import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vite-plus/test';
import { DockerEngine, type DockerResponse } from '../../../infrastructure/docker-engine';
import { PreviewRoutePublisher } from './preview-routes';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

class NetworkEngine extends DockerEngine {
  private exists = false;
  override async request<T = unknown>(method: string, path: string): Promise<DockerResponse<T>> {
    let body: unknown = {};
    if (path.startsWith('/networks?'))
      body = this.exists ? [{ Id: 'network', Name: 'senv-preview-test' }] : [];
    else if (path === '/networks/create') this.exists = true;
    else if (path === '/networks/network')
      body = { Id: 'network', Labels: { 'senv.instance': 'test' } };
    return { status: 200, headers: {}, body: body as T };
  }
}

test('acknowledges route replacement through the final empty snapshot', async () => {
  const root = await mkdtemp(join(tmpdir(), 'senv-preview-routes-'));
  cleanups.push(async () => rm(root, { recursive: true, force: true }));
  const configFile = join(root, 'senv-routes.yml');
  const server = createServer(async (request, response) => {
    const config = JSON.parse(await readFile(configFile, 'utf8')) as {
      http: {
        routers?: Record<string, { rule: string; service: string }>;
        services?: Record<string, { loadBalancer: { servers: Array<{ url: string }> } }>;
      };
    };
    if (request.url === '/api/http/routers') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify(
          Object.entries(config.http.routers ?? {}).map(([name, router]) => ({
            name: `${name}@file`,
            rule: router.rule,
            service: router.service,
            status: 'enabled',
          })),
        ),
      );
    } else if (request.url === '/api/http/services') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify(
          Object.entries(config.http.services ?? {}).map(([name, service]) => ({
            name: `${name}@file`,
            loadBalancer: service.loadBalancer,
          })),
        ),
      );
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  cleanups.push(async () => {
    server.close();
    await once(server, 'close');
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Preview route test server did not bind a TCP port.');
  const publisher = new PreviewRoutePublisher({
    configFile,
    instanceId: 'test',
    entryPoints: ['web'],
    tls: false,
    apiUrl: `http://127.0.0.1:${address.port}`,
    acknowledgementTimeoutMs: 1_000,
    engine: new NetworkEngine(),
    networkName: 'senv-preview-test',
  });
  const first = { deploymentId: 'dpl-one', projectSlug: 'project', branchAlias: 'br-main' };
  const second = { deploymentId: 'dpl-two', projectSlug: 'project', branchAlias: 'br-main' };
  await publisher.publish({
    baseDomain: 'preview.localhost',
    deployments: [first, second],
    branches: [],
    tags: [],
  });
  await publisher.publish({
    baseDomain: 'preview.localhost',
    deployments: [second],
    branches: [],
    tags: [],
  });
  await publisher.publish({
    baseDomain: 'preview.localhost',
    deployments: [],
    branches: [],
    tags: [],
  });

  const config = JSON.parse(await readFile(configFile, 'utf8')) as {
    http: {
      routers: Record<string, unknown>;
      services: Record<string, unknown>;
      middlewares: Record<string, unknown>;
    };
  };
  expect(config.http.routers).toBeUndefined();
  expect(config.http.services).toBeUndefined();
  expect(Object.keys(config.http.middlewares)).toEqual(['senv-test-route-snapshot']);
});
