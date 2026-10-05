import { mkdir, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { deploymentStorageRoot } from '../storage/storage';
import { deploymentInstanceId } from './identity';
import { assertContainerOwned } from './container-ownership';
import { randomUUID } from 'node:crypto';
import type { Duplex } from 'node:stream';
import { DockerEngine } from '../../../infrastructure/docker-engine';

// The marker stays in the process environment, so cleanup never trusts a PID file alone.
const launch = 'umask 077; printf "%s" "$$" > "$1"; exec "$2" -i';
// Every signal is gated by an exact random environment marker, including child
// jobs. Escalate if a program ignores HUP/TERM, without stopping the container.
const cleanup = `
marked() {
  tr "\\000" "\\n" < "$1" 2>/dev/null | grep -Fx "SENV_SHELL_ID=$2" >/dev/null;
}
signal_marked() {
  for e in /proc/[0-9]*/environ; do
    marked "$e" "$2" || continue;
    p=\${e#/proc/}; p=\${p%/environ};
    kill -"$1" "$p" 2>/dev/null || :;
  done;
}
any_marked() {
  for e in /proc/[0-9]*/environ; do
    marked "$e" "$1" && return 0;
  done;
  return 1;
}
signal_marked HUP "$2";
if any_marked "$2"; then
  sleep 1;
  signal_marked TERM "$2";
  if any_marked "$2"; then
    sleep 1;
    signal_marked KILL "$2";
  fi;
fi;
rm -f "$1";
`;

export class ShellExec {
  readonly marker = randomUUID();
  readonly pidFile = `/tmp/.senv-shell-${this.marker}`;
  execId?: string;
  stream?: Duplex;
  constructor(
    readonly engine: DockerEngine,
    readonly containerId: string,
    readonly executable: string,
  ) {}

  async start(cols: number, rows: number, term = 'xterm-256color') {
    await mkdir(shellRecoveryDirectory(), { recursive: true, mode: 0o700 });
    await writeFile(
      join(shellRecoveryDirectory(), `${this.marker}.json`),
      JSON.stringify({
        containerId: this.containerId,
        executable: this.executable,
        marker: this.marker,
        instanceId: deploymentInstanceId(),
      }),
      { mode: 0o600, flag: 'wx' },
    );
    const created = await this.engine.request<{ Id: string }>(
      'POST',
      `/containers/${encodeURIComponent(this.containerId)}/exec`,
      {
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        Privileged: false,
        Cmd: [this.executable, '-c', launch, 'senv-shell', this.pidFile, this.executable],
        Env: [`TERM=${term}`, `SENV_SHELL_ID=${this.marker}`],
      },
    );
    this.execId = created.body.Id;
    this.stream = await this.engine.attachExec(this.execId);
    await this.resize(cols, rows);
    return this.stream;
  }
  async resize(cols: number, rows: number) {
    if (this.execId)
      await this.engine.request(
        'POST',
        `/exec/${encodeURIComponent(this.execId)}/resize?w=${cols}&h=${rows}`,
      );
  }
  async inspect() {
    if (!this.execId) return { Running: false, ExitCode: null };
    return (
      await this.engine.request<{ Running: boolean; ExitCode: number | null }>(
        'GET',
        `/exec/${encodeURIComponent(this.execId)}/json`,
      )
    ).body;
  }
  async close() {
    try {
      if (this.execId) {
        const cancel = await this.engine.request<{ Id: string }>(
          'POST',
          `/containers/${encodeURIComponent(this.containerId)}/exec`,
          {
            AttachStdout: true,
            AttachStderr: true,
            Tty: false,
            Privileged: false,
            Cmd: [this.executable, '-c', cleanup, 'senv-shell-cleanup', this.pidFile, this.marker],
          },
        );
        await this.engine.request('POST', `/exec/${encodeURIComponent(cancel.body.Id)}/start`, {
          Detach: false,
          Tty: false,
        });
        await rm(join(shellRecoveryDirectory(), `${this.marker}.json`), { force: true });
      }
    } finally {
      this.stream?.destroy();
    }
  }
}

const shellRecoveryDirectory = () => join(deploymentStorageRoot(), 'shell-recovery');
// Durable metadata preserves explicit shell paths across an API crash. Ownership
// and the exact random process environment marker are rechecked before signalling.
let recoveryPending = false;
let recovery: Promise<void> | undefined;
export function ensureShellRecovery() {
  return recoveryPending ? recoverShells() : Promise.resolve();
}
export function recoverShells(engine = new DockerEngine()) {
  if (recovery) return recovery;
  recoveryPending = true;
  recovery = recover(engine)
    .then(() => {
      recoveryPending = false;
    })
    .finally(() => {
      recovery = undefined;
    });
  return recovery;
}
async function recover(engine: DockerEngine) {
  await recoverContainerMarkers(engine);
  const entries = await readdir(shellRecoveryDirectory()).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const name of entries) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
    const path = join(shellRecoveryDirectory(), name);
    const value = JSON.parse(await readFile(path, 'utf8')) as {
      containerId: string;
      executable: string;
      marker: string;
      instanceId: string;
    };
    if (
      value.instanceId !== deploymentInstanceId() ||
      name !== `${value.marker}.json` ||
      !/^\/[A-Za-z0-9_./-]+$/.test(value.executable)
    )
      continue;
    let container;
    try {
      container = (
        await engine.request<{
          Id: string;
          Config: { Labels: Record<string, string> };
          State: { Running: boolean };
        }>('GET', `/containers/${encodeURIComponent(value.containerId)}/json`)
      ).body;
    } catch (error) {
      if (error instanceof Error && error.message.includes('(404)')) {
        await rm(path, { force: true });
        continue;
      }
      throw error;
    }
    const labels = container.Config.Labels;
    assertContainerOwned(
      container,
      value.instanceId,
      { id: labels['senv.deployment']!, projectId: labels['senv.project']! },
      'origin',
    );
    if (container.State.Running) {
      const exec = await engine.request<{ Id: string }>(
        'POST',
        `/containers/${encodeURIComponent(container.Id)}/exec`,
        {
          Cmd: [
            value.executable,
            '-c',
            cleanup,
            'senv-shell-recovery',
            `/tmp/.senv-shell-${value.marker}`,
            value.marker,
          ],
          AttachStdout: true,
          AttachStderr: true,
          Tty: false,
          Privileged: false,
        },
      );
      await engine.request('POST', `/exec/${encodeURIComponent(exec.body.Id)}/start`, {
        Detach: false,
        Tty: false,
      });
    }
    await rm(path, { force: true });
  }
}

async function recoverContainerMarkers(engine: DockerEngine) {
  const instance = deploymentInstanceId();
  const containers = (
    await engine.request<Array<{ Id: string }>>(
      'GET',
      `/containers/json?filters=${encodeURIComponent(JSON.stringify({ label: ['senv.managed=true', `senv.instance=${instance}`, 'senv.role=origin'], status: ['running'] }))}`,
    )
  ).body;
  const { findDeployment } = await import('../repositories/deployments');
  for (const listed of containers) {
    const container = (
      await engine.request<{ Id: string; Config: { Labels: Record<string, string> } }>(
        'GET',
        `/containers/${encodeURIComponent(listed.Id)}/json`,
      )
    ).body;
    const labels = container.Config.Labels;
    const owner = findDeployment(labels['senv.deployment']!, labels['senv.project']);
    if (!owner) continue;
    assertContainerOwned(container, instance, owner, 'origin');
    // The durable records below handle arbitrary explicit executable paths.
    // This scan also recovers marker files left by older API versions.
    for (const executable of ['/bin/sh', '/bin/bash', '/bin/ash']) {
      try {
        const exec = await engine.request<{ Id: string }>(
          'POST',
          `/containers/${encodeURIComponent(container.Id)}/exec`,
          {
            Cmd: [
              executable,
              '-c',
              `for marker_file in /tmp/.senv-shell-*; do
            [ -f "$marker_file" ] || continue;
            marker=\${marker_file##*/.senv-shell-};
            printf '%s' "$marker" | grep -Eq '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' || continue;
            set -- "$marker_file" "$marker";
            ${cleanup}
          done`,
            ],
            AttachStdout: true,
            AttachStderr: true,
            Tty: false,
            Privileged: false,
          },
        );
        await engine.request('POST', `/exec/${encodeURIComponent(exec.body.Id)}/start`, {
          Detach: false,
          Tty: false,
        });
        const result = await engine.request<{ ExitCode: number }>(
          'GET',
          `/exec/${encodeURIComponent(exec.body.Id)}/json`,
        );
        if (result.body.ExitCode === 0) break;
      } catch {
        /* Try the next supported shell; explicit paths use durable records. */
      }
    }
  }
}
