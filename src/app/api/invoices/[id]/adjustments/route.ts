import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { json, readJson, handler } from '@/lib/api';
import { requirePracticeContext, requirePermission } from '@/lib/auth';
import { adjustInvoice } from '@/services/billing.service';
import { actorContextFrom } from '@/lib/context';

const schema = z.object({
  amountCents: z.number().int().positive(),
  type: z.enum(['DISCOUNT', 'WRITE_OFF', 'CORRECTION']),
  reason: z.string().min(3).max(500),
});

export const POST = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = requirePracticeContext(req);
  requirePermission(ctx, 'payments:adjust');
  const { id } = await params;
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: 'amountCents, type and reason are required', code: 'VALIDATION' }, 400);
  }
  const actor = actorContextFrom(req, ctx);
  await adjustInvoice(actor, { invoiceId: id, ...parsed.data });
  return json({ ok: true }, 201);
});
