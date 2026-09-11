/**
 * Patient service: registration, search, detail, medical aid, cross-location
 * access, and the patient-transfer workflow.
 *
 * Patient identity is per-practice, NOT per-location. Cross-location treatment
 * grants controlled access and is audited; after the configured number of
 * completed alternate-location encounters the patient is flagged for transfer
 * consideration (never silently transferred).
 */
import { and, eq, or, sql, like, desc, inArray } from 'drizzle-orm';
import type { DB } from '@/db';
import {
  patients,
  locations,
  patientLocationAssignments,
  patientTransfers,
  patientMedicalAid,
  medicalSchemes,
  medicalSchemeOptions,
  encounters,
  invoices,
  icd10Codes,
} from '@/db/schema';
import { badRequest, notFound, forbidden } from '@/lib/errors';
import { recordAudit } from './audit.service';
import { notifyPractice } from './practice.service';

export interface PatientAccessContext {
  db: DB;
  practiceId: string;
  actorUserId: string;
  actorRole: string;
  /** Locations the actor is authorized for. */
  locationIds: string[];
  ip?: string;
  userAgent?: string;
}

export interface RegisterPatientInput {
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  gender?: string;
  phone?: string;
  email?: string;
  idNumber?: string;
  address?: string;
  notes?: string;
  homeLocationId: string;
}

/**
 * Locations from which the patient can be accessed by this actor:
 * - locations the actor is authorized for, AND
 * - the patient's home location OR a location with an active cross-location assignment.
 */
export function accessibleLocationIdsForPatient(
  ctx: PatientAccessContext,
  patient: { homeLocationId: string },
  assignmentLocationIds: string[],
): string[] {
  const clinicalLocations = new Set([patient.homeLocationId, ...assignmentLocationIds]);
  return ctx.locationIds.filter((l) => clinicalLocations.has(l));
}

function getAssignments(db: DB, patientId: string) {
  return db.select().from(patientLocationAssignments).where(eq(patientLocationAssignments.patientId, patientId)).all();
}

/** Fetch a patient with tenant + location authorization checks. */
export function getPatientAuthorized(ctx: PatientAccessContext, patientId: string) {
  const patient = ctx.db.select().from(patients).where(eq(patients.id, patientId)).get();
  // Tenant isolation: 404 (not 403) for cross-tenant probes — no existence leak.
  if (!patient || patient.practiceId !== ctx.practiceId) throw notFound('Patient not found');
  const assignments = getAssignments(ctx.db, patient.id);
  const accessible = accessibleLocationIdsForPatient(ctx, patient, assignments.map((a) => a.locationId));
  if (accessible.length === 0) {
    throw forbidden('You are not authorized to access this patient');
  }
  return { patient, assignments, accessibleLocationIds: accessible };
}

export async function registerPatient(ctx: PatientAccessContext, input: RegisterPatientInput) {
  if (!input.firstName.trim() || !input.lastName.trim()) throw badRequest('Patient first and last name are required');
  if (!ctx.locationIds.includes(input.homeLocationId)) {
    throw forbidden('You are not authorized to register patients at this location');
  }
  const loc = ctx.db.select().from(locations).where(eq(locations.id, input.homeLocationId)).get();
  if (!loc || loc.practiceId !== ctx.practiceId) throw badRequest('Invalid home location');
  if (input.dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(input.dateOfBirth)) {
    throw badRequest('Date of birth must be an ISO date (YYYY-MM-DD)');
  }

  const [patient] = ctx.db
    .insert(patients)
    .values({
      practiceId: ctx.practiceId,
      homeLocationId: input.homeLocationId,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      dateOfBirth: input.dateOfBirth || null,
      gender: input.gender || null,
      phone: input.phone || null,
      email: input.email || null,
      idNumber: input.idNumber || null,
      address: input.address || null,
      notes: input.notes || null,
      createdByUserId: ctx.actorUserId,
    })
    .returning()
    .all();

  await recordAudit({
    db: ctx.db,
    practiceId: ctx.practiceId,
    actorUserId: ctx.actorUserId,
    actorRole: ctx.actorRole,
    action: 'PATIENT_CREATED',
    entityType: 'patient',
    entityId: patient.id,
    locationId: input.homeLocationId,
    metadata: { name: `${patient.firstName} ${patient.lastName}`, homeLocationId: input.homeLocationId },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return patient;
}

export async function updatePatient(
  ctx: PatientAccessContext,
  patientId: string,
  patch: Partial<RegisterPatientInput>,
) {
  const { patient } = getPatientAuthorized(ctx, patientId);
  const update: Record<string, string | null> = {};
  for (const key of ['firstName', 'lastName', 'dateOfBirth', 'gender', 'phone', 'email', 'idNumber', 'address', 'notes'] as const) {
    if (patch[key] !== undefined) update[key] = patch[key] === '' ? null : patch[key] as string;
  }
  if (patch.firstName !== undefined && !patch.firstName.trim()) throw badRequest('First name cannot be empty');
  if (patch.lastName !== undefined && !patch.lastName.trim()) throw badRequest('Last name cannot be empty');
  if (patch.homeLocationId !== undefined && patch.homeLocationId !== patient.homeLocationId) {
    throw badRequest('Home location changes require the patient transfer workflow');
  }
  const [updated] = ctx.db.update(patients).set(update).where(eq(patients.id, patient.id)).returning().all();
  await recordAudit({
    db: ctx.db,
    practiceId: ctx.practiceId,
    actorUserId: ctx.actorUserId,
    actorRole: ctx.actorRole,
    action: 'PATIENT_UPDATED',
    entityType: 'patient',
    entityId: patient.id,
    metadata: { fields: Object.keys(update) },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return updated;
}

/** Tenant-scoped patient search (name fragments, phone, id number). */
export function searchPatients(ctx: PatientAccessContext, query: string, limit = 50) {
  const q = query.trim();
  if (!q) {
    // No query: patients whose home location the actor can access.
    const rows = ctx.db
      .select()
      .from(patients)
      .where(and(eq(patients.practiceId, ctx.practiceId), inArray(patients.homeLocationId, ctx.locationIds)))
      .all()
      .sort((a, b) => a.lastName.localeCompare(b.lastName))
      .slice(0, limit);
    return rows;
  }
  const pattern = `%${q.replace(/[%_]/g, '')}%`;
  const matched = ctx.db
    .select()
    .from(patients)
    .where(
      and(
        eq(patients.practiceId, ctx.practiceId),
        or(
          like(sql`lower(${patients.firstName})`, pattern.toLowerCase()),
          like(sql`lower(${patients.lastName})`, pattern.toLowerCase()),
          like(sql`lower(coalesce(${patients.phone}, ''))`, pattern.toLowerCase()),
          like(sql`lower(coalesce(${patients.idNumber}, ''))`, pattern.toLowerCase()),
        ),
      ),
    )
    .all()
    .slice(0, limit * 3);

  // Location visibility: only patients accessible from the actor's locations.
  const assignmentRows = ctx.db
    .select()
    .from(patientLocationAssignments)
    .where(
      inArray(
        patientLocationAssignments.patientId,
        matched.map((p) => p.id),
      ),
    )
    .all();
  const visible = matched.filter((p) => {
    const locs = new Set([p.homeLocationId, ...assignmentRows.filter((a) => a.patientId === p.id).map((a) => a.locationId)]);
    return ctx.locationIds.some((l) => locs.has(l));
  });
  return visible.slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Cross-location access                                              */
/* ------------------------------------------------------------------ */

/**
 * Grant temporary cross-location access for a patient treated outside their
 * home location. Controlled + audited; does not duplicate the patient.
 */
export async function grantCrossLocationAccess(
  ctx: PatientAccessContext,
  patientId: string,
  treatmentLocationId: string,
  reason?: string,
) {
  const patient = ctx.db.select().from(patients).where(eq(patients.id, patientId)).get();
  if (!patient || patient.practiceId !== ctx.practiceId) throw notFound('Patient not found');
  const loc = ctx.db.select().from(locations).where(eq(locations.id, treatmentLocationId)).get();
  if (!loc || loc.practiceId !== ctx.practiceId) throw badRequest('Invalid treatment location');
  if (!ctx.locationIds.includes(treatmentLocationId)) {
    throw forbidden('You are not authorized for the treatment location');
  }
  if (treatmentLocationId === patient.homeLocationId) {
    throw badRequest('Treatment location is the patient home location');
  }
  const existing = ctx.db
    .select()
    .from(patientLocationAssignments)
    .where(and(eq(patientLocationAssignments.patientId, patientId), eq(patientLocationAssignments.locationId, treatmentLocationId)))
    .get();
  if (existing) return existing;

  const [assignment] = ctx.db
    .insert(patientLocationAssignments)
    .values({
      patientId,
      locationId: treatmentLocationId,
      grantedByUserId: ctx.actorUserId,
      reason: reason ?? null,
    })
    .returning()
    .all();

  await recordAudit({
    db: ctx.db,
    practiceId: ctx.practiceId,
    actorUserId: ctx.actorUserId,
    actorRole: ctx.actorRole,
    action: 'PATIENT_CROSS_LOCATION_ACCESS',
    entityType: 'patient',
    entityId: patientId,
    locationId: treatmentLocationId,
    metadata: { homeLocationId: patient.homeLocationId, reason: reason ?? null },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return assignment;
}

/* ------------------------------------------------------------------ */
/* Patient transfer workflow                                          */
/* ------------------------------------------------------------------ */

const COMPLETED_ENCOUNTER_STATUSES = ['CONSULTATION_COMPLETE', 'AWAITING_BILLING', 'CLOSED'];

/** Completed clinical encounters for the patient at a given location. */
export function completedEncountersAtLocation(db: DB, patientId: string, locationId: string) {
  return db
    .select()
    .from(encounters)
    .where(
      and(
        eq(encounters.patientId, patientId),
        eq(encounters.locationId, locationId),
        inArray(encounters.status, COMPLETED_ENCOUNTER_STATUSES),
      ),
    )
    .all();
}

/**
 * Called after a consultation completes at an alternate location. When the
 * number of completed alternate-location encounters reaches the practice
 * threshold, flag the patient for transfer consideration (PENDING approval).
 */
export async function maybeFlagPatientTransfer(
  ctx: PatientAccessContext,
  patient: { id: string; homeLocationId: string; practiceId: string },
  encounterLocationId: string,
  threshold: number,
) {
  if (encounterLocationId === patient.homeLocationId) return null;
  const completed = completedEncountersAtLocation(ctx.db, patient.id, encounterLocationId);
  if (completed.length < threshold) return null;

  // Already pending or approved for this target location?
  const pendingOrApproved = ctx.db
    .select()
    .from(patientTransfers)
    .where(
      and(
        eq(patientTransfers.patientId, patient.id),
        eq(patientTransfers.toLocationId, encounterLocationId),
        or(eq(patientTransfers.status, 'PENDING'), eq(patientTransfers.status, 'APPROVED')),
      ),
    )
    .get();
  if (pendingOrApproved) return null;

  // Re-flag only if more alternate encounters happened since the last flag.
  const lastFlag = ctx.db
    .select()
    .from(patientTransfers)
    .where(and(eq(patientTransfers.patientId, patient.id), eq(patientTransfers.toLocationId, encounterLocationId)))
    .all()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (lastFlag && (lastFlag.triggerEncounterCount ?? 0) >= completed.length) return null;

  const [transfer] = ctx.db
    .insert(patientTransfers)
    .values({
      patientId: patient.id,
      practiceId: patient.practiceId,
      fromLocationId: patient.homeLocationId,
      toLocationId: encounterLocationId,
      status: 'PENDING',
      triggerEncounterCount: completed.length,
      reason: `Patient has ${completed.length} completed encounters at an alternate location (threshold ${threshold}).`,
    })
    .returning()
    .all();

  await recordAudit({
    db: ctx.db,
    practiceId: ctx.practiceId,
    actorUserId: ctx.actorUserId,
    actorRole: ctx.actorRole,
    action: 'PATIENT_TRANSFER_FLAGGED',
    entityType: 'patient_transfer',
    entityId: transfer.id,
    metadata: { patientId: patient.id, from: patient.homeLocationId, to: encounterLocationId, completedEncounters: completed.length },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  notifyPractice(ctx.db, {
    practiceId: ctx.practiceId,
    type: 'TRANSFER_FLAG',
    title: 'Patient transfer consideration',
    body: `${completed.length} completed encounters at an alternate location — confirm or reject the transfer.`,
    linkPath: `/patients/${patient.id}`,
  });
  return transfer;
}

export function listTransfersForPatient(db: DB, patientId: string) {
  return db
    .select()
    .from(patientTransfers)
    .where(eq(patientTransfers.patientId, patientId))
    .all()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function listPendingTransfers(db: DB, practiceId: string) {
  return db
    .select({ transfer: patientTransfers, patient: patients })
    .from(patientTransfers)
    .innerJoin(patients, eq(patients.id, patientTransfers.patientId))
    .where(and(eq(patientTransfers.practiceId, practiceId), eq(patientTransfers.status, 'PENDING')))
    .all();
}

/**
 * Confirm or reject a transfer. Only authorized users (transfers:decide) may
 * decide. Approval moves the patient's home location; history is preserved.
 */
export async function decideTransfer(
  ctx: PatientAccessContext,
  transferId: string,
  decision: 'APPROVE' | 'REJECT',
  note?: string,
) {
  const transfer = ctx.db.select().from(patientTransfers).where(eq(patientTransfers.id, transferId)).get();
  if (!transfer || transfer.practiceId !== ctx.practiceId) throw notFound('Transfer not found');
  if (transfer.status !== 'PENDING') throw badRequest('Transfer has already been decided');

  const patient = ctx.db.select().from(patients).where(eq(patients.id, transfer.patientId)).get();
  if (!patient) throw notFound('Patient not found');
  if (patient.homeLocationId !== transfer.fromLocationId) {
    throw badRequest('Patient home location changed since the flag was raised');
  }

  if (decision === 'APPROVE') {
    ctx.db.transaction((tx) => {
      tx.update(patients).set({ homeLocationId: transfer.toLocationId }).where(eq(patients.id, patient.id)).run();
      tx.update(patientTransfers)
        .set({ status: 'APPROVED', approvedByUserId: ctx.actorUserId, decidedAt: new Date(), decisionNote: note ?? null })
        .where(eq(patientTransfers.id, transfer.id))
        .run();
    });
  } else {
    ctx.db
      .update(patientTransfers)
      .set({ status: 'REJECTED', decidedAt: new Date(), decisionNote: note ?? null })
      .where(eq(patientTransfers.id, transfer.id))
      .run();
  }

  await recordAudit({
    db: ctx.db,
    practiceId: ctx.practiceId,
    actorUserId: ctx.actorUserId,
    actorRole: ctx.actorRole,
    action: decision === 'APPROVE' ? 'PATIENT_TRANSFERRED' : 'PATIENT_TRANSFER_REJECTED',
    entityType: 'patient_transfer',
    entityId: transfer.id,
    metadata: {
      patientId: patient.id,
      fromLocationId: transfer.fromLocationId,
      toLocationId: transfer.toLocationId,
      note: note ?? null,
    },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  notifyPractice(ctx.db, {
    practiceId: ctx.practiceId,
    type: 'TRANSFER_DECIDED',
    title: decision === 'APPROVE' ? 'Patient transferred' : 'Transfer rejected',
    body: `Transfer decision recorded for patient ${patient.firstName} ${patient.lastName}.`,
    linkPath: `/patients/${patient.id}`,
  });
  return { ok: true, decision };
}

/* ------------------------------------------------------------------ */
/* Medical aid                                                        */
/* ------------------------------------------------------------------ */

export async function setPatientMedicalAid(
  ctx: PatientAccessContext,
  patientId: string,
  input: {
    schemeId: string;
    schemeOptionId?: string;
    membershipNumber: string;
    dependentCode?: string;
    mainMemberName?: string;
  },
) {
  const { patient } = getPatientAuthorized(ctx, patientId);
  const scheme = ctx.db.select().from(medicalSchemes).where(eq(medicalSchemes.id, input.schemeId)).get();
  if (!scheme) throw badRequest('Unknown medical scheme');
  if (input.schemeOptionId) {
    const opt = ctx.db
      .select()
      .from(medicalSchemeOptions)
      .where(eq(medicalSchemeOptions.id, input.schemeOptionId))
      .get();
    if (!opt || opt.schemeId !== scheme.id) throw badRequest('Invalid scheme option');
  }
  if (!input.membershipNumber.trim()) throw badRequest('Membership number is required');

  const existing = ctx.db.select().from(patientMedicalAid).where(eq(patientMedicalAid.patientId, patient.id)).get();
  const values = {
    patientId: patient.id,
    schemeId: scheme.id,
    schemeOptionId: input.schemeOptionId ?? null,
    membershipNumber: input.membershipNumber.trim(),
    dependentCode: input.dependentCode?.trim() || null,
    mainMemberName: input.mainMemberName?.trim() || null,
  };
  if (existing) {
    ctx.db.update(patientMedicalAid).set(values).where(eq(patientMedicalAid.id, existing.id)).run();
  } else {
    ctx.db.insert(patientMedicalAid).values(values).run();
  }
  await recordAudit({
    db: ctx.db,
    practiceId: ctx.practiceId,
    actorUserId: ctx.actorUserId,
    actorRole: ctx.actorRole,
    action: 'PATIENT_MEDICAL_AID_SET',
    entityType: 'patient',
    entityId: patient.id,
    metadata: { scheme: scheme.name },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return { ok: true };
}

export function getPatientMedicalAid(db: DB, patientId: string) {
  return db
    .select({ aid: patientMedicalAid, scheme: medicalSchemes, option: medicalSchemeOptions })
    .from(patientMedicalAid)
    .innerJoin(medicalSchemes, eq(medicalSchemes.id, patientMedicalAid.schemeId))
    .leftJoin(medicalSchemeOptions, eq(medicalSchemeOptions.id, patientMedicalAid.schemeOptionId))
    .where(eq(patientMedicalAid.patientId, patientId))
    .get();
}

/* ------------------------------------------------------------------ */
/* Patient detail view                                                */
/* ------------------------------------------------------------------ */

export function getPatientEncounterHistory(db: DB, patientId: string) {
  return db
    .select({ encounter: encounters, location: locations })
    .from(encounters)
    .innerJoin(locations, eq(locations.id, encounters.locationId))
    .where(eq(encounters.patientId, patientId))
    .all()
    .sort((a, b) => b.encounter.createdAt.getTime() - a.encounter.createdAt.getTime());
}

export function getPatientInvoiceSummary(db: DB, patientId: string) {
  return db
    .select()
    .from(invoices)
    .where(eq(invoices.patientId, patientId))
    .all()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function getPatientDiagnosesHistory(db: DB, patientId: string, limit = 200) {
  // Direct SQL to avoid circular import with encounters service.
  const rows = db.$client
    .prepare(
      `SELECT ed.icd10_code AS code, icd.description AS description, e.id AS encounterId, e.completed_at AS completedAt
       FROM encounter_diagnoses ed
       JOIN encounters e ON e.id = ed.encounter_id
       JOIN icd10_codes icd ON icd.code = ed.icd10_code
       WHERE e.patient_id = ? AND e.status IN ('CONSULTATION_COMPLETE','AWAITING_BILLING','CLOSED')
       ORDER BY e.completed_at DESC LIMIT ?`,
    )
    .all(patientId, limit);
  return rows as Array<{ code: string; description: string; encounterId: string; completedAt: number | null }>;
}

export function searchIcd10(db: DB, query: string, limit = 20) {
  const q = query.trim();
  if (!q) return [];
  const pattern = `%${q.replace(/[%_]/g, '')}%`;
  return db
    .select()
    .from(icd10Codes)
    .where(or(like(sql`lower(${icd10Codes.code})`, q.toLowerCase()), like(sql`lower(${icd10Codes.description})`, pattern.toLowerCase())))
    .all()
    .slice(0, limit);
}

export { desc };
