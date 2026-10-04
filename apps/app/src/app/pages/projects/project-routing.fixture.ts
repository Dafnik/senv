import { vi } from 'vite-plus/test';

export const deployment = {
  id: 'acf379',
  projectId: 'project-id',
  kind: 'static',
  status: 'healthy',
  desiredState: 'running',
  pinned: false,
  artifactId: 'artifact-id',
  imageDigest: null,
  source: { commit: 'abc123' },
  submittedAt: new Date(),
  readyAt: new Date(),
  retentionStartedAt: new Date(),
  retentionDeadlineAt: new Date('2026-10-10'),
  failureReason: null,
  removalPending: false,
  configurationOutdated: true,
  configurationChanges: ['Health checks'],
  previewUrl: 'https://acf379.project-preview.preview.example.test',
  config: {
    port: 80,
    env: {},
    spaFallback: false,
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
  branchAlias: null,
  tags: [],
};

export const deploymentData = {
  previewStatus: vi.fn(
    (_sessionId: string, projectId: string, id: string, enabled: boolean) => ({
      queryKey: ['preview-status', projectId, id],
      enabled,
      queryFn: async () => ({
        url: deployment.previewUrl,
        statusCode: 404,
        checkedAt: new Date(),
        responseTimeMs: 12,
        error: null,
      }),
      refetchInterval: false,
    }),
  ),
  detail: vi.fn((_sessionId: string, projectId: string, id: string) => ({
    queryKey: ['detail', projectId, id],
    enabled: !!projectId && !!id,
    queryFn: async () => deployment,
    refetchInterval: false,
  })),
  runtime: () => ({
    queryKey: ['runtime'],
    queryFn: async () => ({ env: {}, secretNames: [] }),
  }),
  list: () => ({
    queryKey: ['deployments'],
    queryFn: async () => [],
    refetchInterval: false,
  }),
  audit: vi.fn(
    (
      sessionId: string,
      input: { projectId: string; deploymentId?: string },
    ) => ({
      queryKey: [
        'audit',
        sessionId,
        input.projectId,
        input.deploymentId ?? null,
      ],
      queryFn: async () => ({
        entries: input.deploymentId
          ? [
              {
                id: 'event-id',
                projectId: input.projectId,
                deploymentId: input.deploymentId,
                event: 'published',
                actorType: 'user',
                actor: { id: 'admin', name: 'Ada' },
                details: {},
                createdAt: new Date(),
              },
            ]
          : [],
        total: input.deploymentId ? 1 : 0,
        events: ['published'],
        actors: [{ id: 'admin', name: 'Ada' }],
      }),
      refetchInterval: false,
    }),
  ),
  settings: () => ({
    queryKey: ['settings'],
    queryFn: async () => ({
      spaFallback: false,
      repository: '',
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
    }),
  }),
  credentials: () => ({
    queryKey: ['credentials'],
    enabled: false,
    queryFn: async () => [],
  }),
  adminDefaults: () => ({
    queryKey: ['defaults'],
    queryFn: async () => ({
      uploadLimitBytes: 104857600,
      proxyCpus: '0.1',
      proxyMemoryBytes: 67108864,
      logFiles: 3,
      logFileSizeBytes: 10485760,
    }),
  }),
  logs: (
    _sessionId: string,
    projectId: string,
    id: string,
    source: string,
  ) => ({
    queryKey: ['logs', projectId, id, source],
    enabled: !!projectId && !!id,
    initialPageParam: undefined as
      { createdAt: number; id: string } | undefined,
    queryFn: async ({
      pageParam,
    }: {
      pageParam: { createdAt: number; id: string } | undefined;
    }) => ({
      logs: [
        {
          id: pageParam ? 'older' : 'latest',
          createdAt: new Date(pageParam ? 0 : 1000),
          content: pageParam
            ? `older ${source} output`
            : `latest ${source} output`,
        },
      ],
      nextCursor: pageParam ? null : { createdAt: 1000, id: 'latest' },
    }),
    getNextPageParam: (page: {
      nextCursor: { createdAt: number; id: string } | null;
    }) => page.nextCursor ?? undefined,
  }),
  resources: vi.fn((_sessionId: string, projectId: string, id: string) => ({
    queryKey: ['resources', projectId, id],
    enabled: !!projectId && !!id,
    queryFn: async () => ({
      status: 'available',
      sampledAt: new Date('2026-10-04T09:00:00Z'),
      cpuPercent: 43.4,
      memoryUsedBytes: 268435456,
      memoryLimitBytes: 536870912,
    }),
    refetchInterval: false,
  })),
  invalidate: vi.fn(async () => undefined),
};
