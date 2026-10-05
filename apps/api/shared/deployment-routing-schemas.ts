import * as z from 'zod';

export const deploymentKindSchema = z.enum(['static', 'container']);
export const repositoryProviderSchema = z.enum(['github', 'gitlab', 'forgejo', 'gitea']);
export type RepositoryProvider = z.infer<typeof repositoryProviderSchema>;
export const repositoryProviders: ReadonlyArray<{
  value: RepositoryProvider;
  label: string;
}> = [
  { value: 'github', label: 'GitHub' },
  { value: 'gitlab', label: 'GitLab' },
  { value: 'forgejo', label: 'Forgejo' },
  { value: 'gitea', label: 'Gitea' },
];
export const deploymentStatusSchema = z.enum([
  'queued',
  'starting',
  'healthy',
  'unhealthy',
  'stopped',
  'failed',
  'deleted',
  'cleaned',
]);
export const repositoryUrlSchema = z.union([
  z.literal(''),
  z
    .url()
    .max(2048)
    .refine((value) => {
      try {
        const url = new URL(value);
        return (
          ['https:', 'http:', 'ssh:'].includes(url.protocol) &&
          !url.password &&
          (!url.username || (url.protocol === 'ssh:' && url.username === 'git')) &&
          !url.search &&
          !url.hash
        );
      } catch {
        return false;
      }
    }, 'Repository URLs cannot include credentials, queries, or fragments.'),
]);
export const registryServerSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value.includes('://') ? value : `https://${value}`);
      return (
        ['https:', 'http:'].includes(url.protocol) &&
        /^[a-zA-Z0-9.\-[\]:]+$/.test(url.host) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        url.pathname === '/'
      );
    } catch {
      return false;
    }
  }, 'Enter a registry host or HTTP(S) origin without credentials or a path.');
export function isValidPreviewHostname(
  projectSlug: string,
  deploymentLabel: string,
  baseDomain: string,
) {
  const domainIsValid =
    baseDomain.length <= 253 &&
    !baseDomain.includes('://') &&
    baseDomain
      .split('.')
      .every(
        (label) =>
          label.length > 0 &&
          label.length <= 63 &&
          /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label),
      );
  return (
    domainIsValid &&
    deploymentLabel.length <= 63 &&
    /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(deploymentLabel) &&
    `${deploymentLabel}.${projectSlug}.${baseDomain}`.length <= 253
  );
}
export const normalizedPathSchema = z
  .string()
  .trim()
  .regex(/^\/[a-zA-Z0-9_~./-]*$/)
  .max(1024)
  .refine(
    (value) =>
      !value.includes('//') && !value.split('/').some((part) => part === '.' || part === '..'),
    'Enter a normalized absolute path.',
  );

export function proxyPathKey(value: string): string {
  return value.trim().replace(/\/+$/g, '') || '/';
}
export function proxyExtensionKey(value: string): string {
  return value.trim().replace(/^\./, '').toLowerCase();
}
export function cacheMatcherKey(rule: { matcher: 'path' | 'extension'; value: string }): string {
  return `${rule.matcher}:${rule.matcher === 'path' ? proxyPathKey(rule.value) : proxyExtensionKey(rule.value)}`;
}

export function proxyMatcherConflicts(proxy: {
  routes: ReadonlyArray<{ path: string }>;
  cacheRules: ReadonlyArray<{ matcher: 'path' | 'extension'; value: string }>;
}) {
  const duplicates = (keys: string[]) => {
    const seen = new Set<string>();
    const repeated = new Set<string>();
    for (const key of keys) {
      if (seen.has(key)) repeated.add(key);
      seen.add(key);
    }
    return repeated;
  };
  return {
    routes: duplicates(proxy.routes.map((route) => proxyPathKey(route.path))),
    cacheRules: duplicates(proxy.cacheRules.map(cacheMatcherKey)),
  };
}
