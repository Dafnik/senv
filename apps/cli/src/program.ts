import { version } from './version.ts';
import { Command } from 'commander';
import { authCommands } from './commands/auth.ts';
import { projectCommands } from './commands/projects.ts';
import { deploymentCommands } from './commands/deployments.ts';
import { teamCommands, userCommands } from './commands/teams.ts';
import { shell } from './terminal.ts';

export function createProgram() {
  const program = new Command()
    .name('senv')
    .description('Manage senv deployments, projects, accounts and CLI access')
    .version(version)
    .option('--instance <name>', 'Named instance profile')
    .option('--project <slug-or-id>', 'Project preview slug or immutable ID')
    .option('--json', 'Machine-readable JSON output')
    .option('--non-interactive', 'Never prompt')
    .option('--yes', 'Confirm destructive actions')
    .exitOverride();
  program
    .command('tui')
    .description('Open the full-screen terminal interface')
    .action(async (_options, command: Command) => {
      const { launchTui } = await import('./tui/index.tsx');
      await launchTui(command.optsWithGlobals());
    });
  authCommands(program);
  projectCommands(program);
  deploymentCommands(program);
  teamCommands(program);
  userCommands(program);
  program
    .command('shell <id>')
    .description(
      'Open a POSIX shell in the running app/static origin. Runs as the configured container user; changes are temporary. Ctrl-] detaches.',
    )
    .option('--shell <path>', 'Absolute shell executable path')
    .action(async (deploymentId: string, options, command: Command) =>
      shell(deploymentId, options.shell, command),
    );
  const help: Record<string, string> = {
    'auth login': 'Create a personal CLI session with browser approval',
    'auth logout': 'Revoke the current CLI session and remove its local credential',
    'auth status': 'Show sign-in state and credential source',
    'auth whoami': 'Show the current account',
    'auth sessions': 'List and revoke personal browser and CLI sessions',
    'auth tokens': 'Create, list and revoke project automation credentials',
    instances: 'Manage local instance profiles',
    'instances add': 'Add a named API origin',
    'instances list': 'List configured instance profiles',
    'instances use': 'Select the default instance',
    'deployments logs': 'Read deployment origin or proxy logs',
    'deployments resources': 'Read resource usage or watch new samples',
    'deployments history': 'List deployment lifecycle history',
    'deployments audit': 'List project audit events',
    'deployments preview-status': 'Check the public preview endpoint',
    'projects link': 'Link the working directory to an immutable project ID',
  };
  const verbs: Record<string, string> = {
    list: 'List',
    show: 'Show details for',
    create: 'Create',
    revoke: 'Revoke',
    'revoke-others': 'Revoke all other',
    remove: 'Remove',
    delete: 'Delete',
    stop: 'Stop',
    restart: 'Restart',
    publish: 'Publish',
    pin: 'Pin',
    unpin: 'Unpin',
    rename: 'Rename',
    slug: 'Set the preview slug of',
    set: 'Set',
    accept: 'Accept',
    reject: 'Reject',
    cancel: 'Cancel',
    role: 'Change the role of',
    resend: 'Resend signup email to',
    reset: 'Send password reset email to',
    stats: 'Show instance statistics for',
  };
  const describe = (command: Command, path = '') => {
    for (const child of command.commands) {
      const key = `${path} ${child.name()}`.trim();
      if (!child.description())
        child.description(
          help[key] ??
            `${verbs[child.name()] ?? 'Manage'} ${command.name() === 'senv' ? child.name() : command.name()}`,
        );
      describe(child, key);
    }
  };
  describe(program);
  return program;
}
