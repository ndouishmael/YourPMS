import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { json, readJson, handler } from '@/lib/api';
import { requirePracticeContext, requirePermission } from '@/lib/auth';
import { recordClaimResponse } from '@/services/claims.service';
import { actorContextFrom } from '@/lib/context';

const schema = z.object({
  outcome: z.enum(['ACCEPTED', 'REJECTED', 'PROCESSED', 'FAILED']),
  message: z.string().max(1000).optional(),
  approvedCents: z.number().int().nonnegative().optional(),
  schemePaidCents: z.number().int().nonnegative().optional(),
  patientPortionCents: z.number().int().nonnegative().optional(),
});

export const POST = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = requirePracticeContext(req);
  requirePermission(ctx, 'claims:respond');
  const { id } = await params;
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'Invalid claim response payload', code: 'VALIDATION' }, 400);
  const actor = actorContextFrom(req, ctx);
  await recordClaimResponse(actor, id, parsed.data);
  return json({ ok: true });
});
