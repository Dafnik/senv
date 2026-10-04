import { afterEach, expect, test, vi } from 'vite-plus/test';
import {
  readStoredValue,
  removeStoredValue,
  removeStoredValueIfMatches,
  writeStoredValue,
} from './safe-storage';

const originalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  'localStorage',
);
afterEach(() => {
  vi.unstubAllGlobals();
  if (originalStorage)
    Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

test('storage operations report unavailable and throwing browser storage safely', () => {
  const storage = {
    getItem: vi.fn(() => {
      throw new DOMException('blocked');
    }),
    setItem: vi.fn(() => {
      throw new DOMException('quota');
    }),
    removeItem: vi.fn(() => {
      throw new DOMException('blocked');
    }),
  };
  vi.stubGlobal('localStorage', storage);
  expect(readStoredValue('draft')).toBeNull();
  expect(writeStoredValue('draft', 'value')).toBe(false);
  expect(removeStoredValue('draft')).toBe(false);
});

test('storage getter access failures do not escape', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => {
      throw new Error('blocked');
    },
  });
  expect(readStoredValue('draft')).toBeNull();
  expect(writeStoredValue('draft', 'value')).toBe(false);
  expect(removeStoredValue('draft')).toBe(false);
});

test('snapshot removal preserves a newer draft for the same key', () => {
  const values = new Map<string, string>([['draft', 'newer']]);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });

  expect(removeStoredValueIfMatches('draft', 'submitted')).toBe(false);
  expect(readStoredValue('draft')).toBe('newer');
  expect(removeStoredValueIfMatches('draft', 'newer')).toBe(true);
  expect(readStoredValue('draft')).toBeNull();
});
