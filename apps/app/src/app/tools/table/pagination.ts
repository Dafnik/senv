export function lastPageIndex(total: number, pageSize: number) {
  if (!Number.isFinite(total) || total <= 0) return 0;
  if (!Number.isFinite(pageSize) || pageSize <= 0) return 0;
  return Math.max(0, Math.ceil(total / pageSize) - 1);
}
