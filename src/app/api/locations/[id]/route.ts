import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { json, readJson, handler } from '@/lib/api';
import { requirePracticeContext, requirePermission } from '@/lib/auth';
import { updateLocation } from '@/services/practice.service';

const patchSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  isActive: z.boolean().optional(),
});

export const PATCH = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = requirePracticeContext(req);
  requirePermission(ctx, 'locations:manage');
  const { id } = await params;
  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'Invalid location payload', code: 'VALIDATION' }, 400);
  const location = await updateLocation(ctx.db, {
    practiceId: ctx.practiceId!,
    locationId: id,
    name: parsed.data.name,
    isActive: parsed.data.isActive,
    actorUserId: ctx.user.id,
  }, { ip: ctx.ip, userAgent: ctx.userAgent });
  return json({ location });
});
