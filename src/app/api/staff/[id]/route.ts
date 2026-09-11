import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { json, readJson, handler } from '@/lib/api';
import { requirePracticeContext, requirePermission, revokeAllUserSessions } from '@/lib/auth';
import { updateStaffMember, listStaff } from '@/services/practice.service';

const patchSchema = z.object({
  role: z.enum(['MANAGER', 'RECEPTIONIST', 'PRACTITIONER']).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  locationIds: z.array(z.string()).min(1).optional(),
});

export const PATCH = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = requirePracticeContext(req);
  requirePermission(ctx, 'staff:manage');
  const { id } = await params;
  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'Invalid staff update payload', code: 'VALIDATION' }, 400);
  await updateStaffMember(ctx.db, {
    practiceId: ctx.practiceId!,
    membershipId: id,
    actorUserId: ctx.user.id,
    role: parsed.data.role,
    status: parsed.data.status,
    locationIds: parsed.data.locationIds,
  }, { ip: ctx.ip, userAgent: ctx.userAgent });
  if (parsed.data.status === 'SUSPENDED') {
    // Suspension takes effect immediately: kill the member's sessions.
    const member = listStaff(ctx.db, ctx.practiceId!).find((s) => s.membershipId === id);
    if (member) revokeAllUserSessions(member.userId);
  }
  return json({ ok: true });
});
