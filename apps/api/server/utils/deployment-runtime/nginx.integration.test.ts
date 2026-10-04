import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get } from 'node:http';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe } from 'vite-plus/test';
import { registerNginxScenarios } from './nginx.integration-scenarios';
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
  if (req.url === '/missing' || req.url === '/app/dashboard' || req.url === '/missing.js') {
    res.writeHead(404); res.end('missing'); return;
  }
  const body = JSON.stringify({ path: req.url, host: req.headers.host, forwardedFor: req.headers['x-forwarded-for'], count, padding: 'a'.repeat(512) });
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

function request(index: number, path: string, headers?: Record<string, string>) {
  return new Promise<{ response: { status: number; headers: Headers }; body: string }>(
    (resolve, reject) => {
      const req = get(`http://127.0.0.1:${ports[index]}${path}`, { headers }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.once('error', reject);
        response.once('end', () => {
          const resultHeaders = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (value !== undefined)
              resultHeaders.set(name, Array.isArray(value) ? value.join(', ') : value);
          }
          resolve({
            response: { status: response.statusCode!, headers: resultHeaders },
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      });
      req.once('error', reject);
    },
  );
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
            { matcher: 'path', value: '/app', durationSeconds: 60 },
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

  registerNginxScenarios({ origin, getPorts: () => ports, request });
});
