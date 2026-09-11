import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { json, readJson, handler } from '@/lib/api';
import { requirePracticeContext, requirePermission } from '@/lib/auth';
import { setPatientMedicalAid } from '@/services/patients.service';
import { actorContextFrom } from '@/lib/context';

const schema = z.object({
  schemeId: z.string().min(1),
  schemeOptionId: z.string().optional(),
  membershipNumber: z.string().min(3).max(50),
  dependentCode: z.string().max(10).optional(),
  mainMemberName: z.string().max(200).optional(),
});

export const PUT = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = requirePracticeContext(req);
  requirePermission(ctx, 'patients:edit');
  const { id } = await params;
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? 'Invalid medical aid payload', code: 'VALIDATION' }, 400);
  }
  const actor = actorContextFrom(req, ctx);
  await setPatientMedicalAid(actor, id, parsed.data);
  return json({ ok: true });
});
