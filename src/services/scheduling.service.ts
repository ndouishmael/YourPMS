/**
 * Scheduling & waiting queue: appointments, walk-in check-in, queue views.
 *
 * Queue/check-in rules:
 * - One active encounter per patient at a time (WAITING / WITH_DOCTOR).
 * - Check-in is location-authorized; cross-location treatment is granted
 *   controlled, audited access to the existing patient record.
 * - Queue state is persisted (encounters table).
 */
import { and, eq, inArray, gte, lte, desc } from 'drizzle-orm';
import type { DB } from '@/db';
import {
  appointments,
  encounters,
  patients,
  locations,
  users,
  practitioners,
} from '@/db/schema';
import { badRequest, notFound, forbidden, conflict, unprocessable } from '@/lib/errors';
import { recordAudit } from './audit.service';
import { grantCrossLocationAccess, type PatientAccessContext } from './patients.service';

export interface ActorContext {
  db: DB;
  practiceId: string;
  actorUserId: string;
  actorRole: string;
  locationIds: string[];
  ip?: string;
  userAgent?: string;
}

/* ------------------------------------------------------------------ */
/* Appointments                                                       */
/* ------------------------------------------------------------------ */

export interface CreateAppointmentInput {
  patientId: string;
  locationId: string;
  practitionerId?: string;
  startsAt: string; // ISO datetime
  durationMinutes?: number;
  reason?: string;
}

export async function createAppointment(ctx: ActorContext, input: CreateAppointmentInput) {
  if (!ctx.locationIds.includes(input.locationId)) {
    throw forbidden('You are not authorized to manage appointments at this location');
  }
  const patient = ctx.db.select().from(patients).where(eq(patients.id, input.patientId)).get();
  if (!patient || patient.practiceId !== ctx.practiceId) throw notFound('Patient not found');
  if (input.practitionerId) {
    const pr = ctx.db.select().from(practitioners).where(eq(practitioners.id, input.practitionerId)).get();
    if (!pr || pr.practiceId !== ctx.practiceId) throw badRequest('Invalid practitioner');
  }
  const startsAt = new Date(input.startsAt);
  if (Number.isNaN(startsAt.getTime())) throw badRequest('Invalid appointment time');
  const duration = input.durationMinutes ?? 15;
  if (!Number.isInteger(duration) || duration < 5 || duration > 480) throw badRequest('Duration must be 5-480 minutes');

  const [appointment] = ctx.db
    .insert(appointments)
    .values({
      practiceId: ctx.practiceId,
      locationId: input.locationId,
      patientId: patient.id,
      practitionerId: input.practitionerId ?? null,
      startsAt,
      durationMinutes: duration,
      reason: input.reason?.trim() || null,
      createdByUserId: ctx.actorUserId,
    })
    .returning()
    .all();

  await recordAudit({
    db: ctx.db,
    practiceId: ctx.practiceId,
    actorUserId: ctx.actorUserId,
    actorRole: ctx.actorRole,
    action: 'APPOINTMENT_CREATED',
    entityType: 'appointment',
    entityId: appointment.id,
    locationId: input.locationId,
    metadata: { patientId: patient.id, startsAt: input.startsAt },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return appointment;
}

export async function updateAppointment(
  ctx: ActorContext,
  appointmentId: string,
  patch: { status?: 'CANCELLED' | 'NO_SHOW' | 'BOOKED'; startsAt?: string; reason?: string },
) {
  const appt = ctx.db.select().from(appointments).where(eq(appointments.id, appointmentId)).get();
  if (!appt || appt.practiceId !== ctx.practiceId) throw notFound('Appointment not found');
  if (!ctx.locationIds.includes(appt.locationId)) {
    throw forbidden('You are not authorized for this appointment location');
  }
  if (appt.status === 'CHECKED_IN' || appt.status === 'COMPLETED') {
    throw unprocessable('Appointment is already in progress or complete');
  }
  const update: Partial<typeof appointments.$inferInsert> = {};
  if (patch.status) update.status = patch.status;
  if (patch.startsAt) {
    const d = new Date(patch.startsAt);
    if (Number.isNaN(d.getTime())) throw badRequest('Invalid appointment time');
    update.startsAt = d;
  }
  if (patch.reason !== undefined) update.reason = patch.reason;
  const [updated] = ctx.db.update(appointments).set(update).where(eq(appointments.id, appt.id)).returning().all();
  await recordAudit({
    db: ctx.db,
    practiceId: ctx.practiceId,
    actorUserId: ctx.actorUserId,
    actorRole: ctx.actorRole,
    action: 'APPOINTMENT_UPDATED',
    entityType: 'appointment',
    entityId: appt.id,
    metadata: { patch: { status: patch.status, startsAt: patch.startsAt } },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return updated;
}

export function listAppointments(ctx: ActorContext, params: { date?: string; locationId?: string }) {
  const conds = [eq(appointments.practiceId, ctx.practiceId)];
  if (params.locationId) {
    if (!ctx.locationIds.includes(params.locationId)) throw forbidden('Unauthorized location');
    conds.push(eq(appointments.locationId, params.locationId));
  } else {
    conds.push(inArray(appointments.locationId, ctx.locationIds));
  }
  if (params.date) {
    const dayStart = new Date(`${params.date}T00:00:00`);
    if (Number.isNaN(dayStart.getTime())) throw badRequest('Invalid date');
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    conds.push(gte(appointments.startsAt, dayStart), lte(appointments.startsAt, dayEnd));
  }
  return ctx.db
    .select({ appointment: appointments, patient: patients })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .where(and(...conds))
    .all()
    .sort((a, b) => a.appointment.startsAt.getTime() - b.appointment.startsAt.getTime());
}

/* ------------------------------------------------------------------ */
/* Check-in & waiting queue                                           */
/* ------------------------------------------------------------------ */

const ACTIVE_ENCOUNTER_STATUSES = ['WAITING', 'WITH_DOCTOR'];

export async function checkInPatient(
  ctx: ActorContext & PatientAccessContext,
  input: { patientId: string; locationId: string; appointmentId?: string; crossLocationReason?: string },
) {
  const { db, practiceId } = ctx;
  if (!ctx.locationIds.includes(input.locationId)) {
    throw forbidden('You are not authorized to check patients in at this location');
  }
  const patient = db.select().from(patients).where(eq(patients.id, input.patientId)).get();
  if (!patient || patient.practiceId !== practiceId) throw notFound('Patient not found');

  let appointment: typeof appointments.$inferSelect | null | undefined = null;
  if (input.appointmentId) {
    appointment = db.select().from(appointments).where(eq(appointments.id, input.appointmentId)).get();
    if (!appointment || appointment.practiceId !== practiceId) throw notFound('Appointment not found');
    if (appointment.patientId !== patient.id) throw badRequest('Appointment does not belong to this patient');
    if (appointment.status === 'CANCELLED') throw unprocessable('Appointment was cancelled');
    if (appointment.status === 'CHECKED_IN' || appointment.status === 'COMPLETED') {
      throw conflict('Appointment already checked in');
    }
  }

  // One active encounter per patient per practice.
  const active = db
    .select()
    .from(encounters)
    .where(and(eq(encounters.patientId, patient.id), inArray(encounters.status, ACTIVE_ENCOUNTER_STATUSES)))
    .get();
  if (active) throw conflict('Patient is already checked in');

  // Cross-location treatment: controlled, audited access to the SAME patient.
  const isCrossLocation = input.locationId !== patient.homeLocationId;
  if (isCrossLocation) {
    await grantCrossLocationAccess(ctx, patient.id, input.locationId, input.crossLocationReason ?? 'Walk-in treatment at alternate location');
  }

  const [encounter] = db
    .insert(encounters)
    .values({
      practiceId,
      locationId: input.locationId,
      patientId: patient.id,
      appointmentId: appointment?.id ?? null,
      status: 'WAITING',
      isCrossLocation,
      createdByUserId: ctx.actorUserId,
    })
    .returning()
    .all();

  if (appointment) {
    db.update(appointments).set({ status: 'CHECKED_IN' }).where(eq(appointments.id, appointment.id)).run();
  }

  await recordAudit({
    db,
    practiceId,
    actorUserId: ctx.actorUserId,
    actorRole: ctx.actorRole,
    action: 'PATIENT_CHECKED_IN',
    entityType: 'encounter',
    entityId: encounter.id,
    locationId: input.locationId,
    metadata: { patientId: patient.id, appointmentId: appointment?.id ?? null, crossLocation: isCrossLocation },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return encounter;
}

export interface QueueView {
  waiting: Array<{ encounterId: string; patientId: string; patientName: string; checkedInAt: Date; isCrossLocation: boolean }>;
  withDoctor: Array<{ encounterId: string; patientId: string; patientName: string; startedAt: Date | null; practitionerName: string | null }>;
  billing: Array<{
    encounterId: string;
    invoiceId: string;
    invoiceNumber: number;
    patientId: string;
    patientName: string;
    totalCents: number;
    paidCents: number;
    balanceCents: number;
    hasClaim: boolean;
    claimStatus: string | null;
  }>;
}

/** Persisted queue state for a location. */
export function getQueueView(ctx: ActorContext, locationId: string): QueueView {
  if (!ctx.locationIds.includes(locationId)) throw forbidden('Unauthorized location');
  const db = ctx.db;

  const waitingRows = db
    .select({ encounter: encounters, patient: patients })
    .from(encounters)
    .innerJoin(patients, eq(patients.id, encounters.patientId))
    .where(and(eq(encounters.locationId, locationId), eq(encounters.status, 'WAITING')))
    .all()
    .sort((a, b) => a.encounter.priority - b.encounter.priority || a.encounter.checkedInAt.getTime() - b.encounter.checkedInAt.getTime());

  const withDoctorRows = db
    .select({ encounter: encounters, patient: patients, practitionerUser: users })
    .from(encounters)
    .innerJoin(patients, eq(patients.id, encounters.patientId))
    .leftJoin(practitioners, eq(practitioners.id, encounters.practitionerId))
    .leftJoin(users, eq(users.id, practitioners.userId))
    .where(and(eq(encounters.locationId, locationId), eq(encounters.status, 'WITH_DOCTOR')))
    .all()
    .sort((a, b) => (a.encounter.startedAt?.getTime() ?? 0) - (b.encounter.startedAt?.getTime() ?? 0));

  const billingRows = db.$client
    .prepare(
      `SELECT e.id AS encounterId, i.id AS invoiceId, i.invoice_number AS invoiceNumber,
              p.id AS patientId, p.first_name AS firstName, p.last_name AS lastName,
              i.total_cents AS totalCents, i.paid_cents AS paidCents, i.adjusted_cents AS adjustedCents,
              (SELECT c.status FROM claims c WHERE c.invoice_id = i.id) AS claimStatus
       FROM encounters e
       JOIN invoices i ON i.encounter_id = e.id AND i.status IN ('ISSUED','PARTIALLY_PAID')
       JOIN patients p ON p.id = e.patient_id
       WHERE e.location_id = ? AND e.status = 'AWAITING_BILLING'
       ORDER BY i.created_at ASC`,
    )
    .all(locationId) as Array<Record<string, unknown>>;

  return {
    waiting: waitingRows.map((r) => ({
      encounterId: r.encounter.id,
      patientId: r.patient.id,
      patientName: `${r.patient.firstName} ${r.patient.lastName}`,
      checkedInAt: r.encounter.checkedInAt,
      isCrossLocation: r.encounter.isCrossLocation,
    })),
    withDoctor: withDoctorRows.map((r) => ({
      encounterId: r.encounter.id,
      patientId: r.patient.id,
      patientName: `${r.patient.firstName} ${r.patient.lastName}`,
      startedAt: r.encounter.startedAt,
      practitionerName: r.practitionerUser ? `Dr ${r.practitionerUser.firstName} ${r.practitionerUser.lastName}` : null,
    })),
    billing: billingRows.map((r) => ({
      encounterId: String(r.encounterId),
      invoiceId: String(r.invoiceId),
      invoiceNumber: Number(r.invoiceNumber),
      patientId: String(r.patientId),
      patientName: `${String(r.firstName)} ${String(r.lastName)}`,
      totalCents: Number(r.totalCents),
      paidCents: Number(r.paidCents),
      balanceCents: Number(r.totalCents) - Number(r.paidCents) - Number(r.adjustedCents),
      hasClaim: r.claimStatus != null,
      claimStatus: r.claimStatus ? String(r.claimStatus) : null,
    })),
  };
}

/** Doctor picks the next patient: WAITING -> WITH_DOCTOR. */
export async function startEncounter(ctx: ActorContext, encounterId: string, practitionerId: string) {
  const encounter = ctx.db.select().from(encounters).where(eq(encounters.id, encounterId)).get();
  if (!encounter || encounter.practiceId !== ctx.practiceId) throw notFound('Encounter not found');
  if (!ctx.locationIds.includes(encounter.locationId)) {
    throw forbidden('You are not authorized for this encounter location');
  }
  if (encounter.status !== 'WAITING') throw unprocessable(`Encounter cannot be started from status ${encounter.status}`);
  const practitioner = ctx.db.select().from(practitioners).where(eq(practitioners.id, practitionerId)).get();
  if (!practitioner || practitioner.practiceId !== ctx.practiceId) throw badRequest('Invalid practitioner');

  const [updated] = ctx.db
    .update(encounters)
    .set({ status: 'WITH_DOCTOR', startedAt: new Date(), practitionerId })
    .where(eq(encounters.id, encounter.id))
    .returning()
    .all();

  await recordAudit({
    db: ctx.db,
    practiceId: ctx.practiceId,
    actorUserId: ctx.actorUserId,
    actorRole: ctx.actorRole,
    action: 'ENCOUNTER_STARTED',
    entityType: 'encounter',
    entityId: encounter.id,
    locationId: encounter.locationId,
    metadata: { patientId: encounter.patientId, practitionerId },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return updated;
}

export function getEncounterDetail(db: DB, practiceId: string, encounterId: string) {
  const row = db
    .select({ encounter: encounters, patient: patients, location: locations })
    .from(encounters)
    .innerJoin(patients, eq(patients.id, encounters.patientId))
    .innerJoin(locations, eq(locations.id, encounters.locationId))
    .where(eq(encounters.id, encounterId))
    .get();
  if (!row || row.encounter.practiceId !== practiceId) throw notFound('Encounter not found');
  return row;
}

export function listRecentEncounters(ctx: ActorContext, limit = 50) {
  return ctx.db
    .select({ encounter: encounters, patient: patients, location: locations })
    .from(encounters)
    .innerJoin(patients, eq(patients.id, encounters.patientId))
    .innerJoin(locations, eq(locations.id, encounters.locationId))
    .where(and(eq(encounters.practiceId, ctx.practiceId), inArray(encounters.locationId, ctx.locationIds)))
    .all()
    .sort((a, b) => b.encounter.createdAt.getTime() - a.encounter.createdAt.getTime())
    .slice(0, limit);
}

export { desc };
