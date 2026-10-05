import type { DeploymentSource } from './deployments';

export type PublicArtifact = {
  id: string;
  projectId: string;
  size: number;
  sha256: string;
  createdAt: Date;
  source: DeploymentSource;
  deployments: Array<{ id: string; status: string }>;
};

export type ArtifactEntry = {
  name: string;
  path: string;
  kind: 'directory' | 'file';
  size: number;
};
