import { expect, test } from 'vite-plus/test';
import { TestBed } from '@angular/core/testing';
import { AdminDeploymentDefaults } from '../../admin/admin-deployment-defaults/admin-deployment-defaults';
import type { DeploymentSettings } from '@senv/api/shared/deployments';
import {
  createFixture,
  data,
  settings,
  storage,
  setupSettingsTests,
} from './project-deployment-settings.spec-setup';

setupSettingsTests();

test('project settings render a validated route and cache editor without a raw proxy configuration field', async () => {
  const fixture = createFixture();
  await fixture.whenStable();
  const component = fixture.componentInstance;
  component.addRoute();
  component.model.update((value) => ({
    ...value,
    proxy: {
      ...value.proxy,
      routes: [
        {
          ...value.proxy.routes[0]!,
          path: '/api',
          target: 'https://api.example.test',
          rewrite: '/v1',
        },
      ],
    },
  }));
  component.addCacheRule();
  component.model.update((value) => ({
    ...value,
    proxy: {
      ...value.proxy,
      cacheRules: [
        {
          ...value.proxy.cacheRules[0]!,
          matcher: 'extension',
          value: '.js',
          durationSeconds: 600,
        },
      ],
    },
  }));
  fixture.detectChanges();
  await fixture.whenStable();

  expect(fixture.nativeElement.textContent).toContain('Add proxy route');
  expect(fixture.nativeElement.textContent).toContain('Add cache rule');
  expect(
    fixture.nativeElement.querySelector('textarea#proxy-config'),
  ).toBeNull();
  await component.saveSettings(new Event('submit'));
  await fixture.whenStable();

  expect(data.updateSettings).toHaveBeenCalledWith(
    'project-settings',
    expect.objectContaining({
      repository: 'https://github.com/acme/site',
      proxy: expect.objectContaining({
        routes: [
          expect.objectContaining({
            path: '/api',
            target: 'https://api.example.test',
            rewrite: '/v1',
          }),
        ],
        cacheRules: [
          expect.objectContaining({
            matcher: 'extension',
            value: '.js',
            durationSeconds: 600,
          }),
        ],
      }),
    }),
  );
});

test('unsafe proxy destinations fail local validation and viewers cannot change defaults', async () => {
  const editor = createFixture();
  await editor.whenStable();
  editor.componentInstance.addRoute();
  editor.componentInstance.model.update((value) => ({
    ...value,
    proxy: {
      ...value.proxy,
      routes: [
        {
          ...value.proxy.routes[0]!,
          path: '/api',
          target: 'file:///etc/passwd',
          rewrite: '',
        },
      ],
    },
  }));
  await editor.whenStable();
  expect(editor.componentInstance.settingsForm().invalid()).toBe(true);

  const viewer = createFixture(false, false);
  await viewer.whenStable();
  expect(
    viewer.nativeElement.querySelector('button[type="submit"]'),
  ).toBeNull();
  expect(
    viewer.nativeElement
      .querySelector('#project-repository')
      ?.matches(':disabled'),
  ).toBe(true);
  expect(data.updateSettings).not.toHaveBeenCalled();
});

test('the selected Git provider is saved with repository settings', async () => {
  const fixture = createFixture();
  await fixture.whenStable();
  const select = fixture.nativeElement.querySelector(
    '#project-repository-provider',
  ) as HTMLSelectElement;
  expect(
    [...select.options].map((option) => option.textContent?.trim()),
  ).toEqual(['GitHub', 'GitLab', 'Forgejo', 'Gitea']);
  select.value = 'gitlab';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await fixture.whenStable();
  await fixture.componentInstance.saveSettings(new Event('submit'));
  await fixture.whenStable();
  expect(data.updateSettings).toHaveBeenCalledWith(
    'project-settings',
    expect.objectContaining({ repositoryProvider: 'gitlab' }),
  );
});

test('a successful save clears the browser draft and does not persist the saved model again', async () => {
  let saved: Omit<typeof settings, 'repositoryProvider'> & {
    repositoryProvider: DeploymentSettings['repositoryProvider'];
  } = settings as Omit<typeof settings, 'repositoryProvider'> & {
    repositoryProvider: DeploymentSettings['repositoryProvider'];
  };
  data.settings.mockImplementation(() => ({
    queryKey: ['settings'],
    queryFn: async () => saved,
  }));
  data.updateSettings.mockImplementation(async (_projectId, next) => {
    saved = { ...saved, ...next } as typeof saved;
  });
  const fixture = createFixture();
  await fixture.whenStable();
  const key = 'senv:deployment-settings:session-settings:project-settings';
  fixture.componentInstance.model.update((value) => ({
    ...value,
    repository: 'https://github.com/acme/updated',
  }));
  fixture.detectChanges();
  await fixture.whenStable();
  expect(storage.has(key)).toBe(true);

  await fixture.componentInstance.saveSettings(new Event('submit'));
  await fixture.whenStable();
  await fixture.componentInstance.settings.refetch();
  await fixture.whenStable();
  expect(storage.has(key)).toBe(false);
  expect(fixture.componentInstance.model().repository).toBe(
    'https://github.com/acme/updated',
  );
  fixture.componentInstance.model.update((value) => ({
    ...value,
    repository: 'https://github.com/acme/another-edit',
  }));
  fixture.detectChanges();
  await fixture.whenStable();
  expect(storage.has(key)).toBe(true);
});

test('instance administrators can save instance upload, proxy, and log defaults', async () => {
  const fixture = TestBed.createComponent(AdminDeploymentDefaults);
  await fixture.whenStable();
  fixture.componentInstance.defaultsModel.update((value) => ({
    ...value,
    uploadLimitMiB: 250,
    proxyCpus: '0.2',
    logFiles: 5,
  }));
  await fixture.componentInstance.saveDefaults(new Event('submit'));
  await fixture.whenStable();

  expect(data.updateAdminDefaults).toHaveBeenCalledWith(
    expect.objectContaining({
      uploadLimitBytes: 250 * 1048576,
      proxyCpus: '0.2',
      logFiles: 5,
    }),
  );
});
