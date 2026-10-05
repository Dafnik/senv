import { once } from 'node:events';
import { join } from 'node:path';
import { expect, test, vi } from 'vite-plus/test';
import { WebSocket } from 'ws';
import { createDatabase } from '../../../../../../drizzle/database.ts';
import type { LifecycleHarness } from './deployment-lifecycle.integration-support.ts';
import { input, rpc } from './deployment-lifecycle.integration-support.ts';
const control = (value: unknown) =>
  Buffer.concat([Buffer.from([1]), Buffer.from(JSON.stringify(value))]);
export function registerShellScenarios(harness: LifecycleHarness) {
  test('built Nitro route rejects unauthenticated upgrades and connects an authenticated origin shell to real Docker', async () => {
    const url = `ws://localhost:${harness.apiPort}/api/cli/shell`;
    const denied = new WebSocket(url);
    denied.on('error', () => {});
    const status = await new Promise<number>((resolve) =>
      denied.once('unexpected-response', (_request, response) => {
        response.resume();
        resolve(response.statusCode!);
        denied.terminate();
      }),
    );
    expect(status).toBe(401);
    const access = await rpc<{ sessionId: string }>(harness, 'cli.access', undefined, true);
    const db = createDatabase(`file:${join(harness.directory, 'senv.sqlite')}`);
    let token: string;
    try {
      token = (
        db.$client.prepare('select token from session where id = ?').get(access.sessionId) as {
          token: string;
        }
      ).token;
    } finally {
      db.$client.close();
    }
    const grant = await rpc<{ grant: string }>(
      harness,
      'deployments.shellGrant',
      input(harness, harness.replacement.id),
    );
    const socket = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } });
    socket.on('error', () => {});
    const messages: Array<{ type: string; code?: number }> = [];
    const output: Buffer[] = [];
    socket.on('message', (bytes) => {
      const frame = Buffer.from(bytes as Buffer);
      if (frame[0] === 1) messages.push(JSON.parse(frame.subarray(1).toString()));
      else output.push(frame.subarray(1));
    });
    try {
      await once(socket, 'open');
      socket.send(control({ type: 'open', grant: grant.grant }));
      await vi.waitFor(() => expect(messages).toContainEqual({ type: 'ready' }), {
        timeout: 10_000,
      });
      const closed = once(socket, 'close');
      socket.send(
        Buffer.concat([Buffer.from([0]), Buffer.from("printf 'SENV_REAL_ROUTE_OK\\n'; exit 7\n")]),
      );
      await closed;
      expect(messages).toContainEqual({ type: 'exit', code: 7 });
      expect(Buffer.concat(output).toString()).toContain('SENV_REAL_ROUTE_OK');
      const history = await rpc<{ entries: { event: string }[] }>(
        harness,
        'deployments.history',
        input(harness, harness.replacement.id),
        true,
      );
      expect(history.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ event: 'shell.opened' }),
          expect.objectContaining({ event: 'shell.closed' }),
        ]),
      );
    } finally {
      socket.terminate();
    }
  }, 30_000);
}
