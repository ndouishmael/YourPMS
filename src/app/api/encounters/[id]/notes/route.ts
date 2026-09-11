import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { json, readJson, handler } from '@/lib/api';
import { requirePracticeContext, requirePermission } from '@/lib/auth';
import { saveClinicalNote } from '@/services/encounters.service';
import { actorContextFrom } from '@/lib/context';

const schema = z.object({ note: z.string().min(1).max(20000) });

export const POST = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = requirePracticeContext(req);
  requirePermission(ctx, 'encounter:start');
  const { id } = await params;
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'Clinical note text is required', code: 'VALIDATION' }, 400);
  const actor = actorContextFrom(req, ctx);
  const note = await saveClinicalNote(actor, id, parsed.data.note);
  return json({ note }, 201);
});
