import { TRPCError } from '@trpc/server';
import { isValidPreviewHostname } from '../../../../shared/deployments';
import { previewSlugSchema } from '../../../../shared/validation';
import { listProjectDeploymentRows } from '../../deployments/repositories/deployments';
import { refreshOrRollback, serializeRouteMutation } from '../../deployments/services/routing';
import {
  findProject,
  findProjectByPreviewSlug,
  restoreProjectPreviewSlug,
  saveProjectPreviewSlug,
} from '../repositories/projects';

export async function updateProjectPreviewSlug(projectId: string, slug: string) {
  return serializeRouteMutation(async () => {
    if (!previewSlugSchema.safeParse(slug).success)
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          'Preview slugs must be lowercase DNS labels with letters, digits, and internal hyphens.',
      });
    const conflict = findProjectByPreviewSlug(slug, projectId);
    if (conflict)
      throw new TRPCError({ code: 'CONFLICT', message: 'That preview slug is already in use.' });
    const domain = process.env['PREVIEW_BASE_DOMAIN'] ?? 'preview.localhost';
    if (!isValidPreviewHostname(slug, 'a'.repeat(63), domain))
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message:
          'The configured preview domain leaves no room for valid deployment, branch, and tag labels.',
      });
    const tooLong = listProjectDeploymentRows(projectId).some(
      (row) => !isValidPreviewHostname(slug, row.id, domain),
    );
    if (tooLong)
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'The generated preview hostname would exceed the DNS name limit.',
      });
    const before = findProject(projectId);
    if (!before) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found.' });
    const saved = saveProjectPreviewSlug(projectId, slug);
    await refreshOrRollback(() => restoreProjectPreviewSlug(projectId, before.previewSlug, slug));
    return saved;
  });
}
