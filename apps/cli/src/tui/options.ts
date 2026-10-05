import type { ContextOptions } from '../api/client.ts';
import { CliError } from '../errors.ts';
export type TuiOptions = ContextOptions & {
  json?: boolean;
  nonInteractive?: boolean;
  yes?: boolean;
};
export function assertTuiOptions(
  options: TuiOptions,
  terminal = {
    stdin: process.stdin.isTTY,
    stdout: process.stdout.isTTY,
    term: process.env['TERM'],
  },
) {
  if (options.json || options.nonInteractive || options.yes)
    throw new CliError(
      'senv tui does not accept --json, --non-interactive, or --yes. Use ordinary senv commands for automation.',
      2,
    );
  if (!terminal.stdin || !terminal.stdout || terminal.term === 'dumb')
    throw new CliError(
      'senv tui requires an interactive terminal with stdin and stdout TTYs. Use ordinary senv commands instead.',
      2,
    );
}
