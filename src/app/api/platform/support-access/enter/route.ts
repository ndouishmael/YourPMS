import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { json, readJson, handler } from '@/lib/api';
import { requireAuth } from '@/lib/auth';
import { enterSupportMode } from '@/services/platform.service';
import { eq } from 'drizzle-orm';
import { sessions } from '@/db/schema';

const schema = z.object({ grantId: z.string().min(1) });

/**
 * Enter scoped support mode: binds the active grant to the admin's session.
 * The session then resolves to a read-only SUPPORT context for the target
 * practice until expiry/exit; every request continues to be auditable.
 */
export const POST = handler(async (req: NextRequest) => {
  const ctx = requireAuth(req);
  if (ctx.kind !== 'PLATFORM') return json({ error: 'Platform administrator access required', code: 'FORBIDDEN' }, 403);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'grantId is required', code: 'VALIDATION' }, 400);
  const grant = await enterSupportMode(
    { db: ctx.db, actorUserId: ctx.user.id, ip: ctx.ip, userAgent: ctx.userAgent },
    parsed.data.grantId,
  );
  ctx.db.update(sessions).set({ supportGrantId: grant.id }).where(eq(sessions.id, ctx.sessionId)).run();
  return json({ ok: true, practiceId: grant.practiceId, expiresAt: grant.expiresAt });
});
