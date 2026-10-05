import { Readable } from 'node:stream';
import { HTTPError, defineHandler, getQuery, getRouterParam } from 'nitro/h3';
import {
  authorizeOperation,
  resolvePrincipal,
} from '../../../../features/auth/services/request-principal';
import { assertProjectAccess } from '../../../../features/projects/services/access';
import { getArtifact } from '../../../../features/deployments/services/artifacts';
import { projectArtifact } from '../../../../features/deployments/services/artifact-browser';
import {
  ArtifactMissingError,
  ArtifactPathError,
  downloadArtifactArchive,
  openArtifactFile,
} from '../../../../features/deployments/runtime/artifact-browser';
import { deploymentStorageRoot } from '../../../../features/deployments/storage/storage';

export default defineHandler(async (event) => {
  const query = getQuery(event);
  const artifactId = getRouterParam(event, 'artifactId');
  if (!artifactId || typeof query.projectId !== 'string' || !query.projectId)
    throw new HTTPError({ status: 400, message: 'projectId and artifactId are required.' });
  const projectId = query.projectId;
  try {
    const principal = await resolvePrincipal(event.req.headers);
    authorizeOperation(principal, 'artifacts.download', { projectId });
    assertProjectAccess(projectId, principal.user, 'read');
    projectArtifact(projectId, artifactId);
    const artifact = getArtifact(artifactId, projectId);
    const root = deploymentStorageRoot();
    let stream: Readable;
    let filename: string;
    let contentType: string;
    let size: number | undefined;
    if (query.format === 'zip' || query.format === 'tar.gz') {
      if (query.path !== undefined)
        throw new ArtifactPathError('Choose an archive format or a file path.');
      stream = await downloadArtifactArchive(root, artifact.storageKey, query.format);
      filename = `${artifactId}.${query.format}`;
      contentType = query.format === 'zip' ? 'application/zip' : 'application/gzip';
    } else {
      if (query.format !== undefined || typeof query.path !== 'string' || !query.path)
        throw new ArtifactPathError('Choose ZIP, tar.gz, or a file path.');
      const file = await openArtifactFile(root, artifact.storageKey, query.path);
      stream = file.stream;
      size = file.size;
      filename = query.path.split('/').at(-1)!;
      contentType = 'application/octet-stream';
    }
    // Artifact HTML and scripts are always attachments, never executable on the API origin.
    const headers = new Headers({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(filename).replace(/'/g, '%27')}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    if (size !== undefined) headers.set('Content-Length', String(size));
    event.req.signal.addEventListener('abort', () => stream.destroy(), { once: true });
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { headers });
  } catch (error) {
    if (error instanceof ArtifactPathError)
      throw new HTTPError({ status: 400, message: error.message });
    if (error instanceof ArtifactMissingError)
      throw new HTTPError({ status: 404, message: error.message });
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    const statusCode =
      code === 'UNAUTHORIZED' ? 401 : code === 'FORBIDDEN' ? 403 : code === 'NOT_FOUND' ? 404 : 500;
    throw new HTTPError({
      status: statusCode,
      message:
        statusCode === 500
          ? 'Unable to download this artifact.'
          : error instanceof Error
            ? error.message
            : 'Artifact unavailable.',
    });
  }
});
