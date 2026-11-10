import type { Request, Response, NextFunction } from 'express';

interface Bucket {
  count: number;
  resetAt: number;
}

// In-memory sliding-window limiter. Adequate for a single-instance BETA;
// swap for a shared store (Redis/pg) if you run multiple replicas.
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 50_000;

function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) sweep(now);
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return {
    ok: bucket.count <= limit,
    retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

export function clientKey(req: Request, scope: string): string {
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  return `${scope}:${ip}`;
}

export interface RateLimitOptions {
  scope: string;
  limit: number;
  windowMs: number;
  /** Extra dimension, e.g. the submitted email, so one IP cannot burn a whole email's budget. */
  by?: (req: Request) => string;
}

export function rateLimitMiddleware({ scope, limit, windowMs, by }: RateLimitOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = by ? `${scope}:${by(req)}` : clientKey(req, scope);
    const result = rateLimit(key, limit, windowMs);
    if (!result.ok) {
      res.setHeader('Retry-After', String(result.retryAfterSec));
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please slow down and try again.',
        },
      });
      return;
    }
    next();
  };
}
