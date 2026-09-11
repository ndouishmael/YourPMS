import { type NextRequest } from 'next/server';
import { json, handler } from '@/lib/api';
import { requirePracticeContext, requirePermission } from '@/lib/auth';
import { completeConsultation } from '@/services/encounters.service';
import { actorContextFrom } from '@/lib/context';

export const POST = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = requirePracticeContext(req);
  requirePermission(ctx, 'encounter:complete');
  const { id } = await params;
  const actor = actorContextFrom(req, ctx);
  const result = await completeConsultation(actor, id);
  return json({ encounter: result.encounter, invoice: { id: result.invoice.id, invoiceNumber: result.invoice.invoiceNumber, totalCents: result.invoice.totalCents } });
});
