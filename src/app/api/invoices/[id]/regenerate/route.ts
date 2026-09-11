import { type NextRequest } from 'next/server';
import { json, handler } from '@/lib/api';
import { requirePracticeContext, requirePermission } from '@/lib/auth';
import { regenerateInvoice } from '@/services/billing.service';
import { actorContextFrom } from '@/lib/context';

export const POST = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = requirePracticeContext(req);
  requirePermission(ctx, 'billing:manage');
  const { id } = await params;
  const actor = actorContextFrom(req, ctx);
  const invoice = await regenerateInvoice(actor, id);
  return json({ invoice }, 201);
});
