import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function hlm(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const classListCache = new Map<string, string[]>();

export function toClassList(className: string | ClassValue[]): string[] {
  if (typeof className === 'string' && classListCache.has(className)) {
    return classListCache.get(className)!;
  }

  const result = clsx(className)
    .split(' ')
    .filter((value) => value.length > 0);

  if (typeof className === 'string' && classListCache.size < 1_000) {
    classListCache.set(className, result);
  }

  return result;
}
