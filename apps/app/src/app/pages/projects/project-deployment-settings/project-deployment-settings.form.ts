import * as z from 'zod';
import { deploymentSettingsSchema } from '@senv/api/shared/deployments';
import { previewSlugSchema } from '@senv/api/shared/validation';
import {
  settingsFromModel,
  type SettingsModel,
} from './project-deployment-settings.model';

const settingsDraftSchema = z.object({
  spaFallback: z.boolean(),
  repository: z.string(),
  repositoryProvider: z.enum(['github', 'gitlab', 'forgejo', 'gitea']),
  retentionDays: z.number(),
  originCpus: z.string(),
  originMemoryMiB: z.number(),
  health: z.object({
    path: z.string(),
    startupDeadlineSeconds: z.number(),
    intervalSeconds: z.number(),
    timeoutSeconds: z.number(),
    unhealthyThreshold: z.number(),
  }),
  proxy: z.object({
    routes: z.array(
      z.object({
        path: z.string(),
        target: z.string(),
        rewrite: z.string(),
        connectTimeoutSeconds: z.number(),
        readTimeoutSeconds: z.number(),
      }),
    ),
    cacheRules: z.array(
      z.object({
        matcher: z.enum(['path', 'extension']),
        value: z.string(),
        durationSeconds: z.number(),
      }),
    ),
    compression: z.object({
      enabled: z.boolean(),
      endings: z.array(z.string()),
    }),
  }),
  compressionEndings: z.string(),
}) satisfies z.ZodType<SettingsModel>;

export function restoreSettingsModel(
  value: unknown,
  defaults: SettingsModel,
): SettingsModel | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return null;
  const parsed = settingsDraftSchema.safeParse({ ...defaults, ...value });
  return parsed.success ? parsed.data : null;
}

export const projectDeploymentSettingsFormSchema =
  settingsDraftSchema.superRefine((draft, context) => {
    const result = deploymentSettingsSchema.safeParse(settingsFromModel(draft));
    if (!result.success) {
      for (const issue of result.error.issues) {
        const path = issue.path.some(
          (part, index) =>
            part === 'endings' && issue.path[index - 1] === 'compression',
        )
          ? ['compressionEndings']
          : issue.path.map((part) =>
              part === 'originMemoryBytes' ? 'originMemoryMiB' : part,
            );
        context.addIssue({ code: 'custom', path, message: issue.message });
      }
    }

    if (draft.health.timeoutSeconds > draft.health.intervalSeconds) {
      context.addIssue({
        code: 'custom',
        path: ['health', 'timeoutSeconds'],
        message: 'Probe timeout cannot exceed the polling interval.',
      });
    }
  });

export const projectPreviewSlugFormSchema = z.object({
  previewSlug: previewSlugSchema,
});
