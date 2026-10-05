import { login, logout } from '../services/auth.ts';
import { Command } from 'commander';
import { hostname } from 'node:os';
import { apiClient, context } from '../api/client.ts';
import { readConfiguration, validateApiUrl, writeConfiguration } from '../profiles.ts';
import { confirm, integer, output } from '../output.ts';
import { CliError } from '../errors.ts';

export function authCommands(program: Command) {
  const auth = program
    .command('auth')
    .description('Login, personal sessions and project-scoped automation credentials');
  auth
    .command('login')
    .option('--api-url <url>', 'API origin')
    .option('--no-browser', 'Print the URL without opening a browser')
    .option('--label <name>', 'Device name', hostname())
    .action(async (options, command: Command) => {
      output(
        await login({
          ...options,
          instance: command.optsWithGlobals().instance,
          onCode: ({ url, code, expiresAt }) =>
            process.stderr.write(
              `Open ${url}\nCode: ${code}\nApprove the login within ${Math.ceil((expiresAt - Date.now()) / 1000)} seconds.\n`,
            ),
          onWarning: (message) => process.stderr.write(`${message}\n`),
        }),
        command,
      );
    });
  auth
    .command('logout')
    .option('--local-only', 'Remove local credentials without server revocation')
    .action(async (options, command: Command) => {
      output(await logout(await context(command, false), options.localOnly), command);
    });
  auth
    .command('whoami')
    .action(async (_options, command: Command) =>
      output(await (await context(command)).client.me.query(), command),
    );
  auth.command('status').action(async (_options, command: Command) => {
    const value = await context(command);
    output(
      { instance: value.name, apiUrl: value.profile.apiUrl, user: await value.client.me.query() },
      command,
    );
  });
  const sessions = auth.command('sessions');
  sessions
    .command('list')
    .action(async (_options, command: Command) =>
      output(await (await context(command)).client.cli.sessions.query(), command),
    );
  sessions.command('revoke <id>').action(async (id: string, _options, command: Command) => {
    await confirm(command, 'Revoke this session?');
    output(await (await context(command)).client.cli.revokeSession.mutate({ id }), command);
  });
  sessions.command('revoke-others').action(async (_options, command: Command) => {
    await confirm(command, 'Sign out all other browser and CLI sessions?');
    output(await (await context(command)).client.cli.revokeOtherSessions.mutate(), command);
  });
  const tokens = auth.command('tokens');
  tokens
    .command('list')
    .action(async (_options, command: Command) =>
      output(await (await context(command)).client.cli.tokens.query(), command),
    );
  tokens
    .command('create <name>')
    .option('--permission <permission>', 'read or manage', 'read')
    .option('--days <days>', 'Lifetime in days (default: 30)', integer)
    .option('--seconds <seconds>', 'Lifetime in seconds', integer)
    .option('--no-expiry', 'Create a credential that never expires')
    .action(async (name: string, options, command: Command) => {
      if (!['read', 'manage'].includes(options.permission))
        throw new CliError('Permission must be read or manage.', 2);
      if (
        [
          options.days !== undefined,
          options.seconds !== undefined,
          options.expiry === false,
        ].filter(Boolean).length > 1
      )
        throw new CliError('Choose only one of --days, --seconds, or --no-expiry.', 2);
      const value = await context(command);
      output(
        await value.client.cli.createToken.mutate({
          name,
          projectId: await value.project(),
          permission: options.permission,
          expiresInSeconds:
            options.expiry === false ? null : (options.seconds ?? (options.days ?? 30) * 86400),
        }),
        command,
      );
      process.stderr.write('Store this automation secret now. It will not be shown again.\n');
    });
  tokens.command('revoke <id>').action(async (id: string, _options, command: Command) => {
    await confirm(command, 'Revoke this automation credential?');
    output(await (await context(command)).client.cli.revokeToken.mutate({ id }), command);
  });
  const instances = program.command('instances');
  instances
    .command('add <name>')
    .requiredOption('--api-url <url>', 'API origin')
    .action(async (name: string, options, command: Command) => {
      const config = await readConfiguration();
      if (config.profiles[name])
        throw new CliError('Instance already exists. Choose another name.', 2);
      const apiUrl = validateApiUrl(options.apiUrl);
      const instance = await apiClient(apiUrl).cli.instance.query();
      config.profiles[name] = { apiUrl, appUrl: validateApiUrl(instance.appUrl) };
      config.active ??= name;
      await writeConfiguration(config);
      output({ instance: name, apiUrl }, command);
    });
  instances.command('list').action(async (_options, command: Command) => {
    const config = await readConfiguration();
    output(
      Object.entries(config.profiles).map(([name, profile]) => ({
        name,
        apiUrl: profile.apiUrl,
        active: name === config.active,
      })),
      command,
    );
  });
  instances.command('use <name>').action(async (name: string, _options, command: Command) => {
    const config = await readConfiguration();
    if (!config.profiles[name]) throw new CliError('Unknown instance.', 2);
    config.active = name;
    await writeConfiguration(config);
    output({ instance: name }, command);
  });
}
