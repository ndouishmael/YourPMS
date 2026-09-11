import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { json, readJson, handler } from '@/lib/api';
import { requirePracticeContext, requirePermission } from '@/lib/auth';
import { createInvitation } from '@/services/auth.service';
import { listInvitations } from '@/services/practice.service';

export const GET = handler(async (req: NextRequest) => {
  const ctx = requirePracticeContext(req);
  requirePermission(ctx, 'staff:view');
  const invitations = listInvitations(ctx.db, ctx.practiceId!);
  // Never expose tokens after creation; only status metadata.
  return json({
    invitations: invitations.map((i) => ({
      id: i.id,
      email: i.email,
      firstName: i.firstName,
      lastName: i.lastName,
      role: i.role,
      locationIds: JSON.parse(i.locationIds),
      status: i.acceptedAt ? 'ACCEPTED' : i.revokedAt ? 'REVOKED' : i.expiresAt.getTime() < Date.now() ? 'EXPIRED' : 'PENDING',
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
    })),
  });
});

const inviteSchema = z.object({
  email: z.string().email().max(254),
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  role: z.enum(['MANAGER', 'RECEPTIONIST', 'PRACTITIONER']),
  locationIds: z.array(z.string()).min(1),
});

export const POST = handler(async (req: NextRequest) => {
  const ctx = requirePracticeContext(req);
  requirePermission(ctx, 'staff:manage');
  const parsed = inviteSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? 'Invalid invitation payload', code: 'VALIDATION' }, 400);
  }
  const result = await createInvitation(
    ctx.db,
    {
      practiceId: ctx.practiceId!,
      invitedByUserId: ctx.user.id,
      ...parsed.data,
    },
    { ip: ctx.ip, userAgent: ctx.userAgent },
  );
  // The invitation link is returned once to the inviter (email delivery is a
  // deployment integration; Phase 1 surfaces the link in the inviter's UI).
  return json(
    {
      invitation: { id: result.invitation.id, email: result.invitation.email, role: result.invitation.role },
      acceptPath: result.acceptPath,
    },
    201,
  );
});
