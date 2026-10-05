import { chmod, lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CliError } from './errors.ts';

export type Profile = {
  apiUrl: string;
  appUrl?: string;
  accountId?: string;
  sessionId?: string;
  credentialStore?: 'keyring' | 'file';
};
export type Configuration = {
  active?: string;
  profiles: Record<string, Profile>;
  credentials: Record<string, string>;
};
export const configDirectory = () =>
  process.env['SENV_CONFIG_DIR'] ?? join(homedir(), '.config', 'senv');
const configPath = () => join(configDirectory(), 'config.json');
export async function readConfiguration(): Promise<Configuration> {
  try {
    const info = await lstat(configPath());
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      (process.platform !== 'win32' && info.mode & 0o077)
    )
      throw new CliError('senv config must be a private regular file (chmod 600).');
    const value = JSON.parse(await readFile(configPath(), 'utf8')) as Configuration;
    if (!value.profiles || !value.credentials) throw new Error('Invalid configuration.');
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { profiles: {}, credentials: {} };
    throw error;
  }
}
export async function writeConfiguration(value: Configuration) {
  await mkdir(configDirectory(), { recursive: true, mode: 0o700 });
  const directory = await lstat(configDirectory());
  if (!directory.isDirectory() || directory.isSymbolicLink())
    throw new CliError('senv config directory must be a real directory.');
  if (process.platform !== 'win32') await chmod(configDirectory(), 0o700);
  const temporary = join(configDirectory(), `.config-${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await rename(temporary, configPath());
}
const accountKey = (name: string, profile: Profile) =>
  `${profile.apiUrl}|${name}|${profile.accountId}`;
async function keyringEntry(key: string) {
  const { AsyncEntry } = await import('@napi-rs/keyring');
  return new AsyncEntry('senv-cli', key);
}
export async function getCredential(config: Configuration, name: string, profile: Profile) {
  if (process.env['SENV_TOKEN']) return process.env['SENV_TOKEN'];
  const key = accountKey(name, profile);
  if (profile.credentialStore === 'keyring') {
    try {
      return await (await keyringEntry(key)).getPassword();
    } catch {
      throw new CliError('Cannot read the OS credential store. Unlock it or log in again.', 3);
    }
  }
  return config.credentials[key];
}
export async function setCredential(
  config: Configuration,
  name: string,
  profile: Profile,
  secret: string,
  warn: (message: string) => void = (message) => {
    process.stderr.write(`${message}\n`);
  },
) {
  const key = accountKey(name, profile);
  try {
    await (await keyringEntry(key)).setPassword(secret);
    profile.credentialStore = 'keyring';
    delete config.credentials[key];
  } catch {
    if (process.platform === 'win32')
      throw new CliError(
        'OS credential storage is unavailable. Use SENV_TOKEN rather than writing credentials without Windows ACL protection.',
      );
    profile.credentialStore = 'file';
    config.credentials[key] = secret;
    warn('OS credential storage unavailable; using a private user credential file.');
  }
  await writeConfiguration(config);
}
export async function removeCredential(config: Configuration, name: string, profile: Profile) {
  const key = accountKey(name, profile);
  if (profile.credentialStore === 'keyring') await (await keyringEntry(key)).deleteCredential();
  delete config.credentials[key];
  delete profile.accountId;
  delete profile.sessionId;
  delete profile.credentialStore;
  await writeConfiguration(config);
}
export function validateApiUrl(input: string) {
  const url = new URL(input);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new CliError(
      'API URL must be an origin without credentials, paths, query, or fragment.',
      2,
    );
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  )
    throw new CliError('Use HTTPS, or HTTP on loopback for development.', 2);
  return url.origin;
}
export async function localProject(
  start = process.cwd(),
): Promise<{ instance: string; projectId: string } | undefined> {
  let directory = resolve(start);
  while (true) {
    try {
      return JSON.parse(await readFile(join(directory, '.senv.json'), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}
