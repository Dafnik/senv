import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import {
  getCredential,
  localProject,
  readConfiguration,
  validateApiUrl,
  writeConfiguration,
} from './profiles';

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
test('stores profiles privately, keeps environment tokens process-only, and rejects an exposed config', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'senv-profile-'));
  directories.push(directory);
  vi.stubEnv('SENV_CONFIG_DIR', directory);
  const profile = { apiUrl: 'http://localhost:3000' };
  await writeConfiguration({ active: 'test', profiles: { test: profile }, credentials: {} });
  expect((await readConfiguration()).active).toBe('test');
  if (process.platform !== 'win32')
    expect((await stat(join(directory, 'config.json'))).mode & 0o777).toBe(0o600);
  vi.stubEnv('SENV_TOKEN', 'process-only-secret');
  vi.stubEnv('SENV_INSTANCE', 'test');
  expect(await getCredential(await readConfiguration(), 'test', profile)).toBe(
    'process-only-secret',
  );
  expect(await readFile(join(directory, 'config.json'), 'utf8')).not.toContain(
    'process-only-secret',
  );
  if (process.platform !== 'win32') {
    await chmod(join(directory, 'config.json'), 0o644);
    await expect(readConfiguration()).rejects.toThrow('private regular file');
  }
});
test('local project selection preserves immutable IDs and production URLs require HTTPS', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'senv-link-'));
  directories.push(directory);
  await writeFile(
    join(directory, '.senv.json'),
    JSON.stringify({ instance: 'prod', projectId: 'immutable-id' }),
  );
  expect(await localProject(directory)).toEqual({ instance: 'prod', projectId: 'immutable-id' });
  expect(validateApiUrl('https://senv.example')).toBe('https://senv.example');
  expect(validateApiUrl('http://localhost:3000')).toBe('http://localhost:3000');
  for (const url of [
    'http://senv.example',
    'https://user:pass@senv.example',
    'https://senv.example/api',
  ])
    expect(() => validateApiUrl(url)).toThrow();
});

test('credential cleanup rereads configuration and preserves profiles added after connect', async () => {
  const { removeCredential, getStoredCredential } = await import('./profiles.ts');
  const directory = await mkdtemp(join(tmpdir(), 'senv-profile-fresh-'));
  directories.push(directory);
  vi.stubEnv('SENV_CONFIG_DIR', directory);
  const profile = {
    apiUrl: 'http://localhost:3000',
    accountId: 'user',
    sessionId: 'old',
    credentialStore: 'file' as const,
  };
  const key = `${profile.apiUrl}|test|user`;
  await writeConfiguration({
    active: 'test',
    profiles: { test: profile },
    credentials: { [key]: 'old-secret' },
  });
  const stale = await readConfiguration();
  const current = await readConfiguration();
  current.profiles['added'] = { apiUrl: 'https://added.example' };
  await writeConfiguration(current);
  vi.stubEnv('SENV_TOKEN', 'environment-secret');
  expect(await getStoredCredential(stale, 'test', profile)).toBe('old-secret');
  await removeCredential(stale, 'test', profile);
  const saved = await readConfiguration();
  expect(saved.profiles['added']).toEqual({ apiUrl: 'https://added.example' });
  expect(saved.credentials[key]).toBeUndefined();
});

test('environment credentials require an explicit matching instance binding and malformed links name their path', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'senv-link-invalid-'));
  directories.push(directory);
  vi.stubEnv('SENV_TOKEN', 'environment-secret');
  vi.stubEnv('SENV_INSTANCE', 'prod');
  await expect(
    getCredential({ profiles: {}, credentials: {} }, 'dev', { apiUrl: 'http://localhost:3000' }),
  ).rejects.toMatchObject({ exitCode: 2 });
  await writeFile(join(directory, '.senv.json'), '{');
  await expect(localProject(directory)).rejects.toThrow(join(directory, '.senv.json'));
  await writeFile(join(directory, '.senv.json'), '{"instance":2,"projectId":"project"}');
  await expect(localProject(directory)).rejects.toThrow('expected instance and projectId');
});

test('a stale logout cannot delete the newly saved session credential', async () => {
  const { removeCredential } = await import('./profiles.ts');
  const directory = await mkdtemp(join(tmpdir(), 'senv-profile-replaced-'));
  directories.push(directory);
  vi.stubEnv('SENV_CONFIG_DIR', directory);
  const old = {
    apiUrl: 'http://localhost:3000',
    accountId: 'user',
    sessionId: 'old',
    credentialStore: 'file' as const,
  };
  const key = `${old.apiUrl}|test|user`;
  const latest = {
    profiles: { test: { ...old, sessionId: 'new' } },
    credentials: { [key]: 'new-secret' },
  };
  await writeConfiguration(latest);
  await expect(
    removeCredential({ profiles: { test: old }, credentials: {} }, 'test', old),
  ).rejects.toThrow('saved session changed');
  expect((await readConfiguration()).credentials[key]).toBe('new-secret');
});
