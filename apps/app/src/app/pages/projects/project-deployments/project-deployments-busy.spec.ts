import { expect, test, vi } from 'vite-plus/test';
import {
  createFixture,
  setupProjectDeploymentTests,
} from './project-deployments.spec-setup';
import { upload } from './project-deployments.spec-mocks';

setupProjectDeploymentTests();

test('locks every publication input while an upload is pending', async () => {
  let finish!: (artifact: {
    artifactId: string;
    size: number;
    sha256: string;
  }) => void;
  upload.archive.mockReturnValueOnce(
    new Promise((resolve) => (finish = resolve)),
  );
  const fixture = createFixture(true);
  await fixture.whenStable();
  const component = fixture.componentInstance;
  component.publishOpen.set(true);
  const file = new File(['index.html'], 'site.zip', {
    type: 'application/zip',
  });
  component.selectArchive({
    target: { files: { item: () => file } },
  } as unknown as Event);
  await component.publish(new Event('submit'));
  await vi.waitFor(() => expect(upload.archive).toHaveBeenCalledOnce());
  fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('#source-branch').disabled).toBe(
    true,
  );
  expect(
    fixture.nativeElement.querySelector('#deployment-pinned').disabled,
  ).toBe(true);
  expect(
    fixture.nativeElement.querySelector('input[type="file"]').disabled,
  ).toBe(true);
  expect(
    fixture.nativeElement.querySelector('button[type="submit"]').disabled,
  ).toBe(true);
  expect(
    fixture.nativeElement.querySelector('button[type="button"]').disabled,
  ).toBe(true);
  finish({ artifactId: 'pending-artifact', size: 1, sha256: 'hash' });
  await fixture.whenStable();
});
