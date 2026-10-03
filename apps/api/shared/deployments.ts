import * as z from 'zod';

export const deploymentKindSchema = z.enum(['static', 'container']);
export const repositoryProviderSchema = z.enum(['github', 'gitlab', 'forgejo', 'gitea']);
export type RepositoryProvider = z.infer<typeof repositoryProviderSchema>;
export const repositoryProviders: ReadonlyArray<{ value: RepositoryProvider; label: string }> = [
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

export const deploymentHealthSchema = z.object({
  path: normalizedPathSchema.default('/'),
  startupDeadlineSeconds: z.number().int().min(5).max(3600).default(60),
  intervalSeconds: z.number().int().min(1).max(300).default(5),
  timeoutSeconds: z.number().int().min(1).max(60).default(3),
  unhealthyThreshold: z.number().int().min(1).max(20).default(3),
});
export const proxyRouteSchema = z.object({
  path: normalizedPathSchema,
  target: z
    .string()
    .trim()
    .max(2048)
    .refine((value) => {
      try {
        if (/[\r\n"'\\;${}]/.test(value)) return false;
        const url = new URL(value.includes('://') ? value : `http://${value}`);
        return (
          ['http:', 'https:'].includes(url.protocol) &&
          /^[a-zA-Z0-9.-]+$/.test(url.hostname) &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash &&
          !url.pathname.split('/').some((part) => part === '.' || part === '..')
        );
      } catch {
        return false;
      }
    }, 'Enter a safe HTTP(S) host or URL without query or fragment.'),
  rewrite: normalizedPathSchema.optional(),
  connectTimeoutSeconds: z.number().int().min(1).max(300).default(10),
  readTimeoutSeconds: z.number().int().min(1).max(3600).default(60),
});
export const cacheRuleSchema = z
  .object({
    matcher: z.enum(['path', 'extension']),
    value: z.string().trim().min(1).max(255),
    durationSeconds: z.number().int().min(1).max(604800),
  })
  .refine(
    (rule) =>
      rule.matcher === 'path'
        ? normalizedPathSchema.safeParse(rule.value).success
        : /^\.?[A-Za-z0-9]+$/.test(rule.value),
    'Cache matchers must be a normalized path or file extension.',
  );
export const deploymentProxySchema = z
  .object({
    routes: z.array(proxyRouteSchema).max(100).default([]),
    cacheRules: z.array(cacheRuleSchema).max(100).default([]),
    compression: z
      .object({
        enabled: z.boolean().default(true),
        endings: z
          .array(z.string().regex(/^\.[a-z0-9]+$/i))
          .max(100)
          .default([]),
      })
      .default({ enabled: true, endings: [] }),
  })
  .superRefine((proxy, ctx) => {
    const conflicts = proxyMatcherConflicts(proxy);
    for (const [index, route] of proxy.routes.entries()) {
      const key = proxyPathKey(route.path);
      if (conflicts.routes.has(key))
        ctx.addIssue({
          code: 'custom',
          path: ['routes', index, 'path'],
          message: 'This route path is already configured.',
        });
    }
    for (const [index, rule] of proxy.cacheRules.entries()) {
      const key = cacheMatcherKey(rule);
      if (conflicts.cacheRules.has(key))
        ctx.addIssue({
          code: 'custom',
          path: ['cacheRules', index, 'value'],
          message: 'This cache matcher is already configured.',
        });
    }
  });
export type DeploymentActor = { id: string; name: string };

export const deploymentSettingsSchema = z.object({
  spaFallback: z.boolean().default(false),
  repository: repositoryUrlSchema.default(''),
  repositoryProvider: repositoryProviderSchema.default('github'),
  retentionDays: z.number().int().min(1).max(3650).default(7),
  originCpus: z
    .string()
    .regex(/^(?:0\.0*[1-9]\d{0,2}|[1-9]\d{0,2}(?:\.\d{1,3})?)$/)
    .refine((value) => Number(value) <= 128, 'CPU allowance cannot exceed 128.')
    .default('1'),
  originMemoryBytes: z
    .number()
    .int()
    .min(16 * 1024 * 1024)
    .max(1024 * 1024 * 1024 * 1024)
    .default(536870912),
  health: deploymentHealthSchema.prefault({}),
  proxy: deploymentProxySchema.prefault({}),
});
export const instanceDeploymentDefaultsSchema = z.object({
  uploadLimitBytes: z
    .number()
    .int()
    .min(1)
    .max(10 * 1024 * 1024 * 1024)
    .default(104857600),
  proxyCpus: z
    .string()
    .regex(/^(?:0\.0*[1-9]\d{0,2}|[1-9]\d{0,2}(?:\.\d{1,3})?)$/)
    .refine((value) => Number(value) <= 128, 'CPU allowance cannot exceed 128.')
    .default('0.1'),
  proxyMemoryBytes: z
    .number()
    .int()
    .min(16 * 1024 * 1024)
    .max(1024 * 1024 * 1024)
    .default(67108864),
  logFiles: z.number().int().min(1).max(20).default(3),
  logFileSizeBytes: z
    .number()
    .int()
    .min(1024)
    .max(1024 * 1024 * 1024)
    .default(10485760),
});

export const runtimeVariableNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const runtimeValuesSchema = z.record(runtimeVariableNameSchema, z.string().max(16384));
export const projectRuntimeUpdateSchema = z.object({
  env: runtimeValuesSchema,
  secrets: runtimeValuesSchema.default({}),
  removeSecretNames: z.array(runtimeVariableNameSchema).default([]),
});
export type ProjectRuntimeUpdate = z.infer<typeof projectRuntimeUpdateSchema>;

export const publishDeploymentSchema = z.strictObject({
  projectId: z.string().min(1),
  kind: deploymentKindSchema,
  artifactId: z.string().min(1).optional(),
  reuseDeploymentId: z.string().min(1).optional(),
  image: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/)
    .max(2048)
    .optional(),
  registryCredentialId: z.string().min(1).optional(),
  pinned: z.boolean().default(false),
  source: z
    .object({
      commit: z.string().trim().max(256).optional(),
      branch: z.string().trim().max(512).optional(),
    })
    .default({}),
  port: z.number().int().min(1).max(65535).default(80),
});
export type DeploymentKind = z.infer<typeof deploymentKindSchema>;
export type DeploymentStatus = z.infer<typeof deploymentStatusSchema>;
export type DeploymentHealth = z.infer<typeof deploymentHealthSchema>;
export type DeploymentProxy = z.infer<typeof deploymentProxySchema>;
export type DeploymentSettings = z.infer<typeof deploymentSettingsSchema>;
export type InstanceDeploymentDefaults = z.infer<typeof instanceDeploymentDefaultsSchema>;
export type PublishDeploymentInput = z.infer<typeof publishDeploymentSchema>;

export type DeploymentSource = PublishDeploymentInput['source'] & {
  repository?: string;
  repositoryProvider?: RepositoryProvider;
};

export type DeploymentSnapshot = {
  kind: DeploymentKind;
  artifactId: string | null;
  image: string | null;
  registryCredentialId: string | null;
  pinned: boolean;
  source: DeploymentSource;
  secretNames: string[];
  port: number;
  env: Record<string, string>;
  spaFallback: boolean;
  runtimeFingerprint: string;
  retentionDays: number;
  health: DeploymentHealth;
  proxy: DeploymentProxy;
  limits: {
    origin: { cpus: string; memoryBytes: number };
    proxy: { cpus: string; memoryBytes: number };
  };
  logs: { files: number; fileSizeBytes: number };
};

export type PublicDeployment = {
  id: string;
  projectId: string;
  kind: DeploymentKind;
  status: DeploymentStatus;
  removalPending: boolean;
  configurationOutdated: boolean;
  configurationChanges: string[];
  previewUrl: string;
  desiredState: 'running' | 'stopped';
  pinned: boolean;
  artifactId: string | null;
  imageDigest: string | null;
  source: DeploymentSource;
  submittedAt: Date;
  readyAt: Date | null;
  retentionStartedAt: Date | null;
  retentionDeadlineAt: Date | null;
  failureReason: string | null;
  config: {
    retentionDays: number;
    image?: string;
    port: number;
    env: Record<string, string>;
    spaFallback: boolean;
    health: DeploymentHealth;
    proxy: DeploymentProxy;
    limits: {
      origin: { cpus: string; memoryBytes: number };
      proxy: { cpus: string; memoryBytes: number };
    };
    logs: { files: number; fileSizeBytes: number };
    secretNames: string[];
    hasSecrets: boolean;
  };
  branchAlias: string | null;
  tags: string[];
};

export type DeploymentLogCursor = { sequence: number };
export type DeploymentPreviewStatus = {
  url: string;
  statusCode: number | null;
  checkedAt: Date;
  responseTimeMs: number;
  error: string | null;
};
export type DeploymentLogPage = {
  logs: Array<{
    id: string;
    deploymentId: string;
    source: 'proxy' | 'origin';
    content: string;
    createdAt: Date;
  }>;
  nextCursor: DeploymentLogCursor | null;
};

// TAR supports every compression codec provided by the instance's Node runtime.
export const staticArchiveExtensions = [
  '.zip',
  '.tar',
  '.tgz',
  '.gz',
  '.gzip',
  '.br',
  '.zst',
  '.zstd',
  '.tzst',
  '.zz',
  '.zlib',
  '.deflate',
  '.deflate-raw',
] as const;
export type DeploymentAuditEntry = {
  id: string;
  projectId: string;
  deploymentId: string;
  event: string;
  actorType: 'user' | 'system';
  actor: DeploymentActor | null;
  details: Record<string, unknown>;
  createdAt: Date;
};
