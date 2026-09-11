/**
 * In-memory sliding-window rate limiter.
 *
 * Single-instance by design for Phase 1; the interface is Redis-ready for
 * horizontal scale-out. Limits are enforced server-side on all auth endpoints
 * and mutating API routes.
 */

type Bucket = { hits: number[] };

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  // Periodic sweep to bound memory.
  if (now - lastSweep > 60_000) {
    for (const [k, b] of buckets) {
      b.hits = b.hits.filter((t) => now - t < 600_000);
      if (b.hits.length === 0) buckets.delete(k);
    }
    lastSweep = now;
  }
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
  if (bucket.hits.length >= limit) {
    buckets.set(key, bucket);
    const oldest = bucket.hits[0];
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    };
  }
  bucket.hits.push(now);
  buckets.set(key, bucket);
  return { allowed: true, remaining: limit - bucket.hits.length, retryAfterSeconds: 0 };
}

/** Test hook: clear all limits. */
export function resetRateLimits() {
  buckets.clear();
}

export const RATE_LIMITS = {
  login: { limit: 8, windowMs: 5 * 60_000 },
  signup: { limit: 5, windowMs: 10 * 60_000 },
  inviteAccept: { limit: 10, windowMs: 10 * 60_000 },
  api: { limit: 300, windowMs: 60_000 },
  mutation: { limit: 120, windowMs: 60_000 },
} as const;
