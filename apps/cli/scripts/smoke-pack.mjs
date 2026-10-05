import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('..', import.meta.url));
const directory = mkdtempSync(join(tmpdir(), 'senv-packed-'));
const run = (command, args, cwd = directory) =>
  execFileSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, CI: 'true' } });
try {
  run('pnpm', ['pack', '--pack-destination', directory], cli);
  const archive = join(
    directory,
    readdirSync(directory).find((name) => name.endsWith('.tgz')),
  );
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({ name: 'senv-install-smoke', private: true, version: '1.0.0' }),
  );
  // This installation cannot borrow workspace packages or automatically satisfy peers.
  run('pnpm', [
    '--config.auto-install-peers=false',
    'add',
    '--ignore-scripts',
    '--no-optional',
    archive,
  ]);
  run(process.execPath, [join(directory, 'node_modules/@senv/cli/dist/senv.js'), '--version']);
  run(process.execPath, [join(directory, 'node_modules/@senv/cli/dist/senv.js'), '--help']);
  execFileSync(
    'pnpm',
    ['exec', 'vp', 'test', 'run', 'apps/api/server/features/auth/tests/cli-http.test.ts'],
    {
      cwd: fileURLToPath(new URL('../../..', import.meta.url)),
      stdio: 'inherit',
      env: {
        ...process.env,
        SENV_PACKED_CLI: join(directory, 'node_modules/@senv/cli/dist/senv.js'),
      },
    },
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
