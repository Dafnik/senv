import { resolve } from 'node:path';

const storageLocks = new Map<string, Promise<void>>();

/** Serializes artifact commits, reference changes, and cleanup for one storage root. */
export async function withArtifactStorageLock<T>(
  root: string,
  task: () => Promise<T> | T,
): Promise<T> {
  const key = resolve(root);
  const previous = storageLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolvePromise) => {
    release = resolvePromise;
  });
  storageLocks.set(key, current);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (storageLocks.get(key) === current) storageLocks.delete(key);
  }
}
