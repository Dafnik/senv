import { provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { AUTH_CLIENT } from '../../../auth/auth-client';
import { DeploymentsData } from '../../../queries/deployments';
import { ProjectsData } from '../../../queries/projects';
import { AdminDeploymentDefaults } from '../../admin/admin-deployment-defaults/admin-deployment-defaults';
import { ProjectDeploymentSettings } from './project-deployment-settings';

const session = signal({
  data: {
    session: { id: 'session-settings' },
    user: { id: 'admin-id', role: 'admin' },
  },
});
const settings = {
  spaFallback: true,
  repository: 'https://github.com/acme/site',
  retentionDays: 7,
  originCpus: '1',
  originMemoryBytes: 536870912,
  health: {
    path: '/',
    startupDeadlineSeconds: 60,
    intervalSeconds: 5,
    timeoutSeconds: 3,
    unhealthyThreshold: 3,
  },
  proxy: {
    routes: [],
    cacheRules: [],
    compression: { enabled: true, endings: [] },
  },
  baseDomain: 'preview.example.test',
};
const adminDefaults = {
  uploadLimitBytes: 104857600,
  proxyCpus: '0.1',
  proxyMemoryBytes: 67108864,
  logFiles: 3,
  logFileSizeBytes: 10485760,
};
const data = {
  runtime: vi.fn(() => ({
    queryKey: ['runtime'],
    enabled: true,
    queryFn: async () => ({ env: {}, secretNames: [] }),
  })),
  credentials: vi.fn(() => ({
    queryKey: ['credentials'],
    enabled: true,
    queryFn: async () => [],
  })),
  settings: vi.fn(() => ({
    queryKey: ['settings'],
    queryFn: async () => settings,
  })),
  adminDefaults: vi.fn(() => ({
    queryKey: ['defaults'],
    queryFn: async () => adminDefaults,
  })),
  invalidate: vi.fn(async () => undefined),
  updateSettings: vi.fn(async () => undefined),
  updateAdminDefaults: vi.fn(async () => undefined),
};
const projects = {
  updatePreviewSlug: vi.fn(async (_id: string, slug: string) => ({
    previewSlug: slug,
  })),
  invalidate: vi.fn(async () => undefined),
};
const storage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, String(value)),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
};

function createFixture(canManage = true, isAdmin = true) {
  const fixture = TestBed.createComponent(ProjectDeploymentSettings);
  fixture.componentRef.setInput('projectId', 'project-settings');
  fixture.componentRef.setInput('previewSlug', 'my-preview');
  fixture.componentRef.setInput('canManage', canManage);
  fixture.componentRef.setInput('isAdmin', isAdmin);
  return fixture;
}

beforeEach(() => {
  vi.clearAllMocks();
  storage.clear();
  vi.stubGlobal('localStorage', localStorageMock);
  TestBed.configureTestingModule({
    imports: [ProjectDeploymentSettings],
    providers: [
      provideRouter([]),
      provideTanStackQuery(
        () =>
          new QueryClient({ defaultOptions: { queries: { retry: false } } }),
      ),
      { provide: AUTH_CLIENT, useValue: { useSession: () => session } },
      { provide: DeploymentsData, useValue: data },
      { provide: ProjectsData, useValue: projects },
    ],
  });
});

afterEach(() => {
  TestBed.resetTestingModule();
  storage.clear();
  vi.unstubAllGlobals();
});

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

test('route preview follows target paths and rewrites and cache labels follow match type', async () => {
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
          target: 'https://api.example.test/base',
          rewrite: '',
        },
      ],
    },
  }));
  expect(component.routePreview(0)).toBe(
    '/api/example → https://api.example.test/base/example',
  );
  component.model.update((value) => ({
    ...value,
    proxy: {
      ...value.proxy,
      routes: [{ ...value.proxy.routes[0]!, rewrite: '/v1' }],
    },
  }));
  expect(component.routePreview(0)).toBe(
    '/api/example → https://api.example.test/v1/example',
  );
  component.addCacheRule();
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  expect(
    element.querySelector('label[for="cache-value-0"]')?.textContent,
  ).toContain('Request path');
  component.model.update((value) => ({
    ...value,
    proxy: {
      ...value.proxy,
      cacheRules: [{ ...value.proxy.cacheRules[0]!, matcher: 'extension' }],
    },
  }));
  await fixture.whenStable();
  expect(
    element.querySelector('label[for="cache-value-0"]')?.textContent,
  ).toContain('File extension');
  expect(
    element.querySelector('#cache-value-0')?.getAttribute('placeholder'),
  ).toBe('.js');
  expect(element.textContent).not.toContain('Instance deployment defaults');
  const headings = Array.from(element.querySelectorAll('h2')).map((heading) =>
    heading.textContent?.trim(),
  );
  expect(headings[headings.length - 1]).toBe('Project identity');
});

test('static routing belongs to project defaults, can be discarded, and is read only for viewers', async () => {
  const fixture = createFixture();
  await fixture.whenStable();
  const component = fixture.componentInstance;
  const checkbox = fixture.nativeElement.querySelector(
    '#project-spa-fallback',
  ) as HTMLButtonElement;
  expect(checkbox.getAttribute('aria-checked')).toBe('true');
  checkbox.click();
  await fixture.whenStable();
  expect(component.model().spaFallback).toBe(false);
  component.discardDraft();
  await fixture.whenStable();
  expect(component.model().spaFallback).toBe(true);
  fixture.componentRef.setInput('canManage', false);
  await fixture.whenStable();
  expect(checkbox.disabled).toBe(true);
});

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
