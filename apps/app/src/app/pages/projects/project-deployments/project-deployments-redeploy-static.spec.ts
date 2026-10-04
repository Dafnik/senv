import { expect, test } from 'vite-plus/test';
import {
  createFixture,
  setupProjectDeploymentTests,
} from './project-deployments.spec-setup';
import { mock, upload } from './project-deployments.spec-mocks';
setupProjectDeploymentTests();

test('static redeploy selects the retained artifact and prefills source and pin defaults', async () => {
  const fixture = createFixture(true, false, 'deployment-a');
  await fixture.whenStable();
  expect(fixture.componentInstance.publishOpen()).toBe(true);
  expect(fixture.componentInstance.model()).toMatchObject({
    kind: 'static',
    reuseDeploymentId: 'deployment-a',
    branch: 'feature/ui',
    commit: 'abc123',
    port: 80,
    pinned: false,
  });

  await fixture.componentInstance.publish(new Event('submit'));
  await fixture.whenStable();

  expect(upload.archive).not.toHaveBeenCalled();
  expect(upload.directory).not.toHaveBeenCalled();
  expect(mock.publish).toHaveBeenCalledWith(
    expect.objectContaining({
      projectId: 'project-a',
      kind: 'static',
      reuseDeploymentId: 'deployment-a',
      source: { commit: 'abc123', branch: 'feature/ui' },
    }),
  );
  expect(mock.publish.mock.calls[0]?.[0]).not.toHaveProperty('artifactId');
});
