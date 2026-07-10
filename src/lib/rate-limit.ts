import { appConfig } from "@/lib/config";

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

export function enforceRateLimit(key: string, options: { skip?: boolean } = {}) {
  // seed script escape hatch — the seed places many bets through the real code path
  if (options.skip) {
    return;
  }

  const now = Date.now();
  const windowMs = appConfig.betRateLimitWindowMs;
  const maxRequests = appConfig.betRateLimitMaxRequests;
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, {
      count: 1,
      resetAt: now + windowMs,
    });
    return;
  }

  if (bucket.count >= maxRequests) {
    throw new Error("Too many bets at once. Wait a few seconds and try again.");
  }

  bucket.count += 1;
}
