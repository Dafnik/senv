import { vi } from 'vite-plus/test';

export const artifact = {
  id: 'artifact-id',
  projectId: 'project-id',
  size: 512,
  sha256: 'a'.repeat(64),
  createdAt: new Date('2026-10-05T10:00:00Z'),
  source: { branch: 'feature/files', commit: 'abc123' },
  deployments: [{ id: 'acf379', status: 'healthy' }],
};

export const artifactApi = {
  list: { query: vi.fn(async () => ({ items: [artifact], total: 1 })) },
  detail: {
    query: vi.fn(async ({ artifactId }: { artifactId: string }) => {
      if (artifactId !== artifact.id) throw new Error('Artifact not found.');
      return artifact;
    }),
  },
  file: {
    query: vi.fn(async ({ path }: { path: string }) => ({
      name: path.split('/').at(-1)!,
      path,
      size: 12,
      kind: 'code',
      language: 'javascript',
      mime: 'text/plain',
      text: 'const x = 1;',
      reason: null,
    })),
  },
  directory: {
    query: vi.fn(
      async ({ artifactId, path }: { artifactId: string; path: string }) => {
        if (artifactId !== artifact.id) throw new Error('Artifact not found.');
        return {
          path,
          size: path ? 100 : 512,
          entries: path
            ? [
                {
                  name: 'image & été.png',
                  path: `${path}/image & été.png`,
                  kind: 'file' as const,
                  size: 100,
                },
              ]
            : [
                {
                  name: 'assets',
                  path: 'assets',
                  kind: 'directory' as const,
                  size: 100,
                },
                {
                  name: 'index.html',
                  path: 'index.html',
                  kind: 'file' as const,
                  size: 412,
                },
              ],
        };
      },
    ),
  },
};
