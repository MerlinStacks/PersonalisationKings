type PasskeyAction = "authentication_options" | "authentication_verify" | "registration_options" | "registration_verify";

interface Bucket {
  count: number;
  resetAt: number;
}

const windowMs = 60_000;
const buckets = new Map<string, Bucket>();

export function consumePasskeyRateLimit(request: Request, action: PasskeyAction, scope = "anonymous", now = Date.now()) {
  const source = (request.headers.get("x-real-ip") ?? "unknown").slice(0, 100);
  const limit = action.startsWith("registration") ? 10 : 30;
  const retryAfter = consume(`${action}:${source}:${scope}`, limit, now);
  const globalRetryAfter = consume(`${action}:global`, 500, now);
  if (buckets.size > 10_000) {
    for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
  }
  return Math.max(retryAfter, globalRetryAfter);
}

function consume(key: string, limit: number, now: number) {
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return 0;
  }
  current.count += 1;
  return current.count <= limit ? 0 : Math.max(1, Math.ceil((current.resetAt - now) / 1000));
}
