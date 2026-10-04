import {
  MAX_NUMBER,
  MIN_NUMBER,
  REQUIRED,
  metadata,
  schema,
  validateStandardSchema,
} from '@angular/forms/signals';
import * as z from 'zod';
import {
  instanceDeploymentDefaultsSchema,
  type InstanceDeploymentDefaults,
} from '@senv/api/shared/deployments';

const bytesPerMiB = 1024 * 1024;
const apiFieldToDraftField: Record<string, keyof AdminDeploymentDefaultsDraft> =
  {
    uploadLimitBytes: 'uploadLimitMiB',
    proxyCpus: 'proxyCpus',
    proxyMemoryBytes: 'proxyMemoryMiB',
    logFiles: 'logFiles',
    logFileSizeBytes: 'logFileSizeMiB',
  };

export type AdminDeploymentDefaultsDraft = {
  uploadLimitMiB: number;
  proxyCpus: string;
  proxyMemoryMiB: number;
  logFiles: number;
  logFileSizeMiB: number;
};

function toApiValues(
  draft: AdminDeploymentDefaultsDraft,
): InstanceDeploymentDefaults {
  return {
    uploadLimitBytes: Math.round(draft.uploadLimitMiB * bytesPerMiB),
    proxyCpus: draft.proxyCpus.trim(),
    proxyMemoryBytes: Math.round(draft.proxyMemoryMiB * bytesPerMiB),
    logFiles: draft.logFiles,
    logFileSizeBytes: Math.round(draft.logFileSizeMiB * bytesPerMiB),
  };
}

export const adminDeploymentDefaultsDraftValueSchema = z
  .object({
    uploadLimitMiB: z.number(),
    proxyCpus: z.string(),
    proxyMemoryMiB: z.number(),
    logFiles: z.number(),
    logFileSizeMiB: z.number(),
  })
  .superRefine((draft, context) => {
    const result = instanceDeploymentDefaultsSchema.safeParse(
      toApiValues(draft),
    );
    if (result.success) return;
    for (const issue of result.error.issues) {
      const field = apiFieldToDraftField[String(issue.path[0])];
      if (!field) continue;
      context.addIssue({
        code: 'custom',
        path: [field],
        message: issue.message,
      });
    }
  });

export const adminDeploymentDefaultsFormSchema =
  schema<AdminDeploymentDefaultsDraft>((path) => {
    metadata(path.uploadLimitMiB, REQUIRED, () => true);
    metadata(path.uploadLimitMiB, MIN_NUMBER, () => 1);
    metadata(path.uploadLimitMiB, MAX_NUMBER, () => 10_240);
    metadata(path.proxyCpus, REQUIRED, () => true);
    metadata(path.proxyMemoryMiB, REQUIRED, () => true);
    metadata(path.proxyMemoryMiB, MIN_NUMBER, () => 16);
    metadata(path.proxyMemoryMiB, MAX_NUMBER, () => 1_024);
    metadata(path.logFiles, REQUIRED, () => true);
    metadata(path.logFiles, MIN_NUMBER, () => 1);
    metadata(path.logFiles, MAX_NUMBER, () => 20);
    metadata(path.logFileSizeMiB, REQUIRED, () => true);
    metadata(path.logFileSizeMiB, MIN_NUMBER, () => 1);
    metadata(path.logFileSizeMiB, MAX_NUMBER, () => 1_024);
    validateStandardSchema(path, adminDeploymentDefaultsDraftValueSchema);
  });

export function toInstanceDeploymentDefaults(
  draft: AdminDeploymentDefaultsDraft,
): InstanceDeploymentDefaults {
  return instanceDeploymentDefaultsSchema.parse(toApiValues(draft));
}
