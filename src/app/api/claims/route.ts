import { type NextRequest } from 'next/server';
import { json, handler } from '@/lib/api';
import { requirePracticeContext, requirePermission } from '@/lib/auth';
import { listClaims } from '@/services/claims.service';
import { actorContextFrom } from '@/lib/context';

export const GET = handler(async (req: NextRequest) => {
  const ctx = requirePracticeContext(req);
  requirePermission(ctx, 'billing:manage');
  const status = req.nextUrl.searchParams.get('status');
  const actor = actorContextFrom(req, ctx);
  const claims = listClaims(actor, status ? status.split(',') : undefined);
  return json({ claims });
});
