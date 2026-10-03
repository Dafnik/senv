import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from 'node:net';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';
import { createNginxConfig } from './nginx-config';

const docker = promisify(execFile);
const enabled = process.env['SENV_DOCKER_TESTS'] === 'true';
const namespace = `senv-nginx-review-${randomBytes(5).toString('hex')}`;
const origin = `${namespace}-origin`;
const proxies = [`${namespace}-restricted`, `${namespace}-all`];
let directory: string;
let ports: number[];

const upstream = `
const http = require('node:http');
const crypto = require('node:crypto');
let count = 0;
const server = http.createServer((req, res) => {
  count++;
  if (req.url === '/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('first\\n');
    setTimeout(() => res.end('last\\n'), 1000);
    return;
  }
  if (req.url === '/missing') {
    res.writeHead(404); res.end('missing'); return;
  }
  const body = JSON.stringify({ path: req.url, count, padding: 'a'.repeat(512) });
  const headers = { 'Content-Type': req.url.endsWith('.html') ? 'text/html' : 'text/plain', 'Content-Length': Buffer.byteLength(body), 'X-Origin-Count': String(count) };
  if (req.url.includes('private')) headers['Cache-Control'] = 'private, max-age=60';
  if (req.url.includes('no-store')) headers['Cache-Control'] = 'no-store';
  if (req.url.includes('set-cookie')) headers['Set-Cookie'] = 'session=secret; HttpOnly';
  res.writeHead(200, headers); res.end(body);
});
server.on('upgrade', (req, socket) => {
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: ' + accept + '\\r\\n\\r\\n');
  socket.end(Buffer.from([0x81, 0x02, 0x6f, 0x6b]));
});
server.listen(8080, '0.0.0.0');
`;

async function run(...args: string[]) {
  return (await docker('docker', args, { maxBuffer: 4 * 1024 * 1024 })).stdout.trim();
}

async function request(index: number, path: string, headers?: Record<string, string>) {
  const response = await fetch(`http://127.0.0.1:${ports[index]}${path}`, { headers });
  return { response, body: await response.text() };
}

describe.skipIf(!enabled)('live deployment Nginx behavior', () => {
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'senv-nginx-review-'));
    await run('network', 'create', '--label', 'senv.review=nginx', namespace);
    await run(
      'run',
      '-d',
      '--name',
      origin,
      '--network',
      namespace,
      '--label',
      'senv.review=nginx',
      'node:24-alpine',
      'node',
      '-e',
      upstream,
    );
    for (const [index, name] of proxies.entries()) {
      const config = createNginxConfig({
        deploymentId: `dpl-review-${index}`,
        origin: `http://${origin}:8080`,
        spaFallback: true,
        settings: {
          routes: [
            {
              path: '/api',
              target: `http://${origin}:8080`,
              rewrite: '/',
              connectTimeoutSeconds: 10,
              readTimeoutSeconds: 60,
            },
            {
              path: '/api/admin',
              target: `http://${origin}:8080`,
              rewrite: '/special',
              connectTimeoutSeconds: 10,
              readTimeoutSeconds: 60,
            },
          ],
          cacheRules: [
            { matcher: 'path', value: '/assets', durationSeconds: 1 },
            { matcher: 'extension', value: '.js', durationSeconds: 60 },
          ],
          compression: { enabled: true, endings: index === 0 ? ['.js'] : [] },
        },
      });
      const file = join(directory, `${index}.conf`);
      await writeFile(file, config);
      await run(
        'run',
        '-d',
        '--name',
        name,
        '--network',
        namespace,
        '--label',
        'senv.review=nginx',
        '-p',
        '127.0.0.1::80',
        '-v',
        `${file}:/etc/nginx/nginx.conf:ro`,
        'nginx:alpine',
      );
    }
    ports = await Promise.all(
      proxies.map(async (name) => {
        const binding = await run(
          'inspect',
          '--format',
          '{{(index (index .NetworkSettings.Ports "80/tcp") 0).HostPort}}',
          name,
        );
        return Number(binding);
      }),
    );
    for (let attempts = 0; attempts < 50; attempts++) {
      try {
        await Promise.all(
          ports.map(async (port) => {
            const response = await fetch(`http://127.0.0.1:${port}/`);
            if (response.status !== 200) throw new Error('Proxy is not ready.');
          }),
        );
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    throw new Error('Review proxies did not become ready.');
  }, 120_000);

  afterAll(async () => {
    for (const name of [...proxies, origin]) {
      await run('rm', '-f', name).catch(() => undefined);
    }
    await run('network', 'rm', namespace).catch(() => undefined);
    if (directory) await rm(directory, { recursive: true, force: true });
  }, 30_000);

  test('specific routes rewrite paths and bypass matching file cache rules', async () => {
    const first = await request(0, '/api/app.js');
    const second = await request(0, '/api/app.js');
    expect(JSON.parse(first.body).path).toBe('/app.js');
    expect(first.body).not.toBe(second.body);
    expect(JSON.parse((await request(0, '/api/admin/users')).body).path).toBe('/special/users');
    expect(JSON.parse((await request(0, '/apiary/users')).body).path).toBe('/apiary/users');
  });

  test('path cache rules win over file rules and default-origin responses are cached', async () => {
    const first = await request(0, '/assets/app.js');
    expect((await request(0, '/assets/app.js')).body).toBe(first.body);
    await new Promise((resolve) => setTimeout(resolve, 2200));
    expect((await request(0, '/assets/app.js')).body).not.toBe(first.body);
    const extension = await request(0, '/app.js');
    expect((await request(0, '/app.js')).body).toBe(extension.body);
  });

  test('cache honors response restrictions and bypasses request credentials', async () => {
    for (const path of ['/private.js', '/no-store.js', '/set-cookie.js']) {
      expect((await request(0, path)).body).not.toBe((await request(0, path)).body);
    }
    const publicResponse = await request(0, '/identity.js');
    expect((await request(0, '/identity.js')).body).toBe(publicResponse.body);
    const credentials: Record<string, string>[] = [
      { Cookie: 'session=value' },
      { Authorization: 'Bearer value' },
    ];
    for (const headers of credentials) {
      expect((await request(0, '/identity.js', headers)).body).not.toBe(publicResponse.body);
    }
    expect((await request(0, '/identity.js')).body).toBe(publicResponse.body);
  });

  test('compression follows allowed endings and includes extensionless paths by default', async () => {
    expect(
      (await request(0, '/compress.js', { 'Accept-Encoding': 'gzip' })).response.headers.get(
        'content-encoding',
      ),
    ).toBe('gzip');
    expect(
      (await request(0, '/compress.html', { 'Accept-Encoding': 'gzip' })).response.headers.get(
        'content-encoding',
      ),
    ).toBeNull();
    expect(
      (await request(1, '/extensionless', { 'Accept-Encoding': 'gzip' })).response.headers.get(
        'content-encoding',
      ),
    ).toBe('gzip');
    expect(JSON.parse((await request(0, '/missing')).body).path).toBe('/index.html');
  });

  test('streaming flushes before completion and WebSocket upgrades reach the origin', async () => {
    const startedAt = Date.now();
    const response = await fetch(`http://127.0.0.1:${ports[0]}/stream`, {
      headers: { 'Accept-Encoding': 'identity' },
    });
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('first');
    expect(Date.now() - startedAt).toBeLessThan(800);
    while (!(await reader.read()).done) {
      /* drain the streaming response */
    }
    const key = randomBytes(16).toString('base64');
    const expected = createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    const bytes = await new Promise<Buffer>((resolve, reject) => {
      const socket = connect(ports[0], '127.0.0.1');
      const chunks: Buffer[] = [];
      socket.setTimeout(5000, () => socket.destroy(new Error('WebSocket upgrade timed out.')));
      socket.once('error', reject);
      socket.on('data', (chunk) => chunks.push(chunk));
      socket.once('end', () => resolve(Buffer.concat(chunks)));
      socket.once('connect', () =>
        socket.write(
          `GET /websocket HTTP/1.1\r\nHost: review.localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${key}\r\n\r\n`,
        ),
      );
    });
    expect(bytes.toString()).toContain('101 Switching Protocols');
    expect(bytes.toString()).toContain(expected);
    expect(bytes.subarray(-2).toString()).toBe('ok');
  });
});
