/**
 * Claims service: provider-independent claim lifecycle.
 *
 * Claim states: NOT_SUBMITTED -> SUBMITTED -> ACCEPTED -> PROCESSED
 *                 |-> REJECTED (can resubmit)
 *                 |-> FAILED   (adapter/transport failure, can resubmit)
 *
 * Billed != Claimed != Approved/Processed != Paid — each is tracked separately.
 * Medical-aid shortfalls (scheme pays less than claimed) are represented as
 * PROCESSED claims with a patient portion, not rejections.
 */
import { and, eq, desc, inArray, sql } from 'drizzle-orm';
import {
  claims,
  claimLines,
  claimResponses,
  claimTrackingEvents,
  invoices,
  payments,
  patients,
  medicalSchemes,
  encounterDiagnoses,
  encounters,
  invoiceLines,
} from '@/db/schema';
import { notFound, unprocessable, forbidden } from '@/lib/errors';
import { recordAudit } from './audit.service';
import { notifyPractice } from './practice.service';
import { getAdapter, buildClaimBundle } from './claims/adapters';
import type { ActorContext } from './scheduling.service';

/** Create the claim from the invoice (NOT_SUBMITTED) with lines + diagnoses. */
async function createClaimFromInvoice(ctx: ActorContext, invoiceId: string) {
  const { db } = ctx;
  const invoice = db.select().from(invoices).where(eq(invoices.id, invoiceId)).get();
  if (!invoice || invoice.practiceId !== ctx.practiceId) throw notFound('Invoice not found');
  if (!ctx.locationIds.includes(invoice.locationId)) throw forbidden('Unauthorized invoice location');
  if (invoice.status === 'VOID') throw unprocessable('Cannot claim against a void invoice');

  const existing = db.select().from(claims).where(eq(claims.invoiceId, invoiceId)).get();
  if (existing) throw unprocessable('A claim already exists for this invoice');

  const patient = db.select().from(patients).where(eq(patients.id, invoice.patientId)).get();
  if (!patient) throw notFound('Patient not found');
  const aidRow = db.$client
    .prepare(
      `SELECT pma.scheme_id AS schemeId, pma.scheme_option_id AS schemeOptionId, sch.name AS schemeName
       FROM patient_medical_aid pma JOIN medical_schemes sch ON sch.id = pma.scheme_id
       WHERE pma.patient_id = ?`,
    )
    .get(patient.id) as { schemeId: string; schemeOptionId: string | null; schemeName: string } | undefined;
  if (!aidRow) throw unprocessable('Patient has no medical aid on file — add it before claiming');

  const lines = db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId)).all();
  if (!lines.length) throw unprocessable('Invoice has no lines to claim');
  const encounter = db.select().from(encounters).where(eq(encounters.id, invoice.encounterId)).get();
  if (!encounter) throw notFound('Encounter not found');
  const dxs = db.select().from(encounterDiagnoses).where(eq(encounterDiagnoses.encounterId, encounter.id)).all();
  const primaryDx = dxs.find((d) => d.isPrimary) ?? dxs[0];

  const claimed = lines.reduce((s, l) => s + l.amountCents, 0);
  const [claim] = db
    .insert(claims)
    .values({
      practiceId: ctx.practiceId,
      invoiceId: invoice.id,
      encounterId: encounter.id,
      patientId: patient.id,
      practitionerId: encounter.practitionerId,
      schemeId: aidRow.schemeId,
      schemeOptionId: aidRow.schemeOptionId,
      status: 'NOT_SUBMITTED',
      claimedCents: claimed,
    })
    .returning()
    .all();

  for (const line of lines) {
    db.insert(claimLines)
      .values({
        claimId: claim.id,
        tariffCode: line.tariffCode,
        description: line.description,
        units: line.units,
        unitPriceCents: line.unitPriceCents,
        amountCents: line.amountCents,
        icd10Code: primaryDx?.icd10Code ?? null,
      })
      .run();
  }
  return claim;
}

/** Create + submit the claim via the practice's configured adapter. */
export async function submitClaimForInvoice(ctx: ActorContext, invoiceId: string) {
  const claim = await createClaimFromInvoice(ctx, invoiceId);
  return submitClaim(ctx, claim.id);
}

export async function submitClaim(ctx: ActorContext, claimId: string) {
  const { db } = ctx;
  const claim = db.select().from(claims).where(eq(claims.id, claimId)).get();
  if (!claim || claim.practiceId !== ctx.practiceId) throw notFound('Claim not found');
  if (!['NOT_SUBMITTED', 'REJECTED', 'FAILED'].includes(claim.status)) {
    throw unprocessable(`Claim cannot be submitted from status ${claim.status}`);
  }
  const invoice = db.select().from(invoices).where(eq(invoices.id, claim.invoiceId)).get();
  if (!invoice) throw notFound('Invoice not found');
  if (invoice.status === 'VOID') throw unprocessable('Cannot submit a claim against a void invoice');
  if (!ctx.locationIds.includes(invoice.locationId)) throw forbidden('Unauthorized invoice location');

  // If re-submitting after a previous submission, reset tracking.
  const practice = db.$client.prepare(`SELECT claims_adapter_id AS adapterId FROM practices WHERE id = ?`).get(ctx.practiceId) as { adapterId: string } | undefined;
  const adapter = getAdapter(practice?.adapterId ?? 'manual');

  try {
    const bundle = buildClaimBundle(db, claim);
    const result = await adapter.submit(bundle);
    if (!result.accepted) {
      throw new Error(`Claim submission failed: ${result.message}`);
    }
    db.transaction((tx) => {
      tx.update(claims)
        .set({
          status: 'SUBMITTED',
          adapterId: adapter.id,
          externalReference: result.externalReference,
          submittedAt: new Date(),
          submittedByUserId: ctx.actorUserId,
          lastResponseAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(claims.id, claim.id))
        .run();
      tx.insert(claimTrackingEvents).values({ claimId: claim.id, status: 'SUBMITTED', detail: result.message, actorUserId: ctx.actorUserId }).run();
      // The immediate billing action is complete; the claim lifecycle continues.
      tx.update(encounters)
        .set({ status: 'CLOSED', closedAt: new Date() })
        .where(and(eq(encounters.id, claim.encounterId), inArray(encounters.status, ['AWAITING_BILLING', 'CONSULTATION_COMPLETE'])))
        .run();
    });
  } catch (err) {
    // Adapter failure (including NOT_CONFIGURED providers): claim -> FAILED.
    db.update(claims).set({ status: 'FAILED', adapterId: adapter.id, updatedAt: new Date() }).where(eq(claims.id, claim.id)).run();
    db.insert(claimTrackingEvents).values({ claimId: claim.id, status: 'FAILED', detail: String((err as Error).message), actorUserId: ctx.actorUserId }).run();
    const message = (err as Error).message ?? 'Unknown adapter failure';
    throw unprocessable(message);
  }

  const updated = db.select().from(claims).where(eq(claims.id, claimId)).get()!;
  await recordAudit({
    db,
    practiceId: ctx.practiceId,
    actorUserId: ctx.actorUserId,
    actorRole: ctx.actorRole,
    action: 'CLAIM_SUBMITTED',
    entityType: 'claim',
    entityId: updated.id,
    locationId: invoice.locationId,
    metadata: { invoiceId: invoice.id, claimedCents: updated.claimedCents, adapter: adapter.id },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return updated;
}

export interface ClaimResponseInput {
  outcome: 'ACCEPTED' | 'REJECTED' | 'PROCESSED' | 'FAILED';
  message?: string;
  approvedCents?: number;
  schemePaidCents?: number;
  patientPortionCents?: number;
}

/**
 * Record a scheme response (in production this arrives via the adapter /
 * switch; Phase 1 records it via an authorized user action or test hook).
 *
 * PROCESSED with a scheme payment records a MEDICAL_AID payment against the
 * invoice and updates the patient portion / shortfall.
 */
export async function recordClaimResponse(ctx: ActorContext, claimId: string, input: ClaimResponseInput) {
  const { db } = ctx;
  const claim = db.select().from(claims).where(eq(claims.id, claimId)).get();
  if (!claim || claim.practiceId !== ctx.practiceId) throw notFound('Claim not found');
  const invoice = db.select().from(invoices).where(eq(invoices.id, claim.invoiceId)).get();
  if (!invoice) throw notFound('Invoice not found');
  if (!ctx.locationIds.includes(invoice.locationId)) throw forbidden('Unauthorized invoice location');
  if (!['SUBMITTED', 'ACCEPTED', 'REJECTED', 'PROCESSED', 'FAILED'].includes(claim.status)) {
    throw unprocessable(`Claim cannot receive a response in status ${claim.status}`);
  }

  const approved = input.approvedCents ?? null;
  const schemePaid = Math.max(0, input.schemePaidCents ?? 0);
  const patientPortion = Math.max(0, input.patientPortionCents ?? claim.claimedCents - schemePaid);
  if (input.outcome === 'PROCESSED') {
    if (schemePaid + patientPortion > claim.claimedCents) {
      throw unprocessable('Scheme payment + patient portion exceeds the claimed amount');
    }
    if (schemePaid > invoice.totalCents - invoice.paidCents) {
      throw unprocessable('Scheme payment exceeds the outstanding invoice balance');
    }
  }

  db.transaction((tx) => {
    tx.insert(claimResponses)
      .values({
        claimId: claim.id,
        responseType: 'SCHEME_RESPONSE',
        outcome: input.outcome,
        message: input.message ?? null,
        approvedCents: approved,
        paidCents: input.schemePaidCents ?? null,
        patientPortionCents: patientPortion,
        payloadJson: JSON.stringify({ recordedBy: ctx.actorUserId }),
      })
      .run();
    tx.update(claims)
      .set({
        status: input.outcome,
        approvedCents: approved ?? claim.approvedCents,
        schemePaidCents: schemePaid,
        patientPortionCents: patientPortion,
        lastResponseAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(claims.id, claim.id))
      .run();
    tx.insert(claimTrackingEvents)
      .values({ claimId: claim.id, status: input.outcome, detail: input.message ?? null, actorUserId: ctx.actorUserId })
      .run();

    if (input.outcome === 'PROCESSED' && schemePaid > 0) {
      // Medical-aid money received — a real payment row (never mixes with cash).
      tx.insert(payments)
        .values({
          practiceId: ctx.practiceId,
          invoiceId: invoice.id,
          amountCents: schemePaid,
          method: 'EFT',
          payerType: 'MEDICAL_AID',
          reference: `CLAIM:${claim.id}`,
          receivedByUserId: ctx.actorUserId,
          claimId: claim.id,
        })
        .run();
      const paid = invoice.paidCents + schemePaid;
      const settled = paid + invoice.adjustedCents >= invoice.totalCents;
      tx.update(invoices).set({ paidCents: paid, status: settled ? 'PAID' : 'PARTIALLY_PAID' }).where(eq(invoices.id, invoice.id)).run();
    }

    if (input.outcome === 'REJECTED' || input.outcome === 'FAILED') {
      // The patient now owes the full amount — return to the billing workflow.
      tx.update(encounters)
        .set({ status: 'AWAITING_BILLING', closedAt: null })
        .where(and(eq(encounters.id, claim.encounterId), eq(encounters.status, 'CLOSED')))
        .run();
    }
  });

  if (input.outcome === 'REJECTED' || input.outcome === 'FAILED') {
    notifyPractice(db, {
      practiceId: ctx.practiceId,
      type: 'CLAIM_PROBLEM',
      title: `Claim ${input.outcome}`,
      body: input.message ?? 'A claim requires attention.',
      linkPath: `/invoices/${invoice.id}`,
    });
  }

  await recordAudit({
    db,
    practiceId: ctx.practiceId,
    actorUserId: ctx.actorUserId,
    actorRole: ctx.actorRole,
    action: 'CLAIM_RESPONSE',
    entityType: 'claim',
    entityId: claim.id,
    locationId: invoice.locationId,
    metadata: { outcome: input.outcome, schemePaidCents: schemePaid, patientPortionCents: patientPortion },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return { ok: true };
}

export async function resubmitClaim(ctx: ActorContext, claimId: string) {
  const claim = ctx.db.select().from(claims).where(eq(claims.id, claimId)).get();
  if (!claim || claim.practiceId !== ctx.practiceId) throw notFound('Claim not found');
  if (!['REJECTED', 'FAILED'].includes(claim.status)) {
    throw unprocessable(`Only rejected or failed claims can be resubmitted (current: ${claim.status})`);
  }
  return submitClaim(ctx, claimId);
}

export function getClaimDetail(ctx: ActorContext, claimId: string) {
  const claim = ctx.db.select().from(claims).where(eq(claims.id, claimId)).get();
  if (!claim || claim.practiceId !== ctx.practiceId) throw notFound('Claim not found');
  const lines = ctx.db.select().from(claimLines).where(eq(claimLines.claimId, claimId)).all();
  const responses = ctx.db
    .select()
    .from(claimResponses)
    .where(eq(claimResponses.claimId, claimId))
    .all()
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  const tracking = ctx.db
    .select()
    .from(claimTrackingEvents)
    .where(eq(claimTrackingEvents.claimId, claimId))
    .all()
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return { claim, lines, responses, tracking };
}

export function listClaims(ctx: ActorContext, statuses?: string[]) {
  const conds = [eq(claims.practiceId, ctx.practiceId)];
  if (statuses?.length) conds.push(inArray(claims.status, statuses));
  if (!ctx.locationIds.length) return [];
  const locIds = ctx.locationIds;
  return ctx.db
    .select({ claim: claims, patient: patients, scheme: medicalSchemes, invoice: invoices })
    .from(claims)
    .innerJoin(patients, eq(patients.id, claims.patientId))
    .innerJoin(medicalSchemes, eq(medicalSchemes.id, claims.schemeId))
    .innerJoin(invoices, eq(invoices.id, claims.invoiceId))
    .where(and(...conds))
    .all()
    .filter((r) => locIds.includes(r.invoice.locationId))
    .sort((a, b) => b.claim.createdAt.getTime() - a.claim.createdAt.getTime());
}

export { sql, desc };
