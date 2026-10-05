import { TRPCError } from '@trpc/server';
const buckets = new Map<string, { count: number; until: number }>();
export function rateLimit(key: string, max: number, windowMs: number, throwing = true) {
  const now = Date.now();
  for (const [name, bucket] of buckets) if (bucket.until <= now) buckets.delete(name);
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { count: 0, until: now + windowMs };
    if (buckets.size < 10_000) buckets.set(key, bucket);
    else {
      if (throwing) throw new TRPCError({ code: 'TOO_MANY_REQUESTS' });
      return false;
    }
  }
  if (++bucket.count <= max) return true;
  if (throwing)
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'Too many requests. Try again later.',
    });
  return false;
}
