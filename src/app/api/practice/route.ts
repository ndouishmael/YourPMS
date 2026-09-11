import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { json, readJson, handler } from '@/lib/api';
import { requirePracticeContext, requirePermission } from '@/lib/auth';
import { getPractice, listLocations, updatePracticeSettings, listStaff, listNotifications } from '@/services/practice.service';
import { listAdapters } from '@/services/claims/adapters';

export const GET = handler(async (req: NextRequest) => {
  const ctx = requirePracticeContext(req);
  const practice = getPractice(ctx.db, ctx.practiceId!);
  const locations = listLocations(ctx.db, ctx.practiceId!).filter((l) => ctx.locationIds.includes(l.id));
  const staff = requirePermissionSafe(ctx, 'staff:view') ? listStaff(ctx.db, ctx.practiceId!) : [];
  const notifications = listNotifications(ctx.db, ctx.practiceId!);
  return json({
    practice,
    locations,
    staff,
    notifications,
    locationIds: ctx.locationIds,
    role: ctx.role,
    claimsAdapters: listAdapters(),
  });
});

function requirePermissionSafe(ctx: { permissions: string[] }, permission: string): boolean {
  return ctx.permissions.includes(permission);
}

const patchSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  transferThreshold: z.number().int().min(1).max(50).optional(),
  claimsAdapterId: z.string().max(50).optional(),
});

export const PATCH = handler(async (req: NextRequest) => {
  const ctx = requirePracticeContext(req);
  requirePermission(ctx, 'settings:manage');
  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'Invalid settings payload', code: 'VALIDATION' }, 400);
  const practice = await updatePracticeSettings(ctx.db, {
    practiceId: ctx.practiceId!,
    actorUserId: ctx.user.id,
    ...parsed.data,
  }, { ip: ctx.ip, userAgent: ctx.userAgent });
  return json({ practice });
});
