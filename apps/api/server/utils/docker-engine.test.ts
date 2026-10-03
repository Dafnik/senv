import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vite-plus/test';
import { DockerEngine } from './docker-engine';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function engineFixture(
  handler: (
    request: IncomingMessage,
    response: ServerResponse,
    body: Buffer,
  ) => void | Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), 'senv-docker-engine-'));
  const socketPath = join(directory, 'engine.sock');
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    await handler(request, response, Buffer.concat(chunks));
  });
  server.listen(socketPath);
  await once(server, 'listening');
  cleanups.push(async () => {
    server.close();
    await once(server, 'close');
    await rm(directory, { recursive: true, force: true });
  });
  return { engine: new DockerEngine({ socketPath, timeoutMs: 2_000 }), directory };
}

test('speaks versioned Docker HTTP over a Unix socket and parses JSON', async () => {
  const { engine } = await engineFixture((request, response) => {
    expect(request.url).toBe('/v1.45/version');
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ApiVersion: '1.45' }));
  });
  await expect(engine.request<{ ApiVersion: string }>('GET', '/version')).resolves.toMatchObject({
    body: { ApiVersion: '1.45' },
  });
});

test('streams Docker archive uploads and does not miss an immediate response', async () => {
  const { engine, directory } = await engineFixture(async (request, response, body) => {
    expect(request.method).toBe('PUT');
    expect(request.url).toBe('/v1.45/containers/example/archive?path=%2Fsite');
    expect(body.toString()).toBe('archive bytes');
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{}');
  });
  const file = join(directory, 'site.tar');
  await writeFile(file, 'archive bytes');
  await expect(
    engine.uploadFile('PUT', '/containers/example/archive?path=%2Fsite', file),
  ).resolves.toBeUndefined();
  expect(await readFile(file, 'utf8')).toBe('archive bytes');
});

test('preserves binary Docker multiplex streams for log and exec decoding', async () => {
  const { engine } = await engineFixture((request, response) => {
    const frame = Buffer.alloc(12);
    frame[0] = 1;
    frame.writeUInt32BE(4, 4);
    frame.write('test', 8);
    response.writeHead(200, { 'content-type': 'application/vnd.docker.raw-stream' });
    response.end(frame);
  });
  const result = await engine.request<Buffer>('GET', '/containers/example/logs?stdout=1');
  expect(Buffer.isBuffer(result.body)).toBe(true);
  expect(result.body.subarray(8).toString()).toBe('test');
});

test('reports JSON stream errors from a successful HTTP image-pull response', async () => {
  const { engine } = await engineFixture((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"status":"Pulling"}\n{"errorDetail":{"message":"denied"},"error":"denied"}\n');
  });
  await expect(engine.request('POST', '/images/create?fromImage=private%2Fimage')).rejects.toThrow(
    'Docker image pull failed: denied',
  );
});
