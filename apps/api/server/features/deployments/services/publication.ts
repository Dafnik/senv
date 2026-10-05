import { TRPCError } from '@trpc/server';
import { customAlphabet } from 'nanoid';
import type { DeploymentSnapshot } from '../../../../shared/deployments';
import {
  isValidPreviewHostname,
  type DeploymentActor,
  type PublishDeploymentInput,
} from '../../../../shared/deployments';
import { db } from '../../../infrastructure/db';
import { findProject } from '../../projects/repositories/projects';
import { encrypt, runtimeFingerprint } from '../domain/secrets';
import { updateArtifact } from '../repositories/artifacts';
import { getArtifact } from './artifacts';
import { initializeBranchAlias } from '../repositories/branches';
import {
  findDeploymentIdentity,
  findSubmissionOrder,
  insertDeployment,
} from '../repositories/deployments';
import { findDeploymentHistoryIdentity } from '../repositories/history';
import { insertDeploymentSecrets } from '../repositories/secrets';
import { findTagIdentity } from '../repositories/tags';
import { deploymentStorageRoot } from '../storage/storage';
import { withArtifactStorageLock } from '../storage/storage-lock';
import { branchAlias } from './addresses';
import { event } from './history';
import { resolvePublicationInput } from './publication-input';
import { getProjectDeployment } from './summary';

const id = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 21);
const shortDeploymentId = customAlphabet('abcdefghjkmnopqrstuvwxy2345679', 12);

function newDeploymentId(projectId: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const candidate = shortDeploymentId();
    if (
      !findDeploymentIdentity(candidate) &&
      !findDeploymentHistoryIdentity(candidate) &&
      !findTagIdentity(projectId, candidate)
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
  const order = (findSubmissionOrder(input.projectId)?.value ?? 0) + 1;
  const deploymentId = newDeploymentId(input.projectId);
  const baseDomain = process.env['PREVIEW_BASE_DOMAIN'] ?? 'preview.localhost';
  const project = findProject(input.projectId)!;
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
    insertDeployment(tx, {
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
    });
    if (artifactId)
      updateArtifact(tx, artifactId, {
        publishedAt: now,
        // Older clients send source metadata at publication rather than upload.
        ...(getArtifact(artifactId).source === null ? { source: snapshot.source } : {}),
      });
    if (Object.keys(runtime.secrets).length || registryAuth)
      insertDeploymentSecrets(tx, {
        deploymentId,
        ciphertext: encrypt({ secrets: runtime.secrets, registryAuth }),
      });
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
      initializeBranchAlias(tx, {
        id: id(),
        projectId: input.projectId,
        branch: input.source.branch,
        alias: assignedBranchAlias!,
        deploymentId: null,
        selectionOrder: 0,
      });
    }
  });
  return getProjectDeployment(input.projectId, deploymentId);
}
