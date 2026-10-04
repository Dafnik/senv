import { type ChildProcess, spawn } from 'node:child_process';
import { get } from 'node:http';
import { join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { PublicDeployment } from '../shared/deployments';
import { DockerEngine } from './utils/docker-engine';
import { waitFor } from './deployment-lifecycle.integration-network';

export type LifecycleHarness = {
  engine: DockerEngine;
  instanceId: string;
  directory: string;
  apiPort: number;
  previewPort: number;
  traefikApiPort: number;
  apiProcess: ChildProcess | undefined;
  apiOutput: string;
  cookie: string;
  project: { id: string; slug: string; previewSlug: string };
  first: PublicDeployment;
  replacement: PublicDeployment;
  artifactHash: string;
  artifactVolume: string;
};

export function input(harness: LifecycleHarness, deploymentId: string) {
  return { projectId: harness.project.id, deploymentId };
}

export async function ready(harness: LifecycleHarness, deploymentId: string): Promise<void> {
  await waitFor(async () => {
    const detail = await rpc<PublicDeployment>(
      harness,
      'deployments.detail',
      input(harness, deploymentId),
      true,
    );
    if (detail.status === 'failed')
      throw new Error(`Deployment failed: ${detail.failureReason}\n${harness.apiOutput}`);
    return detail.status === 'healthy' && (await preview(harness, deploymentId)).status === 200;
  });
}

export async function rpc<T>(
  harness: LifecycleHarness,
  method: string,
  data: unknown,
  query = false,
): Promise<T> {
  const url = `http://localhost:${harness.apiPort}/api/trpc/${method}`;
  const response = await fetch(
    query ? `${url}?input=${encodeURIComponent(JSON.stringify({ json: data }))}` : url,
    {
      method: query ? 'GET' : 'POST',
      headers: {
        cookie: harness.cookie,
        origin: 'http://localhost:4200',
        'content-type': 'application/json',
      },
      ...(query ? {} : { body: JSON.stringify({ json: data }) }),
    },
  );
  const value = (await response.json()) as { result?: { data: { json: T } }; error?: unknown };
  if (!response.ok || !value.result) {
    const routes = await readFile(
      join(harness.directory, 'deployments/senv-routes.yml'),
      'utf8',
    ).catch(() => 'unavailable');
    throw new Error(
      `${method} failed: ${JSON.stringify(value)}\nRoute file: ${routes}\n${harness.apiOutput}`,
    );
  }
  return value.result.data.json;
}

export function authRequest(harness: LifecycleHarness, path: string, body: unknown) {
  return fetch(`http://localhost:${harness.apiPort}/api/auth/${path}`, {
    method: 'POST',
    headers: { origin: 'http://localhost:4200', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function preview(
  harness: LifecycleHarness,
  label: string,
  slug = harness.project.previewSlug,
): Promise<{ status: number; body: string }> {
  return new Promise((resolvePreview, reject) => {
    get(
      `http://127.0.0.1:${harness.previewPort}`,
      { headers: { host: `${label}.${slug}.preview.localhost` } },
      (response) => {
        let body = '';
        response.on('data', (chunk: Buffer) => (body += chunk.toString()));
        response.on('end', () => resolvePreview({ status: response.statusCode ?? 0, body }));
        response.on('error', reject);
      },
    ).on('error', reject);
  });
}

export async function inspectOrigin(harness: LifecycleHarness, id: string) {
  const result = await harness.engine.request<{
    State: { Running: boolean };
    Config: { Image: string };
    Mounts: Array<{ Type: string; Name?: string; Destination: string; RW: boolean }>;
    HostConfig: {
      Memory: number;
      NanoCpus: number;
      LogConfig: { Config: Record<string, string> };
    };
  }>('GET', `/containers/senv-${harness.instanceId}-${id}-origin/json`);
  return result.body;
}

export async function ensureImage(harness: LifecycleHarness, image: string): Promise<void> {
  try {
    await harness.engine.request('GET', `/images/${encodeURIComponent(image)}/json`);
  } catch {
    await harness.engine.request('POST', `/images/create?fromImage=${encodeURIComponent(image)}`);
  }
}

export async function startApi(harness: LifecycleHarness): Promise<void> {
  harness.apiOutput = '';
  harness.apiProcess = spawn(process.execPath, [resolve('dist/apps/api/server/index.mjs')], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DATABASE_URL: `file:${join(harness.directory, 'senv.sqlite')}`,
      DEPLOYMENT_STORAGE_DIR: join(harness.directory, 'deployments'),
      DEPLOYMENT_ARTIFACT_VOLUME: harness.artifactVolume,
      BETTER_AUTH_SECRET: 'lifecycle-test-secret-at-least-32-characters',
      PORT: String(harness.apiPort),
      ROOT_DOMAIN: 'localhost',
      API_URL: `http://localhost:${harness.apiPort}`,
      APP_URL: 'http://localhost:4200',
      NODE_ENV: 'development',
      SENV_INSTANCE_ID: harness.instanceId,
      PREVIEW_BASE_DOMAIN: 'preview.localhost',
      PREVIEW_TLS: 'false',
      PREVIEW_ENTRYPOINTS: 'web',
      PREVIEW_DYNAMIC_CONFIG: join(harness.directory, 'deployments/senv-routes.yml'),
      PREVIEW_TRAEFIK_API_URL: `http://127.0.0.1:${harness.traefikApiPort}`,
      DEPLOYMENT_STATIC_ORIGIN_IMAGE: 'nginx:alpine',
      DEPLOYMENT_PROXY_IMAGE: 'nginx:alpine',
    },
  });
  const appendOutput = (chunk: Buffer) => {
    harness.apiOutput = (harness.apiOutput + chunk.toString()).slice(-12_000);
  };
  harness.apiProcess.stdout?.on('data', appendOutput);
  harness.apiProcess.stderr?.on('data', appendOutput);
  await waitFor(async () => {
    if (harness.apiProcess?.exitCode !== null) throw new Error(`API exited: ${harness.apiOutput}`);
    try {
      return (await fetch(`http://localhost:${harness.apiPort}/api/health`)).ok;
    } catch {
      return false;
    }
  });
}

export async function stopApi(harness: LifecycleHarness): Promise<void> {
  const processToStop = harness.apiProcess;
  if (!processToStop || processToStop.exitCode !== null) return;
  await new Promise<void>((done) => {
    const force = setTimeout(() => processToStop.kill('SIGKILL'), 8_000);
    processToStop.once('exit', () => {
      clearTimeout(force);
      done();
    });
    processToStop.kill('SIGTERM');
  });
  harness.apiProcess = undefined;
}
