import { Command } from 'commander';
import { TRPCClientError } from '@trpc/client';
import superjson from 'superjson';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { apiClient } from './api/client.ts';
import { createProgram } from './program.ts';
import { CliError, errorCode, unknownOutcome } from './errors.ts';
import { confirm, integer, offset, output } from './output.ts';
import { waitForPublication } from './services/publication-wait.ts';
import type { ClientContext } from './api/client.ts';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test('exit codes distinguish validation, authentication, permission, cancellation and definite server failures', () => {
  expect(errorCode(new DOMException('cancel', 'AbortError'))).toBe(130);
  for (const [code, status, expected] of [
    ['BAD_REQUEST', 400, 2],
    ['UNAUTHORIZED', 401, 3],
    ['FORBIDDEN', 403, 4],
    ['NOT_FOUND', 404, 5],
    ['CONFLICT', 409, 1],
  ] as const) {
    const error = TRPCClientError.from({
      error: { message: 'failure', code: -32000, data: { code, httpStatus: status } },
    });
    expect(errorCode(error)).toBe(expected);
    expect(unknownOutcome(error)).toBe(false);
  }
  expect(unknownOutcome(new Error('network'))).toBe(true);
  expect(() => integer('1.5')).toThrow();
  expect(() => offset('abc')).toThrow();
  expect(offset('0')).toBe(0);
});

test('noninteractive confirmations require yes and JSON stdout contains only the result', async () => {
  const yes = new Command().option('--yes').option('--json');
  yes.parse(['--yes', '--json'], { from: 'user' });
  await confirm(yes, 'Remove?');
  const noninteractive = new Command().option('--non-interactive');
  noninteractive.parse(['--non-interactive'], { from: 'user' });
  await expect(confirm(noninteractive, 'Remove?')).rejects.toMatchObject({ exitCode: 2 });
  const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  output({ id: 'record', status: 'healthy' }, yes);
  expect(stdout).toHaveBeenCalledWith('{"id":"record","status":"healthy"}\n');
  expect(stderr).not.toHaveBeenCalled();
});

test('offline help and version make no requests and every registered command has help text', async () => {
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  for (const args of [['--version'], ['--help'], ['auth', 'tokens', '--help']]) {
    await createProgram()
      .parseAsync(args, { from: 'user' })
      .catch((error) => expect(error.exitCode).toBe(0));
  }
  const inspect = (command: Command) => {
    for (const child of command.commands) {
      expect(child.description()).toBeTruthy();
      inspect(child);
    }
  };
  inspect(createProgram());
  expect(fetch).not.toHaveBeenCalled();
});

test('typed reads retry transient transport failures while mutations are sent once', async () => {
  vi.useFakeTimers();
  const fetch = vi
    .fn()
    .mockRejectedValueOnce(new TypeError('fetch failed'))
    .mockRejectedValueOnce(new TypeError('fetch failed'))
    .mockResolvedValue(
      Response.json({ result: { data: superjson.serialize({ name: 'Instance' }) } }),
    );
  vi.stubGlobal('fetch', fetch);
  const read = apiClient('https://api.example').cli.instance.query();
  await vi.runAllTimersAsync();
  expect(await read).toEqual({ name: 'Instance' });
  expect(fetch).toHaveBeenCalledTimes(3);
  fetch
    .mockReset()
    .mockRejectedValue(new TypeError('fetch failed', { cause: new Error('ECONNRESET') }));
  const mutation = apiClient('https://api.example').cli.revokeSession.mutate({ id: 'session' });
  await expect(mutation).rejects.toThrow('https://api.example');
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('publication waiting uses status only and keeps the submitted ID on timeout and cancellation', async () => {
  vi.useFakeTimers();
  const query = vi
    .fn()
    .mockResolvedValue({ id: 'deployment', status: 'starting', failureReason: null });
  const value = { client: { deployments: { status: { query } } } } as unknown as ClientContext;
  const waiting = waitForPublication(value, 'project', 'deployment', 0);
  await vi.runAllTimersAsync();
  expect(await waiting).toEqual({ id: 'deployment', status: 'timeout', failureReason: null });
  query.mockResolvedValueOnce({ id: 'deployment', status: 'healthy', failureReason: null });
  expect(await waitForPublication(value, 'project', 'deployment', 2)).toMatchObject({
    status: 'healthy',
  });
  const cancel = new AbortController();
  cancel.abort(new CliError('Cancelled', 130));
  await expect(
    waitForPublication(value, 'project', 'deployment', 2, cancel.signal),
  ).rejects.toMatchObject({ exitCode: 130 });
});
