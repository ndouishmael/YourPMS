import { NextResponse, type NextRequest } from 'next/server';
import { json, handler, clientIp } from '@/lib/api';
import { revokeSession, SESSION_COOKIE, CSRF_COOKIE, requireAuth, cookieSecurityOptions } from '@/lib/auth';
import { logout } from '@/services/auth.service';

export const POST = handler(async (req: NextRequest) => {
  // requireAuth enforces CSRF for the logout mutation as well.
  const ctx = requireAuth(req);
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  await logout(ctx.db, ctx.user.id, { ip: clientIp(req), userAgent: req.headers.get('user-agent') ?? undefined });
  if (token) revokeSession(token);
  const res = json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { ...cookieSecurityOptions(), maxAge: 0 });
  res.cookies.set(CSRF_COOKIE, '', { ...cookieSecurityOptions(), httpOnly: false, maxAge: 0 });
  return res as NextResponse;
});
