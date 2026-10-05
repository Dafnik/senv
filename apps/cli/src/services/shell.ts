import { WebSocket } from 'ws';
import type { ClientContext } from '../api/client.ts';
import { CliError } from '../errors.ts';

const frame = (value: unknown) =>
  Buffer.concat([Buffer.from([1]), Buffer.from(JSON.stringify(value))]);
export async function runShell(
  value: ClientContext,
  projectId: string,
  deploymentId: string,
  executable?: string,
  options: { signal?: AbortSignal; onMessage?: (message: string) => void } = {},
) {
  options.signal?.throwIfAborted();
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new CliError('Interactive shell requires a local terminal.', 2);
  const grant = await value.client.deployments.shellGrant.mutate(
    {
      projectId,
      deploymentId,
      executable,
      cols: process.stdout.columns || 80,
      rows: process.stdout.rows || 24,
      term: process.env['TERM']?.match(/^[A-Za-z0-9_-]{1,64}$/)
        ? process.env['TERM']
        : 'xterm-256color',
    },
    { signal: options.signal },
  );
  options.signal?.throwIfAborted();
  const url = new URL('/api/cli/shell', value.profile.apiUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url, {
    headers: { authorization: `Bearer ${value.token}` },
    maxPayload: 1024 * 1024,
    handshakeTimeout: 10_000,
    followRedirects: false,
  });
  options.onMessage?.(
    `Opening the origin using ${grant.executable}. Press Ctrl-] to detach. Changes affect writable runtime files only.`,
  );
  let exitCode: number | undefined;
  let detached = false;
  let remoteError: string | undefined;
  const wasRaw = process.stdin.isRaw;
  await new Promise<void>((resolve, reject) => {
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      options.signal?.removeEventListener('abort', terminateLater);
      process.stdout.off('drain', drain);
      try {
        process.stdin.setRawMode(wasRaw);
      } catch {
        /* Terminal may already have closed. */
      }
      process.stdin.pause();
      process.stdin.off('data', input);
      process.stdout.off('resize', resize);
      process.off('SIGTERM', terminate);
      process.stdin.off('error', terminalError);
      process.stdout.off('error', terminalError);
    };
    const drain = () => {
      if (socket.readyState === WebSocket.OPEN) socket.resume();
    };
    options.signal?.addEventListener('abort', terminateLater, { once: true });
    function terminateLater() {
      terminate();
    }
    const terminalError = () => {
      restore();
      socket.terminate();
      reject(new CliError('Local terminal failed.'));
    };
    const terminate = () => {
      restore();
      socket.terminate();
      reject(new CliError('Cancelled.', 130));
    };
    const resize = () => {
      if (socket.readyState === WebSocket.OPEN)
        socket.send(
          frame({
            type: 'resize',
            cols: process.stdout.columns || 80,
            rows: process.stdout.rows || 24,
          }),
        );
    };
    const input = (chunk: Buffer | string) => {
      // Ink uses UTF-8 input. A standalone CLI shell receives Buffers.
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8');
      if (bytes.includes(0x1d)) {
        socket.send(frame({ type: 'detach' }));
        detached = true;
        exitCode = 0;
        socket.close();
        return;
      }
      if (socket.bufferedAmount > 256 * 1024) {
        terminate();
        return;
      }
      for (let start = 0; start < bytes.length; start += 32 * 1024)
        socket.send(Buffer.concat([Buffer.from([0]), bytes.subarray(start, start + 32 * 1024)]));
    };
    socket.once('open', () => {
      if (options.signal?.aborted) {
        terminate();
        return;
      }
      socket.send(frame({ type: 'open', grant: grant.grant }));
      try {
        process.stdin.setRawMode(true);
      } catch {
        terminalError();
        return;
      }
      process.stdin.resume();
      process.stdin.on('data', input);
      process.stdout.on('resize', resize);
      process.on('SIGTERM', terminate);
      process.stdin.on('error', terminalError);
      process.stdout.on('error', terminalError);
    });
    socket.on('message', (data) => {
      if (restored) return;
      const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      if (bytes[0] === 0) {
        if (!process.stdout.write(bytes.subarray(1))) {
          socket.pause();
          process.stdout.once('drain', drain);
        }
      } else if (bytes[0] === 1) {
        try {
          const message = JSON.parse(bytes.subarray(1).toString()) as {
            type: string;
            code?: number | null;
            message?: string;
          };
          if (message.type === 'ping') socket.send(frame({ type: 'pong' }));
          if (message.type === 'exit' && typeof message.code === 'number') exitCode = message.code;
          if (message.type === 'error') remoteError = message.message ?? 'Shell failed.';
        } catch {
          restore();
          socket.close();
          reject(new CliError('Invalid terminal response.'));
        }
      }
    });
    socket.once('error', () => {
      restore();
      reject(new CliError('Terminal connection failed.'));
    });
    socket.once('close', () => {
      restore();
      if (exitCode !== undefined && !remoteError) {
        resolve();
      } else
        reject(new CliError(remoteError ?? 'Terminal connection ended without an exit status.'));
    });
  });
  return { exitCode: exitCode ?? 0, detached };
}
