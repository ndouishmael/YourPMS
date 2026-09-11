/**
 * YourPMS database schema.
 *
 * Multi-tenancy: every tenant-owned row carries `practice_id`. All service-layer
 * queries scope by the practice resolved from the authenticated session — never
 * from client input. Money is stored as integer cents (ZAR).
 */
import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/* ------------------------------------------------------------------ */
/* Shared column helpers                                              */
/* ------------------------------------------------------------------ */

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => newId('id'));

/** Prefixed random 128-bit identifier (non-enumerable, opaque). */
export function newId(prefix: string): string {
  const a = crypto.getRandomValues(new Uint8Array(16));
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (const b of a) s += alphabet[b % alphabet.length];
  return `${prefix}_${s}`;
}

const createdAt = () => integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date());
const updatedAt = () => integer('updated_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()).$onUpdate(() => new Date());

/* ------------------------------------------------------------------ */
/* Identity & access                                                  */
/* ------------------------------------------------------------------ */

export const users = sqliteTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    /** null for practice users; 'PLATFORM_ADMIN' for platform administrators. */
    platformRole: text('platform_role'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_email_uq').on(sql`lower(${t.email})`)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the opaque session token; the raw token only lives in the cookie. */
    tokenHash: text('token_hash').notNull(),
    /** Random token echoed back via x-csrf-token header (double submit). */
    csrfToken: text('csrf_token').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    /** Set when a platform admin enters a practice in scoped support mode. */
    supportGrantId: text('support_grant_id'),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_uq').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
  ],
);

export const securityEvents = sqliteTable(
  'security_events',
  {
    id: id(),
    type: text('type').notNull(), // LOGIN_FAILED, RATE_LIMITED, CSRF_REJECTED, ORIGIN_REJECTED, ...
    userId: text('user_id'),
    email: text('email'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    detail: text('detail'),
    createdAt: createdAt(),
  },
  (t) => [index('security_events_type_idx').on(t.type, t.createdAt)],
);

/* ------------------------------------------------------------------ */
/* Practices, locations, staff                                        */
/* ------------------------------------------------------------------ */

export const practices = sqliteTable(
  'practices',
  {
    id: newIdCol('prac'),
    name: text('name').notNull(),
    /** South African practice number (K-number style). */
    practiceNumber: text('practice_number').notNull(),
    status: text('status').notNull().default('ACTIVE'), // ACTIVE | SUSPENDED
    vatRateBps: integer('vat_rate_bps').notNull().default(0),
    /** Patient-transfer consideration threshold (completed alternate-location encounters). */
    transferThreshold: integer('transfer_threshold').notNull().default(2),
    /** Claims routing: adapter id, provider-independent core. */
    claimsAdapterId: text('claims_adapter_id').notNull().default('manual'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('practices_number_uq').on(t.practiceNumber)],
);

function newIdCol(prefix: string) {
  return text('id')
    .primaryKey()
    .$defaultFn(() => newId(prefix));
}

export const locations = sqliteTable(
  'locations',
  {
    id: newIdCol('loc'),
    practiceId: text('practice_id')
      .notNull()
      .references(() => practices.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('locations_practice_name_uq').on(t.practiceId, sql`lower(${t.name})`),
    index('locations_practice_idx').on(t.practiceId),
  ],
);

/** Membership of a user in a practice with a role. */
export const memberships = sqliteTable(
  'memberships',
  {
    id: newIdCol('mem'),
    practiceId: text('practice_id')
      .notNull()
      .references(() => practices.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** OWNER | MANAGER | RECEPTIONIST | PRACTITIONER */
    role: text('role').notNull(),
    status: text('status').notNull().default('ACTIVE'), // ACTIVE | SUSPENDED
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('memberships_practice_user_uq').on(t.practiceId, t.userId),
    index('memberships_user_idx').on(t.userId),
  ],
);

/** Per-location authorization for a practice membership. */
export const locationMemberships = sqliteTable(
  'location_memberships',
  {
    id: newIdCol('lm'),
    membershipId: text('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    locationId: text('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('location_memberships_uq').on(t.membershipId, t.locationId),
    index('location_memberships_location_idx').on(t.locationId),
  ],
);

export const practitioners = sqliteTable(
  'practitioners',
  {
    id: newIdCol('pr'),
    practiceId: text('practice_id')
      .notNull()
      .references(() => practices.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    hpcsaNumber: text('hpcsa_number'),
    discipline: text('discipline').notNull().default('General Practitioner'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('practitioners_user_practice_uq').on(t.practiceId, t.userId),
    index('practitioners_practice_idx').on(t.practiceId),
  ],
);

export const invitations = sqliteTable(
  'invitations',
  {
    id: newIdCol('inv'),
    practiceId: text('practice_id')
      .notNull()
      .references(() => practices.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    role: text('role').notNull(), // MANAGER | RECEPTIONIST | PRACTITIONER
    locationIds: text('location_ids').notNull().default('[]'), // JSON array
    /** SHA-256 of the invitation token sent by email. */
    tokenHash: text('token_hash').notNull(),
    invitedByUserId: text('invited_by_user_id')
      .notNull()
      .references(() => users.id),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    acceptedAt: integer('accepted_at', { mode: 'timestamp_ms' }),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('invitations_token_uq').on(t.tokenHash),
    index('invitations_practice_email_idx').on(t.practiceId, sql`lower(${t.email})`),
  ],
);

/* ------------------------------------------------------------------ */
/* Patients                                                           */
/* ------------------------------------------------------------------ */

export const patients = sqliteTable(
  'patients',
  {
    id: newIdCol('pat'),
    practiceId: text('practice_id')
      .notNull()
      .references(() => practices.id, { onDelete: 'cascade' }),
    homeLocationId: text('home_location_id')
      .notNull()
      .references(() => locations.id),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    dateOfBirth: text('date_of_birth'), // ISO date string
    gender: text('gender'),
    phone: text('phone'),
    email: text('email'),
    idNumber: text('id_number'),
    address: text('address'),
    notes: text('notes'),
    createdByUserId: text('created_by_user_id').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('patients_practice_name_idx').on(t.practiceId, t.lastName, t.firstName),
    index('patients_practice_home_loc_idx').on(t.practiceId, t.homeLocationId),
  ],
);

/** Temporary cross-location access grant (controlled, auditable). */
export const patientLocationAssignments = sqliteTable(
  'patient_location_assignments',
  {
    id: newIdCol('pla'),
    patientId: text('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    locationId: text('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    grantedByUserId: text('granted_by_user_id')
      .notNull()
      .references(() => users.id),
    reason: text('reason'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('patient_location_assignments_uq').on(t.patientId, t.locationId)],
);

export const patientTransfers = sqliteTable(
  'patient_transfers',
  {
    id: newIdCol('pt'),
    patientId: text('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    practiceId: text('practice_id')
      .notNull()
      .references(() => practices.id, { onDelete: 'cascade' }),
    fromLocationId: text('from_location_id')
      .notNull()
      .references(() => locations.id),
    toLocationId: text('to_location_id')
      .notNull()
      .references(() => locations.id),
    status: text('status').notNull().default('PENDING'), // PENDING | APPROVED | REJECTED
    /** completed alternate-location encounters at flag time */
    triggerEncounterCount: integer('trigger_encounter_count'),
    requestedByUserId: text('requested_by_user_id').references(() => users.id),
    approvedByUserId: text('approved_by_user_id').references(() => users.id),
    reason: text('reason'),
    decisionNote: text('decision_note'),
    decidedAt: integer('decided_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
  },
  (t) => [index('patient_transfers_patient_idx').on(t.patientId, t.status)],
);

export const patientMedicalAid = sqliteTable(
  'patient_medical_aid',
  {
    id: newIdCol('pma'),
    patientId: text('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    schemeId: text('scheme_id')
      .notNull()
      .references(() => medicalSchemes.id),
    schemeOptionId: text('scheme_option_id').references(() => medicalSchemeOptions.id),
    membershipNumber: text('membership_number').notNull(),
    dependentCode: text('dependent_code'),
    mainMemberName: text('main_member_name'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('patient_medical_aid_uq').on(t.patientId)],
);

/* ------------------------------------------------------------------ */
/* Catalogues: schemes, ICD-10, tariffs                               */
/* ------------------------------------------------------------------ */

export const medicalSchemes = sqliteTable(
  'medical_schemes',
  {
    id: newIdCol('sch'),
    name: text('name').notNull(),
    code: text('code').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [uniqueIndex('medical_schemes_code_uq').on(t.code)],
);

export const medicalSchemeOptions = sqliteTable(
  'medical_scheme_options',
  {
    id: newIdCol('sco'),
    schemeId: text('scheme_id')
      .notNull()
      .references(() => medicalSchemes.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code').notNull(),
  },
  (t) => [uniqueIndex('medical_scheme_options_uq').on(t.schemeId, t.code)],
);

export const icd10Codes = sqliteTable(
  'icd10_codes',
  {
    code: text('code').primaryKey(),
    description: text('description').notNull(),
    chapter: text('chapter'),
  },
  (t) => [index('icd10_description_idx').on(t.description)],
);

export const tariffItems = sqliteTable(
  'tariff_items',
  {
    id: newIdCol('tar'),
    code: text('code').notNull(),
    description: text('description').notNull(),
    /** Default price in cents (practice may override per line). */
    defaultPriceCents: integer('default_price_cents').notNull().default(0),
    category: text('category').notNull().default('CONSULTATION'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [uniqueIndex('tariff_items_code_uq').on(t.code)],
);

/* ------------------------------------------------------------------ */
/* Appointments & encounters                                          */
/* ------------------------------------------------------------------ */

export const appointments = sqliteTable(
  'appointments',
  {
    id: newIdCol('appt'),
    practiceId: text('practice_id')
      .notNull()
      .references(() => practices.id, { onDelete: 'cascade' }),
    locationId: text('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    patientId: text('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    practitionerId: text('practitioner_id').references(() => practitioners.id),
    startsAt: integer('starts_at', { mode: 'timestamp_ms' }).notNull(),
    durationMinutes: integer('duration_minutes').notNull().default(15),
    status: text('status').notNull().default('BOOKED'), // BOOKED | CHECKED_IN | COMPLETED | CANCELLED | NO_SHOW
    reason: text('reason'),
    createdByUserId: text('created_by_user_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('appointments_practice_loc_time_idx').on(t.practiceId, t.locationId, t.startsAt),
    index('appointments_patient_idx').on(t.patientId),
  ],
);

export const encounters = sqliteTable(
  'encounters',
  {
    id: newIdCol('enc'),
    practiceId: text('practice_id')
      .notNull()
      .references(() => practices.id, { onDelete: 'cascade' }),
    locationId: text('location_id')
      .notNull()
      .references(() => locations.id, { onDelete: 'cascade' }),
    patientId: text('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    practitionerId: text('practitioner_id').references(() => practitioners.id),
    appointmentId: text('appointment_id').references(() => appointments.id),
    /**
     * Clinical workflow state, kept separate from financial state:
     * WAITING -> WITH_DOCTOR -> CONSULTATION_COMPLETE -> AWAITING_BILLING -> CLOSED
     */
    status: text('status').notNull().default('WAITING'),
    priority: integer('priority').notNull().default(0),
    checkedInAt: integer('checked_in_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    completedAt: integer('completed_at', { mode: 'timestamp_ms' }),
    closedAt: integer('closed_at', { mode: 'timestamp_ms' }),
    /** True when treated at a location other than the patient's home location. */
    isCrossLocation: integer('is_cross_location', { mode: 'boolean' }).notNull().default(false),
    createdByUserId: text('created_by_user_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('encounters_practice_status_idx').on(t.practiceId, t.status),
    index('encounters_location_status_idx').on(t.locationId, t.status),
    index('encounters_patient_idx').on(t.patientId),
    index('encounters_practice_patient_loc_idx').on(t.practiceId, t.patientId, t.locationId),
  ],
);

export const encounterNotes = sqliteTable(
  'encounter_notes',
  {
    id: newIdCol('note'),
    encounterId: text('encounter_id')
      .notNull()
      .references(() => encounters.id, { onDelete: 'cascade' }),
    /** Versioned clinical notes — edits append new versions, history preserved. */
    version: integer('version').notNull().default(1),
    note: text('note').notNull(),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('encounter_notes_version_uq').on(t.encounterId, t.version)],
);

export const encounterDiagnoses = sqliteTable(
  'encounter_diagnoses',
  {
    id: newIdCol('dx'),
    encounterId: text('encounter_id')
      .notNull()
      .references(() => encounters.id, { onDelete: 'cascade' }),
    icd10Code: text('icd10_code').notNull().references(() => icd10Codes.code),
    isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('encounter_diagnoses_enc_idx').on(t.encounterId)],
);

/** Billable items recorded during consultation (tariff/procedure lines). */
export const encounterItems = sqliteTable(
  'encounter_items',
  {
    id: newIdCol('item'),
    encounterId: text('encounter_id')
      .notNull()
      .references(() => encounters.id, { onDelete: 'cascade' }),
    tariffCode: text('tariff_code').notNull(),
    description: text('description').notNull(),
    units: integer('units').notNull().default(1),
    unitPriceCents: integer('unit_price_cents').notNull(),
    amountCents: integer('amount_cents').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('encounter_items_enc_idx').on(t.encounterId)],
);

/* ------------------------------------------------------------------ */
/* Billing: invoices, payments, claims                                */
/* ------------------------------------------------------------------ */

export const invoices = sqliteTable(
  'invoices',
  {
    id: newIdCol('inv'),
    practiceId: text('practice_id')
      .notNull()
      .references(() => practices.id, { onDelete: 'cascade' }),
    locationId: text('location_id')
      .notNull()
      .references(() => locations.id),
    encounterId: text('encounter_id')
      .notNull()
      .references(() => encounters.id),
    patientId: text('patient_id')
      .notNull()
      .references(() => patients.id),
    /** Human-readable sequence, unique per practice. */
    invoiceNumber: integer('invoice_number').notNull(),
    status: text('status').notNull().default('DRAFT'), // DRAFT | ISSUED | PARTIALLY_PAID | PAID | VOID | ADJUSTED
    subtotalCents: integer('subtotal_cents').notNull().default(0),
    totalCents: integer('total_cents').notNull().default(0),
    /** Sum of ACTIVE payments. */
    paidCents: integer('paid_cents').notNull().default(0),
    /** Sum of adjustments (discounts/write-offs). */
    adjustedCents: integer('adjusted_cents').notNull().default(0),
    issuedAt: integer('issued_at', { mode: 'timestamp_ms' }),
    voidedAt: integer('voided_at', { mode: 'timestamp_ms' }),
    voidReason: text('void_reason'),
    createdByUserId: text('created_by_user_id').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('invoices_practice_number_uq').on(t.practiceId, t.invoiceNumber),
    index('invoices_practice_status_idx').on(t.practiceId, t.status),
    index('invoices_encounter_idx').on(t.encounterId),
    index('invoices_patient_idx').on(t.patientId),
  ],
);

export const invoiceLines = sqliteTable(
  'invoice_lines',
  {
    id: newIdCol('inl'),
    invoiceId: text('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    tariffCode: text('tariff_code').notNull(),
    description: text('description').notNull(),
    units: integer('units').notNull().default(1),
    unitPriceCents: integer('unit_price_cents').notNull(),
    amountCents: integer('amount_cents').notNull(),
  },
  (t) => [index('invoice_lines_invoice_idx').on(t.invoiceId)],
);

export const payments = sqliteTable(
  'payments',
  {
    id: newIdCol('pay'),
    practiceId: text('practice_id')
      .notNull()
      .references(() => practices.id, { onDelete: 'cascade' }),
    invoiceId: text('invoice_id')
      .notNull()
      .references(() => invoices.id),
    /** Positive integer cents actually received. */
    amountCents: integer('amount_cents').notNull(),
    method: text('method').notNull(), // CASH | CARD | EFT
    payerType: text('payer_type').notNull().default('PATIENT'), // PATIENT | MEDICAL_AID
    status: text('status').notNull().default('ACTIVE'), // ACTIVE | REVERSED
    reference: text('reference'),
    receivedByUserId: text('received_by_user_id')
      .notNull()
      .references(() => users.id),
    receivedAt: integer('received_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
    reversedAt: integer('reversed_at', { mode: 'timestamp_ms' }),
    reversedByUserId: text('reversed_by_user_id').references(() => users.id),
    reversalReason: text('reversal_reason'),
    /** Link to the medical-aid claim payment this settles, when applicable. */
    claimId: text('claim_id'),
  },
  (t) => [
    index('payments_invoice_idx').on(t.invoiceId),
    index('payments_practice_idx').on(t.practiceId, t.receivedAt),
  ],
);

export const paymentAdjustments = sqliteTable(
  'payment_adjustments',
  {
    id: newIdCol('adj'),
    practiceId: text('practice_id')
      .notNull()
      .references(() => practices.id, { onDelete: 'cascade' }),
    invoiceId: text('invoice_id')
      .notNull()
      .references(() => invoices.id),
    /** Negative cents reduce the balance (discount / write-off / correction). */
    amountCents: integer('amount_cents').notNull(),
    type: text('type').notNull(), // DISCOUNT | WRITE_OFF | CORRECTION
    reason: text('reason').notNull(),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('payment_adjustments_invoice_idx').on(t.invoiceId)],
);

export const claims = sqliteTable(
  'claims',
  {
    id: newIdCol('clm'),
    practiceId: text('practice_id')
      .notNull()
      .references(() => practices.id, { onDelete: 'cascade' }),
    invoiceId: text('invoice_id')
      .notNull()
      .references(() => invoices.id),
    encounterId: text('encounter_id')
      .notNull()
      .references(() => encounters.id),
    patientId: text('patient_id')
      .notNull()
      .references(() => patients.id),
    practitionerId: text('practitioner_id').references(() => practitioners.id),
    schemeId: text('scheme_id')
      .notNull()
      .references(() => medicalSchemes.id),
    schemeOptionId: text('scheme_option_id').references(() => medicalSchemeOptions.id),
    status: text('status').notNull().default('NOT_SUBMITTED'), // NOT_SUBMITTED | SUBMITTED | ACCEPTED | REJECTED | PROCESSED | FAILED
    claimedCents: integer('claimed_cents').notNull().default(0),
    approvedCents: integer('approved_cents'),
    schemePaidCents: integer('scheme_paid_cents').notNull().default(0),
    patientPortionCents: integer('patient_portion_cents').notNull().default(0),
    adapterId: text('adapter_id'),
    externalReference: text('external_reference'),
    submittedByUserId: text('submitted_by_user_id').references(() => users.id),
    submittedAt: integer('submitted_at', { mode: 'timestamp_ms' }),
    lastResponseAt: integer('last_response_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('claims_invoice_uq').on(t.invoiceId),
    index('claims_practice_status_idx').on(t.practiceId, t.status),
  ],
);

export const claimLines = sqliteTable(
  'claim_lines',
  {
    id: newIdCol('cll'),
    claimId: text('claim_id')
      .notNull()
      .references(() => claims.id, { onDelete: 'cascade' }),
    tariffCode: text('tariff_code').notNull(),
    description: text('description').notNull(),
    units: integer('units').notNull().default(1),
    unitPriceCents: integer('unit_price_cents').notNull(),
    amountCents: integer('amount_cents').notNull(),
    icd10Code: text('icd10_code'),
  },
  (t) => [index('claim_lines_claim_idx').on(t.claimId)],
);

export const claimResponses = sqliteTable(
  'claim_responses',
  {
    id: newIdCol('clr'),
    claimId: text('claim_id')
      .notNull()
      .references(() => claims.id, { onDelete: 'cascade' }),
    responseType: text('response_type').notNull(), // SUBMISSION_ACK | SCHEME_RESPONSE | REMITTANCE
    outcome: text('outcome'), // ACCEPTED | REJECTED | PROCESSED | FAILED
    message: text('message'),
    approvedCents: integer('approved_cents'),
    paidCents: integer('paid_cents'),
    patientPortionCents: integer('patient_portion_cents'),
    payloadJson: text('payload_json'),
    receivedAt: integer('received_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [index('claim_responses_claim_idx').on(t.claimId)],
);

export const claimTrackingEvents = sqliteTable(
  'claim_tracking_events',
  {
    id: newIdCol('clt'),
    claimId: text('claim_id')
      .notNull()
      .references(() => claims.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    detail: text('detail'),
    actorUserId: text('actor_user_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('claim_tracking_claim_idx').on(t.claimId, t.createdAt)],
);

/* ------------------------------------------------------------------ */
/* Platform administration                                            */
/* ------------------------------------------------------------------ */

export const supportAccessGrants = sqliteTable(
  'support_access_grants',
  {
    id: newIdCol('sag'),
    platformAdminUserId: text('platform_admin_user_id')
      .notNull()
      .references(() => users.id),
    practiceId: text('practice_id')
      .notNull()
      .references(() => practices.id),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('ACTIVE'), // ACTIVE | EXPIRED | REVOKED
    startsAt: integer('starts_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date()),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
    revokedByUserId: text('revoked_by_user_id').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('support_grants_practice_idx').on(t.practiceId, t.status)],
);

/* ------------------------------------------------------------------ */
/* Audit trail (append-only, hash-chained)                            */
/* ------------------------------------------------------------------ */

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: newIdCol('aud'),
    seq: integer('seq'),
    practiceId: text('practice_id'),
    actorUserId: text('actor_user_id'),
    actorRole: text('actor_role'),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    locationId: text('location_id'),
    metadata: text('metadata'), // JSON string
    ip: text('ip'),
    userAgent: text('user_agent'),
    /** Hash chain: sha256(prevHash | canonical record) — tamper evidence. */
    prevHash: text('prev_hash'),
    hash: text('hash').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_practice_idx').on(t.practiceId, t.createdAt),
    index('audit_action_idx').on(t.action, t.createdAt),
    index('audit_actor_idx').on(t.actorUserId),
  ],
);

/* ------------------------------------------------------------------ */
/* Notifications                                                      */
/* ------------------------------------------------------------------ */

export const notifications = sqliteTable(
  'notifications',
  {
    id: newIdCol('ntf'),
    practiceId: text('practice_id')
      .notNull()
      .references(() => practices.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(), // TRANSFER_FLAG | BILLING_ALERT | ...
    title: text('title').notNull(),
    body: text('body'),
    linkPath: text('link_path'),
    readAt: integer('read_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_practice_idx').on(t.practiceId, t.createdAt)],
);
