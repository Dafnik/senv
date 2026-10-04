import { TRPCError } from '@trpc/server';
import { and, eq, isNull } from 'drizzle-orm';
import {
  deployment,
  deploymentRegistryCredential,
  deploymentSecret,
} from '../../../../drizzle/schema';
import type { DeploymentSnapshot, PublishDeploymentInput } from '../../shared/deployments';
import { db } from './db';
import { decrypt, type CapturedDeploymentSecrets } from './deployment-secrets';
import {
  getProjectDeploymentSettings,
  getInstanceDeploymentDefaults,
  projectRuntimeValues,
} from './project-deployment-settings';
import { getArtifact } from './deployment-artifacts';

export function resolvePublicationInput(input: PublishDeploymentInput) {
  const runtime = projectRuntimeValues(input.projectId);
  const settings = getProjectDeploymentSettings(input.projectId);
  const defaults = getInstanceDeploymentDefaults();
  let artifactId = input.artifactId;
  let image = input.image;
  let registryCredentialId = input.registryCredentialId;
  let registryAuth: { serverAddress: string; username: string; password: string } | undefined;
  if (input.reuseDeploymentId) {
    const original = db
      .select()
      .from(deployment)
      .where(
        and(
          eq(deployment.id, input.reuseDeploymentId),
          eq(deployment.projectId, input.projectId),
          isNull(deployment.deletedAt),
        ),
      )
      .get();
    if (
      !original ||
      original.kind !== input.kind ||
      original.cleanupStartedAt !== null ||
      original.status === 'cleaned'
    )
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Choose a retained deployment of the same kind to reuse.',
      });
    const originalSnapshot = original.snapshot as DeploymentSnapshot;
    if (input.kind === 'static') {
      if (!original.artifactId)
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'The original artifact is no longer retained.',
        });
      artifactId = original.artifactId;
    } else {
      image = original.imageDigest ?? undefined;
      if (typeof image !== 'string' || !/@sha256:[a-f0-9]{64}$/.test(image))
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'The original image digest is not ready to reuse.',
        });
    }
    registryCredentialId = originalSnapshot.registryCredentialId ?? undefined;
    const originalSecrets = db
      .select()
      .from(deploymentSecret)
      .where(eq(deploymentSecret.deploymentId, original.id))
      .get();
    if (originalSecrets) {
      registryAuth = decrypt<CapturedDeploymentSecrets>(originalSecrets.ciphertext).registryAuth;
    }
  }
  if (input.registryCredentialId === null) {
    registryCredentialId = null;
    registryAuth = undefined;
  }
  if (input.kind === 'static' && !artifactId)
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose an uploaded static artifact.' });
  if (input.kind === 'container' && !image)
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Enter a container image.' });
  if (input.kind === 'static' && artifactId) {
    const artifact = getArtifact(artifactId);
    if (artifact.projectId !== input.projectId || artifact.kind !== 'static')
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'The artifact is not available to this project.',
      });
  }
  if (input.registryCredentialId) {
    const credential = db
      .select()
      .from(deploymentRegistryCredential)
      .where(
        and(
          eq(deploymentRegistryCredential.id, input.registryCredentialId),
          eq(deploymentRegistryCredential.projectId, input.projectId),
        ),
      )
      .get();
    if (!credential)
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Registry credential not found.' });
    registryCredentialId = credential.id;
    registryAuth = {
      serverAddress: credential.registry,
      username: credential.username,
      password: decrypt<string>(credential.ciphertext),
    };
  }
  return { artifactId, image, registryCredentialId, registryAuth, runtime, settings, defaults };
}
