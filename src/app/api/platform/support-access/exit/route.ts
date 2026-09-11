import { type NextRequest } from 'next/server';
import { json, handler } from '@/lib/api';
import { requireAuth } from '@/lib/auth';
import { exitSupportMode } from '@/services/platform.service';
import { eq } from 'drizzle-orm';
import { sessions } from '@/db/schema';

export const POST = handler(async (req: NextRequest) => {
  const ctx = requireAuth(req);
  if (ctx.kind !== 'PLATFORM' && ctx.kind !== 'SUPPORT') {
    return json({ error: 'Platform administrator access required', code: 'FORBIDDEN' }, 403);
  }
  if (ctx.kind === 'SUPPORT' && ctx.practiceId) {
    await exitSupportMode({ db: ctx.db, actorUserId: ctx.user.id, ip: ctx.ip, userAgent: ctx.userAgent }, ctx.practiceId);
  }
  ctx.db.update(sessions).set({ supportGrantId: null }).where(eq(sessions.id, ctx.sessionId)).run();
  return json({ ok: true });
});
