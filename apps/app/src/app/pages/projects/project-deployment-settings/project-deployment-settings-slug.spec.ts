import { expect, test } from 'vite-plus/test';
import { Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import {
  createFixture,
  projects,
  storage,
  setupSettingsTests,
} from './project-deployment-settings.spec-setup';

setupSettingsTests();

test('project admins can update the preview slug while developers see it read only', async () => {
  const navigate = vi
    .spyOn(TestBed.inject(Router), 'navigate')
    .mockResolvedValue(true);
  const fixture = createFixture(true, true);
  await fixture.whenStable();
  fixture.componentInstance.slugModel.set({ previewSlug: 'next-preview' });
  await fixture.componentInstance.saveSlug(new Event('submit'));
  await fixture.whenStable();
  expect(projects.updatePreviewSlug).toHaveBeenCalledWith(
    'project-settings',
    'next-preview',
  );

  expect(navigate).toHaveBeenCalledWith(
    ['/projects', 'next-preview', 'settings'],
    { replaceUrl: true },
  );
  expect(fixture.nativeElement.textContent).toContain(
    'senv project, deployment, and log links',
  );
  expect(fixture.nativeElement.textContent).toContain(
    'only affect new deployments',
  );
  expect(fixture.componentInstance.slugError()).toBe('');

  const developer = createFixture(true, false);
  await developer.whenStable();
  expect(
    developer.nativeElement.querySelector('#project-preview-slug-setting'),
  ).toBeNull();
  expect(developer.nativeElement.textContent).toContain('my-preview');
});

test('discarding a slug draft restores the saved address and removes the changed local value', async () => {
  const fixture = createFixture();
  await fixture.whenStable();
  fixture.componentInstance.slugModel.set({ previewSlug: 'draft-slug' });
  await fixture.whenStable();
  expect(
    storage.get('senv:preview-slug:session-settings:project-settings'),
  ).toBe('draft-slug');
  fixture.componentInstance.discardSlugDraft();
  await fixture.whenStable();
  expect(fixture.componentInstance.slugModel().previewSlug).toBe('my-preview');
  expect(
    storage.get('senv:preview-slug:session-settings:project-settings'),
  ).not.toBe('draft-slug');
});
