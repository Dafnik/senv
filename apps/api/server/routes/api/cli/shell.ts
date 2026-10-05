import { defineWebSocketHandler } from 'nitro/h3';
import nodeAdapter, { fromNodeUpgradeHandler } from 'crossws/adapters/node';
import type { Hooks, Peer } from 'crossws';
import {
  shellConnections as connections,
  type ShellReason,
} from '../../../features/deployments/services/shell-registry';
import type { Principal } from '../../../features/auth/services/request-principal';
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

const controls = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('open'), grant: z.string().min(20).max(128) }),
  z.strictObject({
    type: z.literal('resize'),
    cols: z
      .number()
      .int()
      .min(1)
      .transform((value) => Math.min(value, 1000)),
    rows: z
      .number()
      .int()
      .min(1)
      .transform((value) => Math.min(value, 1000)),
  }),
  z.strictObject({ type: z.literal('detach') }),
  z.strictObject({ type: z.literal('pong') }),
]);
const control = (value: unknown) =>
  Buffer.concat([Buffer.from([1]), Buffer.from(JSON.stringify(value))]);

export function createConnectionHooks(principal: Principal, headers: Headers): Partial<Hooks> {
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
          if (reason.endsWith('_timeout') || reason === 'max_lifetime')
            shellAudit(principal, grant, 'shell.timeout', reason);
          if (['session_revoked', 'permission_lost'].includes(reason))
            shellAudit(principal, grant, 'shell.revoked', reason);
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
          if (ending || execution?.stream?.writableEnded || execution?.stream?.destroyed) return;
          if (opening && !execution?.stream) return;
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
          if (ending || closed || opening) return;
          if (!execution) throw new Error('Terminal is not open.');
          await execution.resize(input.cols, input.rows);
          return;
        }
        if (grant || opening || closed) throw new Error('Shell already opened.');
        opening = true;
        grant = await consumeShellGrant(await resolvePrincipal(headers), input.grant);
        if (closed) return;
        if (
          [...connections.values()].filter((value) => value.userId === principal.user.id).length >=
            4 ||
          [...connections.values()].filter((value) => value.deploymentId === grant!.deploymentId)
            .length >= 8
        )
          throw new Error('Too many active shells.');
        connectionId = peer.id;
        const revoke = async (reason: ShellReason) => {
          if (closed) return;
          peer.send(control({ type: 'error', message: reason.replaceAll('_', ' ') }));
          await finish(reason);
          peer.close(1008, reason);
        };
        connections.set(peer.id, {
          userId: principal.user.id,
          sessionId: grant.sessionId,
          projectId: grant.projectId,
          deploymentId: grant.deploymentId,
          close: revoke,
        });
        clearTimeout(handshake);
        execution = new ShellExec(new DockerEngine(), grant.containerId, grant.executable);
        const stream = await execution.start(grant.cols, grant.rows, grant.term);
        if (closed) {
          await execution.close();
          return;
        }
        shellAudit(principal, grant, 'shell.opened');
        opening = false;
        peer.send(control({ type: 'ready' }));
        stream.on('error', () => {
          if (closed || ending) return;
          peer.close(1011, 'Container terminal failed.');
          void finish('docker_error');
        });
        stream.on('end', async () => {
          if (closed) return;
          ending = true;
          const result = await execution!.inspect().catch(() => ({ ExitCode: null }));
          let current: Principal;
          try {
            current = await resolvePrincipal(headers);
            requirePersonal(current);
          } catch {
            await revoke('session_revoked');
            return;
          }
          try {
            const container = await inspectShellContainer(current, grant!);
            if (container.Id !== grant!.containerId) {
              await revoke('container_replaced');
              return;
            }
          } catch (error) {
            await revoke(
              error && typeof error === 'object' && 'code' in error && error.code === 'FORBIDDEN'
                ? 'permission_lost'
                : 'deployment_stopped',
            );
            return;
          }
          if (closed) return;
          peer.send(control({ type: 'exit', code: result.ExitCode }));
          await finish('exit');
          peer.close(1000, 'Shell exited.');
        });
        stream.on('close', () => {
          if (!closed && !ending) {
            peer.close(1011, 'Container terminal disconnected.');
            void finish('docker_error');
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
                void finish('docker_error');
              });
          }
        });
        timer = setInterval(async () => {
          if (checking || closed) return;
          checking = true;
          try {
            let reason: ShellReason | undefined;
            if (Date.now() - startedAt > 2 * 3600_000) reason = 'max_lifetime';
            else if (Date.now() - lastInput > 15 * 60_000) reason = 'idle_timeout';
            else if (Date.now() - lastPong > 30_000) reason = 'heartbeat_timeout';
            if (reason) {
              await revoke(reason);
              return;
            }
            let current: Principal;
            try {
              current = await resolvePrincipal(headers);
              requirePersonal(current);
            } catch {
              await revoke('session_revoked');
              return;
            }
            let container;
            try {
              container = await inspectShellContainer(current, grant!);
            } catch (error) {
              await revoke(
                error && typeof error === 'object' && 'code' in error && error.code === 'FORBIDDEN'
                  ? 'permission_lost'
                  : 'deployment_stopped',
              );
              return;
            }
            if (container.Id !== grant!.containerId) {
              await revoke('container_replaced');
              return;
            }
            peer.send(control({ type: 'ping' }));
          } catch {
            await revoke('docker_error');
          } finally {
            checking = false;
          }
        }, 5000);
      } catch {
        if (grant) shellAudit(principal, grant, 'shell.denied', 'invalid_request_or_concurrency');
        await finish('invalid_request');
        peer.close(1008, 'Shell request failed. Request a new shell grant.');
      }
    },
    close() {
      void finish('disconnected');
    },
    error() {
      void finish('docker_error');
    },
  };
}

const states = new WeakMap<Peer, Partial<Hooks>>();
export const shellHooks: Partial<Hooks> = {
  async upgrade(request) {
    if (request.headers.has('origin'))
      return new Response('Browser shell connections are forbidden.', { status: 403 });
    if (!request.headers.get('authorization'))
      return new Response('A CLI bearer session is required.', { status: 401 });
    try {
      const principal = await resolvePrincipal(request.headers);
      requirePersonal(principal);
      return { context: { principal } };
    } catch (error) {
      return new Response('Shell authentication failed.', {
        status:
          error && typeof error === 'object' && 'code' in error && error.code === 'FORBIDDEN'
            ? 403
            : 401,
      });
    }
  },
  open(peer) {
    const hooks = createConnectionHooks(peer.context.principal as Principal, peer.request.headers);
    states.set(peer, hooks);
    return hooks.open?.(peer);
  },
  message(peer, message) {
    return states.get(peer)?.message?.(peer, message);
  },
  close(peer, details) {
    const hooks = states.get(peer);
    states.delete(peer);
    return hooks?.close?.(peer, details);
  },
  error(peer, error) {
    return states.get(peer)?.error?.(peer, error);
  },
};
export const shellAdapter = nodeAdapter({
  hooks: shellHooks,
  serverOptions: { maxPayload: 64 * 1024 },
  idleTimeout: 0,
});
export default defineWebSocketHandler({
  upgrade(request) {
    return fromNodeUpgradeHandler((req, socket, head) =>
      shellAdapter.handleUpgrade(req, socket, head, request),
    ).upgrade!(request);
  },
});
