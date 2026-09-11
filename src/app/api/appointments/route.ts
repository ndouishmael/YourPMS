import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { json, readJson, handler } from '@/lib/api';
import { requirePracticeContext, requirePermission } from '@/lib/auth';
import { createAppointment, listAppointments, updateAppointment } from '@/services/scheduling.service';
import { actorContextFrom } from '@/lib/context';

export const GET = handler(async (req: NextRequest) => {
  const ctx = requirePracticeContext(req);
  requirePermission(ctx, 'appointments:manage');
  const actor = actorContextFrom(req, ctx);
  const appointments = listAppointments(actor, {
    date: req.nextUrl.searchParams.get('date') ?? undefined,
    locationId: req.nextUrl.searchParams.get('locationId') ?? undefined,
  });
  return json({ appointments });
});

const createSchema = z.object({
  patientId: z.string().min(1),
  locationId: z.string().min(1),
  practitionerId: z.string().optional(),
  startsAt: z.string().min(10),
  durationMinutes: z.number().int().min(5).max(480).optional(),
  reason: z.string().max(500).optional(),
});

export const POST = handler(async (req: NextRequest) => {
  const ctx = requirePracticeContext(req);
  requirePermission(ctx, 'appointments:manage');
  const parsed = createSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'Invalid appointment payload', code: 'VALIDATION' }, 400);
  const actor = actorContextFrom(req, ctx);
  const appointment = await createAppointment(actor, parsed.data);
  return json({ appointment }, 201);
});

const patchSchema = z.object({
  status: z.enum(['BOOKED', 'CANCELLED', 'NO_SHOW']).optional(),
  startsAt: z.string().optional(),
});

export const PATCH = handler(async (req: NextRequest) => {
  const ctx = requirePracticeContext(req);
  requirePermission(ctx, 'appointments:manage');
  const body = await readJson<{ id?: string }>(req);
  if (!body.id) return json({ error: 'Appointment id is required', code: 'VALIDATION' }, 400);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return json({ error: 'Invalid appointment update payload', code: 'VALIDATION' }, 400);
  const actor = actorContextFrom(req, ctx);
  const appointment = await updateAppointment(actor, body.id, parsed.data);
  return json({ appointment });
});
