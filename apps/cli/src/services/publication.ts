import { type ClientContext } from '../api/client.ts';
import { staticUpload } from '../api/upload.ts';
import { CliError } from '../errors.ts';
export type PublishOptions = {
  image?: string;
  reuse?: string;
  kind?: 'static' | 'container';
  registryCredential?: string;
  port?: number;
  pin?: boolean;
  branch?: string;
  commit?: string;
  signal?: AbortSignal;
  onSubmit?: () => void;
  onProgress?: (sent: number, total: number) => void;
};
export async function publish(
  value: ClientContext,
  projectId: string,
  path: string | undefined,
  options: PublishOptions,
) {
  options.signal?.throwIfAborted();
  if ([Boolean(path), Boolean(options.image), Boolean(options.reuse)].filter(Boolean).length !== 1)
    throw new CliError('Choose exactly one directory/archive, --image, or --reuse.', 2);
  if (options.kind && !['static', 'container'].includes(options.kind))
    throw new CliError('Kind must be static or container.', 2);
  const original = options.reuse
    ? await value.client.deployments.detail.query({ projectId, deploymentId: options.reuse })
    : undefined;
  const artifactId = path
    ? await staticUpload(
        value.profile.apiUrl,
        value.token!,
        projectId,
        path,
        await value.client.deployments.uploadConstraints.query({ projectId }),
        { signal: options.signal, onProgress: options.onProgress },
      )
    : undefined;
  options.signal?.throwIfAborted();
  options.onSubmit?.();
  return value.client.deployments.publish.mutate({
    projectId,
    kind: options.reuse ? (options.kind ?? original!.kind) : options.image ? 'container' : 'static',
    image: options.image,
    artifactId,
    reuseDeploymentId: options.reuse,
    registryCredentialId: options.registryCredential,
    port: options.port ?? original?.config.port ?? 80,
    pinned: Boolean(options.pin),
    source: { branch: options.branch, commit: options.commit },
  });
}
