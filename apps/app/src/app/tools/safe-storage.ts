function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function readStoredValue(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeStoredValue(key: string, value: string): boolean {
  try {
    const target = storage();
    if (!target) return false;
    target.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeStoredValue(key: string): boolean {
  try {
    const target = storage();
    if (!target) return false;
    target.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function removeStoredValueIfMatches(
  key: string,
  expectedValue: string,
): boolean {
  return readStoredValue(key) === expectedValue && removeStoredValue(key);
}
