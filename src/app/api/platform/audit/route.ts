import { type NextRequest } from 'next/server';
import { json, handler } from '@/lib/api';
import { requireAuth } from '@/lib/auth';
import { listAudit, verifyAuditChain } from '@/services/audit.service';

export const GET = handler(async (req: NextRequest) => {
  const ctx = requireAuth(req);
  if (ctx.kind !== 'PLATFORM') return json({ error: 'Platform administrator access required', code: 'FORBIDDEN' }, 403);
  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '200', 10);
  const logs = listAudit(ctx.db, { practiceId: undefined, limit: Number.isFinite(limit) ? limit : 200 });
  const chain = verifyAuditChain(ctx.db);
  return json({ logs, chain: { ok: chain.ok, count: chain.count } });
});
