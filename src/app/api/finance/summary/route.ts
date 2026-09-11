import { type NextRequest } from 'next/server';
import { json, handler } from '@/lib/api';
import { requirePracticeContext, requirePermission } from '@/lib/auth';
import { financeSummary } from '@/services/finance.service';
import { actorContextFrom } from '@/lib/context';

export const GET = handler(async (req: NextRequest) => {
  const ctx = requirePracticeContext(req);
  requirePermission(ctx, 'finance:view');
  const actor = actorContextFrom(req, ctx);
  const summary = financeSummary(actor, {
    from: req.nextUrl.searchParams.get('from') ?? undefined,
    to: req.nextUrl.searchParams.get('to') ?? undefined,
    locationId: req.nextUrl.searchParams.get('locationId') ?? undefined,
  });
  return json({ summary });
});
