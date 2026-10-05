import { CommanderError } from 'commander';
import { createProgram } from './program.ts';
import { errorCode } from './errors.ts';

try {
  await createProgram().parseAsync(process.argv);
} catch (error) {
  if (error instanceof CommanderError) {
    process.exitCode =
      error.code === 'commander.helpDisplayed' || error.code === 'commander.version' ? 0 : 2;
  } else {
    process.stderr.write(
      `${error instanceof Error ? error.message.replace(/senv_at_[A-Za-z0-9_-]+/g, '[redacted]') : 'Command failed.'}\n`,
    );
    process.exitCode = errorCode(error);
  }
}
