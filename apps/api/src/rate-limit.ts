interface Bucket {
  count: number;
  resetAt: number;
}

const maximumBuckets = 10_000;
const buckets = new Map<string, Bucket>();

export function consumeRateLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= maximumBuckets) pruneBuckets(now);
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return {
    allowed: bucket.count <= limit,
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
  };
}

export function clearRateLimitsForTests() {
  buckets.clear();
}

function pruneBuckets(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  while (buckets.size >= maximumBuckets) {
    const oldest = buckets.keys().next().value;
    if (typeof oldest !== "string") break;
    buckets.delete(oldest);
  }
}
