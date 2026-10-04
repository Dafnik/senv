/**
 * Polyfill for DOMException with AbortError name
 */
class AbortError extends Error {
  constructor() {
    const name = 'AbortError';
    super(name);
    this.name = name;
    this.message = name;
  }
}

/**
 * Polyfill for `signal.throwIfAborted()`
 * @see https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/throwIfAborted
 */
export const throwIfAborted = (signal?: AbortSignal) => {
  if (!signal?.aborted) {
    return;
  }
  // If available, use the native implementation
  signal.throwIfAborted?.();

  // If we have `DOMException`, use it
  if (typeof DOMException !== 'undefined') {
    throw new DOMException('AbortError', 'AbortError');
  }

  // Otherwise, use our own implementation
  throw new AbortError();
};
