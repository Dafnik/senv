import { expect, test } from 'vite-plus/test';
import {
  createFixture,
  setupProjectDeploymentTests,
} from './project-deployments.spec-setup';
import { mock, upload } from './project-deployments.spec-mocks';
setupProjectDeploymentTests();

test('directory publication uploads selected files and submits the chosen port', async () => {
  const fixture = createFixture(true);
  await fixture.whenStable();
  const index = new File(['<html>'], 'index.html');
  const app = new File(['app'], 'app.js');
  const files = [index, app] as unknown as FileList;
  fixture.componentInstance.selectDirectory({
    target: { files },
  } as unknown as Event);
  fixture.componentInstance.model.update((model) => ({
    ...model,
    port: 8080,
  }));
  await fixture.whenStable();

  await fixture.componentInstance.publish(new Event('submit'));
  await fixture.whenStable();

  expect(upload.directory).toHaveBeenCalledWith('project-a', files, {
    branch: undefined,
    commit: undefined,
  });
  expect(mock.publish).toHaveBeenCalledWith(
    expect.objectContaining({
      projectId: 'project-a',
      kind: 'static',
      artifactId: 'uploaded-directory',
      port: 8080,
    }),
  );
});

test('list links open the deployment workspace using the project slug', async () => {
  const fixture = createFixture();
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  expect(
    element.querySelector(
      'a[href="/projects/project/deployments/deployment-a"]',
    ),
  ).not.toBeNull();
  expect(element.textContent).toContain('View details');
});
