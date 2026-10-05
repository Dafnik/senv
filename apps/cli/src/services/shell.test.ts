import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { runShell } from './shell.ts';
import type { ClientContext } from '../api/client.ts';

vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    WebSocket: class extends EventEmitter {
      static OPEN = 1;
      readyState = 1;
      bufferedAmount = 0;
      send = vi.fn();
      pause() {}
      resume() {}
      constructor() {
        super();
        socket = this as unknown as FakeSocket;
      }
      terminate() {
        this.readyState = 3;
        this.emit('close', 1006, Buffer.alloc(0));
      }
      close() {
        this.terminate();
      }
    },
  };
});
type FakeSocket = EventEmitter & {
  send: ReturnType<typeof vi.fn>;
  bufferedAmount: number;
  terminate: () => void;
};
let socket: FakeSocket;
const descriptors: Array<[object, string, PropertyDescriptor | undefined]> = [];
const define = (object: object, key: string, value: unknown) => {
  descriptors.push([object, key, Object.getOwnPropertyDescriptor(object, key)]);
  Object.defineProperty(object, key, { value, writable: true, configurable: true });
};
const control = (value: unknown) =>
  Buffer.concat([Buffer.from([1]), Buffer.from(JSON.stringify(value))]);
const raw = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  raw.mockReset();
  define(process.stdin, 'isTTY', true);
  define(process.stdout, 'isTTY', true);
  define(process.stdin, 'isRaw', false);
  define(process.stdin, 'setRawMode', raw);
  vi.spyOn(process.stdin, 'resume').mockReturnValue(process.stdin);
  vi.spyOn(process.stdin, 'pause').mockReturnValue(process.stdin);
  vi.spyOn(process.stdin, 'setEncoding').mockReturnValue(process.stdin);
});
afterEach(() => {
  for (const [object, key, previous] of descriptors.splice(0).reverse()) {
    if (previous) Object.defineProperty(object, key, previous);
    else Reflect.deleteProperty(object, key);
  }
  vi.restoreAllMocks();
  vi.useRealTimers();
});
async function launch() {
  const value = {
    token: 'session',
    profile: { apiUrl: 'http://localhost:3000' },
    client: {
      deployments: {
        shellGrant: {
          mutate: async () => ({
            grant: 'g'.repeat(32),
            executable: '/bin/sh',
            configuredUser: '1000',
          }),
        },
      },
    },
  } as unknown as ClientContext;
  const running = runShell(value, 'project', 'deployment');
  // Install rejection handling before a synchronous socket error fires.
  const settled = running.then(
    (result) => ({ result }),
    (error) => ({ error }),
  );
  await Promise.resolve();
  await Promise.resolve();
  socket.emit('open');
  return { running, settled };
}

test('stdin remains detached until ready and half-open connections fail with terminal restoration', async () => {
  const { settled } = await launch();
  process.stdin.emit('data', Buffer.from('early'));
  expect(socket.send).toHaveBeenCalledTimes(1);
  socket.emit('message', control({ type: 'ready' }));
  process.stdin.emit('data', Buffer.from([0xff]));
  expect(socket.send).toHaveBeenLastCalledWith(Buffer.from([0, 0xff]));
  await vi.advanceTimersByTimeAsync(35_000);
  expect(await settled).toMatchObject({
    error: { exitCode: 1, message: 'Terminal heartbeat timed out.' },
  });
  expect(raw).toHaveBeenLastCalledWith(false);
});
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const)
  test(`shell cleanup restores raw mode on ${signal}`, async () => {
    const before = process.listenerCount(signal);
    const { settled } = await launch();
    socket.emit('message', control({ type: 'ready' }));
    process.emit(signal);
    expect(await settled).toMatchObject({ error: { exitCode: 130 } });
    expect(raw).toHaveBeenLastCalledWith(false);
    expect(process.listenerCount(signal)).toBe(before);
  });
test('send-buffer overflow is a transport error and server close reasons are preserved', async () => {
  const first = await launch();
  socket.emit('message', control({ type: 'ready' }));
  socket.bufferedAmount = 256 * 1024 + 1;
  process.stdin.emit('data', Buffer.from('input'));
  expect(await first.settled).toMatchObject({
    error: { exitCode: 1, message: 'Terminal send buffer overflow.' },
  });
  const next = await launch();
  socket.emit('message', control({ type: 'ready' }));
  socket.emit('message', control({ type: 'error', message: 'deployment stopped' }));
  socket.terminate();
  expect(await next.settled).toMatchObject({
    error: { exitCode: 1, message: 'deployment stopped' },
  });
});

test('uncaught-exception cleanup restores terminal ownership without consuming the remote exit code', async () => {
  const { settled } = await launch();
  socket.emit('message', control({ type: 'ready' }));
  EventEmitter.prototype.emit.call(
    process,
    'uncaughtExceptionMonitor',
    new Error('renderer failed'),
    'uncaughtException',
  );
  expect(raw).toHaveBeenLastCalledWith(false);
  socket.terminate();
  expect(await settled).toMatchObject({ error: { exitCode: 1 } });
});
