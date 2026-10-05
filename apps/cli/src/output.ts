import { createInterface } from 'node:readline/promises';
import type { Command } from 'commander';
import stringWidth from 'string-width';
import { terminalText } from './tui/safety.ts';
import { CliError } from './errors.ts';

export function output(value: unknown, command: Command) {
  if (command.optsWithGlobals().json) {
    process.stdout.write(`${JSON.stringify(value)}\n`);
    return;
  }
  const entries = Array.isArray(value) ? value : [value];
  const rows = entries.filter(
    (row): row is Record<string, unknown> =>
      !!row && typeof row === 'object' && !Array.isArray(row),
  );
  if (rows.length === entries.length && rows.length) {
    const fields = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    const format = (value: unknown) =>
      terminalText(
        value instanceof Date
          ? value.toISOString()
          : typeof value === 'object' && value !== null
            ? JSON.stringify(value)
            : String(value ?? ''),
      );
    const pad = (text: string, width: number) =>
      text + ' '.repeat(Math.max(0, width - stringWidth(text)));
    const widths = fields.map((field) =>
      Math.max(stringWidth(field), ...rows.map((row) => stringWidth(format(row[field])))),
    );
    process.stdout.write(
      `${fields.map((field, i) => pad(terminalText(field), widths[i]!)).join('  ')}\n`,
    );
    for (const row of rows)
      process.stdout.write(
        `${fields.map((field, i) => pad(format(row[field]), widths[i]!)).join('  ')}\n`,
      );
  } else
    process.stdout.write(
      `${terminalText(typeof value === 'string' ? value : JSON.stringify(value, null, 2))}\n`,
    );
}
export async function confirm(command: Command, message: string) {
  const options = command.optsWithGlobals();
  if (options.yes) return;
  if (options.nonInteractive || !process.stdin.isTTY)
    throw new CliError(`${message} Pass --yes to confirm.`, 2);
  const reader = createInterface({ input: process.stdin, output: process.stderr });
  const cancellation = new AbortController();
  const cancel = () => cancellation.abort();
  reader.once('SIGINT', cancel);
  process.once('SIGINT', cancel);
  try {
    if (
      (
        await reader.question(`${message} [y/N] `, { signal: cancellation.signal })
      ).toLowerCase() !== 'y'
    )
      throw new CliError('Cancelled.', 130);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError')
      throw new CliError('Cancelled.', 130);
    throw error;
  } finally {
    process.removeListener('SIGINT', cancel);
    reader.close();
  }
}
export function integer(value: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new CliError('Expected a positive integer.', 2);
  return parsed;
}
export const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export function offset(value: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new CliError('Expected a non-negative integer.', 2);
  return parsed;
}
