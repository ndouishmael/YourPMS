import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { json, readJson, handler } from '@/lib/api';
import { requireAuth } from '@/lib/auth';
import { createSupportGrant, listSupportGrants } from '@/services/platform.service';

export const GET = handler(async (req: NextRequest) => {
  const ctx = requireAuth(req);
  if (ctx.kind !== 'PLATFORM') return json({ error: 'Platform administrator access required', code: 'FORBIDDEN' }, 403);
  return json({ grants: listSupportGrants(ctx.db) });
});

const schema = z.object({
  practiceId: z.string().min(1),
  reason: z.string().min(10).max(1000),
  minutes: z.number().int().min(5).max(240).optional(),
});

export const POST = handler(async (req: NextRequest) => {
  const ctx = requireAuth(req);
  if (ctx.kind !== 'PLATFORM') return json({ error: 'Platform administrator access required', code: 'FORBIDDEN' }, 403);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: 'practiceId and a reason of at least 10 characters are required', code: 'VALIDATION' }, 400);
  }
  const grant = await createSupportGrant(
    { db: ctx.db, actorUserId: ctx.user.id, ip: ctx.ip, userAgent: ctx.userAgent },
    parsed.data,
  );
  return json({ grant }, 201);
});
