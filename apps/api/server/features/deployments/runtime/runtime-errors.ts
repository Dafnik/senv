export function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 4000).replace(/(password|token|secret)([=: ]+)\S+/gi, '$1$2[redacted]');
}
