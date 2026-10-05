import { TRPCError } from '@trpc/server';
import { deployment, deploymentSecret } from '../../../../../../drizzle/schema';
import { db } from '../../../infrastructure/db';
import { decrypt, type CapturedDeploymentSecrets } from '../domain/secrets';
import {
  findDeployment,
  findDeploymentSecrets,
  listActiveDeploymentRows,
  listActiveDeploymentSecrets,
  updateDeployment,
} from '../repositories/deployments';
import type { RuntimeConfig } from '../runtime/contracts';

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
  const row = findDeployment(deploymentId);
  if (!row || row.deletedAt || row.cleanupStartedAt) return null;
  const encrypted = findDeploymentSecrets(deploymentId);
  return runtimeConfig(row, encrypted);
}
export function listDeploymentRuntimeConfigs(): RuntimeConfig[] {
  const rows = listActiveDeploymentRows();
  if (!rows.length) return [];
  const secrets = listActiveDeploymentSecrets();
  const secretsByDeployment = new Map(secrets.map(({ secret }) => [secret.deploymentId, secret]));
  return rows.map((row) => runtimeConfig(row, secretsByDeployment.get(row.id)));
}

export function setDeploymentImageDigest(deploymentId: string, digest: string) {
  if (!/^.+@sha256:[a-f0-9]{64}$/.test(digest))
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Image digest is invalid.' });
  const row = findDeployment(deploymentId);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
  if (row.imageDigest && row.imageDigest !== digest)
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'A deployment image digest is immutable once resolved.',
    });
  updateDeployment(db, deploymentId, { imageDigest: digest });
}
