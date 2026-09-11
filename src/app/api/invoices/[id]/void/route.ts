import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { json, readJson, handler } from '@/lib/api';
import { requirePracticeContext, requirePermission } from '@/lib/auth';
import { voidInvoice } from '@/services/billing.service';
import { actorContextFrom } from '@/lib/context';

const schema = z.object({ reason: z.string().min(3).max(500) });

export const POST = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = requirePracticeContext(req);
  requirePermission(ctx, 'invoices:void');
  const { id } = await params;
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'A void reason is required', code: 'VALIDATION' }, 400);
  const actor = actorContextFrom(req, ctx);
  await voidInvoice(actor, id, parsed.data.reason);
  return json({ ok: true });
});
