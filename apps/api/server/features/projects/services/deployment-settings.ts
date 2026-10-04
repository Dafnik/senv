import { TRPCError } from '@trpc/server';
import {
  deploymentSettingsSchema,
  projectRuntimeUpdateSchema,
} from '../../../../shared/deployments';
import { db } from '../../../infrastructure/db';
import { decrypt, encrypt } from '../../deployments/domain/secrets';
import {
  findProjectDeploymentSettings,
  findProjectRuntime,
  saveProjectDeploymentSettings,
  saveProjectRuntime,
} from '../repositories/deployment-settings';

const defaultSettings = deploymentSettingsSchema.parse({});

export function projectRuntimeValues(projectId: string) {
  const saved = findProjectRuntime(projectId);
  return {
    env: saved?.env ?? {},
    secrets: saved?.secretsCiphertext
      ? decrypt<Record<string, string>>(saved.secretsCiphertext)
      : {},
  };
}
export function getProjectRuntime(projectId: string) {
  const runtime = projectRuntimeValues(projectId);
  return { env: runtime.env, secretNames: Object.keys(runtime.secrets) };
}
export function updateProjectRuntime(projectId: string, input: unknown) {
  const valid = projectRuntimeUpdateSchema.parse(input);
  db.transaction((tx) => {
    const previous = projectRuntimeValues(projectId);
    const secrets: Record<string, string> = Object.assign(Object.create(null), previous.secrets);
    for (const name of valid.removeSecretNames) delete secrets[name];
    Object.assign(secrets, valid.secrets);
    const overlap = Object.keys(valid.env).find((name) =>
      Object.prototype.hasOwnProperty.call(secrets, name),
    );
    if (overlap)
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `${overlap} is already used by a runtime secret.`,
      });
    const values = {
      env: valid.env,
      secretsCiphertext: Object.keys(secrets).length ? encrypt(secrets) : null,
      updatedAt: new Date(),
    };
    saveProjectRuntime(tx, projectId, values);
  });
  return getProjectRuntime(projectId);
}

export function getProjectDeploymentSettings(projectId: string) {
  const saved = findProjectDeploymentSettings(projectId);
  return deploymentSettingsSchema.parse(
    saved
      ? {
          spaFallback: saved.spaFallback,
          repository: saved.repository ?? '',
          repositoryProvider: saved.repositoryProvider,
          retentionDays: saved.retentionDays,
          originCpus: saved.originCpus,
          originMemoryBytes: saved.originMemoryBytes,
          health: saved.health,
          proxy: saved.proxy,
        }
      : defaultSettings,
  );
}
export function updateProjectDeploymentSettings(projectId: string, settings: unknown) {
  const valid = deploymentSettingsSchema.parse(settings);
  const now = new Date();
  saveProjectDeploymentSettings(projectId, valid, now);
  return valid;
}
