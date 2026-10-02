export function unwrapAuthResult<T>(result: {
  data: T | null;
  error: { message?: string } | null;
}): T {
  if (result.error) {
    throw new Error(
      result.error.message || 'The request failed. Please try again.',
    );
  }
  if (result.data === null) {
    throw new Error('The server returned no data. Please try again.');
  }
  return result.data;
}
