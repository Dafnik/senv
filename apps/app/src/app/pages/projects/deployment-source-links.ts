import {
  repositoryUrlSchema,
  type DeploymentSource,
  type RepositoryProvider,
} from '@senv/api/shared/deployments';

const providerPaths: Record<
  RepositoryProvider,
  { branch: string; commit: string }
> = {
  github: { branch: 'tree', commit: 'commit' },
  gitlab: { branch: '-/tree', commit: '-/commit' },
  forgejo: { branch: 'src/branch', commit: 'commit' },
  gitea: { branch: 'src/branch', commit: 'commit' },
};

export function deploymentSourceLinks(source: DeploymentSource) {
  const empty = { repository: null, branch: null, commit: null };
  if (
    !source.repository ||
    !repositoryUrlSchema.safeParse(source.repository).success
  )
    return empty;
  let url = new URL(source.repository);
  if (url.protocol === 'ssh:') {
    url = new URL(`https://${url.hostname}${url.pathname}`);
  }
  const path = url.pathname.replace(/\/+$/, '').replace(/\.git$/, '');
  if (!path || path === '/') return empty;
  const repository = `${url.origin}${path}`;
  const paths = source.repositoryProvider
    ? providerPaths[source.repositoryProvider]
    : undefined;
  return {
    repository,
    branch:
      paths && source.branch
        ? `${repository}/${paths.branch}/${encodeURIComponent(source.branch)}`
        : null,
    commit:
      paths && source.commit
        ? `${repository}/${paths.commit}/${encodeURIComponent(source.commit)}`
        : null,
  };
}
