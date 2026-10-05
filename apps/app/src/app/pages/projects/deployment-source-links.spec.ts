import { expect, test } from 'vite-plus/test';
import { deploymentSourceLinks } from './deployment-source-links';

test.each([
  ['github', 'tree', 'commit'],
  ['gitlab', '-/tree', '-/commit'],
  ['forgejo', 'src/branch', 'commit'],
  ['gitea', 'src/branch', 'commit'],
] as const)(
  '%s links retain self-hosted paths and encode source references',
  (repositoryProvider, branchPath, commitPath) => {
    const links = deploymentSourceLinks({
      repository: 'https://git.example.test:8443/git/team/subgroup/site.git/',
      repositoryProvider,
      branch: 'feature/new-ui',
      commit: 'abc123',
    });
    expect(links).toEqual({
      repository: 'https://git.example.test:8443/git/team/subgroup/site',
      branch: `https://git.example.test:8443/git/team/subgroup/site/${branchPath}/feature%2Fnew-ui`,
      commit: `https://git.example.test:8443/git/team/subgroup/site/${commitPath}/abc123`,
    });
  },
);

test('SSH clone URLs become HTTPS web links without an SSH username or port', () => {
  expect(
    deploymentSourceLinks({
      repository: 'ssh://git@git.example.test:2222/team/site.git',
      repositoryProvider: 'gitlab',
      branch: 'main',
    }),
  ).toEqual({
    repository: 'https://git.example.test/team/site',
    branch: 'https://git.example.test/team/site/-/tree/main',
    commit: null,
  });
});

test('source links stay absent without the corresponding metadata', () => {
  expect(deploymentSourceLinks({ branch: 'main', commit: 'abc' })).toEqual({
    repository: null,
    branch: null,
    commit: null,
  });
  expect(
    deploymentSourceLinks({
      repository: 'https://github.com/team/site',
      repositoryProvider: 'github',
    }),
  ).toEqual({
    repository: 'https://github.com/team/site',
    branch: null,
    commit: null,
  });
});

test.each([
  'javascript:alert(1)',
  'https://user:secret@example.com/team/site',
  'file:///tmp/site',
  'https://example.com/team/site?secret=token',
  'not a url',
])('does not create unsafe links for %s', (repository) => {
  expect(
    deploymentSourceLinks({
      repository,
      repositoryProvider: 'github',
      branch: 'main',
      commit: 'abc',
    }),
  ).toEqual({ repository: null, branch: null, commit: null });
});
