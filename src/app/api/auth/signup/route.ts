import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { json, readJson, handler, enforceRateLimit, clientIp } from '@/lib/api';
import { signupPractitioner } from '@/services/auth.service';
import { createSession, SESSION_COOKIE, CSRF_COOKIE, cookieSecurityOptions, assertOrigin } from '@/lib/auth';
import { getDb } from '@/db';
import { recordSecurityEvent } from '@/services/audit.service';

const schema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().max(254),
  password: z.string().min(10).max(200),
  practiceName: z.string().min(2).max(200),
  practiceNumber: z.string().regex(/^\d{4,10}$/, "Practice number must be 4-10 digits"),
  locationName: z.string().min(2).max(100),
  hpcsaNumber: z.string().max(50).optional(),
});

export const POST = handler(async (req: NextRequest) => {
  assertOrigin(req);
  enforceRateLimit(req, 'signup');
  const body = await readJson(req);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? 'Invalid input', code: 'VALIDATION' }, 400);
  }
  const meta = { ip: clientIp(req), userAgent: req.headers.get('user-agent') ?? undefined };
  const { userId } = await signupPractitioner(getDb(), parsed.data, meta);
  const session = createSession(userId, meta);
  const res = json({ ok: true, userId });
  res.cookies.set(SESSION_COOKIE, session.token, { ...cookieSecurityOptions(), expires: session.expiresAt });
  res.cookies.set(CSRF_COOKIE, session.csrfToken, {
    ...cookieSecurityOptions(),
    httpOnly: false, // readable by the SPA for double-submit echo
    expires: session.expiresAt,
  });
  void recordSecurityEvent(getDb(), { type: 'SIGNUP', userId, ip: meta.ip, userAgent: meta.userAgent }).catch(() => undefined);
  return res as NextResponse;
});
