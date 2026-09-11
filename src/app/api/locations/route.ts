import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { json, readJson, handler } from '@/lib/api';
import { requirePracticeContext, requirePermission } from '@/lib/auth';
import { createLocation, listLocations } from '@/services/practice.service';

export const GET = handler(async (req: NextRequest) => {
  const ctx = requirePracticeContext(req);
  const locations = listLocations(ctx.db, ctx.practiceId!);
  // Only locations the caller is authorized for.
  return json({ locations: locations.filter((l) => ctx.locationIds.includes(l.id)) });
});

const createSchema = z.object({
  name: z.string().min(2).max(100),
  code: z.string().max(20).optional(),
});

export const POST = handler(async (req: NextRequest) => {
  const ctx = requirePracticeContext(req);
  requirePermission(ctx, 'locations:manage');
  const parsed = createSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'Location name is required (2-100 chars)', code: 'VALIDATION' }, 400);
  const location = await createLocation(ctx.db, {
    practiceId: ctx.practiceId!,
    name: parsed.data.name,
    code: parsed.data.code,
    actorUserId: ctx.user.id,
  }, { ip: ctx.ip, userAgent: ctx.userAgent });
  return json({ location }, 201);
});
