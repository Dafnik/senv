import { CommanderError } from 'commander';
import { createProgram } from './program.ts';
import { terminalText } from './tui/safety.ts';
import { errorCode } from './errors.ts';

try {
  await createProgram().parseAsync(process.argv);
} catch (error) {
  if (error instanceof CommanderError) {
    process.exitCode =
      error.code === 'commander.helpDisplayed' || error.code === 'commander.version' ? 0 : 2;
  } else {
    const code = errorCode(error);
    process.stderr.write(
      `${error instanceof Error ? terminalText(error.message).replace(/senv_at_[A-Za-z0-9_-]+/g, '[redacted]') : 'Command failed.'}${code === 3 ? '\nRun senv auth login.' : ''}\n`,
    );
    process.exitCode = code;
  }
}
