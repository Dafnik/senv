import { createTRPCClient, httpLink } from '@trpc/client';
import superjson from 'superjson';
import type { Command } from 'commander';
import type { AppRouter } from '../../../api/server/trpc/routers/index';
import { getCredential, localProject, readConfiguration } from '../profiles.ts';
import { CliError } from '../errors.ts';

export const apiClient = (apiUrl: string, token?: string, signal?: AbortSignal) =>
  createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: `${apiUrl}/api/trpc`,
        transformer: superjson,
        headers: () => (token ? { authorization: `Bearer ${token}` } : {}),
        fetch: (url, options) =>
          fetch(url, {
            ...options,
            redirect: 'error',
            signal: AbortSignal.any([
              AbortSignal.timeout(30_000),
              ...(signal ? [signal] : []),
              ...(options?.signal ? [options.signal] : []),
            ]),
          }),
      }),
    ],
  });
export type ContextOptions = { instance?: string; project?: string; signal?: AbortSignal };

export function context(command: Command, authentication = true) {
  return resolveContext(command.optsWithGlobals(), authentication);
}

export async function resolveContext(options: ContextOptions = {}, authentication = true) {
  const configuration = await readConfiguration();
  const local = await localProject();
  const name = String(
    options.instance ??
      process.env['SENV_INSTANCE'] ??
      local?.instance ??
      configuration.active ??
      'default',
  );
  const profile = configuration.profiles[name];
  if (!profile)
    throw new CliError(
      `Unknown instance ${name}. Run senv auth login --api-url <url> --instance ${name}.`,
      2,
    );
  const token = await getCredential(configuration, name, profile);
  if (authentication && !token)
    throw new CliError('Sign in with senv auth login, or set SENV_TOKEN.', 3);
  const client = apiClient(profile.apiUrl, token, options.signal);
  const project = async () => {
    const selection =
      options.project ??
      process.env['SENV_PROJECT'] ??
      (local?.instance === name ? local.projectId : undefined);
    if (!selection)
      throw new CliError(
        'Select a project with --project, SENV_PROJECT, or senv projects link.',
        2,
      );
    return (await client.cli.project.query({ project: String(selection) })).id;
  };
  return { configuration, name, profile, token, client, project };
}
export async function authRequest<T>(
  apiUrl: string,
  path: string,
  token?: string,
  body?: unknown,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<T> {
  // Custom Better Auth account endpoints retain their Origin/CSRF checks. A native
  // bearer client uses the frontend origin declared by this instance rather than
  // weakening those checks on the server.
  const origin =
    token && body !== undefined && !headers['origin']
      ? new URL((await apiClient(apiUrl, undefined, signal).cli.instance.query()).appUrl).origin
      : undefined;
  const response = await fetch(`${apiUrl}/api/auth/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(origin ? { origin } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    redirect: 'error',
    signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]),
  });
  const value = (await response.json().catch(() => ({}))) as {
    message?: string;
    error?: string;
    error_description?: string;
  };
  if (!response.ok) {
    const error = new CliError(
      value.message ?? value.error_description ?? 'Authentication request failed.',
      response.status === 401
        ? 3
        : response.status === 403
          ? 4
          : response.status === 404
            ? 5
            : response.status === 400
              ? 2
              : 1,
    );
    Object.assign(error, { authError: value.error });
    throw error;
  }
  return value as T;
}

export type ClientContext = Awaited<ReturnType<typeof resolveContext>>;
