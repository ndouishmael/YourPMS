/**
 * Claims adapter architecture (provider-independent core).
 *
 * The core domain speaks Claim / ClaimLine / Invoice / Patient / Practitioner /
 * Location / MedicalScheme. Provider-specific protocols (MediKredit XML,
 * Healthbridge switching, future webhooks) live entirely inside adapters that
 * implement ClaimsAdapter.
 *
 * Phase 1 ships:
 *  - "manual":  records the claim as submitted for manual/portal submission
 *               (no external protocol invented).
 *  - "simulation": deterministic local simulation used by tests and demos.
 *
 * Real provider adapters (MediKredit, Healthbridge) are intentionally NOT
 * implemented: no credentials or official technical documentation are
 * available in this environment, and inventing endpoints/protocols would be
 * wrong. The interface below is the integration seam for when they are.
 */
import type { DB } from '@/db';
import { claims, claimLines, patients, practitioners, users, locations, invoices, medicalSchemes, medicalSchemeOptions, patientMedicalAid } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { AppError } from '@/lib/errors';

/** Provider-neutral bundle handed to an adapter for submission. */
export interface ClaimBundle {
  claimId: string;
  practice: { id: string; name: string; practiceNumber: string };
  location: { id: string; name: string };
  practitioner: { id: string; name: string; hpcsaNumber: string | null } | null;
  patient: {
    id: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string | null;
    idNumber: string | null;
    medicalAid: {
      schemeName: string;
      schemeCode: string;
      optionName: string | null;
      membershipNumber: string;
      dependentCode: string | null;
      mainMemberName: string | null;
    } | null;
  };
  invoice: { id: string; invoiceNumber: number; totalCents: number; issuedAt: Date | null };
  lines: Array<{
    tariffCode: string;
    description: string;
    units: number;
    unitPriceCents: number;
    amountCents: number;
    icd10Code: string | null;
  }>;
  claimedCents: number;
}

export interface AdapterSubmitResult {
  /** accepted by the switch/adapter (claim moves to SUBMITTED) */
  accepted: boolean;
  /** Provider reference for tracking, when available. */
  externalReference: string | null;
  message: string;
  /** Hard failure (connectivity/config) -> claim FAILED. */
  hardFailure?: boolean;
}

export interface ClaimsAdapter {
  readonly id: string;
  readonly name: string;
  readonly configured: boolean;
  submit(bundle: ClaimBundle): Promise<AdapterSubmitResult>;
}

/* ------------------------------------------------------------------ */
/* Manual adapter — record for portal/switch submission               */
/* ------------------------------------------------------------------ */

export const manualAdapter: ClaimsAdapter = {
  id: 'manual',
  name: 'Manual submission (recorded for switch/portal capture)',
  configured: true,
  async submit(bundle) {
    return {
      accepted: true,
      externalReference: `MANUAL-${bundle.claimId.slice(-8).toUpperCase()}`,
      message: 'Claim captured for manual submission to the medical scheme.',
    };
  },
};

/* ------------------------------------------------------------------ */
/* Simulation adapter — local testing only                            */
/* ------------------------------------------------------------------ */

export const simulationAdapter: ClaimsAdapter = {
  id: 'simulation',
  name: 'Local simulation (testing/demo only)',
  configured: true,
  async submit(bundle) {
    return {
      accepted: true,
      externalReference: `SIM-${bundle.claimId.slice(-8).toUpperCase()}`,
      message: 'Claim accepted by the local claims simulator.',
    };
  },
};

/* ------------------------------------------------------------------ */
/* Provider stubs — NOT CONFIGURED (no credentials or docs)           */
/* ------------------------------------------------------------------ */

function notConfiguredAdapter(id: string, name: string): ClaimsAdapter {
  return {
    id,
    name,
    configured: false,
    async submit() {
      throw new AppError(
        `The ${name} adapter requires provider credentials and official technical documentation before it can be enabled. No endpoints or protocols are invented.`,
        503,
        'ADAPTER_NOT_CONFIGURED',
      );
    },
  };
}

export const medikreditAdapter = notConfiguredAdapter('medikredit', 'MediKredit');
export const healthbridgeAdapter = notConfiguredAdapter('healthbridge', 'Healthbridge');

/* ------------------------------------------------------------------ */
/* Registry                                                           */
/* ------------------------------------------------------------------ */

const ADAPTERS: Record<string, ClaimsAdapter> = {
  manual: manualAdapter,
  simulation: simulationAdapter,
  medikredit: medikreditAdapter,
  healthbridge: healthbridgeAdapter,
};

export function getAdapter(id: string): ClaimsAdapter {
  return ADAPTERS[id] ?? manualAdapter;
}

export function listAdapters(): Array<{ id: string; name: string; configured: boolean }> {
  return Object.values(ADAPTERS).map((a) => ({ id: a.id, name: a.name, configured: a.configured }));
}

/** Build the provider-neutral claim bundle from the core domain. */
export function buildClaimBundle(db: DB, claim: typeof claims.$inferSelect): ClaimBundle {
  const invoice = db.select().from(invoices).where(eq(invoices.id, claim.invoiceId)).get();
  if (!invoice) throw new AppError('Claim invoice missing', 500, 'INTERNAL');
  const patient = db.select().from(patients).where(eq(patients.id, claim.patientId)).get();
  if (!patient) throw new AppError('Claim patient missing', 500, 'INTERNAL');
  const scheme = db.select().from(medicalSchemes).where(eq(medicalSchemes.id, claim.schemeId)).get();
  if (!scheme) throw new AppError('Claim scheme missing', 500, 'INTERNAL');
  const option = claim.schemeOptionId
    ? db.select().from(medicalSchemeOptions).where(eq(medicalSchemeOptions.id, claim.schemeOptionId)).get()
    : null;
  const aid = db.select().from(patientMedicalAid).where(eq(patientMedicalAid.patientId, patient.id)).get();
  const practice = db.$client
    .prepare(`SELECT id, name, practice_number AS practiceNumber FROM practices WHERE id = ?`)
    .get(claim.practiceId) as { id: string; name: string; practiceNumber: string };
  const location = db.select().from(locations).where(eq(locations.id, invoice.locationId)).get();
  const practitionerRow = claim.practitionerId
    ? db
        .select({ practitioner: practitioners, user: users })
        .from(practitioners)
        .innerJoin(users, eq(users.id, practitioners.userId))
        .where(eq(practitioners.id, claim.practitionerId))
        .get()
    : null;
  const lines = db.select().from(claimLines).where(eq(claimLines.claimId, claim.id)).all();

  return {
    claimId: claim.id,
    practice,
    location: location ? { id: location.id, name: location.name } : { id: '', name: '' },
    practitioner: practitionerRow
      ? {
          id: practitionerRow.practitioner.id,
          name: `Dr ${practitionerRow.user.firstName} ${practitionerRow.user.lastName}`,
          hpcsaNumber: practitionerRow.practitioner.hpcsaNumber,
        }
      : null,
    patient: {
      id: patient.id,
      firstName: patient.firstName,
      lastName: patient.lastName,
      dateOfBirth: patient.dateOfBirth,
      idNumber: patient.idNumber,
      medicalAid: aid
        ? {
            schemeName: scheme.name,
            schemeCode: scheme.code,
            optionName: option?.name ?? null,
            membershipNumber: aid.membershipNumber,
            dependentCode: aid.dependentCode,
            mainMemberName: aid.mainMemberName,
          }
        : null,
    },
    invoice: { id: invoice.id, invoiceNumber: invoice.invoiceNumber, totalCents: invoice.totalCents, issuedAt: invoice.issuedAt },
    lines: lines.map((l) => ({ ...l, icd10Code: l.icd10Code ?? null })),
    claimedCents: claim.claimedCents,
  };
}

export { claimLines };
