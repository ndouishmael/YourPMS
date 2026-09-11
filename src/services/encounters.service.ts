/**
 * Encounter (consultation) service: clinical notes, diagnoses, billable items,
 * and the Complete Consultation transition which validates billing info,
 * generates the invoice, and routes the encounter into the billing workflow.
 *
 * Clinical workflow states (separate from financial state):
 *   WAITING -> WITH_DOCTOR -> CONSULTATION_COMPLETE -> AWAITING_BILLING -> CLOSED
 */
import { and, eq, desc, inArray } from 'drizzle-orm';
import type { DB } from '@/db';
import {
  encounters,
  encounterNotes,
  encounterDiagnoses,
  encounterItems,
  patients,
  icd10Codes,
  tariffItems,
  locations,
  practices,
} from '@/db/schema';
import { badRequest, notFound, forbidden, unprocessable } from '@/lib/errors';
import { recordAudit } from './audit.service';
import { maybeFlagPatientTransfer } from './patients.service';
import type { ActorContext } from './scheduling.service';
import { generateInvoiceForEncounter } from './billing.service';

export function clinicalRecord(db: DB, practiceId: string, encounterId: string) {
  const encounter = db.select().from(encounters).where(eq(encounters.id, encounterId)).get();
  if (!encounter || encounter.practiceId !== practiceId) throw notFound('Encounter not found');
  const notes = db
    .select()
    .from(encounterNotes)
    .where(eq(encounterNotes.encounterId, encounterId))
    .all()
    .sort((a, b) => a.version - b.version);
  const diagnoses = db
    .select()
    .from(encounterDiagnoses)
    .where(eq(encounterDiagnoses.encounterId, encounterId))
    .all();
  const items = db.select().from(encounterItems).where(eq(encounterItems.encounterId, encounterId)).all();
  return { encounter, notes, diagnoses, items };
}

async function requireEncounterInStates(
  ctx: ActorContext,
  encounterId: string,
  allowed: string[],
): Promise<typeof encounters.$inferSelect> {
  const encounter = ctx.db.select().from(encounters).where(eq(encounters.id, encounterId)).get();
  if (!encounter || encounter.practiceId !== ctx.practiceId) throw notFound('Encounter not found');
  if (!ctx.locationIds.includes(encounter.locationId)) {
    throw forbidden('You are not authorized for this encounter location');
  }
  if (!allowed.includes(encounter.status)) {
    throw unprocessable(`Not allowed while encounter is ${encounter.status}`);
  }
  return encounter;
}

/** Add or update the clinical note (append-only versions). */
export async function saveClinicalNote(ctx: ActorContext, encounterId: string, note: string) {
  const encounter = await requireEncounterInStates(ctx, encounterId, ['WAITING', 'WITH_DOCTOR']);
  if (!note.trim()) throw badRequest('Clinical note cannot be empty');
  const versions = ctx.db.select().from(encounterNotes).where(eq(encounterNotes.encounterId, encounter.id)).all();
  const nextVersion = versions.length + 1;
  const [saved] = ctx.db
    .insert(encounterNotes)
    .values({ encounterId: encounter.id, version: nextVersion, note: note.trim(), createdByUserId: ctx.actorUserId })
    .returning()
    .all();
  await recordAudit({
    db: ctx.db,
    practiceId: ctx.practiceId,
    actorUserId: ctx.actorUserId,
    actorRole: ctx.actorRole,
    action: 'CLINICAL_NOTE_SAVED',
    entityType: 'encounter',
    entityId: encounter.id,
    metadata: { version: nextVersion },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return saved;
}

export interface DiagnosisInput {
  icd10Code: string;
  isPrimary?: boolean;
}

/** Replace the diagnosis set (validated against the ICD-10 catalogue). */
export async function saveDiagnoses(ctx: ActorContext, encounterId: string, diagnoses: DiagnosisInput[]) {
  const encounter = await requireEncounterInStates(ctx, encounterId, ['WAITING', 'WITH_DOCTOR']);
  if (!diagnoses.length) throw badRequest('At least one diagnosis is required');
  const primaries = diagnoses.filter((d) => d.isPrimary).length;
  if (primaries > 1) throw badRequest('Only one primary diagnosis is allowed');
  for (const d of diagnoses) {
    const code = d.icd10Code.trim().toUpperCase();
    const exists = ctx.db.select().from(icd10Codes).where(eq(icd10Codes.code, code)).get();
    if (!exists) throw badRequest(`Unknown ICD-10 code: ${d.icd10Code}`);
  }
  await ctx.db.transaction((tx) => {
    tx.delete(encounterDiagnoses).where(eq(encounterDiagnoses.encounterId, encounter.id)).run();
    for (const d of diagnoses) {
      tx.insert(encounterDiagnoses)
        .values({ encounterId: encounter.id, icd10Code: d.icd10Code.trim().toUpperCase(), isPrimary: d.isPrimary ?? false })
        .run();
    }
  });
  await recordAudit({
    db: ctx.db,
    practiceId: ctx.practiceId,
    actorUserId: ctx.actorUserId,
    actorRole: ctx.actorRole,
    action: 'DIAGNOSES_SAVED',
    entityType: 'encounter',
    entityId: encounter.id,
    metadata: { codes: diagnoses.map((d) => d.icd10Code) },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return { ok: true };
}

export interface ItemInput {
  tariffCode: string;
  units?: number;
  unitPriceCents?: number;
}

/** Replace the billable item set (validated against the tariff catalogue). */
export async function saveItems(ctx: ActorContext, encounterId: string, items: ItemInput[]) {
  const encounter = await requireEncounterInStates(ctx, encounterId, ['WAITING', 'WITH_DOCTOR']);
  if (!items.length) throw badRequest('At least one billable item is required');
  const prepared: Array<typeof encounterItems.$inferInsert> = [];
  for (const item of items) {
    const code = item.tariffCode.trim().toUpperCase();
    const tariff = ctx.db.select().from(tariffItems).where(eq(tariffItems.code, code)).get();
    if (!tariff) throw badRequest(`Unknown tariff code: ${item.tariffCode}`);
    const units = item.units ?? 1;
    if (!Number.isInteger(units) || units < 1 || units > 100) throw badRequest(`Invalid units for ${code}`);
    const unitPriceCents = item.unitPriceCents ?? tariff.defaultPriceCents;
    if (!Number.isInteger(unitPriceCents) || unitPriceCents < 0) throw badRequest(`Invalid price for ${code}`);
    prepared.push({
      encounterId: encounter.id,
      tariffCode: code,
      description: tariff.description,
      units,
      unitPriceCents,
      amountCents: units * unitPriceCents,
    });
  }
  await ctx.db.transaction((tx) => {
    tx.delete(encounterItems).where(eq(encounterItems.encounterId, encounter.id)).run();
    for (const p of prepared) tx.insert(encounterItems).values(p).run();
  });
  await recordAudit({
    db: ctx.db,
    practiceId: ctx.practiceId,
    actorUserId: ctx.actorUserId,
    actorRole: ctx.actorRole,
    action: 'ENCOUNTER_ITEMS_SAVED',
    entityType: 'encounter',
    entityId: encounter.id,
    metadata: { items: prepared.map((p) => ({ code: p.tariffCode, units: p.units })) },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return { ok: true };
}

/**
 * Complete Consultation:
 *  1. Validate clinical content (note, diagnoses, items).
 *  2. Generate + issue the invoice from encounter items (transactional).
 *  3. Route the encounter into the billing workflow (AWAITING_BILLING).
 *  4. Evaluate the patient-transfer consideration flag.
 */
export async function completeConsultation(ctx: ActorContext, encounterId: string) {
  const encounter = await requireEncounterInStates(ctx, encounterId, ['WITH_DOCTOR']);
  const db = ctx.db;

  const notes = db.select().from(encounterNotes).where(eq(encounterNotes.encounterId, encounter.id)).all();
  if (!notes.length) throw unprocessable('A clinical note is required before completing the consultation');
  const diagnoses = db.select().from(encounterDiagnoses).where(eq(encounterDiagnoses.encounterId, encounter.id)).all();
  if (!diagnoses.length) throw unprocessable('At least one ICD-10 diagnosis is required before completing');
  const items = db.select().from(encounterItems).where(eq(encounterItems.encounterId, encounter.id)).all();
  if (!items.length) throw unprocessable('At least one tariff/billable item is required before completing');

  const patient = db.select().from(patients).where(eq(patients.id, encounter.patientId)).get();
  if (!patient) throw notFound('Patient not found');
  const practice = db.select().from(practices).where(eq(practices.id, ctx.practiceId)).get();
  if (!practice) throw notFound('Practice not found');

  // Generate the invoice and advance the workflow atomically.
  const invoice = await generateInvoiceForEncounter(db, {
    encounter,
    items,
    actorUserId: ctx.actorUserId,
  });

  await recordAudit({
    db,
    practiceId: ctx.practiceId,
    actorUserId: ctx.actorUserId,
    actorRole: ctx.actorRole,
    action: 'CONSULTATION_COMPLETED',
    entityType: 'encounter',
    entityId: encounter.id,
    locationId: encounter.locationId,
    metadata: { patientId: patient.id, invoiceId: invoice.id, totalCents: invoice.totalCents },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });

  // Cross-location transfer consideration (completed encounters only).
  await maybeFlagPatientTransfer(
    {
      db,
      practiceId: ctx.practiceId,
      actorUserId: ctx.actorUserId,
      actorRole: ctx.actorRole,
      locationIds: ctx.locationIds,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    },
    patient,
    encounter.locationId,
    practice.transferThreshold,
  );

  return { encounter, invoice };
}

/** Encounter history for a patient (clinical access required). */
export function getPatientHistory(db: DB, practiceId: string, patientId: string) {
  const rows = db
    .select({ encounter: encounters, location: locations })
    .from(encounters)
    .innerJoin(locations, eq(locations.id, encounters.locationId))
    .where(and(eq(encounters.practiceId, practiceId), eq(encounters.patientId, patientId), inArray(encounters.status, ['CONSULTATION_COMPLETE', 'AWAITING_BILLING', 'CLOSED'])))
    .all()
    .sort((a, b) => (b.encounter.completedAt?.getTime() ?? 0) - (a.encounter.completedAt?.getTime() ?? 0));
  const result = [];
  for (const row of rows) {
    const dx = db.select().from(encounterDiagnoses).where(eq(encounterDiagnoses.encounterId, row.encounter.id)).all();
    const notes = db.select().from(encounterNotes).where(eq(encounterNotes.encounterId, row.encounter.id)).all();
    result.push({ ...row, diagnoses: dx, latestNote: notes[notes.length - 1]?.note ?? null });
  }
  return result;
}

export { desc };
