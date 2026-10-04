import { TRPCError } from '@trpc/server';
import { and, eq, max } from 'drizzle-orm';
import { customAlphabet } from 'nanoid';
import {
  deployment,
  deploymentArtifact,
  deploymentBranchAlias,
  deploymentHistory,
  deploymentSecret,
  deploymentTag,
  organization,
} from '../../../../drizzle/schema';
import {
  isValidPreviewHostname,
  type DeploymentActor,
  type PublishDeploymentInput,
} from '../../shared/deployments';
import { db } from './db';
import { withArtifactStorageLock } from './deployment-storage-lock';
import { deploymentStorageRoot } from './deployment-storage';
import { getProjectDeployment } from './deployment-summary';
import { branchAlias } from './deployment-addresses';
import { event } from './deployment-history';
import { resolvePublicationInput } from './deployment-publication-input';
import { encrypt, runtimeFingerprint } from './deployment-secrets';
import type { DeploymentSnapshot } from '../../shared/deployments';

const id = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 21);
const shortDeploymentId = customAlphabet('abcdefghjkmnopqrstuvwxy2345679', 12);

function newDeploymentId(projectId: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = shortDeploymentId();
    if (
      !db
        .select({ id: deployment.id })
        .from(deployment)
        .where(eq(deployment.id, candidate))
        .get() &&
      !db
        .select({ id: deploymentHistory.id })
        .from(deploymentHistory)
        .where(eq(deploymentHistory.deploymentId, candidate))
        .get() &&
      !db
        .select({ id: deploymentTag.id })
        .from(deploymentTag)
        .where(and(eq(deploymentTag.projectId, projectId), eq(deploymentTag.name, candidate)))
        .get()
    )
      return candidate;
  }
  throw new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Could not allocate a deployment ID. Try again.',
  });
}

export async function publishDeployment(input: PublishDeploymentInput, actor?: DeploymentActor) {
  return withArtifactStorageLock(deploymentStorageRoot(), () =>
    publishDeploymentLocked(input, actor),
  );
}

function publishDeploymentLocked(input: PublishDeploymentInput, actor?: DeploymentActor) {
  const { artifactId, image, registryCredentialId, registryAuth, runtime, settings, defaults } =
    resolvePublicationInput(input);
  const now = new Date();
  const order =
    (db
      .select({ value: max(deployment.submissionOrder) })
      .from(deployment)
      .where(eq(deployment.projectId, input.projectId))
      .get()?.value ?? 0) + 1;
  const deploymentId = newDeploymentId(input.projectId);
  const baseDomain = process.env['PREVIEW_BASE_DOMAIN'] ?? 'preview.localhost';
  const project = db.select().from(organization).where(eq(organization.id, input.projectId)).get()!;
  if (!isValidPreviewHostname(project.previewSlug, deploymentId, baseDomain))
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Preview domain or generated hostname is invalid.',
    });
  const assignedBranchAlias = input.source.branch
    ? branchAlias(input.source.branch, input.projectId)
    : undefined;
  if (
    assignedBranchAlias &&
    !isValidPreviewHostname(project.previewSlug, assignedBranchAlias, baseDomain)
  )
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'The branch alias hostname exceeds DNS limits.',
    });
  const snapshot: DeploymentSnapshot = {
    kind: input.kind,
    artifactId: artifactId ?? null,
    image: image ?? null,
    registryCredentialId: registryCredentialId ?? null,
    pinned: input.pinned,
    source: {
      ...input.source,
      repository: settings.repository || undefined,
      repositoryProvider: settings.repositoryProvider,
    },
    secretNames: Object.keys(runtime.secrets),
    port: input.port,
    env: runtime.env,
    runtimeFingerprint: runtimeFingerprint(runtime),
    retentionDays: settings.retentionDays,
    spaFallback: settings.spaFallback,
    health: settings.health,
    proxy: settings.proxy,
    limits: {
      origin: { cpus: settings.originCpus, memoryBytes: settings.originMemoryBytes },
      proxy: { cpus: defaults.proxyCpus, memoryBytes: defaults.proxyMemoryBytes },
    },
    logs: { files: defaults.logFiles, fileSizeBytes: defaults.logFileSizeBytes },
  };
  db.transaction((tx) => {
    const initialDigest = input.kind === 'container' && image?.includes('@sha256:') ? image : null;
    tx.insert(deployment)
      .values({
        id: deploymentId,
        projectId: input.projectId,
        artifactId: artifactId ?? null,
        kind: input.kind,
        pinned: input.pinned,
        submittedAt: now,
        submissionOrder: order,
        source: snapshot.source,
        snapshot,
        imageDigest: initialDigest,
      })
      .run();
    if (artifactId)
      tx.update(deploymentArtifact)
        .set({ publishedAt: now })
        .where(eq(deploymentArtifact.id, artifactId))
        .run();
    if (Object.keys(runtime.secrets).length || registryAuth)
      tx.insert(deploymentSecret)
        .values({ deploymentId, ciphertext: encrypt({ secrets: runtime.secrets, registryAuth }) })
        .run();
    event(
      tx,
      input.projectId,
      deploymentId,
      'submitted',
      { kind: input.kind, pinned: input.pinned, source: input.source },
      now,
      actor,
    );
    if (input.source.branch) {
      tx.insert(deploymentBranchAlias)
        .values({
          id: id(),
          projectId: input.projectId,
          branch: input.source.branch,
          alias: assignedBranchAlias!,
          deploymentId: null,
          selectionOrder: 0,
        })
        .onConflictDoNothing()
        .run();
    }
  });
  return getProjectDeployment(input.projectId, deploymentId);
}
