import { createInterface } from 'node:readline/promises';
import type { Command } from 'commander';
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
      value instanceof Date
        ? value.toISOString()
        : typeof value === 'object' && value !== null
          ? JSON.stringify(value)
          : String(value ?? '');
    const widths = fields.map((field) =>
      Math.min(80, Math.max(field.length, ...rows.map((row) => format(row[field]).length))),
    );
    process.stdout.write(`${fields.map((field, i) => field.padEnd(widths[i]!)).join('  ')}\n`);
    for (const row of rows)
      process.stdout.write(
        `${fields.map((field, i) => format(row[field]).slice(0, 80).padEnd(widths[i]!)).join('  ')}\n`,
      );
  } else
    process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`);
}
export async function confirm(command: Command, message: string) {
  const options = command.optsWithGlobals();
  if (options.yes) return;
  if (options.nonInteractive || !process.stdin.isTTY)
    throw new CliError(`${message} Pass --yes to confirm.`, 2);
  const reader = createInterface({ input: process.stdin, output: process.stderr });
  try {
    if ((await reader.question(`${message} [y/N] `)).toLowerCase() !== 'y')
      throw new CliError('Cancelled.', 130);
  } finally {
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
