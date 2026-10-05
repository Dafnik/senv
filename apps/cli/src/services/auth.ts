import { version } from '../version.ts';
import { hostname } from 'node:os';
import open from 'open';
import { apiClient, authRequest, type ClientContext } from '../api/client.ts';
import {
  getStoredCredential,
  localProject,
  readConfiguration,
  removeCredential,
  setCredential,
  validateApiUrl,
} from '../profiles.ts';
import { CliError } from '../errors.ts';
import { sleep } from './timing.ts';

export type LoginCode = { url: string; code: string; expiresAt: number; label?: string };
export type LoginState = 'pending' | 'approved' | 'denied';
export type LoginOptions = {
  instance?: string;
  apiUrl?: string;
  label?: string;
  browser?: boolean;
  signal?: AbortSignal;
  onState?: (state: LoginState) => void;
  onCode?: (code: LoginCode) => void;
  onWarning?: (message: string) => void;
};
export async function login(options: LoginOptions) {
  options.signal?.throwIfAborted();
  const request: typeof authRequest = (url, path, token, body, headers) =>
    authRequest(url, path, token, body, headers, options.signal);
  const configuration = await readConfiguration();
  const local = await localProject();
  const name = String(
    options.instance ??
      process.env['SENV_INSTANCE'] ??
      local?.instance ??
      configuration.active ??
      'default',
  );
  const old = configuration.profiles[name];
  if (!options.apiUrl && !old?.apiUrl)
    options.onWarning?.('No API URL configured; using http://localhost:3000.');
  const apiUrl = validateApiUrl(String(options.apiUrl ?? old?.apiUrl ?? 'http://localhost:3000'));
  const instance = await apiClient(apiUrl, undefined, options.signal).cli.instance.query();
  validateApiUrl(instance.appUrl);
  const code = await request<{
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete: string;
    expires_in: number;
    interval: number;
  }>(
    apiUrl,
    'device/code',
    undefined,
    { client_id: 'senv-cli' },
    { 'x-senv-device-label': options.label ?? hostname(), 'x-senv-cli-version': version },
  );
  if (
    !Number.isFinite(code.expires_in) ||
    code.expires_in <= 0 ||
    !Number.isFinite(code.interval) ||
    code.interval <= 0
  )
    throw new CliError('Instance returned invalid device expiry or polling interval.', 2);
  if (new URL(code.verification_uri_complete).origin !== new URL(instance.appUrl).origin)
    throw new CliError('Instance returned an unexpected authorization URL.');
  options.onCode?.({
    url: code.verification_uri_complete,
    code: code.user_code,
    expiresAt: Date.now() + Math.min(code.expires_in, 600) * 1000,
    label: options.label ?? hostname(),
  });
  options.onState?.('pending');
  if (options.browser !== false)
    await open(code.verification_uri_complete).catch(() =>
      options.onWarning?.('Browser could not open. Use the displayed URL.'),
    );
  const expires = Date.now() + Math.min(Math.max(1, code.expires_in), 600) * 1000;
  let interval = Math.max(1, code.interval) * 1000;
  while (Date.now() < expires) {
    await sleep(Math.min(interval, expires - Date.now()), options.signal);
    if (Date.now() >= expires) break;
    let token: { access_token: string };
    try {
      token = await request(apiUrl, 'device/token', undefined, {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: 'senv-cli',
        device_code: code.device_code,
      });
    } catch (error) {
      const kind = (error as { authError?: string }).authError;
      if (kind === 'access_denied') options.onState?.('denied');
      if (kind === 'authorization_pending') continue;
      if (kind === 'slow_down') {
        interval += 5000;
        continue;
      }
      throw error;
    }
    options.onState?.('approved');
    const client = apiClient(apiUrl, token.access_token, options.signal);
    let identity;
    let current;
    let oldToken;
    try {
      identity = await client.me.query();
      const sessions = await client.cli.sessions.query();
      current = sessions.find((row) => row.current);
      if (!current) throw new CliError('Could not verify the new CLI session.');
      const profile = {
        apiUrl,
        appUrl: instance.appUrl,
        accountId: identity.id,
        sessionId: current.id,
      };
      oldToken =
        old &&
        (await getStoredCredential(
          { ...configuration, credentials: { ...configuration.credentials } },
          name,
          old,
        ).catch(() => undefined));
      options.signal?.throwIfAborted();
      configuration.profiles[name] = profile;
      configuration.active = name;
      await setCredential(
        configuration,
        name,
        profile,
        token.access_token,
        options.onWarning ?? (() => {}),
      );
    } catch (error) {
      await authRequest(
        apiUrl,
        'sign-out',
        token.access_token,
        {},
        { origin: new URL(instance.appUrl).origin },
      ).catch(() => {});
      throw error;
    }
    if (oldToken && old?.sessionId && old.sessionId !== current.id)
      await apiClient(old.apiUrl, oldToken)
        .cli.revokeSession.mutate({ id: old.sessionId })
        .catch(() =>
          options.onWarning?.('Previous CLI session could not be revoked. Revoke it from Profile.'),
        );
    if (old && (old.apiUrl !== apiUrl || old.accountId !== identity.id))
      await removeCredential(configuration, name, old).catch(() =>
        options.onWarning?.(
          'Previous local credential could not be removed. Unlock the keyring and retry cleanup.',
        ),
      );
    return { instance: name, account: identity.email, sessionId: current.id };
  }
  throw new CliError('Login expired. Start senv auth login again.', 3);
}

export async function logout(value: ClientContext, localOnly = false) {
  if (process.env['SENV_TOKEN'])
    throw new CliError('SENV_TOKEN is process-only. Unset it or revoke the credential.', 2);
  if (!localOnly && value.profile.sessionId) {
    try {
      await value.client.cli.revokeSession.mutate({ id: value.profile.sessionId });
    } catch (error) {
      throw new CliError(
        `${error instanceof Error ? error.message : 'Session revocation failed.'} Use senv auth logout --local-only to remove expired local credentials.`,
        3,
      );
    }
  }
  await removeCredential(value.configuration, value.name, value.profile);
  return { loggedOut: true, serverRevoked: !localOnly && Boolean(value.profile.sessionId) };
}
