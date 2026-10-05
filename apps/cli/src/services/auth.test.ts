import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { login } from './auth.ts';

vi.mock('./timing.ts', () => ({
  sleep: (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    }),
}));

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  store: vi.fn(),
  revoke: vi.fn(),
  configuration: { active: 'test', profiles: {} as Record<string, unknown>, credentials: {} },
}));
vi.mock('../profiles.ts', () => ({
  readConfiguration: async () => mocks.configuration,
  getCredential: async () => 'old-secret',
  setCredential: mocks.store,
  removeCredential: vi.fn(),
  validateApiUrl: (value: string) => value,
}));
vi.mock('../api/client.ts', () => ({
  authRequest: mocks.request,
  apiClient: () => ({
    cli: {
      instance: { query: async () => ({ appUrl: 'https://app.example.com' }) },
      sessions: { query: async () => [{ id: 'new-session', current: true }] },
      revokeSession: { mutate: mocks.revoke },
    },
    me: { query: async () => ({ id: 'user', email: 'user@example.com' }) },
  }),
}));
beforeEach(() => {
  vi.useFakeTimers();
  mocks.configuration.profiles = {
    test: { apiUrl: 'https://api.example.com', accountId: 'user', sessionId: 'old-session' },
  };
  mocks.request.mockReset();
  mocks.store.mockReset();
  mocks.revoke.mockReset();
  mocks.store.mockResolvedValue(undefined);
  mocks.revoke.mockResolvedValue(undefined);
  mocks.request.mockImplementation(async (_url, path) =>
    path === 'device/code'
      ? {
          device_code: 'private-code',
          user_code: 'ABCD',
          verification_uri_complete: 'https://app.example.com/cli/authorize?code=ABCD',
          expires_in: 60,
          interval: 1,
        }
      : path === 'device/token'
        ? { access_token: 'new-secret' }
        : {},
  );
});
afterEach(() => {
  vi.useRealTimers();
});
test('approval verifies and stores the independent session before revoking the old session', async () => {
  const order: string[] = [];
  mocks.store.mockImplementation(async () => {
    order.push('stored');
  });
  mocks.revoke.mockImplementation(async () => {
    order.push('revoked');
  });
  const code = vi.fn();
  const pending = login({ browser: false, onCode: code });
  await vi.advanceTimersByTimeAsync(1000);
  expect(await pending).toEqual({
    instance: 'test',
    account: 'user@example.com',
    sessionId: 'new-session',
  });
  expect(order).toEqual(['stored', 'revoked']);
  expect(code).toHaveBeenCalledWith(expect.objectContaining({ code: 'ABCD' }));
  expect(JSON.stringify(code.mock.calls)).not.toContain('private-code');
});
test('pending approval and slow_down respect the increased polling interval', async () => {
  const base = mocks.request.getMockImplementation()!;
  let polls = 0;
  mocks.request.mockImplementation(async (...args) => {
    if (args[1] === 'device/token' && ++polls <= 2)
      throw { authError: polls === 1 ? 'authorization_pending' : 'slow_down' };
    return base(...args);
  });
  const pending = login({ browser: false });
  await vi.advanceTimersByTimeAsync(2000);
  expect(polls).toBe(2);
  await vi.advanceTimersByTimeAsync(5999);
  expect(polls).toBe(2);
  await vi.advanceTimersByTimeAsync(1);
  await pending;
  expect(polls).toBe(3);
});
test('cancelling pending approval stops polling and never persists a credential', async () => {
  const signal = new AbortController();
  const pending = login({ browser: false, signal: signal.signal });
  const rejected = expect(pending).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(0);
  signal.abort();
  await rejected;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocks.request.mock.calls.filter((call) => call[1] === 'device/token')).toHaveLength(0);
  expect(mocks.store).not.toHaveBeenCalled();
});
test('denial does not create a local session or revoke an existing one', async () => {
  const base = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (...args) => {
    if (args[1] === 'device/token') throw { authError: 'access_denied' };
    return base(...args);
  });
  const rejected = expect(login({ browser: false })).rejects.toMatchObject({
    authError: 'access_denied',
  });
  await vi.advanceTimersByTimeAsync(1000);
  await rejected;
  expect(mocks.store).not.toHaveBeenCalled();
  expect(mocks.revoke).not.toHaveBeenCalled();
});
test('expired approval stops without persisting a credential', async () => {
  const base = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (...args) => {
    if (args[1] === 'device/token') throw { authError: 'authorization_pending' };
    return base(...args);
  });
  const rejected = expect(login({ browser: false })).rejects.toMatchObject({ exitCode: 3 });
  await vi.advanceTimersByTimeAsync(60_000);
  await rejected;
  expect(mocks.store).not.toHaveBeenCalled();
});
test('persistence failure revokes the newly redeemed session and preserves the old one', async () => {
  mocks.store.mockRejectedValueOnce(new Error('disk full'));
  const rejected = expect(login({ browser: false })).rejects.toThrow('disk full');
  await vi.advanceTimersByTimeAsync(1000);
  await rejected;
  expect(mocks.request).toHaveBeenCalledWith(
    'https://api.example.com',
    'sign-out',
    'new-secret',
    {},
    { origin: 'https://app.example.com' },
  );
  expect(mocks.revoke).not.toHaveBeenCalled();
});
test('authorization URLs must match trusted instance metadata', async () => {
  mocks.request.mockResolvedValueOnce({
    verification_uri_complete: 'https://untrusted.example.com/authorize',
  });
  await expect(login({ browser: false })).rejects.toThrow('unexpected authorization URL');
  expect(mocks.store).not.toHaveBeenCalled();
});
