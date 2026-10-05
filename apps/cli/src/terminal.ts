import type { Command } from 'commander';
import { context } from './api/client.ts';
import { runShell } from './services/shell.ts';

export async function shell(
  deploymentId: string,
  executable: string | undefined,
  command: Command,
) {
  const value = await context(command);
  const result = await runShell(value, await value.project(), deploymentId, executable, {
    onMessage: (message) => process.stderr.write(`${message}\n`),
  });
  process.exitCode = result.exitCode;
}
