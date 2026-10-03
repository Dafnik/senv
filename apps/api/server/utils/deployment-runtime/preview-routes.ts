import { mkdir, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, basename, join } from 'node:path';
import type { DockerEngine } from '../docker-engine';

export type PreviewRouteTargets = {
  baseDomain: string;
  deployments: Array<{ deploymentId: string; projectSlug: string }>;
  branches: Array<{ branchAlias: string; projectSlug: string; deploymentId: string }>;
  tags: Array<{ tag: string; projectSlug: string; deploymentId: string }>;
};
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
    const http: {
      routers?: Record<string, unknown>;
      services?: Record<string, unknown>;
      middlewares: Record<string, unknown>;
    } = { middlewares: {} };
    const config: Record<string, unknown> = { http };
    const baseDomain = normalizeDomain(targets.baseDomain);
    const hosts = new Map<string, string>();
    for (const route of targets.deployments)
      addHost(
        hosts,
        `${safeLabel(route.deploymentId)}.${safeLabel(route.projectSlug)}.${baseDomain}`,
        route.deploymentId,
      );
    for (const route of targets.branches)
      addHost(
        hosts,
        `${safeLabel(route.branchAlias)}.${safeLabel(route.projectSlug)}.${baseDomain}`,
        route.deploymentId,
      );
    for (const route of targets.tags)
      addHost(
        hosts,
        `${safeLabel(route.tag)}.${safeLabel(route.projectSlug)}.${baseDomain}`,
        route.deploymentId,
      );

    // Traefik 3.5 rejects empty routers/services maps and retains its prior snapshot.
    // Omitting them when empty creates a valid middleware-only update that clears old routes.
    if (hosts.size) {
      http.routers = {};
      http.services = {};
    }

    // Traefik can retain its previous provider state for a completely empty file.
    // This unused no-op middleware keeps the per-instance file non-empty without exposing a route.
    http.middlewares[`senv-${this.options.instanceId}-route-snapshot`] = {
      headers: { customRequestHeaders: { 'X-Senv-Route-Snapshot': this.options.instanceId } },
    };

    for (const [host, deploymentId] of hosts) {
      const token = safeToken(host);
      const routeName = `senv-${this.options.instanceId}-${token}`;
      const serviceName = `${routeName}-service`;
      const router: Record<string, unknown> = {
        rule: 'Host(`' + host + '`)',
        entryPoints: this.options.entryPoints,
        service: serviceName,
      };
      if (this.options.tls) {
        router['tls'] = this.options.certificateResolver
          ? { certResolver: this.options.certificateResolver }
          : {};
      }
      http.routers![routeName] = router;
      http.services![serviceName] = {
        loadBalancer: {
          servers: [
            { url: `http://${containerName(this.options.instanceId, deploymentId, 'proxy')}:80` },
          ],
          passHostHeader: true,
        },
      };
    }
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

export function normalizeDomain(domain: string): string {
  const value = domain.trim().toLowerCase().replace(/\.$/, '');
  const labels = value.split('.');
  if (
    !value ||
    value.length > 253 ||
    labels.some(
      (label) =>
        label.length < 1 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
  ) {
    throw new Error(
      'Preview base domain must be a valid DNS domain with labels no longer than 63 characters.',
    );
  }
  return value;
}

function safeLabel(value: string): string {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value))
    throw new Error(`Invalid preview DNS label: ${value}`);
  return value;
}
function safeToken(value: string): string {
  const slug = value
    .replaceAll('.', '-')
    .replace(/[^a-z0-9-]/g, '-')
    .slice(0, 45)
    .replace(/-+$/, '');
  return `${slug}-${createHash('sha256').update(value).digest('hex').slice(0, 12)}`;
}
function addHost(hosts: Map<string, string>, host: string, deploymentId: string): void {
  if (host.length > 253) throw new Error(`Preview hostname exceeds the DNS maximum: ${host}`);
  hosts.set(host, deploymentId);
}
export function containerName(
  instanceId: string,
  deploymentId: string,
  role: 'origin' | 'proxy',
): string {
  if (
    !/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(instanceId) ||
    !/^[a-zA-Z0-9_-]+$/.test(deploymentId)
  )
    throw new Error('Invalid senv container identity.');
  return `senv-${instanceId}-${deploymentId}-${role}`;
}
