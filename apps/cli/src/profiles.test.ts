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
