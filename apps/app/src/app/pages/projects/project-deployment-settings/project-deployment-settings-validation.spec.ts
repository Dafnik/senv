import { expect, test } from 'vite-plus/test';
import {
  createFixture,
  data,
  setupSettingsTests,
} from './project-deployment-settings.spec-setup';
import { createEmptySettingsModel } from './project-deployment-settings.model';
import { restoreSettingsModel } from './project-deployment-settings.form';

setupSettingsTests();

test('form validation agrees with API rules for repository URLs and normalized health paths', async () => {
  const fixture = createFixture();
  await fixture.whenStable();
  const component = fixture.componentInstance;
  for (const repository of [
    'https://user@example.com/repo',
    'https://example.com/repo?token=secret',
  ]) {
    component.model.update((value) => ({ ...value, repository }));
    await fixture.whenStable();
    expect(component.settingsForm.repository().invalid()).toBe(true);
    await component.saveSettings(new Event('submit'));
    expect(data.updateSettings).not.toHaveBeenCalled();
  }
  component.model.update((value) => ({
    ...value,
    repository: 'ssh://git@example.com/repo',
  }));
  for (const path of ['/./', '//', '/a/../b', '/a//b']) {
    component.model.update((value) => ({
      ...value,
      health: { ...value.health, path },
    }));
    await fixture.whenStable();
    expect(component.settingsForm.health.path().invalid()).toBe(true);
    await component.saveSettings(new Event('submit'));
    expect(data.updateSettings).not.toHaveBeenCalled();
  }
  component.model.update((value) => ({
    ...value,
    health: { ...value.health, path: '/health/ready' },
  }));
  await fixture.whenStable();
  expect(component.settingsForm().valid()).toBe(true);
  await component.saveSettings(new Event('submit'));
  await fixture.whenStable();
  expect(data.updateSettings).toHaveBeenCalledWith(
    'project-settings',
    expect.objectContaining({
      repository: 'ssh://git@example.com/repo',
      health: expect.objectContaining({ path: '/health/ready' }),
    }),
  );
});

test('the form rejects equivalent proxy matchers and non-normalized rewrite paths before saving', async () => {
  const fixture = createFixture();
  await fixture.whenStable();
  const component = fixture.componentInstance;
  const route = {
    path: '/api',
    target: 'http://example.com',
    rewrite: '',
    connectTimeoutSeconds: 10,
    readTimeoutSeconds: 60,
  };
  component.model.update((model) => ({
    ...model,
    proxy: { ...model.proxy, routes: [route, { ...route, path: '/api/' }] },
  }));
  await fixture.whenStable();
  expect(
    component.settingsForm.proxy.routes[0]
      .path()
      .errors()
      .some(
        (error) => error.message === 'This route path is already configured.',
      ),
  ).toBe(true);
  component.model.update((model) => ({
    ...model,
    proxy: {
      ...model.proxy,
      routes: [{ ...route, rewrite: '/../' }],
      cacheRules: [
        { matcher: 'extension', value: 'js', durationSeconds: 60 },
        { matcher: 'extension', value: '.JS', durationSeconds: 60 },
      ],
    },
  }));
  await fixture.whenStable();
  expect(component.settingsForm.proxy.routes[0].rewrite().invalid()).toBe(true);
  expect(
    component.settingsForm.proxy.cacheRules[0]
      .value()
      .errors()
      .some(
        (error) =>
          error.message === 'This cache matcher is already configured.',
      ),
  ).toBe(true);
});

test('draft schema validates nested cache values and maps compression issues to its text field', async () => {
  const fixture = createFixture();
  await fixture.whenStable();
  const component = fixture.componentInstance;
  component.model.update((model) => ({
    ...model,
    proxy: {
      ...model.proxy,
      cacheRules: [
        { matcher: 'extension', value: 'bad/path', durationSeconds: 60 },
      ],
    },
    compressionEndings: 'css, bad/path',
  }));
  await fixture.whenStable();

  expect(
    component.settingsForm.proxy.cacheRules[0]
      .value()
      .errors()
      .some((error) =>
        error.message?.includes(
          'Cache matchers must be a normalized path or file extension.',
        ),
      ),
  ).toBe(true);
  expect(
    component.settingsForm.compressionEndings().errors().length,
  ).toBeGreaterThan(0);
});

test('settings draft restoration keeps valid shallow drafts and rejects malformed nested state', () => {
  const defaults = createEmptySettingsModel();
  expect(
    restoreSettingsModel(
      { repository: 'https://git.example.test/team/app' },
      defaults,
    ),
  ).toMatchObject({
    repository: 'https://git.example.test/team/app',
    health: defaults.health,
    proxy: defaults.proxy,
  });
  expect(
    restoreSettingsModel({ proxy: { routes: 'invalid' } }, defaults),
  ).toBeNull();
});
