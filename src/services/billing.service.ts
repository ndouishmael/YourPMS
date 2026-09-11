/**
 * Billing service: invoice lifecycle, payments, reversals, adjustments.
 *
 * Financial invariants:
 * - All money is integer cents.
 * - invoice.balance = total - adjusted - paid(ACTIVE payments).
 * - Invoice states: DRAFT -> ISSUED -> PARTIALLY_PAID -> PAID | VOID | ADJUSTED.
 * - Overpayment is rejected by default; duplicate payments are blocked.
 * - Every mutation is transactional and audited; payments are tenant- and
 *   location-authorized.
 */
import { and, eq, sql, desc } from 'drizzle-orm';
import type { DB } from '@/db';
import {
  invoices,
  invoiceLines,
  payments,
  paymentAdjustments,
  encounters,
  patients,
  claims,
  practitioners,
  users,
} from '@/db/schema';
import { badRequest, notFound, forbidden, unprocessable, conflict } from '@/lib/errors';
import { recordAudit } from './audit.service';
import type { ActorContext } from './scheduling.service';

/* ------------------------------------------------------------------ */
/* Invoice generation                                                 */
/* ------------------------------------------------------------------ */

export interface GeneratedInvoice {
  id: string;
  invoiceNumber: number;
  totalCents: number;
}

/**
 * Create + issue an invoice for a completed encounter. Called from
 * completeConsultation within the encounter's transactional flow.
 */
export async function generateInvoiceForEncounter(
  db: DB,
  params: {
    encounter: typeof encounters.$inferSelect;
    items: Array<{ tariffCode: string; description: string; units: number; unitPriceCents: number; amountCents: number }>;
    actorUserId: string;
  },
): Promise<GeneratedInvoice> {
  const { encounter, items } = params;
  if (encounter.status !== 'WITH_DOCTOR') {
    throw unprocessable('Invoice generation requires a completed consultation');
  }
  const subtotal = items.reduce((s, i) => s + i.amountCents, 0);
  if (subtotal <= 0) throw unprocessable('Invoice total must be positive');

  const invoice = db.transaction((tx) => {
    const number = (tx.select({ n: sql<number>`coalesce(max(${invoices.invoiceNumber}), 0)` }).from(invoices).where(eq(invoices.practiceId, encounter.practiceId)).get()?.n ?? 0) + 1;
    const [inv] = tx
      .insert(invoices)
      .values({
        practiceId: encounter.practiceId,
        locationId: encounter.locationId,
        encounterId: encounter.id,
        patientId: encounter.patientId,
        invoiceNumber: number,
        status: 'ISSUED',
        subtotalCents: subtotal,
        totalCents: subtotal,
        issuedAt: new Date(),
        createdByUserId: params.actorUserId,
      })
      .returning()
      .all();
    for (const item of items) {
      tx.insert(invoiceLines)
        .values({
          invoiceId: inv.id,
          tariffCode: item.tariffCode,
          description: item.description,
          units: item.units,
          unitPriceCents: item.unitPriceCents,
          amountCents: item.amountCents,
        })
        .run();
    }
    tx.update(encounters)
      .set({ status: 'AWAITING_BILLING', completedAt: new Date() })
      .where(eq(encounters.id, encounter.id))
      .run();
    return inv;
  });

  await recordAudit({
    db,
    practiceId: encounter.practiceId,
    actorUserId: params.actorUserId,
    action: 'INVOICE_CREATED',
    entityType: 'invoice',
    entityId: invoice.id,
    locationId: encounter.locationId,
    metadata: { invoiceNumber: invoice.invoiceNumber, totalCents: invoice.totalCents, encounterId: encounter.id },
  });
  return invoice;
}

/* ------------------------------------------------------------------ */
/* Invoice access & views                                             */
/* ------------------------------------------------------------------ */

export function getInvoiceAuthorized(ctx: ActorContext, invoiceId: string) {
  const row = ctx.db
    .select({ invoice: invoices, patient: patients })
    .from(invoices)
    .innerJoin(patients, eq(patients.id, invoices.patientId))
    .where(eq(invoices.id, invoiceId))
    .get();
  if (!row || row.invoice.practiceId !== ctx.practiceId) throw notFound('Invoice not found');
  if (!ctx.locationIds.includes(row.invoice.locationId)) {
    throw forbidden('You are not authorized for this invoice location');
  }
  const lines = ctx.db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId)).all();
  const pays = ctx.db
    .select()
    .from(payments)
    .where(eq(payments.invoiceId, invoiceId))
    .all()
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  const adjustments = ctx.db
    .select()
    .from(paymentAdjustments)
    .where(eq(paymentAdjustments.invoiceId, invoiceId))
    .all();
  const claim = ctx.db.select().from(claims).where(eq(claims.invoiceId, invoiceId)).get();
  const encounter = ctx.db.select().from(encounters).where(eq(encounters.id, row.invoice.encounterId)).get() ?? null;
  return { ...row, lines, payments: pays, adjustments, claim: claim ?? null, encounter };
}

export function invoiceBalance(invoice: typeof invoices.$inferSelect): number {
  return invoice.totalCents - invoice.adjustedCents - invoice.paidCents;
}

export function listInvoices(ctx: ActorContext, opts: { status?: string[]; limit?: number } = {}) {
  const conds = [eq(invoices.practiceId, ctx.practiceId)];
  if (opts.status?.length) conds.push(sql`${invoices.status} IN (${sql.join(opts.status.map((s) => sql`${s}`), sql`, `)})`);
  const locCond = ctx.locationIds.length
    ? sql`${invoices.locationId} IN (${sql.join(ctx.locationIds.map((l) => sql`${l}`), sql`, `)})`
    : sql`1 = 0`;
  conds.push(locCond);
  return ctx.db
    .select({ invoice: invoices, patient: patients })
    .from(invoices)
    .innerJoin(patients, eq(patients.id, invoices.patientId))
    .where(and(...conds))
    .all()
    .sort((a, b) => b.invoice.createdAt.getTime() - a.invoice.createdAt.getTime())
    .slice(0, opts.limit ?? 100);
}

/* ------------------------------------------------------------------ */
/* Payments                                                           */
/* ------------------------------------------------------------------ */

export interface RecordPaymentInput {
  invoiceId: string;
  amountCents: number;
  method: 'CASH' | 'CARD' | 'EFT';
  reference?: string;
}

export async function recordPatientPayment(ctx: ActorContext, input: RecordPaymentInput) {
  const { db } = ctx;
  const { invoice } = getInvoiceAuthorized(ctx, input.invoiceId);

  if (!['ISSUED', 'PARTIALLY_PAID', 'ADJUSTED'].includes(invoice.status)) {
    throw unprocessable(`Invoice is ${invoice.status}; payments are not accepted in this state`);
  }
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw badRequest('Payment amount must be a positive integer number of cents');
  }
  const balance = invoiceBalance(invoice);
  if (input.amountCents > balance) {
    throw unprocessable(
      `Payment exceeds outstanding balance (${input.amountCents} > ${balance} cents). Overpayment is not allowed.`,
    );
  }

  // Duplicate-payment guard: identical amount + invoice + method within 60s.
  const dup = db
    .select()
    .from(payments)
    .where(
      and(
        eq(payments.invoiceId, invoice.id),
        eq(payments.method, input.method),
        eq(payments.amountCents, input.amountCents),
        eq(payments.status, 'ACTIVE'),
        sql`${payments.receivedAt} > ${Date.now() - 60_000}`,
      ),
    )
    .get();
  if (dup) throw conflict('An identical payment was just recorded on this invoice');

  const payment = db.transaction((tx) => {
    const [pay] = tx
      .insert(payments)
      .values({
        practiceId: ctx.practiceId,
        invoiceId: invoice.id,
        amountCents: input.amountCents,
        method: input.method,
        payerType: 'PATIENT',
        reference: input.reference?.trim() || null,
        receivedByUserId: ctx.actorUserId,
      })
      .returning()
      .all();
    const paid = invoice.paidCents + input.amountCents;
    const adjusted = invoice.adjustedCents;
    const status = paid + adjusted >= invoice.totalCents ? 'PAID' : 'PARTIALLY_PAID';
    tx.update(invoices).set({ paidCents: paid, status }).where(eq(invoices.id, invoice.id)).run();
    if (status === 'PAID') {
      tx.update(encounters)
        .set({ status: 'CLOSED', closedAt: new Date() })
        .where(and(eq(encounters.id, invoice.encounterId), eq(encounters.status, 'AWAITING_BILLING')))
        .run();
    }
    return pay;
  });

  await recordAudit({
    db,
    practiceId: ctx.practiceId,
    actorUserId: ctx.actorUserId,
    actorRole: ctx.actorRole,
    action: 'PAYMENT_RECORDED',
    entityType: 'invoice',
    entityId: invoice.id,
    locationId: invoice.locationId,
    metadata: { paymentId: payment.id, amountCents: input.amountCents, method: input.method },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return payment;
}

export async function reversePayment(ctx: ActorContext, paymentId: string, reason: string) {
  const { db } = ctx;
  if (!reason?.trim()) throw badRequest('A reversal reason is required');
  const payment = db.select().from(payments).where(eq(payments.id, paymentId)).get();
  if (!payment || payment.practiceId !== ctx.practiceId) throw notFound('Payment not found');
  if (payment.status !== 'ACTIVE') throw unprocessable('Payment is already reversed');
  const invoice = db.select().from(invoices).where(eq(invoices.id, payment.invoiceId)).get();
  if (!invoice) throw notFound('Invoice not found');
  if (!ctx.locationIds.includes(invoice.locationId)) throw forbidden('Unauthorized invoice location');
  if (invoice.status === 'VOID') throw unprocessable('Cannot reverse a payment on a void invoice');

  db.transaction((tx) => {
    tx.update(payments)
      .set({ status: 'REVERSED', reversedAt: new Date(), reversedByUserId: ctx.actorUserId, reversalReason: reason.trim() })
      .where(eq(payments.id, payment.id))
      .run();
    const paid = invoice.paidCents - payment.amountCents;
    const status = paid <= 0 ? (invoice.adjustedCents > 0 ? 'ADJUSTED' : 'ISSUED') : 'PARTIALLY_PAID';
    tx.update(invoices).set({ paidCents: paid, status }).where(eq(invoices.id, invoice.id)).run();
    // A settled-then-reversed invoice returns to the billing workflow.
    tx.update(encounters)
      .set({ status: 'AWAITING_BILLING', closedAt: null })
      .where(and(eq(encounters.id, invoice.encounterId), eq(encounters.status, 'CLOSED')))
      .run();
  });

  await recordAudit({
    db,
    practiceId: ctx.practiceId,
    actorUserId: ctx.actorUserId,
    actorRole: ctx.actorRole,
    action: 'PAYMENT_REVERSED',
    entityType: 'invoice',
    entityId: invoice.id,
    locationId: invoice.locationId,
    metadata: { paymentId: payment.id, amountCents: payment.amountCents, reason: reason.trim() },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return { ok: true };
}

export async function adjustInvoice(
  ctx: ActorContext,
  input: { invoiceId: string; amountCents: number; type: 'DISCOUNT' | 'WRITE_OFF' | 'CORRECTION'; reason: string },
) {
  const { db } = ctx;
  const { invoice } = getInvoiceAuthorized(ctx, input.invoiceId);
  if (!input.reason?.trim()) throw badRequest('An adjustment reason is required');
  if (!['DISCOUNT', 'WRITE_OFF', 'CORRECTION'].includes(input.type)) throw badRequest('Invalid adjustment type');
  // amountCents is the reduction magnitude (positive) applied to the balance.
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw badRequest('Adjustment amount must be positive cents');
  }
  if (!['ISSUED', 'PARTIALLY_PAID', 'ADJUSTED'].includes(invoice.status)) {
    throw unprocessable(`Invoice is ${invoice.status}; adjustments are not accepted in this state`);
  }
  const balance = invoiceBalance(invoice);
  if (input.amountCents > balance) throw unprocessable('Adjustment exceeds the outstanding balance');

  db.transaction((tx) => {
    tx.insert(paymentAdjustments)
      .values({
        practiceId: ctx.practiceId,
        invoiceId: invoice.id,
        amountCents: -input.amountCents,
        type: input.type,
        reason: input.reason.trim(),
        createdByUserId: ctx.actorUserId,
      })
      .run();
    const adjusted = invoice.adjustedCents + input.amountCents;
    const settled = invoice.paidCents + adjusted >= invoice.totalCents;
    tx.update(invoices)
      .set({ adjustedCents: adjusted, status: settled ? 'ADJUSTED' : invoice.status })
      .where(eq(invoices.id, invoice.id))
      .run();
    if (settled) {
      tx.update(encounters)
        .set({ status: 'CLOSED', closedAt: new Date() })
        .where(and(eq(encounters.id, invoice.encounterId), eq(encounters.status, 'AWAITING_BILLING')))
        .run();
    }
  });

  await recordAudit({
    db,
    practiceId: ctx.practiceId,
    actorUserId: ctx.actorUserId,
    actorRole: ctx.actorRole,
    action: 'INVOICE_ADJUSTED',
    entityType: 'invoice',
    entityId: invoice.id,
    locationId: invoice.locationId,
    metadata: { amountCents: input.amountCents, type: input.type, reason: input.reason.trim() },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return { ok: true };
}

export async function voidInvoice(ctx: ActorContext, invoiceId: string, reason: string) {
  const { db } = ctx;
  if (!reason?.trim()) throw badRequest('A void reason is required');
  const { invoice } = getInvoiceAuthorized(ctx, invoiceId);
  if (invoice.status === 'VOID') throw unprocessable('Invoice is already void');
  if (invoice.status === 'PAID') throw unprocessable('A paid invoice cannot be voided — reverse the payments first');
  const activePayments = db
    .select()
    .from(payments)
    .where(and(eq(payments.invoiceId, invoice.id), eq(payments.status, 'ACTIVE')))
    .all();
  if (activePayments.length) throw unprocessable('Reverse all payments before voiding this invoice');

  db.transaction((tx) => {
    tx.update(invoices)
      .set({ status: 'VOID', voidedAt: new Date(), voidReason: reason.trim() })
      .where(eq(invoices.id, invoice.id))
      .run();
    tx.update(encounters)
      .set({ status: 'AWAITING_BILLING', closedAt: null })
      .where(and(eq(encounters.id, invoice.encounterId), eq(encounters.status, 'CLOSED')))
      .run();
  });

  await recordAudit({
    db,
    practiceId: ctx.practiceId,
    actorUserId: ctx.actorUserId,
    actorRole: ctx.actorRole,
    action: 'INVOICE_VOIDED',
    entityType: 'invoice',
    entityId: invoice.id,
    locationId: invoice.locationId,
    metadata: { reason: reason.trim() },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return { ok: true };
}

/** Regenerate an invoice for an encounter whose previous invoice was voided. */
export async function regenerateInvoice(ctx: ActorContext, encounterId: string) {
  const { db } = ctx;
  const encounter = db.select().from(encounters).where(eq(encounters.id, encounterId)).get();
  if (!encounter || encounter.practiceId !== ctx.practiceId) throw notFound('Encounter not found');
  if (!ctx.locationIds.includes(encounter.locationId)) throw forbidden('Unauthorized encounter location');
  if (encounter.status !== 'AWAITING_BILLING') throw unprocessable('Encounter is not awaiting billing');
  const existing = db.select().from(invoices).where(eq(invoices.encounterId, encounterId)).all();
  if (!existing.some((i) => i.status === 'VOID')) throw unprocessable('No voided invoice to replace');
  if (existing.some((i) => i.status !== 'VOID')) throw unprocessable('An active invoice already exists for this encounter');

  // Re-issue from encounter items: temporarily allow generation from AWAITING_BILLING.
  const items = db.$client
    .prepare(`SELECT tariff_code AS tariffCode, description, units, unit_price_cents AS unitPriceCents, amount_cents AS amountCents FROM encounter_items WHERE encounter_id = ?`)
    .all(encounterId) as Array<{ tariffCode: string; description: string; units: number; unitPriceCents: number; amountCents: number }>;
  if (!items.length) throw unprocessable('Encounter has no billable items');

  const subtotal = items.reduce((s, i) => s + i.amountCents, 0);
  const invoice = db.transaction((tx) => {
    const number = (tx.select({ n: sql<number>`coalesce(max(${invoices.invoiceNumber}), 0)` }).from(invoices).where(eq(invoices.practiceId, ctx.practiceId)).get()?.n ?? 0) + 1;
    const [inv] = tx
      .insert(invoices)
      .values({
        practiceId: ctx.practiceId,
        locationId: encounter.locationId,
        encounterId: encounter.id,
        patientId: encounter.patientId,
        invoiceNumber: number,
        status: 'ISSUED',
        subtotalCents: subtotal,
        totalCents: subtotal,
        issuedAt: new Date(),
        createdByUserId: ctx.actorUserId,
      })
      .returning()
      .all();
    for (const item of items) {
      tx.insert(invoiceLines)
        .values({
          invoiceId: inv.id,
          tariffCode: item.tariffCode,
          description: item.description,
          units: item.units,
          unitPriceCents: item.unitPriceCents,
          amountCents: item.amountCents,
        })
        .run();
    }
    return inv;
  });

  await recordAudit({
    db,
    practiceId: ctx.practiceId,
    actorUserId: ctx.actorUserId,
    actorRole: ctx.actorRole,
    action: 'INVOICE_REGENERATED',
    entityType: 'invoice',
    entityId: invoice.id,
    locationId: encounter.locationId,
    metadata: { encounterId, totalCents: invoice.totalCents },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return invoice;
}

/* ------------------------------------------------------------------ */
/* Reports helper                                                     */
/* ------------------------------------------------------------------ */

export function revenueByPractitioner(db: DB, practiceId: string) {
  return db
    .select({
      practitionerId: practitioners.id,
      name: sql<string>`'Dr ' || ${users.firstName} || ' ' || ${users.lastName}`,
      encounterCount: sql<number>`count(distinct ${encounters.id})`,
      billedCents: sql<number>`coalesce(sum(${invoices.totalCents}), 0)`,
      paidCents: sql<number>`coalesce(sum(${invoices.paidCents}), 0)`,
    })
    .from(invoices)
    .innerJoin(encounters, eq(encounters.id, invoices.encounterId))
    .leftJoin(practitioners, eq(practitioners.id, encounters.practitionerId))
    .leftJoin(users, eq(users.id, practitioners.userId))
    .where(and(eq(invoices.practiceId, practiceId), sql`${invoices.status} != 'VOID'`))
    .groupBy(practitioners.id, users.firstName, users.lastName)
    .all();
}

export { desc };
