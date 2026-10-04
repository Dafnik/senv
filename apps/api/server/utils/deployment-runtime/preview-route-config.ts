import { createHash } from 'node:crypto';
import type { PreviewRouteTargets } from './contracts';
import { containerName } from './preview-route-identity';

export function buildPreviewRouteConfig(
  targets: PreviewRouteTargets,
  options: {
    instanceId: string;
    entryPoints: string[];
    tls: boolean;
    certificateResolver?: string;
  },
): { config: Record<string, unknown>; hosts: Map<string, string> } {
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
  http.middlewares[`senv-${options.instanceId}-route-snapshot`] = {
    headers: { customRequestHeaders: { 'X-Senv-Route-Snapshot': options.instanceId } },
  };

  for (const [host, deploymentId] of hosts) {
    const token = safeToken(host);
    const routeName = `senv-${options.instanceId}-${token}`;
    const serviceName = `${routeName}-service`;
    const router: Record<string, unknown> = {
      rule: 'Host(`' + host + '`)',
      entryPoints: options.entryPoints,
      service: serviceName,
    };
    if (options.tls) {
      router['tls'] = options.certificateResolver
        ? { certResolver: options.certificateResolver }
        : {};
    }
    http.routers![routeName] = router;
    http.services![serviceName] = {
      loadBalancer: {
        servers: [{ url: `http://${containerName(options.instanceId, deploymentId, 'proxy')}:80` }],
        passHostHeader: true,
      },
    };
  }
  return { config, hosts };
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
