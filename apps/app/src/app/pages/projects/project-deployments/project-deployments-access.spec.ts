import { expect, test } from 'vite-plus/test';
import { aliasUrl } from '../deployment-presentation';
import {
  createFixture,
  setupProjectDeploymentTests,
} from './project-deployments.spec-setup';
import { deployments } from './project-deployments.spec-data';
import { mock } from './project-deployments.spec-mocks';
setupProjectDeploymentTests();

test('viewers can inspect status, preview, configuration, and history without mutation controls', async () => {
  const fixture = createFixture(false);
  await fixture.whenStable();
  expect(fixture.nativeElement.textContent).toContain('healthy');
  expect(
    fixture.nativeElement
      .querySelector('app-deployment-preview-actions a[target="_blank"]')
      ?.getAttribute('href'),
  ).toBe(deployments[0]!.previewUrl);
  expect(fixture.nativeElement.textContent).toContain('feature/ui');
  expect(fixture.nativeElement.textContent).toContain('deployment-old');
  expect(fixture.nativeElement.textContent).toContain('Ada');
  expect(aliasUrl(deployments[0]!, deployments[0]!.branchAlias!)).toBe(
    'https://br-feature-ui.project.preview.example.test/',
  );
  expect(fixture.nativeElement.textContent.toLowerCase()).toContain(
    'read only',
  );
  expect(fixture.nativeElement.textContent).not.toContain('Publish deployment');
  expect(
    fixture.nativeElement.querySelector('button[aria-label^="Remove tag"]'),
  ).toBeNull();
  expect(
    fixture.nativeElement.querySelector('button[aria-label^="Delete"]'),
  ).toBeNull();
  expect(fixture.nativeElement.textContent).not.toContain('Assign tag');
  expect(mock.credentials).toHaveBeenCalledWith(
    'session-a',
    'project-a',
    false,
  );
});

test('terminal container snapshots remain inspectable without lifecycle actions', async () => {
  deployments.push({
    ...deployments[0]!,
    id: 'cleaned-container',
    kind: 'container',
    status: 'cleaned',
    desiredState: 'stopped',
    artifactId: null,
    imageDigest: 'sha256:retained-container',
    tags: ['former-tag'],
  });
  try {
    const fixture = createFixture(true, true);
    await fixture.whenStable();
    const article = Array.from(
      fixture.nativeElement.querySelectorAll(
        'article',
      ) as NodeListOf<HTMLElement>,
    ).find((item) => item.textContent?.includes('cleaned-container'))!;

    expect(article.textContent).toContain('Forget history');
    expect(article.textContent).not.toContain('Restart');
    expect(article.textContent).not.toContain('Stop');
    expect(article.textContent).not.toContain('Assign tag');
    expect(
      article.querySelector('button[aria-label="Remove tag former-tag"]'),
    ).toBeNull();

    const details = article.querySelector('a[href$="/cleaned-container"]');
    expect(details).not.toBeNull();
    expect(
      article.querySelector('a[href$="/cleaned-container/logs"]'),
    ).not.toBeNull();
  } finally {
    deployments.pop();
  }
});

test('removal-pending deployments show their pending state and hide unavailable actions and links', async () => {
  deployments.push({
    ...deployments[0]!,
    id: 'pending-removal',
    removalPending: true,
    tags: ['pending-tag'],
  });
  try {
    const fixture = createFixture(true, true);
    await fixture.whenStable();
    const article = Array.from(
      fixture.nativeElement.querySelectorAll(
        'article',
      ) as NodeListOf<HTMLElement>,
    ).find((item) => item.textContent?.includes('pending-removal'))!;

    expect(article.querySelector('[role="status"]')?.textContent).toContain(
      'Removal pending',
    );
    expect(article.querySelector('header')!.textContent).not.toContain(
      'healthy',
    );
    expect(article.textContent).not.toContain('Stop');
    expect(article.textContent).not.toContain('Restart');
    expect(article.textContent).not.toContain('Delete');
    expect(article.textContent).not.toContain('Assign tag');
    expect(article.querySelector('#tag-pending-removal')).toBeNull();
    expect(article.querySelector('a[target="_blank"]')).toBeNull();
    expect(article.textContent).toContain('View logs');
    expect(mock.stop).not.toHaveBeenCalled();
    expect(mock.restart).not.toHaveBeenCalled();
    expect(mock.remove).not.toHaveBeenCalled();
    expect(mock.assignTag).not.toHaveBeenCalled();
  } finally {
    deployments.pop();
  }
});
