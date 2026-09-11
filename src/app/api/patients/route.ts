import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { json, readJson, handler } from '@/lib/api';
import { requirePracticeContext, requirePermission } from '@/lib/auth';
import { registerPatient, searchPatients } from '@/services/patients.service';
import { actorContextFrom } from '@/lib/context';

export const GET = handler(async (req: NextRequest) => {
  const ctx = requirePracticeContext(req);
  requirePermission(ctx, 'patients:view');
  const query = req.nextUrl.searchParams.get('q') ?? '';
  const actor = actorContextFrom(req, ctx);
  const patients = searchPatients(actor, query);
  return json({ patients });
});

const createSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be YYYY-MM-DD').optional().or(z.literal('')),
  gender: z.string().max(30).optional().or(z.literal('')),
  phone: z.string().max(30).optional().or(z.literal('')),
  email: z.string().email().max(254).optional().or(z.literal('')),
  idNumber: z.string().max(20).optional().or(z.literal('')),
  address: z.string().max(500).optional().or(z.literal('')),
  notes: z.string().max(2000).optional().or(z.literal('')),
  homeLocationId: z.string().min(1),
});

export const POST = handler(async (req: NextRequest) => {
  const ctx = requirePracticeContext(req);
  requirePermission(ctx, 'patients:create');
  const parsed = createSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? 'Invalid patient payload', code: 'VALIDATION' }, 400);
  }
  const actor = actorContextFrom(req, ctx);
  const patient = await registerPatient(actor, parsed.data);
  return json({ patient }, 201);
});
