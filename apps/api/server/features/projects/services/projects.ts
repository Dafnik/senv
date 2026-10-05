import { TRPCError } from '@trpc/server';
import { customAlphabet } from 'nanoid';
import { deploymentSettingsSchema, isValidPreviewHostname } from '../../../../shared/deployments';
import { previewSlugSchema } from '../../../../shared/validation';
import { db } from '../../../infrastructure/db';
import { suggestUniquePreviewSlug } from '../auth-options';
import { initializeProjectDeploymentSettings } from '../repositories/deployment-settings';
import {
  findProjectByPreviewSlug,
  insertProject,
  insertProjectAdmin,
  listProjectMembers,
  listVisibleProjects,
  type Project,
  type ProjectListQuery,
} from '../repositories/projects';
import { assertProjectAccess } from './access';

type Actor = { id: string; role?: string | null };
const newProjectId = customAlphabet('acdefghjkmnpqrtuvwxy34679', 21);
function validatePreviewSlug(value: unknown, name: string) {
  const candidate = value === undefined ? suggestUniquePreviewSlug(name) : value;
  const parsed = previewSlugSchema.safeParse(candidate);
  if (!parsed.success)
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message:
        'Preview slugs must be lowercase DNS labels with letters, digits, and internal hyphens.',
    });
  const slug = parsed.data;
  if (value !== undefined && findProjectByPreviewSlug(slug))
    throw new TRPCError({ code: 'CONFLICT', message: 'That preview slug is already in use.' });
  if (
    !isValidPreviewHostname(
      slug,
      'a'.repeat(63),
      process.env['PREVIEW_BASE_DOMAIN'] ?? 'preview.localhost',
    )
  )
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message:
        'The configured preview domain leaves no room for valid deployment, branch, and tag labels.',
    });
  return slug;
}
function projectDetail(project: Project) {
  return { ...project, members: listProjectMembers(project.id) };
}
export function createProject(actor: Actor, input: { name: string; previewSlug?: string }) {
  const projectId = newProjectId();
  const previewSlug = validatePreviewSlug(input.previewSlug, input.name);
  return db.transaction((tx) => {
    const project = insertProject(tx, { id: projectId, name: input.name, previewSlug });
    insertProjectAdmin(tx, projectId, actor.id);
    initializeProjectDeploymentSettings(tx, projectId, deploymentSettingsSchema.parse({}));
    return project;
  });
}
export function listProjects(actor: Actor, input: ProjectListQuery) {
  const rows = listVisibleProjects(actor, input);
  const hasNextPage = rows.length > input.limit;
  const projects = rows.slice(0, input.limit);
  const last = projects[projects.length - 1];
  return {
    projects,
    // Numeric timestamps survive Angular's SSR transfer cache without Date conversion.
    nextCursor: hasNextPage && last ? { createdAt: last.createdAt.getTime(), id: last.id } : null,
  };
}
export function getProject(actor: Actor, projectId: string) {
  return projectDetail(assertProjectAccess(projectId, actor, 'read'));
}
export function getProjectBySlug(actor: Actor, slug: string) {
  const project = findProjectByPreviewSlug(slug);
  if (!project)
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Project not found. Its slug may have changed.',
    });
  return getProject(actor, project.id);
}
