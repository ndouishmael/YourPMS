/**
 * API route helpers: uniform error mapping, body parsing, rate limiting.
 * Route handlers stay thin; business rules live in the service layer.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { AppError, tooMany } from '@/lib/errors';
import { rateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { recordSecurityEvent } from '@/services/audit.service';
import { getDb } from '@/db';

export function json(data: unknown, status = 200): NextResponse {
  const res = NextResponse.json(data as Record<string, unknown>, { status });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof AppError) {
    return json({ error: err.message, code: err.code }, err.status);
  }
  // eslint-disable-next-line no-console
  console.error('[api] unhandled error:', err);
  return json({ error: 'Internal server error', code: 'INTERNAL' }, 500);
}

export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return 'unknown';
}

export function enforceRateLimit(req: NextRequest, bucket: keyof typeof RATE_LIMITS, identity?: string): void {
  const cfg = RATE_LIMITS[bucket];
  const key = `${bucket}:${identity ?? clientIp(req)}`;
  const result = rateLimit(key, cfg.limit, cfg.windowMs);
  if (!result.allowed) {
    void recordSecurityEvent(getDb(), {
      type: 'RATE_LIMITED',
      ip: clientIp(req),
      userAgent: req.headers.get('user-agent'),
      detail: `bucket=${bucket}`,
    }).catch(() => undefined);
    throw tooMany(`Too many requests. Retry in ${result.retryAfterSeconds}s`);
  }
}

export async function readJson<T>(req: NextRequest): Promise<T> {
  try {
    const body = await req.json();
    if (body === null || typeof body !== 'object') throw new Error('not an object');
    return body as T;
  } catch {
    throw new AppError('Request body must be valid JSON', 400, 'INVALID_JSON');
  }
}

/** Wrap a route handler with error mapping. */
export function handler<A extends unknown[]>(fn: (req: NextRequest, ...args: A) => Promise<NextResponse> | NextResponse) {
  return async (req: NextRequest, ...args: A): Promise<NextResponse> => {
    try {
      return await fn(req, ...args);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
