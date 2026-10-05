import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import superjson from 'superjson';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vite-plus/test';
const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const python = await execute('python3', ['--version']).then(
  () => true,
  () => false,
);
let buildDirectory: string;
beforeAll(async () => {
  if (python && process.platform !== 'win32') {
    buildDirectory = await mkdtemp(join(tmpdir(), 'senv-tui-build-'));
    await execute('vp', ['build', '--outDir', buildDirectory], { cwd: root });
    await symlink(join(root, 'node_modules'), join(buildDirectory, 'node_modules'));
    await writeFile(join(buildDirectory, 'package.json'), JSON.stringify({ type: 'module' }));
  }
});
afterAll(async () => {
  if (buildDirectory) await rm(buildDirectory, { recursive: true, force: true });
});
for (const mode of ['quit', 'resize', 'signal', 'hangup', 'ascii', 'suspend'])
  test.skipIf(!python || process.platform === 'win32')(
    `built TUI restores terminal state after ${mode}`,
    async () => {
      const result = await execute(
        'python3',
        [
          `${root}scripts/test-terminal.py`,
          process.execPath,
          join(buildDirectory, 'senv.js'),
          mode,
        ],
        { timeout: 15_000 },
      );
      expect(JSON.parse(result.stdout)).toEqual({ mode, restored: true });
    },
    20_000,
  );

test.skipIf(!python || process.platform === 'win32')(
  'built TUI navigates project and account tabs across wide and narrow terminal layouts',
  async () => {
    const requests: string[] = [];
    const project = {
      id: 'project',
      name: 'Website 界🙂 \x1b]52;c;dGVzdA==\x07',
      previewSlug: 'website',
      role: 'admin',
      permission: 'admin',
      members: [],
    };
    const deployment = {
      id: 'deployment',
      projectId: 'project',
      kind: 'static',
      status: 'healthy',
      pinned: false,
      source: { branch: 'main' },
      submittedAt: new Date(),
      tags: [],
      config: {},
      previewUrl: 'http://deployment.website.preview.localhost',
      branchAlias: null,
    };
    const at = new Date();
    const event = {
      id: 'event',
      projectId: 'project',
      deploymentId: 'deployment',
      event: 'tag-assigned',
      actorType: 'user',
      actor: { id: 'user', name: 'Dafni' },
      details: { name: 'production' },
      createdAt: at,
    };
    const outputs: Record<string, unknown> = {
      me: {
        id: 'user',
        email: 'admin@example.com',
        name: 'Admin',
        role: 'admin',
        emailVerified: true,
      },
      'cli.access': {
        kind: 'personal',
        projectId: null,
        permission: null,
        impersonated: false,
        sessionId: 'session',
      },
      'cli.project': project,
      'projects.detail': project,
      'projects.list': { projects: [project], nextCursor: null },
      'deployments.list': { deployments: [deployment] },
      'deployments.detail': { ...deployment, history: [event] },
      'deployments.resources': {
        status: 'available',
        sampledAt: at,
        cpuPercent: 26.4,
        memoryUsedBytes: 256 * 1024 ** 2,
        memoryLimitBytes: 1024 ** 3,
      },
      'deployments.history': {
        entries: Array.from({ length: 10 }, (_, index) => ({
          ...event,
          id: `event-${index}`,
          actor: { id: `user-${index}`, name: `Dafni ${index}` },
        })),
        total: 10,
      },
      'deployments.resourceHistory': {
        from: at,
        to: at,
        intervalMs: 30000,
        points: [
          {
            sampledAt: at,
            cpuPercent: 26.4,
            memoryUsedBytes: 128 * 1024 ** 2,
            memoryLimitBytes: 1024 ** 3,
          },
          {
            sampledAt: at,
            cpuPercent: 15,
            memoryUsedBytes: 256 * 1024 ** 2,
            memoryLimitBytes: 1024 ** 3,
          },
        ],
      },
      'deployments.logsForward': {
        logs: [
          {
            id: 'log',
            sequence: 1,
            createdAt: at,
            content:
              '{"level":30,"msg":"SENV_PREVIEW_READY","port":8080}\n' +
              Array.from(
                { length: 49 },
                (_, index) => `Log output ${String(index + 1).padStart(2, '0')}`,
              ).join('\n'),
          },
        ],
        afterSequence: 1,
        hasMore: false,
        retentionGap: false,
      },
      'cli.sessions': [
        {
          id: 'session',
          label: 'CLI test session',
          kind: 'cli',
          current: true,
          expiresAt: new Date('2030-01-01'),
        },
      ],
      'cli.tokens': [
        {
          id: 'token',
          name: 'CI token',
          permission: 'read',
          prefix: 'ci',
          expiresAt: null,
          revokedAt: null,
        },
      ],
    };
    const server = createServer((request, response) => {
      expect(request.headers.authorization).toBe('Bearer navigation-test-credential');
      const path = new URL(request.url!, 'http://localhost').pathname.split('/').at(-1)!;
      requests.push(path);
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ result: { data: superjson.serialize(outputs[path]) } }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No test server address');
      const result = await execute(
        'python3',
        [
          `${root}scripts/test-terminal.py`,
          process.execPath,
          join(buildDirectory, 'senv.js'),
          'navigation',
          `http://127.0.0.1:${address.port}`,
          'navigation-test-credential',
        ],
        { timeout: 25_000 },
      );
      expect(JSON.parse(result.stdout)).toEqual({ mode: 'navigation', restored: true });
      expect(requests).toEqual(
        expect.arrayContaining([
          'deployments.detail',
          'deployments.logsForward',
          'deployments.resources',
          'deployments.resourceHistory',
          'deployments.history',
          'cli.sessions',
          'cli.tokens',
        ]),
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
  30_000,
);

test('built TUI rejects a non-TTY launch before enabling terminal ownership', async () => {
  await expect(
    execute(process.execPath, [join(buildDirectory, 'senv.js'), 'tui'], { timeout: 5000 }),
  ).rejects.toMatchObject({ code: 2, stderr: expect.stringContaining('terminal') });
});
