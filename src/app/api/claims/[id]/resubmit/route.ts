import { type NextRequest } from 'next/server';
import { json, handler } from '@/lib/api';
import { requirePracticeContext, requirePermission } from '@/lib/auth';
import { resubmitClaim } from '@/services/claims.service';
import { actorContextFrom } from '@/lib/context';

export const POST = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = requirePracticeContext(req);
  requirePermission(ctx, 'claims:submit');
  const { id } = await params;
  const actor = actorContextFrom(req, ctx);
  const claim = await resubmitClaim(actor, id);
  return json({ claim });
});
