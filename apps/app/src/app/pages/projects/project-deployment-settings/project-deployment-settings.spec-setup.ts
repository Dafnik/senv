import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query';
import type { DeploymentSettings } from '@senv/api/shared/deployments';
import { afterEach, beforeEach, vi } from 'vite-plus/test';
import { AUTH_CLIENT } from '../../../auth/auth-client';
import { DeploymentsData } from '../../../queries/deployments';
import { ProjectsData } from '../../../queries/projects';
import { ProjectDeploymentSettings } from './project-deployment-settings';
import { TestResizeObserver } from '../test-resize-observer';

export const session = signal({
  data: {
    session: { id: 'session-settings' },
    user: { id: 'admin-id', role: 'admin' },
  },
});
export const settings = {
  spaFallback: true,
  repository: 'https://github.com/acme/site',
  repositoryProvider: 'github',
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
export const adminDefaults = {
  uploadLimitBytes: 104857600,
  proxyCpus: '0.1',
  proxyMemoryBytes: 67108864,
  logFiles: 3,
  logFileSizeBytes: 10485760,
};
export const data = {
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
  updateSettings: vi.fn(
    async (_projectId: string, _settings: DeploymentSettings) => undefined,
  ),
  updateAdminDefaults: vi.fn(async () => undefined),
};
export const projects = {
  updatePreviewSlug: vi.fn(async (_id: string, slug: string) => ({
    previewSlug: slug,
  })),
  invalidate: vi.fn(async () => undefined),
};
export const storage = new Map<string, string>();
export const localStorageMock = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, String(value)),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
};

export function createFixture(canManage = true, isAdmin = true) {
  const fixture = TestBed.createComponent(ProjectDeploymentSettings);
  fixture.componentRef.setInput('projectId', 'project-settings');
  fixture.componentRef.setInput('previewSlug', 'my-preview');
  fixture.componentRef.setInput('canManage', canManage);
  fixture.componentRef.setInput('isAdmin', isAdmin);
  return fixture;
}

export function setupSettingsTests() {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.clear();
    vi.stubGlobal('localStorage', localStorageMock);
    vi.stubGlobal('ResizeObserver', TestResizeObserver);
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
}
