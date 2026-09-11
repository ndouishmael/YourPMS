import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { json, readJson, handler } from '@/lib/api';
import { requirePracticeContext, requirePermission } from '@/lib/auth';
import { getQueueView, checkInPatient } from '@/services/scheduling.service';
import { actorContextFrom } from '@/lib/context';

export const GET = handler(async (req: NextRequest) => {
  const ctx = requirePracticeContext(req);
  requirePermission(ctx, 'queue:manage');
  const locationId = req.nextUrl.searchParams.get('locationId');
  if (!locationId) return json({ error: 'locationId is required', code: 'VALIDATION' }, 400);
  const actor = actorContextFrom(req, ctx);
  const queue = getQueueView(actor, locationId);
  return json({ queue });
});

const checkInSchema = z.object({
  patientId: z.string().min(1),
  locationId: z.string().min(1),
  appointmentId: z.string().optional(),
  crossLocationReason: z.string().max(500).optional(),
});

export const POST = handler(async (req: NextRequest) => {
  const ctx = requirePracticeContext(req);
  requirePermission(ctx, 'queue:manage');
  const parsed = checkInSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'Invalid check-in payload', code: 'VALIDATION' }, 400);
  const actor = actorContextFrom(req, ctx);
  const encounter = await checkInPatient(actor, parsed.data);
  return json({ encounter }, 201);
});
