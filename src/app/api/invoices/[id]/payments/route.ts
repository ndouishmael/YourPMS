import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { json, readJson, handler } from '@/lib/api';
import { requirePracticeContext, requirePermission } from '@/lib/auth';
import { recordPatientPayment } from '@/services/billing.service';
import { actorContextFrom } from '@/lib/context';

const schema = z.object({
  amountCents: z.number().int().positive(),
  method: z.enum(['CASH', 'CARD', 'EFT']),
  reference: z.string().max(100).optional(),
});

export const POST = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = requirePracticeContext(req);
  requirePermission(ctx, 'payments:record');
  const { id } = await params;
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: 'amountCents (positive integer) and method (CASH/CARD/EFT) are required', code: 'VALIDATION' }, 400);
  }
  const actor = actorContextFrom(req, ctx);
  const payment = await recordPatientPayment(actor, { invoiceId: id, ...parsed.data });
  return json({ payment }, 201);
});
