import { expect, test } from 'vite-plus/test';
import {
  createFixture,
  setupProjectDeploymentTests,
} from './project-deployments.spec-setup';
import { deployments, storage } from './project-deployments.spec-data';
import { mock, upload } from './project-deployments.spec-mocks';
setupProjectDeploymentTests();

test('developers can upload a ZIP, publish a fixed snapshot, and keep ordinary draft fields after refresh', async () => {
  const fixture = createFixture(true);
  await fixture.whenStable();
  const component = fixture.componentInstance;
  const file = new File(['index.html'], 'site.zip', {
    type: 'application/zip',
  });
  component.selectArchive({
    target: { files: { item: () => file } },
  } as unknown as Event);
  component.model.update((model) => ({
    ...model,
    branch: 'feature/ui',
  }));
  fixture.detectChanges();
  await fixture.whenStable();

  await component.publish(new Event('submit'));
  await fixture.whenStable();

  expect(upload.archive).toHaveBeenCalledWith('project-a', file, {
    branch: 'feature/ui',
    commit: undefined,
  });
  expect(mock.publish).toHaveBeenCalledWith(
    expect.objectContaining({
      projectId: 'project-a',
      kind: 'static',
      artifactId: 'uploaded-artifact',
      source: { branch: 'feature/ui', commit: undefined },
      pinned: false,
    }),
  );
  expect(mock.invalidate).toHaveBeenCalledWith('session-a', 'project-a');
  expect(component.model().branch).toBe('');
});

test('retained content reuse submits its deployment ID without uploading again', async () => {
  const fixture = createFixture(true);
  await fixture.whenStable();
  const component = fixture.componentInstance;
  component.model.update((model) => ({
    ...model,
    reuseDeploymentId: 'deployment-a',
  }));
  await fixture.whenStable();

  await component.publish(new Event('submit'));
  await fixture.whenStable();

  expect(upload.archive).not.toHaveBeenCalled();
  expect(upload.directory).not.toHaveBeenCalled();
  expect(mock.publish).toHaveBeenCalledWith(
    expect.objectContaining({
      projectId: 'project-a',
      kind: 'static',
      reuseDeploymentId: 'deployment-a',
    }),
  );
});

test('existing browser drafts migrate their stored reuseArtifactId to reuseDeploymentId', async () => {
  storage.set(
    'senv:deployment-draft:session-a:project-a',
    JSON.stringify({ kind: 'static', reuseArtifactId: 'deployment-a' }),
  );
  const fixture = createFixture(true);
  await fixture.whenStable();
  expect(fixture.componentInstance.model().reuseDeploymentId).toBe(
    'deployment-a',
  );
});

test('container reuse does not require a new image or per-deployment runtime values', async () => {
  deployments.push({
    ...deployments[0]!,
    id: 'container-reuse',
    kind: 'container',
    artifactId: null,
    imageDigest: 'sha256:fixed-container',
    source: { branch: 'release', commit: 'fixed' },
  });
  try {
    const fixture = createFixture(true);
    await fixture.whenStable();
    const component = fixture.componentInstance;
    component.model.update((model) => ({
      ...model,
      kind: 'container',
      image: '',
      reuseDeploymentId: 'container-reuse',
    }));
    await fixture.whenStable();
    expect(component.publishForm().invalid()).toBe(false);

    await component.publish(new Event('submit'));
    await fixture.whenStable();

    expect(upload.archive).not.toHaveBeenCalled();
    expect(upload.directory).not.toHaveBeenCalled();
    expect(mock.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-a',
        kind: 'container',
        reuseDeploymentId: 'container-reuse',
        pinned: false,
      }),
    );
  } finally {
    deployments.pop();
  }
});

test('publishing opens from a button and runtime and registry editors live in settings', async () => {
  const fixture = createFixture(true);
  await fixture.whenStable();
  expect(
    fixture.nativeElement.querySelector('#publish-deployment-card'),
  ).toBeNull();
  const publish = fixture.nativeElement.querySelector(
    'button[aria-controls="publish-deployment-card"]',
  ) as HTMLButtonElement;
  expect(publish.textContent?.trim()).toBe('Publish');
  publish.click();
  await fixture.whenStable();
  expect(
    fixture.nativeElement.querySelector('#publish-deployment-card'),
  ).not.toBeNull();
  expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
  expect(fixture.nativeElement.querySelector('#new-secret-value')).toBeNull();
  expect(fixture.nativeElement.querySelector('#credential-secret')).toBeNull();
  expect(
    fixture.nativeElement.querySelector('#deployment-lifetime'),
  ).toBeNull();
  expect(
    fixture.nativeElement.querySelector('#deployment-pinned'),
  ).not.toBeNull();
  publish.click();
  await fixture.whenStable();
  expect(
    fixture.nativeElement.querySelector('#publish-deployment-card'),
  ).toBeNull();
});

test('upload failures stay visible and do not create a deployment', async () => {
  upload.archive.mockRejectedValueOnce(
    new Error('The ZIP is missing root index.html.'),
  );
  const fixture = createFixture(true);
  await fixture.whenStable();
  fixture.componentInstance.publishOpen.set(true);
  const file = new File(['bad'], 'site.zip', { type: 'application/zip' });
  fixture.componentInstance.selectArchive({
    target: { files: { item: () => file } },
  } as unknown as Event);

  await fixture.componentInstance.publish(new Event('submit'));
  await fixture.whenStable();

  expect(fixture.nativeElement.textContent).toContain(
    'missing root index.html',
  );
  expect(mock.publish).not.toHaveBeenCalled();
});
