import { eq } from 'drizzle-orm';
import { deploymentInstanceDefaults } from '../../../../../../drizzle/schema';
import { db } from '../../../infrastructure/db';
type Defaults = typeof deploymentInstanceDefaults.$inferInsert;
export function findInstanceDeploymentDefaults() {
  return db
    .select()
    .from(deploymentInstanceDefaults)
    .where(eq(deploymentInstanceDefaults.id, 1))
    .get();
}

export function saveInstanceDeploymentDefaults(valid: Omit<Defaults, 'id'>) {
  return db
    .insert(deploymentInstanceDefaults)
    .values({ id: 1, ...valid })
    .onConflictDoUpdate({
      target: deploymentInstanceDefaults.id,
      set: { ...valid, updatedAt: new Date() },
    })
    .run();
}
