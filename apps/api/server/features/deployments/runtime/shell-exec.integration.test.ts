import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { expect, test, vi } from 'vite-plus/test';
import { DockerEngine } from '../../../infrastructure/docker-engine';
import { ShellExec } from './shell-exec';

const execute = promisify(execFile);
const docker = (command: string, args: string[]) => execute('docker', [command, ...args]);
const available = await docker('info', ['--format', '{{.ServerVersion}}']).then(
  () => true,
  () => false,
);

test.skipIf(!available)(
  'real nginx origin supports duplex input, resize, remote exit and targeted cleanup',
  async () => {
    const name = `senv-shell-test-${randomUUID()}`;
    const { stdout } = await docker('run', ['--rm', '-d', '--name', name, 'nginx:alpine']);
    const engine = new DockerEngine();
    const containerId = stdout.trim();
    let terminal: ShellExec | undefined;
    try {
      terminal = new ShellExec(engine, containerId, '/bin/sh');
      const stream = await terminal.start(100, 40);
      let output = '';
      stream.on('data', (bytes) => {
        output += bytes.toString();
      });
      await terminal.resize(120, 50);
      stream.write('printf "senv-terminal-ready\\n"; stty size; exit 7\n');
      await vi.waitFor(
        async () =>
          expect(await terminal!.inspect()).toMatchObject({ Running: false, ExitCode: 7 }),
        { timeout: 10_000 },
      );
      expect(output).toContain('senv-terminal-ready');
      expect(output).toContain('50 120');
      await terminal.close();
      await expect(
        docker('exec', [containerId, 'test', '!', '-e', terminal.pidFile]),
      ).resolves.toBeDefined();
      terminal = new ShellExec(engine, containerId, '/bin/sh');
      const active = await terminal.start(80, 24);
      active.resume();
      await vi.waitFor(async () => {
        const pid = await docker('exec', [containerId, 'cat', terminal!.pidFile]);
        expect(pid.stdout).toMatch(/^\d+$/);
      });
      active.write("trap '' HUP TERM; sleep 300 & wait\n");
      await vi.waitFor(async () => {
        const processes = await docker('exec', [containerId, 'ps']);
        expect(processes.stdout).toContain('sleep 300');
      });
      await terminal.close();
      await vi.waitFor(async () => expect((await terminal!.inspect()).Running).toBe(false), {
        timeout: 5000,
      });
      const processes = await docker('exec', [containerId, 'ps']);
      expect(processes.stdout).not.toContain('sleep 300');
      expect(
        (await docker('inspect', ['--format', '{{.State.Running}}', containerId])).stdout.trim(),
      ).toBe('true');
    } finally {
      await terminal?.close().catch(() => {});
      await docker('rm', ['-f', name]).catch(() => {});
    }
  },
  30_000,
);
