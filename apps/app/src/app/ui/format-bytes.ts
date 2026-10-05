export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return bytes >= 1048576
    ? `${(bytes / 1048576).toFixed(1)} MiB`
    : `${(bytes / 1024).toFixed(1)} KiB`;
}
