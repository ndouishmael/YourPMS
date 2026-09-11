import { type NextRequest } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { json, handler } from '@/lib/api';
import { requirePracticeContext, requirePermission } from '@/lib/auth';
import { invitations } from '@/db/schema';
import { notFound } from '@/lib/errors';
import { recordAudit } from '@/services/audit.service';

export const DELETE = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = requirePracticeContext(req);
  requirePermission(ctx, 'staff:manage');
  const { id } = await params;
  const invitation = ctx.db.select().from(invitations).where(eq(invitations.id, id)).get();
  if (!invitation || invitation.practiceId !== ctx.practiceId) throw notFound('Invitation not found');
  if (invitation.acceptedAt) return json({ error: 'Invitation already accepted', code: 'CONFLICT' }, 409);
  ctx.db
    .update(invitations)
    .set({ revokedAt: new Date() })
    .where(and(eq(invitations.id, id), eq(invitations.practiceId, ctx.practiceId!)))
    .run();
  await recordAudit({
    db: ctx.db,
    practiceId: ctx.practiceId,
    actorUserId: ctx.user.id,
    actorRole: ctx.role,
    action: 'STAFF_INVITATION_REVOKED',
    entityType: 'invitation',
    entityId: id,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return json({ ok: true });
});
