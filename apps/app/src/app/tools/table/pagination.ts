export function lastPageIndex(total: number, pageSize: number) {
  return Math.max(0, Math.ceil(total / pageSize) - 1);
}
