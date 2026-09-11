import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { json, readJson, handler, enforceRateLimit, clientIp } from '@/lib/api';
import { acceptInvitation } from '@/services/auth.service';
import { createSession, SESSION_COOKIE, CSRF_COOKIE, cookieSecurityOptions, assertOrigin } from '@/lib/auth';
import { getDb } from '@/db';

const schema = z.object({
  token: z.string().min(10).max(200),
  password: z.string().min(10).max(200),
});

export const POST = handler(async (req: NextRequest) => {
  assertOrigin(req);
  enforceRateLimit(req, 'inviteAccept');
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: 'A valid invitation token and a password of at least 10 characters are required', code: 'VALIDATION' }, 400);
  }
  const meta = { ip: clientIp(req), userAgent: req.headers.get('user-agent') ?? undefined };
  const result = await acceptInvitation(getDb(), parsed.data, meta);
  const session = createSession(result.userId, meta);
  const res = json({ ok: true });
  res.cookies.set(SESSION_COOKIE, session.token, { ...cookieSecurityOptions(), expires: session.expiresAt });
  res.cookies.set(CSRF_COOKIE, session.csrfToken, { ...cookieSecurityOptions(), httpOnly: false, expires: session.expiresAt });
  return res as NextResponse;
});
