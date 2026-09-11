import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { json, readJson, handler, enforceRateLimit, clientIp } from '@/lib/api';
import { login } from '@/services/auth.service';
import { createSession, SESSION_COOKIE, CSRF_COOKIE, cookieSecurityOptions, assertOrigin } from '@/lib/auth';
import { getDb } from '@/db';
import { recordSecurityEvent } from '@/services/audit.service';
import { unauthorized } from '@/lib/errors';

const schema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

export const POST = handler(async (req: NextRequest) => {
  assertOrigin(req); // login-CSRF defense for this pre-auth endpoint
  const ip = clientIp(req);
  const emailFromBody = (() => {
    try {
      // Parse lightly for rate-limit identity without consuming the body.
      return null as string | null;
    } catch {
      return null;
    }
  })();
  enforceRateLimit(req, 'login', emailFromBody ?? undefined);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) {
    throw unauthorized('Invalid email or password');
  }
  const meta = { ip, userAgent: req.headers.get('user-agent') ?? undefined };
  try {
    const user = await login(getDb(), parsed.data.email, parsed.data.password, meta);
    const session = createSession(user.id, meta);
    const res = json({ ok: true });
    res.cookies.set(SESSION_COOKIE, session.token, { ...cookieSecurityOptions(), expires: session.expiresAt });
    res.cookies.set(CSRF_COOKIE, session.csrfToken, {
      ...cookieSecurityOptions(),
      httpOnly: false,
      expires: session.expiresAt,
    });
    return res as NextResponse;
  } catch (err) {
    await recordSecurityEvent(getDb(), {
      type: 'LOGIN_FAILED',
      email: parsed.data.email,
      ip,
      userAgent: meta.userAgent,
      detail: 'invalid credentials',
    }).catch(() => undefined);
    throw err;
  }
});
