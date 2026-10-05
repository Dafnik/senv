import { eq } from 'drizzle-orm';
import {
  projectDeploymentRuntime,
  projectDeploymentSettings,
} from '../../../../../../drizzle/schema';
import { db, type QueryHandle } from '../../../infrastructure/db';
type Settings = typeof projectDeploymentSettings.$inferInsert;
type Runtime = typeof projectDeploymentRuntime.$inferInsert;
export function initializeProjectDeploymentSettings(
  database: QueryHandle,
  projectId: string,
  defaults: Omit<Settings, 'projectId'>,
) {
  database
    .insert(projectDeploymentSettings)
    .values({ projectId, ...defaults, repository: null })
    .onConflictDoNothing()
    .run();
}

export function findProjectRuntime(projectId: string) {
  return db
    .select()
    .from(projectDeploymentRuntime)
    .where(eq(projectDeploymentRuntime.projectId, projectId))
    .get();
}

export function saveProjectRuntime(
  tx: QueryHandle,
  projectId: string,
  values: Omit<Runtime, 'projectId'>,
) {
  return tx
    .insert(projectDeploymentRuntime)
    .values({ projectId, ...values })
    .onConflictDoUpdate({ target: projectDeploymentRuntime.projectId, set: values })
    .run();
}

export function findProjectDeploymentSettings(projectId: string) {
  return db
    .select()
    .from(projectDeploymentSettings)
    .where(eq(projectDeploymentSettings.projectId, projectId))
    .get();
}

export function saveProjectDeploymentSettings(
  projectId: string,
  valid: Omit<Settings, 'projectId'> & { repository: string },
  now: Date,
) {
  return db
    .insert(projectDeploymentSettings)
    .values({ projectId, ...valid, repository: valid.repository || null })
    .onConflictDoUpdate({
      target: projectDeploymentSettings.projectId,
      set: { ...valid, repository: valid.repository || null, updatedAt: now },
    })
    .run();
}
