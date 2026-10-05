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
    .version('0.1.0')
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
    .description('Open a POSIX shell in the running app/static origin. Ctrl-] detaches.')
    .option('--shell <path>', 'Absolute shell executable path')
    .action(async (deploymentId: string, options, command: Command) =>
      shell(deploymentId, options.shell, command),
    );
  return program;
}
