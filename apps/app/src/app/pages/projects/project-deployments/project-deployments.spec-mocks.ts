import { vi } from 'vite-plus/test';
import type { DeploymentPreviewStatus as PreviewStatusResult } from '@senv/api/shared/deployments';
import {
  history,
  deployments,
  registryCredentials,
  settings,
} from './project-deployments.spec-data';
export const mock = {
  previewStatus: vi.fn(
    (
      _sessionId: string,
      _projectId: string,
      _deploymentId: string,
      enabled: boolean,
    ) => ({
      queryKey: ['preview-status'],
      enabled,
      queryFn: async (): Promise<PreviewStatusResult> => ({
        url: deployments[0].previewUrl,
        statusCode: 404,
        checkedAt: new Date(),
        responseTimeMs: 12,
        error: null,
      }),
      refetchInterval: false,
    }),
  ),
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
    queryFn: async () => registryCredentials,
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
  publish: vi.fn(async (_input: unknown) => ({ id: 'deployment-new' })),
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
export const upload = {
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
