import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import {
  deploymentInstanceDefaults,
  projectDeploymentRuntime,
  projectDeploymentSettings,
} from '../../../../drizzle/schema';
import {
  deploymentSettingsSchema,
  projectRuntimeUpdateSchema,
  instanceDeploymentDefaultsSchema,
} from '../../shared/deployments';
import { db } from './db';
import { encrypt, decrypt } from './deployment-secrets';

const defaultSettings = deploymentSettingsSchema.parse({});
const defaultInstance = instanceDeploymentDefaultsSchema.parse({});

export function projectRuntimeValues(projectId: string) {
  const saved = db
    .select()
    .from(projectDeploymentRuntime)
    .where(eq(projectDeploymentRuntime.projectId, projectId))
    .get();
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
    tx.insert(projectDeploymentRuntime)
      .values({ projectId, ...values })
      .onConflictDoUpdate({ target: projectDeploymentRuntime.projectId, set: values })
      .run();
  });
  return getProjectRuntime(projectId);
}

export function getProjectDeploymentSettings(projectId: string) {
  const saved = db
    .select()
    .from(projectDeploymentSettings)
    .where(eq(projectDeploymentSettings.projectId, projectId))
    .get();
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
  db.insert(projectDeploymentSettings)
    .values({ projectId, ...valid, repository: valid.repository || null })
    .onConflictDoUpdate({
      target: projectDeploymentSettings.projectId,
      set: { ...valid, repository: valid.repository || null, updatedAt: now },
    })
    .run();
  return valid;
}
export function getInstanceDeploymentDefaults() {
  const saved = db
    .select()
    .from(deploymentInstanceDefaults)
    .where(eq(deploymentInstanceDefaults.id, 1))
    .get();
  if (!saved) return defaultInstance;
  return instanceDeploymentDefaultsSchema.parse(saved);
}
export function updateInstanceDeploymentDefaults(input: unknown) {
  const valid = instanceDeploymentDefaultsSchema.parse(input);
  db.insert(deploymentInstanceDefaults)
    .values({ id: 1, ...valid })
    .onConflictDoUpdate({
      target: deploymentInstanceDefaults.id,
      set: { ...valid, updatedAt: new Date() },
    })
    .run();
  return valid;
}
