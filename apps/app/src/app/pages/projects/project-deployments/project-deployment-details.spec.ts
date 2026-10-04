import { expect, test } from 'vite-plus/test';
import { TestBed } from '@angular/core/testing';
import { retentionInfo } from '../deployment-presentation';
import { DeploymentList } from '../deployment-list';
import { DeploymentOverview } from '../deployment-overview';
import { setupProjectDeploymentTests } from './project-deployments.spec-setup';
import { deployments } from './project-deployments.spec-data';

setupProjectDeploymentTests();

test('deployment details explain expiry without repeating the ID as a title', async () => {
  const fixture = TestBed.createComponent(DeploymentOverview);
  fixture.componentRef.setInput('projectSlug', 'project');
  fixture.componentRef.setInput('deployment', {
    ...deployments[0]!,
    branchAlias: null,
    configurationOutdated: true,
    configurationChanges: ['Health checks'],
    retentionStartedAt: new Date('2026-10-05T10:00:00Z'),
    retentionDeadlineAt: new Date('2026-10-12T10:00:00Z'),
  });
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  expect(element.textContent).toContain('Configuration out of date');
  expect(element.textContent).toContain('Health checks');
  expect(element.querySelector('#deployment-configuration')).not.toBeNull();
  expect(element.querySelector('#deployment-audit')).not.toBeNull();
  expect(
    element.querySelector(
      '#deployment-information app-deployment-preview-status',
    ),
  ).toBeNull();
  expect(
    element.querySelector('app-deployment-preview-status section[hlmCard] h2')
      ?.textContent,
  ).toBe('Browser Health check');
  expect(
    element.querySelector('button[aria-label="Copy preview link"]'),
  ).not.toBeNull();
  expect(
    element.querySelector('button[aria-label="Copy deployment details link"]'),
  ).toBeNull();
  expect(element.querySelector('h1')?.textContent).toContain('feature/ui');
  expect(element.querySelector('h1')?.textContent).not.toContain(
    'deployment-a',
  );
  expect(element.textContent).toContain('Expires');
  expect(element.textContent).toContain('Oct 12, 2026');
  expect(element.textContent).toContain('audit history remains available');
  expect(element.textContent).toContain('assign a tag to prevent expiry');
  expect(element.textContent).toContain('Retention started');
});

test('retention explains every active protection and when expiry starts', () => {
  const retention = retentionInfo({
    ...deployments[0]!,
    pinned: true,
    tags: ['stable'],
  });
  expect(retention.label).toBe('No expiry');
  expect(retention.context).toContain('pinned');
  expect(retention.context).toContain('tagged');
  expect(retention.context).toContain('selected for its branch');
  expect(retention.description).toContain('when all protection is removed');
});

test.each([
  ['github', 'tree', 'commit'],
  ['gitlab', '-/tree', '-/commit'],
  ['forgejo', 'src/branch', 'commit'],
  ['gitea', 'src/branch', 'commit'],
] as const)(
  'detail source metadata links to the selected %s provider',
  async (repositoryProvider, branchPath, commitPath) => {
    const fixture = TestBed.createComponent(DeploymentOverview);
    fixture.componentRef.setInput('projectSlug', 'project');
    fixture.componentRef.setInput('deployment', {
      ...deployments[0],
      source: {
        repository: 'https://git.example.test/team/site.git',
        repositoryProvider,
        branch: 'feature/ui',
        commit: 'abcdef1234567890',
      },
    });
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const links = [
      ...element.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]'),
    ];
    expect(
      links.filter(
        (link) => link.href === 'https://git.example.test/team/site',
      ),
    ).toHaveLength(1);
    expect(
      links.filter(
        (link) =>
          link.href ===
          `https://git.example.test/team/site/${branchPath}/feature%2Fui`,
      ),
    ).toHaveLength(2);
    expect(
      links.filter(
        (link) =>
          link.href ===
          `https://git.example.test/team/site/${commitPath}/abcdef1234567890`,
      ),
    ).toHaveLength(2);
    expect(element.querySelector('h1 a')?.textContent).toContain('feature/ui');
  },
);

test('list expiry has a labeled date', async () => {
  const fixture = TestBed.createComponent(DeploymentList);
  fixture.componentRef.setInput('projectId', 'project-a');
  fixture.componentRef.setInput('items', [
    {
      ...deployments[0]!,
      branchAlias: null,
      retentionDeadlineAt: new Date(Date.now() + 2 * 86400000),
    },
  ]);
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  expect(element.textContent).toContain('Expires');
  expect(element.querySelector('time[datetime]')).not.toBeNull();
});
