import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { afterEach, expect, test } from 'vite-plus/test';
import { requestDeploymentPreview } from './deployment-preview-status';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

async function listen(server: Server) {
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port.');
  return `http://deployment.project.preview.localhost:${address.port}/`;
}

test('GET reports the public HTTP status and resolves local preview hosts without sending credentials', async () => {
  let status = 404;
  const url = await listen(
    createServer((request, response) => {
      expect(request.method).toBe('GET');
      expect(request.url).toBe('/');
      expect(request.headers.host).toContain('deployment.project.preview.localhost');
      expect(request.headers.cookie).toBeUndefined();
      expect(request.headers.authorization).toBeUndefined();
      response.writeHead(status).end();
    }),
  );
  const missing = await requestDeploymentPreview(url);
  expect(missing).toMatchObject({ url, statusCode: 404, error: null });
  expect(missing.checkedAt).toBeInstanceOf(Date);
  expect(missing.responseTimeMs).toBeGreaterThanOrEqual(0);
  status = 200;
  expect(await requestDeploymentPreview(url)).toMatchObject({ statusCode: 200, error: null });
});

test('reports redirects without following them or waiting for the response body', async () => {
  const paths: string[] = [];
  const url = await listen(
    createServer((request, response) => {
      paths.push(request.url!);
      response.writeHead(302, { location: '/redirect-target' });
      response.flushHeaders();
    }),
  );
  expect(await requestDeploymentPreview(url, 500)).toMatchObject({ statusCode: 302, error: null });
  expect(paths).toEqual(['/']);
});

test('bounds a preview that never sends headers and reports connection refusal', async () => {
  const server = createServer(() => {});
  const url = await listen(server);
  expect(await requestDeploymentPreview(url, 30)).toMatchObject({
    statusCode: null,
    error: 'The preview did not respond within 0.03 seconds.',
  });
  await new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
  expect(await requestDeploymentPreview(url)).toMatchObject({
    statusCode: null,
    error: 'The preview server refused the connection.',
  });
});
