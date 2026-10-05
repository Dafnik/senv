import { createError, defineEventHandler, getHeader, readMultipartFormData } from 'nitro/h3';
import {
  authorizeOperation,
  resolvePrincipal,
} from '../../../features/auth/services/request-principal';
import { assertCanPublishProject } from '../../../features/projects/services/access';
import { getInstanceDeploymentDefaults } from '../../../features/admin/services/deployment-defaults';
import { registerUploadedArtifact } from '../../../features/deployments/index';
import {
  ArtifactStore,
  stripSelectedDirectoryRoot,
  type StaticUploadFile,
} from '../../../features/deployments/runtime/artifacts';
import { deploymentStorageRoot } from '../../../features/deployments/storage/storage';
import { withArtifactStorageLock } from '../../../features/deployments/storage/storage-lock';
import { maxStaticArtifactEntries } from '../../../features/deployments/runtime/artifact-limits';

const multipartOverheadLimit = 8 * 1024 * 1024;
export default defineEventHandler(async (event) => {
  const principal = await resolvePrincipal(event.req.headers).catch((error) => {
    throw createError({
      statusCode: error.code === 'FORBIDDEN' ? 403 : 401,
      statusMessage: 'Sign in to upload deployment artifacts.',
    });
  });
  if (!principal)
    throw createError({
      statusCode: 401,
      statusMessage: 'Sign in to upload deployment artifacts.',
    });

  const contentType = getHeader(event, 'content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data;'))
    throw createError({
      statusCode: 415,
      statusMessage: 'Artifact uploads must use multipart/form-data.',
    });
  const defaults = getInstanceDeploymentDefaults();
  const maxBytes = defaults.uploadLimitBytes;
  const contentLength = Number(getHeader(event, 'content-length'));
  if (!Number.isSafeInteger(contentLength) || contentLength < 1)
    throw createError({
      statusCode: 411,
      statusMessage: 'A bounded Content-Length is required for artifact uploads.',
    });
  if (contentLength > maxBytes + multipartOverheadLimit)
    throw createError({
      statusCode: 413,
      statusMessage: `Upload exceeds the ${maxBytes}-byte limit.`,
    });

  let parts;
  try {
    parts = await readMultipartFormData(event);
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Unable to read multipart upload.' });
  }
  if (!parts?.length || parts.length > maxStaticArtifactEntries + 2)
    throw createError({
      statusCode: 400,
      statusMessage: 'Upload contains no files or too many multipart entries.',
    });
  const projectIdPart = parts.find((part) => part.name === 'projectId' && !part.filename);
  const projectId = projectIdPart
    ? Buffer.from(projectIdPart.data).toString('utf8').trim()
    : undefined;
  if (!projectId) throw createError({ statusCode: 400, statusMessage: 'projectId is required.' });
  try {
    authorizeOperation(principal, 'artifacts.upload', { projectId });
    assertCanPublishProject(principal.user.id, projectId);
  } catch (error) {
    throw createError({
      statusCode: 403,
      statusMessage: error instanceof Error ? error.message : 'You cannot publish to this project.',
    });
  }

  const archiveParts = parts.filter((part) => part.name === 'file' && part.filename);
  const directoryParts = parts.filter((part) => part.name === 'files' && part.filename);
  if (
    archiveParts.length > 1 ||
    (archiveParts.length && directoryParts.length) ||
    (!archiveParts.length && !directoryParts.length)
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Upload one archive or a set of directory files.',
    });
  }
  const uploadedBytes = [...archiveParts, ...directoryParts].reduce(
    (sum, part) => sum + (part.data?.byteLength ?? 0),
    0,
  );
  if (uploadedBytes > maxBytes)
    throw createError({
      statusCode: 413,
      statusMessage: `Uploaded files exceed the ${maxBytes}-byte limit.`,
    });
  if (directoryParts.length > maxStaticArtifactEntries)
    throw createError({
      statusCode: 413,
      statusMessage: `Directory upload exceeds the ${maxStaticArtifactEntries}-file limit.`,
    });

  const store = new ArtifactStore({ root: deploymentStorageRoot(), maxBytes });
  await store.initialize();
  try {
    return await withArtifactStorageLock(deploymentStorageRoot(), async () => {
      let saved: { storageKey: string; size: number; sha256: string };
      if (archiveParts.length) {
        const file = archiveParts[0]!;
        if (!file.data || !file.data.length || !file.filename)
          throw new Error('Select a non-empty archive.');
        saved = await store.ingestArchive(Buffer.from(file.data), file.filename!);
      } else {
        const files: StaticUploadFile[] = directoryParts.map((part) => ({
          name: part.filename!,
          data: Buffer.from(part.data),
        }));
        saved = await store.ingestFiles(stripSelectedDirectoryRoot(files));
      }
      return registerUploadedArtifact({ projectId, kind: 'static', ...saved });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Artifact upload failed.';
    const statusCode =
      /exceeds the .* limit|uploaded (?:ZIP|archive) exceeds|extracted website exceeds/i.test(
        message,
      )
        ? 413
        : 400;
    throw createError({ statusCode, statusMessage: message });
  }
});
