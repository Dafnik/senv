import { createHash, randomBytes } from 'node:crypto';
import { connect } from 'node:net';
import { expect, test } from 'vite-plus/test';

type NginxScenarioContext = {
  origin: string;
  getPorts: () => number[];
  request: (
    index: number,
    path: string,
    headers?: Record<string, string>,
  ) => Promise<{
    response: { status: number; headers: Headers };
    body: string;
  }>;
};

export function registerNginxScenarios(context: NginxScenarioContext): void {
  test('auth cookies never reach deployment origins while ordinary preview cookies still work', async () => {
    for (const cookie of [
      'better-auth.session_token=secret',
      'theme=dark; __Secure-better-auth.session_token=secret; app=value',
      'better-auth.session_token=a; better-auth.session_token=b',
      'better-auth.session_data.0=secret',
    ]) {
      expect(
        JSON.parse((await context.request(0, '/api/cookies', { Cookie: cookie })).body).cookie,
      ).toBe('');
    }
    expect(
      JSON.parse(
        (await context.request(0, '/api/cookies', { Cookie: 'app=value; theme=dark' })).body,
      ).cookie,
    ).toBe('app=value; theme=dark');
  });
  test('specific routes rewrite paths and bypass matching file cache rules', async () => {
    const first = await context.request(0, '/api/app.js');
    const second = await context.request(0, '/api/app.js');
    expect(JSON.parse(first.body).path).toBe('/app.js');
    expect(first.body).not.toBe(second.body);
    expect(JSON.parse((await context.request(0, '/api/admin/users')).body).path).toBe(
      '/special/users',
    );
    expect(JSON.parse((await context.request(0, '/apiary/users')).body).path).toBe('/apiary/users');
  });

  test('external routes send the target authority and origin routes preserve the preview Host', async () => {
    const headers = { Host: 'review.project.preview.localhost', 'X-Forwarded-For': '192.0.2.1' };
    const external = await context.request(0, '/api/users', headers);
    expect(external.response.status).toBe(200);
    expect(JSON.parse(external.body).host).toBe(`${context.origin}:8080`);
    expect(JSON.parse(external.body).forwardedFor).toContain('192.0.2.1');
    expect(JSON.parse((await context.request(0, '/users', headers)).body).host).toBe(headers.Host);
  });

  test('path cache rules win over file rules and default-origin responses are cached', async () => {
    const first = await context.request(0, '/assets/app.js');
    expect((await context.request(0, '/assets/app.js')).body).toBe(first.body);
    await new Promise((resolve) => setTimeout(resolve, 2200));
    expect((await context.request(0, '/assets/app.js')).body).not.toBe(first.body);
    const extension = await context.request(0, '/app.js');
    expect((await context.request(0, '/app.js')).body).toBe(extension.body);
  });

  test('cache honors response restrictions and bypasses request credentials', async () => {
    for (const path of ['/private.js', '/no-store.js', '/set-cookie.js']) {
      expect((await context.request(0, path)).body).not.toBe((await context.request(0, path)).body);
    }
    const publicResponse = await context.request(0, '/identity.js');
    expect((await context.request(0, '/identity.js')).body).toBe(publicResponse.body);
    const credentials: Record<string, string>[] = [
      { Cookie: 'session=value' },
      { Authorization: 'Bearer value' },
    ];
    for (const headers of credentials) {
      expect((await context.request(0, '/identity.js', headers)).body).not.toBe(
        publicResponse.body,
      );
    }
    expect((await context.request(0, '/identity.js')).body).toBe(publicResponse.body);
  });

  test('SPA fallback survives both path and extension cache rules', async () => {
    for (const path of ['/app/dashboard', '/missing.js']) {
      const result = await context.request(0, path);
      expect(result.response.status).toBe(200);
      expect(JSON.parse(result.body).path).toBe('/index.html');
    }
  });

  test('compression follows allowed endings and includes extensionless paths by default', async () => {
    expect(
      (
        await context.request(0, '/compress.js', { 'Accept-Encoding': 'gzip' })
      ).response.headers.get('content-encoding'),
    ).toBe('gzip');
    expect(
      (
        await context.request(0, '/compress.html', { 'Accept-Encoding': 'gzip' })
      ).response.headers.get('content-encoding'),
    ).toBeNull();
    expect(
      (
        await context.request(1, '/extensionless', { 'Accept-Encoding': 'gzip' })
      ).response.headers.get('content-encoding'),
    ).toBe('gzip');
    expect(JSON.parse((await context.request(0, '/missing')).body).path).toBe('/index.html');
  });

  test('streaming flushes before completion and WebSocket upgrades reach the origin', async () => {
    const startedAt = Date.now();
    const response = await fetch(`http://127.0.0.1:${context.getPorts()[0]}/stream`, {
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
      const socket = connect(context.getPorts()[0], '127.0.0.1');
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
}
