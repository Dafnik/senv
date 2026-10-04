import * as z from 'zod';
import {
  normalizedPathSchema,
  proxyPathKey,
  cacheMatcherKey,
  proxyMatcherConflicts,
} from './deployment-routing-schemas';

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
    {
      message: 'Cache matchers must be a normalized path or file extension.',
      path: ['value'],
    },
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
