import { type NextRequest } from 'next/server';
import { json, handler } from '@/lib/api';
import { requirePracticeContext, requirePermission } from '@/lib/auth';
import { listInvoices } from '@/services/billing.service';
import { actorContextFrom } from '@/lib/context';

export const GET = handler(async (req: NextRequest) => {
  const ctx = requirePracticeContext(req);
  requirePermission(ctx, 'billing:manage');
  const actor = actorContextFrom(req, ctx);
  const status = req.nextUrl.searchParams.get('status');
  const invoices = listInvoices(actor, { status: status ? status.split(',') : undefined });
  return json({ invoices });
});
