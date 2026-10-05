import * as z from 'zod';
import {
  deploymentKindSchema,
  repositoryProviderSchema,
  repositoryUrlSchema,
} from './deployment-routing-schemas';
import { deploymentHealthSchema, deploymentProxySchema } from './deployment-proxy-schemas';

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
  registryCredentialId: z.string().min(1).nullable().optional(),
  pinned: z.boolean().default(false),
  source: z
    .object({
      commit: z.string().trim().max(256).optional(),
      branch: z.string().trim().max(512).optional(),
    })
    .default({}),
  port: z.number().int().min(1).max(65535).default(80),
});
