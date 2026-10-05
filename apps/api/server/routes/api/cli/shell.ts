import { createError, defineWebSocketHandler } from 'nitro/h3';
import * as z from 'zod';
import { DockerEngine } from '../../../infrastructure/docker-engine';
import {
  requirePersonal,
  resolvePrincipal,
} from '../../../features/auth/services/request-principal';
import {
  consumeShellGrant,
  inspectShellContainer,
  shellAudit,
  type ShellGrant,
} from '../../../features/deployments/services/shell';
import { ShellExec } from '../../../features/deployments/runtime/shell-exec';

const connections = new Map<string, { userId: string; deploymentId: string }>();
const controls = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('open'), grant: z.string().min(20).max(128) }),
  z.strictObject({
    type: z.literal('resize'),
    cols: z.number().int().min(1).max(1000),
    rows: z.number().int().min(1).max(1000),
  }),
  z.strictObject({ type: z.literal('detach') }),
  z.strictObject({ type: z.literal('pong') }),
]);
const control = (value: unknown) =>
  Buffer.concat([Buffer.from([1]), Buffer.from(JSON.stringify(value))]);

export default defineWebSocketHandler(async (event) => {
  if (!event.req.headers.get('authorization'))
    throw createError({ statusCode: 401, statusMessage: 'A CLI bearer session is required.' });
  const principal = await resolvePrincipal(event.req.headers).catch(() => {
    throw createError({ statusCode: 401 });
  });
  requirePersonal(principal);
  let grant: ShellGrant | undefined;
  let execution: ShellExec | undefined;
  let closed = false;
  let opening = false;
  let ending = false;
  let connectionId: string | undefined;
  let lastInput = Date.now();
  let lastPong = Date.now();
  const startedAt = Date.now();
  let timer: ReturnType<typeof setInterval> | undefined;
  let handshake: ReturnType<typeof setTimeout> | undefined;
  let checking = false;
  let finishPromise: Promise<void> | undefined;
  const finish = (reason: string) => {
    if (finishPromise) return finishPromise;
    closed = true;
    clearInterval(timer);
    clearTimeout(handshake);
    if (connectionId) connections.delete(connectionId);
    finishPromise = (async () => {
      try {
        await execution?.close();
      } catch (error) {
        console.error(
          '[shell] cleanup failed',
          error instanceof Error ? error.message : 'Unknown Docker failure',
        );
      }
      if (grant) {
        try {
          shellAudit(principal, grant, 'shell.closed', reason);
        } catch {
          /* deployment already removed */
        }
      }
    })();
    return finishPromise;
  };
  return {
    open(peer) {
      handshake = setTimeout(() => {
        peer.close(1008, 'Shell grant required.');
        void finish('handshake_timeout');
      }, 5000);
    },
    async message(peer, message) {
      try {
        const packet = message.uint8Array();
        if (packet.length < 1 || packet.length > 64 * 1024)
          throw new Error('Invalid terminal frame.');
        if (packet[0] === 0) {
          if (!execution?.stream || closed || execution.stream.writableLength > 256 * 1024)
            throw new Error('Terminal input is unavailable or too fast.');
          lastInput = Date.now();
          execution.stream.write(packet.subarray(1));
          return;
        }
        if (packet[0] !== 1) throw new Error('Invalid terminal frame.');
        const input = controls.parse(JSON.parse(Buffer.from(packet.subarray(1)).toString('utf8')));
        if (input.type === 'pong') {
          lastPong = Date.now();
          return;
        }
        if (input.type === 'detach') {
          await finish('detached');
          peer.close(1000, 'Detached.');
          return;
        }
        if (input.type === 'resize') {
          if (!execution || closed) throw new Error('Terminal is not open.');
          await execution.resize(input.cols, input.rows);
          return;
        }
        if (grant || opening || closed) throw new Error('Shell already opened.');
        opening = true;
        grant = await consumeShellGrant(await resolvePrincipal(event.req.headers), input.grant);
        if (closed) return;
        if (
          [...connections.values()].filter((value) => value.userId === principal.user.id).length >=
            4 ||
          [...connections.values()].filter((value) => value.deploymentId === grant!.deploymentId)
            .length >= 8
        )
          throw new Error('Too many active shells.');
        connectionId = peer.id;
        connections.set(peer.id, { userId: principal.user.id, deploymentId: grant.deploymentId });
        clearTimeout(handshake);
        execution = new ShellExec(new DockerEngine(), grant.containerId, grant.executable);
        const stream = await execution.start(grant.cols, grant.rows, grant.term);
        if (closed) {
          await execution.close();
          return;
        }
        shellAudit(principal, grant, 'shell.opened');
        stream.on('error', () => {
          peer.close(1011, 'Container terminal failed.');
          void finish('transport_error');
        });
        stream.on('end', async () => {
          if (closed) return;
          ending = true;
          const result = await execution!.inspect().catch(() => ({ ExitCode: null }));
          peer.send(control({ type: 'exit', code: result.ExitCode }));
          await finish('exit');
          peer.close(1000, 'Shell exited.');
        });
        stream.on('close', () => {
          if (!closed && !ending) {
            peer.close(1011, 'Container terminal disconnected.');
            void finish('transport_error');
          }
        });
        stream.on('data', (bytes: Buffer) => {
          peer.send(Buffer.concat([Buffer.from([0]), bytes]));
          if (peer.bufferedAmount > 1024 * 1024) {
            stream.pause();
            void peer
              .waitForDrain({ threshold: 256 * 1024 })
              .then(() => {
                if (!closed) stream.resume();
              })
              .catch(() => {
                peer.close(1011, 'Terminal output disconnected.');
                void finish('transport_error');
              });
          }
        });
        timer = setInterval(async () => {
          if (checking || closed) return;
          checking = true;
          try {
            if (
              Date.now() - lastInput > 15 * 60_000 ||
              Date.now() - startedAt > 2 * 3600_000 ||
              Date.now() - lastPong > 30_000
            )
              throw new Error('Terminal timed out.');
            const current = await resolvePrincipal(event.req.headers);
            if (requirePersonal(current).id !== grant!.sessionId)
              throw new Error('Session revoked.');
            const container = await inspectShellContainer(current, grant!);
            if (container.Id !== grant!.containerId) throw new Error('Container replaced.');
            peer.send(control({ type: 'ping' }));
          } catch {
            peer.send(
              control({
                type: 'error',
                message: 'Shell authorization ended or the connection timed out.',
              }),
            );
            await finish('revoked_or_timeout');
            peer.close(1008, 'Authorization ended.');
          } finally {
            checking = false;
          }
        }, 5000);
      } catch {
        await finish('invalid_request');
        peer.close(1008, 'Shell request failed. Request a new shell grant.');
      }
    },
    close() {
      void finish('disconnected');
    },
    error() {
      void finish('transport_error');
    },
  };
});
