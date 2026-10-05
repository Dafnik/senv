import { listProjectPreviewSlugs } from '../../projects/repositories/projects';
import { listPreviewBranches } from '../repositories/branches';
import { listRoutableDeployments } from '../repositories/deployments';
import { listPreviewTags } from '../repositories/tags';

export function getPreviewRouteTargets() {
  const projects = listProjectPreviewSlugs();
  const projectSlugs = new Map(projects.map((project) => [project.id, project.projectSlug]));
  const availableDeployments = listRoutableDeployments();
  const available = new Map(
    availableDeployments.map((target) => [target.deploymentId, target.projectId]),
  );
  return {
    baseDomain: process.env['PREVIEW_BASE_DOMAIN'] ?? 'preview.localhost',
    deployments: availableDeployments.map((target) => ({
      deploymentId: target.deploymentId,
      projectSlug: projectSlugs.get(target.projectId)!,
    })),
    branches: listPreviewBranches()
      .filter(
        (target) => target.deploymentId && available.get(target.deploymentId) === target.projectId,
      )
      .map((target) => ({
        branchAlias: target.branchAlias,
        projectSlug: projectSlugs.get(target.projectId)!,
        deploymentId: target.deploymentId!,
      })),
    tags: listPreviewTags()
      .filter((target) => available.get(target.deploymentId) === target.projectId)
      .map((target) => ({
        tag: target.name,
        projectSlug: projectSlugs.get(target.projectId)!,
        deploymentId: target.deploymentId,
      })),
  };
}
