import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import type { DockerEngine } from '../docker-engine';

import type { PreviewRouteTargets } from './contracts';
import { buildPreviewRouteConfig } from './preview-route-config';
import { containerName } from './preview-route-identity';
export type { PreviewRouteTargets } from './contracts';
export { containerName } from './preview-route-identity';
export { normalizeDomain } from './preview-route-config';
export type PreviewRouteOptions = {
  configFile: string;
  instanceId: string;
  entryPoints: string[];
  tls: boolean;
  certificateResolver?: string;
  apiUrl?: string;
  acknowledgementTimeoutMs?: number;
  engine: DockerEngine;
  networkName: string;
};

/** Atomically replaces Traefik's file-provider snapshot after ensuring it shares our private network. */
export class PreviewRoutePublisher {
  #serial = Promise.resolve();
  constructor(readonly options: PreviewRouteOptions) {}

  publish(targets: PreviewRouteTargets): Promise<void> {
    const next = this.#serial.then(() => this.#publish(targets));
    this.#serial = next.catch(() => {});
    return next;
  }

  async #publish(targets: PreviewRouteTargets): Promise<void> {
    const { config, hosts } = buildPreviewRouteConfig(targets, this.options);
    const tempPath = join(
      dirname(this.options.configFile),
      `.${basename(this.options.configFile)}-${process.pid}-${Date.now()}.tmp`,
    );
    await mkdir(dirname(this.options.configFile), { recursive: true, mode: 0o750 });
    await writeFile(tempPath, JSON.stringify(config), { mode: 0o640 });
    await rename(tempPath, this.options.configFile);
    if (this.options.apiUrl) await this.#waitUntilLoaded(hosts);
  }

  async #waitUntilLoaded(expected: Map<string, string>): Promise<void> {
    const deadline = Date.now() + (this.options.acknowledgementTimeoutMs ?? 15_000);
    let lastError = 'Traefik has not loaded the preview route snapshot.';
    while (Date.now() < deadline) {
      try {
        const [routerResponse, serviceResponse] = await Promise.all([
          fetch(`${this.options.apiUrl}/api/http/routers`, { signal: AbortSignal.timeout(2_000) }),
          fetch(`${this.options.apiUrl}/api/http/services`, { signal: AbortSignal.timeout(2_000) }),
        ]);
        if (!routerResponse.ok || !serviceResponse.ok)
          throw new Error(
            `Traefik API returned ${routerResponse.status}/${serviceResponse.status}.`,
          );
        const routers = (await routerResponse.json()) as Array<{
          name?: string;
          rule?: string;
          service?: string;
          status?: string;
        }>;
        const services = (await serviceResponse.json()) as Array<{
          name?: string;
          loadBalancer?: { servers?: Array<{ url?: string }> };
        }>;
        const prefix = `senv-${this.options.instanceId}-`;
        const actual = routers.filter((router) => router.name?.startsWith(prefix));
        const actualHosts = new Set(
          actual
            .map((router) => router.rule?.match(/^Host\(`([^`]+)`\)$/)?.[1])
            .filter((host): host is string => Boolean(host)),
        );
        const expectedHosts = new Set(expected.keys());
        if (
          actualHosts.size === expectedHosts.size &&
          [...expectedHosts].every((host) => actualHosts.has(host))
        ) {
          const serviceMap = new Map(
            services.map((service) => [
              service.name?.replace(/@file$/, ''),
              service.loadBalancer?.servers?.[0]?.url,
            ]),
          );
          const allReady = [...expected].every(([host, deploymentId]) => {
            const router = actual.find(
              (item) => item.rule === 'Host(`' + host + '`)' && item.status === 'enabled',
            );
            const actualUrl = router?.service
              ? serviceMap.get(router.service.replace(/@file$/, ''))
              : undefined;
            const expectedUrl = `http://${containerName(this.options.instanceId, deploymentId, 'proxy')}:80`;
            return actualUrl === expectedUrl;
          });
          if (allReady) return;
          lastError = `Traefik routes were present, but proxy targets did not match: ${JSON.stringify(actual.map((router) => ({ name: router.name, rule: router.rule, status: router.status, service: router.service, url: router.service ? serviceMap.get(router.service.replace(/@file$/, '')) : undefined })))}.`;
        } else
          lastError = `Traefik loaded hosts [${[...actualHosts].sort().join(', ')}], expected [${[...expectedHosts].sort().join(', ')}]; routers: ${JSON.stringify(actual.map((router) => ({ name: router.name, rule: router.rule, status: router.status, service: router.service })))}.`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Traefik did not acknowledge the atomic preview route update: ${lastError}`);
  }

  async ensureNetwork(): Promise<void> {
    const listed = await this.options.engine.request<
      Array<{ Id: string; Name: string; Labels?: Record<string, string> }>
    >(
      'GET',
      `/networks?filters=${encodeURIComponent(JSON.stringify({ name: [this.options.networkName] }))}`,
    );
    const existing = listed.body.find((network) => network.Name === this.options.networkName);
    if (existing) {
      const inspected = await this.options.engine.request<{
        Id: string;
        Labels?: Record<string, string>;
      }>('GET', `/networks/${existing.Id}`);
      if (inspected.body.Labels?.['senv.instance'] !== this.options.instanceId)
        throw new Error(
          `Docker network ${this.options.networkName} is not owned by this senv instance.`,
        );
      return;
    }
    await this.options.engine.request('POST', `/networks/create`, {
      Name: this.options.networkName,
      Driver: 'bridge',
      CheckDuplicate: true,
      Labels: { 'senv.managed': 'true', 'senv.instance': this.options.instanceId },
    });
  }
}
