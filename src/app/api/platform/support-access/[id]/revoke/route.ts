import { type NextRequest } from 'next/server';
import { json, handler } from '@/lib/api';
import { requireAuth } from '@/lib/auth';
import { revokeSupportGrant } from '@/services/platform.service';

export const POST = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = requireAuth(req);
  if (ctx.kind !== 'PLATFORM') return json({ error: 'Platform administrator access required', code: 'FORBIDDEN' }, 403);
  const { id } = await params;
  await revokeSupportGrant({ db: ctx.db, actorUserId: ctx.user.id, ip: ctx.ip, userAgent: ctx.userAgent }, id);
  return json({ ok: true });
});
