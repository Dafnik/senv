import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTanStackQuery, QueryClient } from '@tanstack/angular-query';
import type { PublicDeployment } from '@senv/api/shared/deployments';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { AUTH_CLIENT } from '../../../auth/auth-client';
import { DeploymentUpload } from '../../../queries/deployment-upload';
import { DeploymentsData } from '../../../queries/deployments';
import { ProjectDeployments } from './project-deployments';

const session = signal({
  data: {
    session: { id: 'session-a' },
    user: { id: 'developer-id', role: 'user' },
  },
});
const deployments: Array<PublicDeployment & { previewUrl: string }> = [
  {
    id: 'deployment-a',
    configurationOutdated: false,
    configurationChanges: [],
    projectId: 'project-a',
    kind: 'static',
    status: 'healthy',
    desiredState: 'running',
    pinned: false,
    artifactId: 'artifact-a',
    imageDigest: null,
    source: { branch: 'feature/ui', commit: 'abc123' },
    submittedAt: new Date('2026-10-01T12:00:00Z'),
    readyAt: new Date('2026-10-01T12:00:10Z'),
    retentionStartedAt: null,
    retentionDeadlineAt: null,
    failureReason: null,
    removalPending: false,
    config: {
      port: 80,
      env: { PUBLIC_NAME: 'demo' },
      spaFallback: true,
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
      limits: {
        origin: { cpus: '1', memoryBytes: 536870912 },
        proxy: { cpus: '0.1', memoryBytes: 67108864 },
      },
      logs: { files: 3, fileSizeBytes: 10485760 },
      secretNames: [],
      hasSecrets: false,
    },
    branchAlias: 'br-feature-ui-a1b2c3d4',
    tags: [],
    previewUrl: 'https://dpl-deployment-a.project.preview.example.test',
  },
];
const history = [
  {
    id: 'event-a',
    projectId: 'project-a',
    deploymentId: 'deployment-old',
    event: 'deleted',
    actorType: 'user',
    actor: { id: 'user-123', name: 'Ada' },
    details: {},
    createdAt: new Date('2026-09-30T10:00:00Z'),
  },
];
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
const storage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, String(value)),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
};

const mock = {
  list: vi.fn(() => ({
    queryKey: ['deployments'],
    queryFn: async () => deployments,
    refetchInterval: false,
  })),
  history: vi.fn(() => ({
    queryKey: ['history'],
    queryFn: async () => history,
  })),
  settings: vi.fn(() => ({
    queryKey: ['settings'],
    queryFn: async () => settings,
  })),
  credentials: vi.fn(() => ({
    queryKey: ['credentials'],
    enabled: true,
    queryFn: async () => [],
  })),
  adminDefaults: vi.fn(() => ({
    queryKey: ['admin-defaults'],
    enabled: true,
    queryFn: async () => ({
      uploadLimitBytes: 104857600,
      proxyCpus: '0.1',
      proxyMemoryBytes: 67108864,
      logFiles: 3,
      logFileSizeBytes: 10485760,
    }),
  })),
  logs: vi.fn(() => ({
    queryKey: ['logs'],
    enabled: true,
    initialPageParam: undefined,
    queryFn: async ({
      pageParam,
    }: {
      pageParam: { createdAt: number; id: string } | undefined;
    }) =>
      pageParam
        ? {
            logs: [
              {
                id: 'older-log-id',
                deploymentId: 'deployment-a',
                source: 'origin' as const,
                content: 'GET /assets/app.js 200',
                createdAt: new Date('2026-10-01T11:59:00Z'),
              },
            ],
            nextCursor: null,
          }
        : {
            logs: [
              {
                id: 'internal-log-id',
                deploymentId: 'deployment-a',
                source: 'origin' as const,
                content: 'GET /health 200',
                createdAt: new Date('2026-10-01T12:00:00Z'),
              },
            ],
            nextCursor: {
              createdAt: Date.parse('2026-10-01T12:00:00Z'),
              id: 'internal-log-id',
            },
          },
    getNextPageParam: (page: {
      nextCursor: { createdAt: number; id: string } | null;
    }) => page.nextCursor ?? undefined,
  })),
  invalidate: vi.fn(async () => undefined),
  publish: vi.fn(async () => ({ id: 'deployment-new' })),
  setPinned: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
  restart: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
  assignTag: vi.fn(async () => undefined),
  removeTag: vi.fn(async () => undefined),
  removeHistory: vi.fn(async () => undefined),
  saveRegistryCredential: vi.fn(async () => undefined),
  deleteRegistryCredential: vi.fn(async () => undefined),
  updateSettings: vi.fn(async () => undefined),
  updateAdminDefaults: vi.fn(async () => undefined),
};
const upload = {
  archive: vi.fn(async () => ({
    artifactId: 'uploaded-artifact',
    size: 12,
    sha256: 'abc',
  })),
  directory: vi.fn(async () => ({
    artifactId: 'uploaded-directory',
    size: 12,
    sha256: 'abc',
  })),
};

function createFixture(canManage = true, isAdmin = false) {
  const fixture = TestBed.createComponent(ProjectDeployments);
  fixture.componentRef.setInput('projectId', 'project-a');
  fixture.componentRef.setInput('previewSlug', 'project');
  fixture.componentRef.setInput('canManage', canManage);
  fixture.componentRef.setInput('isAdmin', isAdmin);
  return fixture;
}

beforeEach(() => {
  vi.clearAllMocks();
  storage.clear();
  vi.stubGlobal('localStorage', localStorageMock);
  session.set({
    data: {
      session: { id: 'session-a' },
      user: { id: 'developer-id', role: 'user' },
    },
  });
  TestBed.configureTestingModule({
    imports: [ProjectDeployments],
    providers: [
      provideRouter([]),
      provideTanStackQuery(
        () =>
          new QueryClient({ defaultOptions: { queries: { retry: false } } }),
      ),
      { provide: AUTH_CLIENT, useValue: { useSession: () => session } },
      { provide: DeploymentsData, useValue: mock },
      { provide: DeploymentUpload, useValue: upload },
    ],
  });
});

afterEach(() => {
  TestBed.resetTestingModule();
  storage.clear();
  vi.unstubAllGlobals();
});

test('viewers can inspect status, preview, configuration, and history without mutation controls', async () => {
  const fixture = createFixture(false);
  await fixture.whenStable();
  expect(fixture.nativeElement.textContent).toContain('healthy');
  expect(
    fixture.nativeElement
      .querySelector('a[target="_blank"]')
      ?.getAttribute('href'),
  ).toBe(deployments[0]!.previewUrl);
  expect(fixture.nativeElement.textContent).toContain('1 variables');
  expect(fixture.nativeElement.textContent).toContain('deployment-old');
  expect(fixture.nativeElement.textContent).toContain('Ada');
  expect(fixture.nativeElement.textContent).toContain('user-123');
  expect(fixture.componentInstance.branchUrl(deployments[0]!)).toBe(
    'https://br-feature-ui-a1b2c3d4.project.preview.example.test',
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

  expect(upload.archive).toHaveBeenCalledWith('project-a', file);
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
    reuseArtifactId: 'deployment-a',
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
      reuseArtifactId: 'container-reuse',
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

  expect(upload.directory).toHaveBeenCalledWith('project-a', files);
  expect(mock.publish).toHaveBeenCalledWith(
    expect.objectContaining({
      projectId: 'project-a',
      kind: 'static',
      artifactId: 'uploaded-directory',
      port: 8080,
    }),
  );
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

test('switching sessions closes publishing and clears tags and details', async () => {
  const fixture = createFixture(true);
  await fixture.whenStable();
  const component = fixture.componentInstance;
  component.publishOpen.set(true);
  component.tagDrafts.set({ 'deployment-a': 'prod' });

  session.set({
    data: {
      session: { id: 'session-b' },
      user: { id: 'another-user', role: 'user' },
    },
  });
  fixture.detectChanges();
  await fixture.whenStable();

  expect(component.publishOpen()).toBe(false);
  expect(component.tagDrafts()).toEqual({});
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

test('tag forms reject unsafe names and allow healthy deployments to assign a valid tag', async () => {
  const fixture = createFixture(true);
  await fixture.whenStable();
  const component = fixture.componentInstance;
  component.tagDrafts.set({ 'deployment-a': 'dpl-release' });
  await component.assignTag(new Event('submit'), deployments[0] as never);
  expect(mock.assignTag).not.toHaveBeenCalled();

  component.tagDrafts.set({ 'deployment-a': 'preview-canary' });
  await component.assignTag(new Event('submit'), deployments[0] as never);
  await fixture.whenStable();
  expect(mock.assignTag).toHaveBeenCalledWith(
    'project-a',
    'preview-canary',
    'deployment-a',
  );
});

test('pinning a deployment uses the project mutation and refreshes the list', async () => {
  const fixture = createFixture(true);
  await fixture.whenStable();
  await fixture.componentInstance.setPinned(deployments[0]!);
  expect(mock.setPinned).toHaveBeenCalledWith(
    'project-a',
    'deployment-a',
    true,
  );
  expect(mock.invalidate).toHaveBeenCalledWith('session-a', 'project-a');
});

test('list links open deployment details and logs using the project slug', async () => {
  const fixture = createFixture();
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  expect(
    element.querySelector(
      'a[href="/projects/project/deployments/deployment-a"]',
    ),
  ).not.toBeNull();
  expect(
    element.querySelector(
      'a[href="/projects/project/deployments/deployment-a/logs"]',
    ),
  ).not.toBeNull();
});

test('deployment expiry and current configuration are visible in list and details', async () => {
  const fixture = createFixture();
  fixture.componentRef.setInput('detailDeployment', {
    ...deployments[0]!,
    branchAlias: null,
    configurationOutdated: true,
    configurationChanges: ['Health checks'],
    retentionDeadlineAt: new Date('2026-10-12T10:00:00Z'),
  });
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  expect(element.textContent).toContain('Configuration out of date');
  expect(element.textContent).toContain('Health checks');
  expect(element.querySelector('#deployment-configuration')).not.toBeNull();
  expect(element.querySelector('#deployment-audit')).not.toBeNull();
  expect(
    element.querySelector('button[aria-label="Copy preview link"]'),
  ).not.toBeNull();
  expect(
    element.querySelector('button[aria-label="Copy deployment details link"]'),
  ).not.toBeNull();
  expect(element.textContent).toContain(
    fixture.componentInstance.dateLabel(new Date('2026-10-12T10:00:00Z')),
  );
  expect(
    fixture.componentInstance.expiryLabel({ ...deployments[0]!, pinned: true }),
  ).toContain('pinned');
  expect(
    fixture.componentInstance.expiryLabel({
      ...deployments[0]!,
      tags: ['stable'],
    }),
  ).toContain('tagged');
});

test('copy buttons copy the absolute detail URL and exact preview URL', async () => {
  const fixture = createFixture();
  await fixture.whenStable();
  const writeText = vi.fn(async () => undefined);
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  try {
    const element = fixture.nativeElement as HTMLElement;
    element
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Copy deployment details link"]',
      )!
      .click();
    await fixture.whenStable();
    expect(writeText).toHaveBeenLastCalledWith(
      new URL(
        '/projects/project/deployments/deployment-a',
        window.location.origin,
      ).href,
    );
    element
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Copy preview link"]',
      )!
      .click();
    await fixture.whenStable();
    expect(writeText).toHaveBeenLastCalledWith(deployments[0]!.previewUrl);
  } finally {
    if (descriptor) Object.defineProperty(navigator, 'clipboard', descriptor);
    else Reflect.deleteProperty(navigator, 'clipboard');
  }
});
