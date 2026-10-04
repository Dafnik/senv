import { TRPCError } from '@trpc/server';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { deployment, deploymentSecret } from '../../../../drizzle/schema';
import { db } from './db';
import { decrypt, type CapturedDeploymentSecrets } from './deployment-secrets';
import type { RuntimeConfig } from './deployment-runtime/contracts';

function runtimeConfig(
  row: typeof deployment.$inferSelect,
  encrypted: typeof deploymentSecret.$inferSelect | undefined,
): RuntimeConfig {
  const snapshot = row.snapshot;
  const { secrets, registryAuth } = encrypted
    ? decrypt<CapturedDeploymentSecrets>(encrypted.ciphertext)
    : { secrets: {} };
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    artifactId: row.artifactId,
    imageDigest: row.imageDigest ?? snapshot.image,
    port: snapshot.port,
    env: snapshot.env,
    secrets,
    registryAuth,
    health: snapshot.health,
    spaFallback: snapshot.spaFallback,
    proxy: snapshot.proxy,
    limits: snapshot.limits,
    logs: snapshot.logs,
    desiredState: row.desiredState,
    status: row.status,
    submittedAt: row.submittedAt,
  };
}

export function getDeploymentRuntimeConfig(deploymentId: string): RuntimeConfig | null {
  const row = db.select().from(deployment).where(eq(deployment.id, deploymentId)).get();
  if (!row || row.deletedAt || row.cleanupStartedAt) return null;
  const encrypted = db
    .select()
    .from(deploymentSecret)
    .where(eq(deploymentSecret.deploymentId, deploymentId))
    .get();
  return runtimeConfig(row, encrypted);
}
export function listDeploymentRuntimeConfigs(): RuntimeConfig[] {
  const rows = db
    .select()
    .from(deployment)
    .where(and(isNull(deployment.deletedAt), isNull(deployment.cleanupStartedAt)))
    .orderBy(asc(deployment.submissionOrder))
    .all();
  if (!rows.length) return [];
  const secrets = db
    .select({ secret: deploymentSecret })
    .from(deploymentSecret)
    .innerJoin(deployment, eq(deploymentSecret.deploymentId, deployment.id))
    .where(and(isNull(deployment.deletedAt), isNull(deployment.cleanupStartedAt)))
    .all();
  const secretsByDeployment = new Map(secrets.map(({ secret }) => [secret.deploymentId, secret]));
  return rows.map((row) => runtimeConfig(row, secretsByDeployment.get(row.id)));
}

export function setDeploymentImageDigest(deploymentId: string, digest: string) {
  if (!/^.+@sha256:[a-f0-9]{64}$/.test(digest))
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Image digest is invalid.' });
  const row = db.select().from(deployment).where(eq(deployment.id, deploymentId)).get();
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
  if (row.imageDigest && row.imageDigest !== digest)
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'A deployment image digest is immutable once resolved.',
    });
  db.update(deployment).set({ imageDigest: digest }).where(eq(deployment.id, deploymentId)).run();
}
