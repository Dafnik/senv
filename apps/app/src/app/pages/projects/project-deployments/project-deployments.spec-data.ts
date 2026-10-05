import { signal } from '@angular/core';
import type { PublicDeployment } from '@senv/api/shared/deployments';
export const session = signal({
  data: {
    session: { id: 'session-a' },
    user: { id: 'developer-id', role: 'user' },
  },
});
export const deployments: Array<PublicDeployment & { previewUrl: string }> = [
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
      retentionDays: 7,
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
    branchAlias: 'br-feature-ui',
    tags: [],
    previewUrl: 'https://dpl-deployment-a.project.preview.example.test',
  },
];
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
export const storage = new Map<string, string>();
export const localStorageMock = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, String(value)),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
};

export const history = {
  entries: [
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
  ],
  total: 1,
  events: ['deleted'],
  actors: [{ id: 'user-123', name: 'Ada' }],
};

export const registryCredentials: Array<{
  id: string;
  name: string;
  registry: string;
}> = [];
