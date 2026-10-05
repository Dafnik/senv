import { hostname } from 'node:os';
import open from 'open';
import { apiClient, authRequest, type ClientContext } from '../api/client.ts';
import {
  getCredential,
  readConfiguration,
  removeCredential,
  setCredential,
  validateApiUrl,
} from '../profiles.ts';
import { CliError } from '../errors.ts';
import { sleep } from './timing.ts';

export type LoginCode = { url: string; code: string; expiresAt: number };
export type LoginOptions = {
  instance?: string;
  apiUrl?: string;
  label?: string;
  browser?: boolean;
  signal?: AbortSignal;
  onCode?: (code: LoginCode) => void;
  onWarning?: (message: string) => void;
};
export async function login(options: LoginOptions) {
  options.signal?.throwIfAborted();
  const request: typeof authRequest = (url, path, token, body, headers) =>
    authRequest(url, path, token, body, headers, options.signal);
  const configuration = await readConfiguration();
  const name = String(
    options.instance ?? process.env['SENV_INSTANCE'] ?? configuration.active ?? 'default',
  );
  const old = configuration.profiles[name];
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
    { 'x-senv-device-label': options.label ?? hostname(), 'x-senv-cli-version': '0.1.0' },
  );
  if (new URL(code.verification_uri_complete).origin !== new URL(instance.appUrl).origin)
    throw new CliError('Instance returned an unexpected authorization URL.');
  options.onCode?.({
    url: code.verification_uri_complete,
    code: code.user_code,
    expiresAt: Date.now() + code.expires_in * 1000,
  });
  if (options.browser !== false)
    await open(code.verification_uri_complete).catch(() =>
      options.onWarning?.('Browser could not open. Use the displayed URL.'),
    );
  const expires = Date.now() + code.expires_in * 1000;
  let interval = code.interval * 1000;
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
      if (kind === 'authorization_pending') continue;
      if (kind === 'slow_down') {
        interval += 5000;
        continue;
      }
      throw error;
    }
    const client = apiClient(apiUrl, token.access_token);
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
        (await getCredential(
          { ...configuration, credentials: { ...configuration.credentials } },
          name,
          old,
        ));
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
    if (oldToken && old?.sessionId && old.apiUrl === apiUrl && old.sessionId !== current.id)
      await apiClient(old.apiUrl, oldToken)
        .cli.revokeSession.mutate({ id: old.sessionId })
        .catch(() =>
          options.onWarning?.('Previous CLI session could not be revoked. Revoke it from Profile.'),
        );
    return { instance: name, account: identity.email, sessionId: current.id };
  }
  throw new CliError('Login expired. Start senv auth login again.', 3);
}

export async function logout(value: ClientContext, localOnly = false) {
  if (process.env['SENV_TOKEN'])
    throw new CliError('SENV_TOKEN is process-only. Unset it or revoke the credential.', 2);
  if (!localOnly && value.profile.sessionId)
    await value.client.cli.revokeSession.mutate({ id: value.profile.sessionId });
  await removeCredential(value.configuration, value.name, value.profile);
  return { loggedOut: true, serverRevoked: !localOnly };
}
