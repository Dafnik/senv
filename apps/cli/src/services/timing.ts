import { setTimeout } from 'node:timers/promises';

export async function sleep(milliseconds: number, signal?: AbortSignal) {
  await setTimeout(milliseconds, undefined, { signal });
}
