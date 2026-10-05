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
      }
    } finally {
      this.stream?.destroy();
    }
  }
}
