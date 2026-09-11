import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { json, readJson, handler } from '@/lib/api';
import { requirePracticeContext, requirePermission } from '@/lib/auth';
import { decideTransfer, listTransfersForPatient, listPendingTransfers } from '@/services/patients.service';
import { actorContextFrom } from '@/lib/context';

export const GET = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = requirePracticeContext(req);
  const { id } = await params;
  if (id === 'pending') {
    requirePermission(ctx, 'transfers:decide');
    return json({ pending: listPendingTransfers(ctx.db, ctx.practiceId!) });
  }
  requirePermission(ctx, 'patients:view');
  const transfers = listTransfersForPatient(ctx.db, id).filter(
    (t) => t.practiceId === ctx.practiceId,
  );
  return json({ transfers });
});

const decideSchema = z.object({
  transferId: z.string().min(1),
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z.string().max(1000).optional(),
});

export const POST = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = requirePracticeContext(req);
  requirePermission(ctx, 'transfers:decide');
  const { id } = await params;
  const parsed = decideSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'Invalid transfer decision payload', code: 'VALIDATION' }, 400);
  if (parsed.data.transferId !== id) {
    return json({ error: 'Transfer id mismatch between URL and body', code: 'VALIDATION' }, 400);
  }
  const actor = actorContextFrom(req, ctx);
  const result = await decideTransfer(actor, parsed.data.transferId, parsed.data.decision, parsed.data.note);
  return json(result);
});
