import { type NextRequest } from 'next/server';
import { json, handler } from '@/lib/api';
import { requirePracticeContext, requirePermission } from '@/lib/auth';
import { listAudit, verifyAuditChain } from '@/services/audit.service';

export const GET = handler(async (req: NextRequest) => {
  const ctx = requirePracticeContext(req);
  requirePermission(ctx, 'audit:view');
  const action = req.nextUrl.searchParams.get('action') ?? undefined;
  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '100', 10);
  const logs = listAudit(ctx.db, { practiceId: ctx.practiceId, action, limit: Number.isFinite(limit) ? limit : 100 });
  const chain = verifyAuditChain(ctx.db);
  return json({ logs, chain: { ok: chain.ok, count: chain.count } });
});
