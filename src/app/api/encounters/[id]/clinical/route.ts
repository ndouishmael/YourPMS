import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { json, readJson, handler } from '@/lib/api';
import { requirePracticeContext, requirePermission } from '@/lib/auth';
import { saveDiagnoses, saveItems } from '@/services/encounters.service';
import { actorContextFrom } from '@/lib/context';

const schema = z.object({
  diagnoses: z
    .array(z.object({ icd10Code: z.string().min(2).max(10), isPrimary: z.boolean().optional() }))
    .max(20)
    .optional(),
  items: z
    .array(
      z.object({
        tariffCode: z.string().min(2).max(20),
        units: z.number().int().min(1).max(100).optional(),
        unitPriceCents: z.number().int().min(0).optional(),
      }),
    )
    .max(50)
    .optional(),
});

export const PUT = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = requirePracticeContext(req);
  requirePermission(ctx, 'encounter:start');
  const { id } = await params;
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? 'Invalid clinical payload', code: 'VALIDATION' }, 400);
  }
  const actor = actorContextFrom(req, ctx);
  if (parsed.data.diagnoses) await saveDiagnoses(actor, id, parsed.data.diagnoses);
  if (parsed.data.items) await saveItems(actor, id, parsed.data.items);
  return json({ ok: true });
});
