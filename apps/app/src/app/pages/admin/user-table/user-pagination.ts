const PAGE_SIZES = [10, 20, 50, 100] as const;
const MAX_PAGE = Math.floor(Number.MAX_SAFE_INTEGER / PAGE_SIZES.at(-1)!) + 1;

export function normalizeUserPage(value: unknown): number {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? Math.min(page, MAX_PAGE) : 1;
}

export function normalizeUserPageSize(value: unknown): number {
  const size = Number(value);
  return PAGE_SIZES.includes(size as (typeof PAGE_SIZES)[number]) ? size : 20;
}

export function canonicalUserPageParam(
  value: string | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  const normalized = String(normalizeUserPage(value));
  return value === normalized ? undefined : normalized;
}

export function canonicalUserPageSizeParam(
  value: string | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  const normalized = String(normalizeUserPageSize(value));
  return value === normalized ? undefined : normalized;
}
