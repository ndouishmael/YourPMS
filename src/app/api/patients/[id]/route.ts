import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { json, readJson, handler } from '@/lib/api';
import { requirePracticeContext, requirePermission } from '@/lib/auth';
import {
  getPatientAuthorized,
  updatePatient,
  getPatientMedicalAid,
  getPatientEncounterHistory,
  listTransfersForPatient,
  getPatientInvoiceSummary,
  getPatientDiagnosesHistory,
} from '@/services/patients.service';
import { actorContextFrom } from '@/lib/context';

export const GET = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = requirePracticeContext(req);
  requirePermission(ctx, 'patients:view');
  const { id } = await params;
  const actor = actorContextFrom(req, ctx);
  const { patient, assignments, accessibleLocationIds } = getPatientAuthorized(actor, id);
  const medicalAid = getPatientMedicalAid(ctx.db, id);
  const clinical = ctx.permissions.includes('clinical:access');
  return json({
    patient,
    assignments,
    accessibleLocationIds,
    medicalAid: medicalAid
      ? { scheme: medicalAid.scheme.name, option: medicalAid.option?.name ?? null, membershipNumber: medicalAid.aid.membershipNumber, dependentCode: medicalAid.aid.dependentCode, mainMemberName: medicalAid.aid.mainMemberName }
      : null,
    transfers: listTransfersForPatient(ctx.db, id),
    encounters: getPatientEncounterHistory(ctx.db, id).map((e) => ({
      id: e.encounter.id,
      status: e.encounter.status,
      location: e.location.name,
      isCrossLocation: e.encounter.isCrossLocation,
      completedAt: e.encounter.completedAt,
      createdAt: e.encounter.createdAt,
    })),
    invoices: getPatientInvoiceSummary(ctx.db, id),
    diagnosesHistory: clinical ? getPatientDiagnosesHistory(ctx.db, id) : undefined,
  });
});

const patchSchema = z.object({
  firstName: z.string().min(1).max(100).optional(),
  lastName: z.string().min(1).max(100).optional(),
  dateOfBirth: z.string().optional(),
  gender: z.string().max(30).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().max(254).optional(),
  idNumber: z.string().max(20).optional(),
  address: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
});

export const PATCH = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = requirePracticeContext(req);
  requirePermission(ctx, 'patients:edit');
  const { id } = await params;
  const parsed = patchSchema.safeParse(await readJson(req));
  if (!parsed.success) return json({ error: 'Invalid patient update payload', code: 'VALIDATION' }, 400);
  const actor = actorContextFrom(req, ctx);
  const patient = await updatePatient(actor, id, parsed.data);
  return json({ patient });
});
