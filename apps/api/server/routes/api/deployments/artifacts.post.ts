import { HTTPError, defineHandler } from 'nitro/h3';
import {
  authorizeOperation,
  resolvePrincipal,
} from '../../../features/auth/services/request-principal';
import { assertCanPublishProject } from '../../../features/projects/services/access';
import { getInstanceDeploymentDefaults } from '../../../features/admin/services/deployment-defaults';
import { registerUploadedArtifact } from '../../../features/deployments/index';
import { ArtifactStore } from '../../../features/deployments/runtime/artifacts';
import { stageArtifactUpload } from '../../../features/deployments/runtime/artifact-multipart';
import { deploymentStorageRoot } from '../../../features/deployments/storage/storage';
import { publishDeploymentSchema, type DeploymentSource } from '../../../../shared/deployments';
import { getProjectDeploymentSettings } from '../../../features/projects/services/deployment-settings';

export default defineHandler(async (event) => {
  const principal = await resolvePrincipal(event.req.headers).catch((error) => {
    throw new HTTPError({
      status: error.code === 'FORBIDDEN' ? 403 : 401,
      message: 'Sign in to upload deployment artifacts.',
    });
  });
  if (!principal)
    throw new HTTPError({ status: 401, message: 'Sign in to upload deployment artifacts.' });
  if (
    !(event.req.headers.get('content-type') ?? '').toLowerCase().startsWith('multipart/form-data;')
  )
    throw new HTTPError({ status: 415, message: 'Artifact uploads must use multipart/form-data.' });
  const selectedProject = event.req.headers.get('x-senv-project-id');
  if (
    principal.automation &&
    (principal.automation.permission !== 'manage' ||
      selectedProject !== principal.automation.projectId)
  )
    throw new HTTPError({
      status: 403,
      message: 'A matching project header and manage token are required for uploads.',
    });
  if (selectedProject) {
    try {
      authorizeOperation(principal, 'artifacts.upload', { projectId: selectedProject });
      assertCanPublishProject(principal.user.id, selectedProject);
    } catch {
      throw new HTTPError({ status: 403, message: 'You cannot publish to this project.' });
    }
  }
  const maxBytes = getInstanceDeploymentDefaults().uploadLimitBytes;
  const contentLength = Number(event.req.headers.get('content-length'));
  if (!Number.isSafeInteger(contentLength) || contentLength < 1)
    throw new HTTPError({
      status: 411,
      message: 'A bounded Content-Length is required for artifact uploads.',
    });
  if (contentLength > maxBytes + 8 * 1024 * 1024)
    throw new HTTPError({ status: 413, message: `Upload exceeds the ${maxBytes}-byte limit.` });

  const store = new ArtifactStore({ root: deploymentStorageRoot(), maxBytes });
  await store.initialize();
  let staged: Awaited<ReturnType<typeof stageArtifactUpload>> | undefined;
  try {
    staged = await stageArtifactUpload(event.req, deploymentStorageRoot(), maxBytes);
    const projectId = staged.fields.get('projectId')?.trim();
    if (selectedProject && selectedProject !== projectId)
      throw new HTTPError({
        status: 403,
        message: 'Upload project does not match the authorized header.',
      });
    if (!projectId) throw new HTTPError({ status: 400, message: 'projectId is required.' });
    try {
      authorizeOperation(principal, 'artifacts.upload', { projectId });
      assertCanPublishProject(principal.user.id, projectId);
    } catch (error) {
      throw new HTTPError({
        status: 403,
        message: error instanceof Error ? error.message : 'You cannot publish to this project.',
      });
    }
    let source: DeploymentSource | undefined;
    const sourceJson = staged.fields.get('source');
    if (sourceJson !== undefined) {
      try {
        const metadata = publishDeploymentSchema.shape.source.parse(JSON.parse(sourceJson));
        const settings = getProjectDeploymentSettings(projectId);
        source = {
          ...metadata,
          repository: settings.repository || undefined,
          repositoryProvider: settings.repositoryProvider,
        };
      } catch {
        throw new HTTPError({ status: 400, message: 'Artifact source metadata is invalid.' });
      }
    }
    let registered: ReturnType<typeof registerUploadedArtifact> | undefined;
    await store.ingestStaged(staged.files, (saved) => {
      registered = registerUploadedArtifact({ projectId, kind: 'static', source, ...saved });
    });
    return registered!;
  } catch (error) {
    if (HTTPError.isError(error)) throw error;
    const message = error instanceof Error ? error.message : 'Artifact upload failed.';
    throw new HTTPError({ status: /exceeds the .*limit/i.test(message) ? 413 : 400, message });
  } finally {
    await staged?.dispose();
  }
});
