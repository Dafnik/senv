import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { resolveContext } from './api/client.ts';
import { writeConfiguration } from './profiles.ts';
const originalDirectory = process.cwd();
let directory: string | undefined;
afterEach(async () => {
  process.chdir(originalDirectory);
  vi.unstubAllEnvs();
  if (directory) await rm(directory, { recursive: true, force: true });
});
test('selection precedence is flags, environment, local link, then active profile', async () => {
  directory = await mkdtemp(join(tmpdir(), 'senv-context-'));
  process.chdir(directory);
  vi.stubEnv('SENV_CONFIG_DIR', join(directory, 'config'));
  vi.stubEnv('SENV_INSTANCE', '');
  vi.stubEnv('SENV_TOKEN', '');
  delete process.env['SENV_INSTANCE'];
  await writeConfiguration({
    active: 'active',
    profiles: Object.fromEntries(
      ['flag', 'env', 'link', 'active'].map((name) => [
        name,
        { apiUrl: `https://${name}.example` },
      ]),
    ),
    credentials: {},
  });
  await writeFile(
    join(directory, '.senv.json'),
    JSON.stringify({ instance: 'link', projectId: 'immutable-project' }),
  );
  vi.stubEnv('SENV_INSTANCE', 'env');
  expect((await resolveContext({ instance: 'flag' }, false, false)).name).toBe('flag');
  expect((await resolveContext({}, false, false)).name).toBe('env');
  delete process.env['SENV_INSTANCE'];
  expect((await resolveContext({}, false, false)).name).toBe('link');
  await rm(join(directory, '.senv.json'));
  expect((await resolveContext({}, false, false)).name).toBe('active');
  await writeFile(
    join(directory, '.senv.json'),
    JSON.stringify({ instance: 'missing', projectId: 'immutable-project' }),
  );
  await expect(resolveContext({}, false, false)).rejects.toThrow(join(directory, '.senv.json'));
});
