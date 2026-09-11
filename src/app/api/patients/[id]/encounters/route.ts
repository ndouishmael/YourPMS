import { type NextRequest } from 'next/server';
import { json, handler } from '@/lib/api';
import { requirePracticeContext, requirePermission } from '@/lib/auth';
import { getPatientAuthorized } from '@/services/patients.service';
import { getPatientHistory } from '@/services/encounters.service';
import { actorContextFrom } from '@/lib/context';

export const GET = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = requirePracticeContext(req);
  requirePermission(ctx, 'clinical:access');
  const { id } = await params;
  const actor = actorContextFrom(req, ctx);
  getPatientAuthorized(actor, id); // tenant + location authorization
  const history = getPatientHistory(ctx.db, ctx.practiceId!, id);
  return json({ history });
});
