import { TRPCError } from '@trpc/server';
import type { PublicArtifact } from '../../../../shared/artifacts';
import { getArtifact } from './artifacts';
import { listArtifactDeployments, listProjectArtifacts } from '../repositories/artifacts';
import {
  ArtifactMissingError,
  ArtifactPathError,
  browseArtifact,
  previewArtifactFile,
} from '../runtime/artifact-browser';
import { deploymentStorageRoot } from '../storage/storage';

type Artifact = ReturnType<typeof getArtifact>;

function presentArtifacts(projectId: string, artifacts: Artifact[]): PublicArtifact[] {
  const deployments = listArtifactDeployments(
    projectId,
    artifacts.map((artifact) => artifact.id),
  );
  return artifacts.map((artifact) => {
    const references = deployments.filter((item) => item.artifactId === artifact.id);
    return {
      id: artifact.id,
      projectId: artifact.projectId,
      size: artifact.size,
      sha256: artifact.sha256,
      createdAt: artifact.createdAt,
      source: artifact.source ?? references[0]?.source ?? {},
      deployments: references.map(({ id, status }) => ({ id, status })),
    };
  });
}

export function projectArtifacts(projectId: string, limit: number, offset: number) {
  const result = listProjectArtifacts(projectId, limit, offset);
  return { items: presentArtifacts(projectId, result.items), total: result.total };
}

export function projectArtifact(projectId: string, artifactId: string) {
  const artifact = getArtifact(artifactId, projectId);
  if (artifact.kind !== 'static' || !artifact.publishedAt)
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Artifact not found.' });
  return presentArtifacts(projectId, [artifact])[0]!;
}

export async function projectArtifactDirectory(
  projectId: string,
  artifactId: string,
  path: string,
) {
  projectArtifact(projectId, artifactId);
  const artifact = getArtifact(artifactId, projectId);
  try {
    return await browseArtifact(deploymentStorageRoot(), artifact.storageKey, path);
  } catch (error) {
    if (error instanceof ArtifactPathError)
      throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
    if (error instanceof ArtifactMissingError)
      throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
    throw error;
  }
}

export async function projectArtifactFile(projectId: string, artifactId: string, path: string) {
  projectArtifact(projectId, artifactId);
  const artifact = getArtifact(artifactId, projectId);
  try {
    return await previewArtifactFile(deploymentStorageRoot(), artifact.storageKey, path);
  } catch (error) {
    if (error instanceof ArtifactPathError)
      throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
    if (error instanceof ArtifactMissingError)
      throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
    throw error;
  }
}
