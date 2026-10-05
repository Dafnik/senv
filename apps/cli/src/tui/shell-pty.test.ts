import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import superjson from 'superjson';
import { afterAll, beforeAll, expect, test } from 'vite-plus/test';
import { DockerEngine } from '../../../api/server/infrastructure/docker-engine';
import { ShellExec } from '../../../api/server/features/deployments/runtime/shell-exec';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const available =
  process.platform !== 'win32' &&
  (await execute('docker', ['info', '--format', '{{.ServerVersion}}']).then(
    () => true,
    () => false,
  )) &&
  (await execute('python3', ['--version']).then(
    () => true,
    () => false,
  ));
const control = (value: unknown) =>
  Buffer.concat([Buffer.from([1]), Buffer.from(JSON.stringify(value))]);
let buildDirectory: string;
beforeAll(async () => {
  if (available) {
    buildDirectory = await mkdtemp(join(tmpdir(), 'senv-tui-shell-build-'));
    await execute('vp', ['build', '--outDir', buildDirectory], { cwd: root });
    await symlink(join(root, 'node_modules'), join(buildDirectory, 'node_modules'));
    await writeFile(join(buildDirectory, 'package.json'), JSON.stringify({ type: 'module' }));
  }
});
afterAll(async () => {
  if (buildDirectory) await rm(buildDirectory, { recursive: true, force: true });
});
for (const [mode, image] of [
  ['shell-exit', 'nginx:alpine'],
  ['shell-detach', 'alpine:3.22'],
  ['shell-disconnect', 'nginx:alpine'],
] as const)
  test.skipIf(!available)(
    `TUI hands the PTY to a real ${image} origin and resumes after ${mode}`,
    async () => {
      const name = `senv-tui-test-${randomUUID()}`;
      const launched = await execute('docker', [
        'run',
        '--rm',
        '-d',
        '--name',
        name,
        image,
        ...(image.startsWith('alpine') ? ['sleep', '300'] : []),
      ]);
      const engine = new DockerEngine();
      const containerId = launched.stdout.trim();
      let execution: ShellExec | undefined;
      let completion: Promise<void> | undefined;
      let timer: ReturnType<typeof setInterval> | undefined;
      let exitSent = false;
      const credential = `test-personal-${randomUUID()}`;
      const deployment = {
        id: 'deployment',
        projectId: 'project',
        kind: 'static',
        status: 'healthy',
        pinned: false,
        removalPending: false,
        desiredState: 'running',
        artifactId: 'artifact',
        imageDigest: null,
        source: {},
        submittedAt: new Date(),
        previewUrl: 'http://deployment.project.preview.localhost',
        branchAlias: null,
        tags: [],
        config: { env: { PRIVATE: 'must-not-be-shown' } },
      };
      const me = {
        id: 'user',
        email: 'admin@example.com',
        name: 'Admin',
        role: 'admin',
        emailVerified: true,
      };
      const project = {
        id: 'project',
        name: 'Project',
        previewSlug: 'project',
        role: 'admin',
        permission: 'admin',
        members: [],
      };
      const server = createServer((request, response) => {
        const path = new URL(request.url!, 'http://localhost').pathname.split('/').at(-1)!;
        const outputs: Record<string, unknown> = {
          me,
          'cli.access': {
            kind: 'personal',
            projectId: null,
            permission: null,
            impersonated: false,
            sessionId: 'session',
          },
          'cli.project': project,
          'projects.detail': project,
          'deployments.list': { deployments: [deployment] },
          'deployments.detail': { ...deployment, history: [] },
          'deployments.shellTarget': { target: 'origin', configuredUser: 'root (image default)' },
          'deployments.shellGrant': {
            grant: 'g'.repeat(32),
            executable: '/bin/sh',
            configuredUser: 'root (image default)',
          },
        };
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ result: { data: superjson.serialize(outputs[path]) } }));
      });
      const sockets = new WebSocketServer({ server, path: '/api/cli/shell' });
      sockets.on('connection', (socket, request) => {
        expect(request.headers.authorization).toBe(`Bearer ${credential}`);
        socket.on('message', async (bytes) => {
          const packet = Buffer.from(bytes as Buffer);
          if (packet[0] === 0) {
            if (mode === 'shell-disconnect') socket.terminate();
            else execution?.stream?.write(packet.subarray(1));
          } else {
            const message = JSON.parse(packet.subarray(1).toString());
            if (message.type === 'open') {
              expect(message.grant).toBe('g'.repeat(32));
              execution = new ShellExec(engine, containerId, '/bin/sh');
              const stream = await execution.start(100, 24);
              stream.on('data', (data) => {
                if (socket.readyState === WebSocket.OPEN)
                  socket.send(Buffer.concat([Buffer.from([0]), data]));
              });
              socket.send(control({ type: 'ready' }));
              socket.send(Buffer.concat([Buffer.from([0]), Buffer.from('SENV_SHELL_READY\n')]));
              timer = setInterval(async () => {
                if (exitSent || !execution || socket.readyState !== WebSocket.OPEN) return;
                const info = await execution.inspect();
                if (!info.Running) {
                  exitSent = true;
                  clearInterval(timer);
                  socket.send(control({ type: 'exit', code: info.ExitCode }));
                  socket.close();
                }
              }, 100);
            } else if (message.type === 'resize')
              await execution?.resize(message.cols, message.rows);
            else if (message.type === 'detach') socket.close();
          }
        });
        socket.once('close', () => {
          clearInterval(timer);
          completion = execution?.close();
        });
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      try {
        const address = server.address() as { port: number };
        const result = await execute(
          'python3',
          [
            `${root}scripts/test-terminal.py`,
            process.execPath,
            join(buildDirectory, 'senv.js'),
            mode,
            `http://127.0.0.1:${address.port}`,
            credential,
          ],
          { timeout: 20_000 },
        );
        expect(JSON.parse(result.stdout)).toEqual({ mode, restored: true });
        await completion;
        expect(await execution?.inspect()).toMatchObject({ Running: false });
        expect(
          (
            await execute('docker', ['inspect', '--format', '{{.State.Running}}', containerId])
          ).stdout.trim(),
        ).toBe('true');
      } finally {
        clearInterval(timer);
        await execution?.close().catch(() => {});
        for (const socket of sockets.clients) socket.terminate();
        await new Promise<void>((resolve) => sockets.close(() => resolve()));
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await execute('docker', ['rm', '-f', name]).catch(() => {});
      }
    },
    40_000,
  );
