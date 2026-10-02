import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function sqlitePath(url: string): string {
  if (url === ':memory:') return url;
  if (!url.startsWith('file:') || url.slice(5).length === 0) {
    throw new Error('DATABASE_URL must be a SQLite file path, such as file:./data/senv.sqlite');
  }

  const path = resolve(url.slice(5));
  mkdirSync(dirname(path), { recursive: true });
  return path;
}
