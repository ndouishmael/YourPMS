import { type NextRequest } from 'next/server';
import { json, handler } from '@/lib/api';
import { requirePracticeContext, requirePermission } from '@/lib/auth';
import { startEncounter } from '@/services/scheduling.service';
import { getPractitionerForUser } from '@/services/practice.service';
import { actorContextFrom } from '@/lib/context';
import { badRequest } from '@/lib/errors';

export const POST = handler(async (req: NextRequest, { params }: { params: Promise<{ encounterId: string }> }) => {
  const ctx = requirePracticeContext(req);
  requirePermission(ctx, 'encounter:start');
  const { encounterId } = await params;
  const actor = actorContextFrom(req, ctx);
  const practitioner = getPractitionerForUser(ctx.db, ctx.practiceId!, ctx.user.id);
  if (!practitioner) throw badRequest('Only practitioners can start encounters');
  const encounter = await startEncounter(actor, encounterId, practitioner.id);
  return json({ encounter });
});
