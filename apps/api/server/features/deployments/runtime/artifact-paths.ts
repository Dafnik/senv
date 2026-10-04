import type { StaticUploadFile } from './artifact-types';

export function safeRelativePath(input: string): string {
  if (
    !input ||
    input.includes('\0') ||
    input.includes('\\') ||
    input.startsWith('/') ||
    /^[a-zA-Z]:/.test(input)
  ) {
    throw new Error('Website file path must be a safe relative path.');
  }
  const parts = input.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..'))
    throw new Error('Website file path contains an unsafe segment.');
  return parts.join('/');
}

/** Removes the one directory prefix browsers add for a selected webkitdirectory root. */
export function stripSelectedDirectoryRoot(files: StaticUploadFile[]): StaticUploadFile[] {
  const names = files.map((file) => safeRelativePath(file.name));
  const firstSegments = new Set(names.map((name) => name.split('/')[0]));
  if (firstSegments.size !== 1 || !names.some((name) => name.includes('/')))
    return files.map((file, index) => ({ ...file, name: names[index]! }));
  const root = [...firstSegments][0]!;
  const prefix = `${root}/`;
  if (names.some((name) => !name.startsWith(prefix)))
    throw new Error('Directory upload paths must share one selected root.');
  return files.map((file, index) => ({ ...file, name: names[index]!.slice(prefix.length) }));
}
