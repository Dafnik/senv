import { CliError } from '../errors.ts';
export function tokenLifetime(
  duration: string | number | undefined,
  unit: 'seconds' | 'days' | 'months' | 'years' = 'seconds',
): number | null {
  if (duration === '' || duration === undefined) return null;
  const seconds =
    Number(duration) * { seconds: 1, days: 86400, months: 2592000, years: 31536000 }[unit];
  if (
    !Number.isSafeInteger(seconds) ||
    seconds <= 0 ||
    !Number.isFinite(new Date(Date.now() + seconds * 1000).getTime())
  )
    throw new CliError('Choose a positive duration in whole seconds, or leave it empty.', 2);
  return seconds;
}
