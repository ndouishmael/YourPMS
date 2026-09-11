/**
 * Financial reporting: practice-level metrics for the finance dashboard.
 * Built directly on the transactional data model so advanced reporting can be
 * added later without schema changes.
 */
import { and, eq, gte, lte, sql, inArray, ne } from 'drizzle-orm';
import type { DB } from '@/db';
import { invoices, payments, claims, encounters, patients, locations, practitioners, users, paymentAdjustments } from '@/db/schema';
import type { ActorContext } from './scheduling.service';

export interface FinanceSummary {
  totalBilledCents: number;
  totalPaidCents: number;
  cashReceivedCents: number;
  medicalAidPaidCents: number;
  patientPaidCents: number;
  adjustmentsCents: number;
  outstandingPatientBalanceCents: number;
  outstandingClaimedCents: number;
  shortfallCents: number;
  invoiceCounts: Record<string, number>;
  claimCounts: Record<string, number>;
  revenueByDay: Array<{ day: string; billedCents: number; paidCents: number }>;
  revenueByMethod: Array<{ method: string; amountCents: number }>;
  revenueByLocation: Array<{ locationId: string; locationName: string; billedCents: number; paidCents: number }>;
  revenueByPractitioner: Array<{ practitionerId: string | null; name: string; billedCents: number; paidCents: number }>;
  debtorAgeing: Array<{ bucket: string; outstandingCents: number; invoiceCount: number }>;
  claimProblems: Array<{ claimId: string; patientName: string; status: string; claimedCents: number; message: string | null }>;
  reconciliation: { invoicesChecked: number; mismatches: number };
}

export function financeSummary(ctx: ActorContext, params: { from?: string; to?: string; locationId?: string } = {}): FinanceSummary {
  const db = ctx.db;
  const locIds = params.locationId ? [params.locationId] : ctx.locationIds;
  if (params.locationId && !ctx.locationIds.includes(params.locationId)) locIds.length = 0;
  const from = params.from ? new Date(params.from) : new Date(Date.now() - 90 * 24 * 3600 * 1000);
  const to = params.to ? new Date(new Date(params.to).getTime() + 24 * 3600 * 1000) : new Date(Date.now() + 24 * 3600 * 1000);

  const invoiceRows = db
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.practiceId, ctx.practiceId),
        ne(invoices.status, 'VOID'),
        gte(invoices.createdAt, from),
        lte(invoices.createdAt, to),
      ),
    )
    .all()
    .filter((i) => locIds.includes(i.locationId));

  const invoiceIds = invoiceRows.map((i) => i.id);
  const paymentRows = invoiceIds.length
    ? db
        .select()
        .from(payments)
        .where(and(inArray(payments.invoiceId, invoiceIds), eq(payments.status, 'ACTIVE')))
        .all()
    : [];
  const adjustmentRows = invoiceIds.length
    ? db.select().from(paymentAdjustments).where(inArray(paymentAdjustments.invoiceId, invoiceIds)).all()
    : [];
  const claimRows = invoiceIds.length ? db.select().from(claims).where(inArray(claims.invoiceId, invoiceIds)).all() : [];

  const invoiceCounts: Record<string, number> = {};
  for (const inv of invoiceRows) invoiceCounts[inv.status] = (invoiceCounts[inv.status] ?? 0) + 1;
  const claimCounts: Record<string, number> = {};
  for (const c of claimRows) claimCounts[c.status] = (claimCounts[c.status] ?? 0) + 1;

  const totalBilled = invoiceRows.reduce((s, i) => s + i.totalCents, 0);
  const medicalAidPaid = paymentRows.filter((p) => p.payerType === 'MEDICAL_AID').reduce((s, p) => s + p.amountCents, 0);
  const patientPaid = paymentRows.filter((p) => p.payerType === 'PATIENT').reduce((s, p) => s + p.amountCents, 0);
  const cashReceived = paymentRows.filter((p) => p.method === 'CASH').reduce((s, p) => s + p.amountCents, 0);
  const adjustmentsTotal = adjustmentRows.reduce((s, a) => s + a.amountCents, 0);
  const outstandingPatient = invoiceRows.reduce((s, i) => s + Math.max(0, i.totalCents - i.adjustedCents - i.paidCents), 0);
  const outstandingClaimed = claimRows
    .filter((c) => ['SUBMITTED', 'ACCEPTED'].includes(c.status))
    .reduce((s, c) => s + c.claimedCents - c.schemePaidCents, 0);
  const patientPaidByInvoice = new Map<string, number>();
  for (const p of paymentRows) {
    if (p.payerType === 'PATIENT') {
      patientPaidByInvoice.set(p.invoiceId, (patientPaidByInvoice.get(p.invoiceId) ?? 0) + p.amountCents);
    }
  }
  const shortfall = claimRows
    .filter((c) => c.status === 'PROCESSED')
    .reduce((s, c) => s + Math.max(0, c.patientPortionCents - (patientPaidByInvoice.get(c.invoiceId) ?? 0)), 0);

  // Revenue by day
  const byDay = new Map<string, { billedCents: number; paidCents: number }>();
  for (const inv of invoiceRows) {
    const day = inv.createdAt.toISOString().slice(0, 10);
    const e = byDay.get(day) ?? { billedCents: 0, paidCents: 0 };
    e.billedCents += inv.totalCents;
    byDay.set(day, e);
  }
  const invById = new Map(invoiceRows.map((i) => [i.id, i]));
  for (const p of paymentRows) {
    const inv = invById.get(p.invoiceId);
    if (!inv) continue;
    const day = p.receivedAt.toISOString().slice(0, 10);
    const e = byDay.get(day) ?? { billedCents: 0, paidCents: 0 };
    e.paidCents += p.amountCents;
    byDay.set(day, e);
  }

  // Revenue by method
  const byMethod = new Map<string, number>();
  for (const p of paymentRows) byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + p.amountCents);

  // Revenue by location
  const locs = db.select().from(locations).where(eq(locations.practiceId, ctx.practiceId)).all();
  const byLocation = locs
    .filter((l) => locIds.includes(l.id))
    .map((l) => {
      const invs = invoiceRows.filter((i) => i.locationId === l.id);
      return {
        locationId: l.id,
        locationName: l.name,
        billedCents: invs.reduce((s, i) => s + i.totalCents, 0),
        paidCents: invs.reduce((s, i) => s + i.paidCents, 0),
      };
    });

  // Revenue by practitioner
  const practitionerRows = db
    .select({ practitioner: practitioners, user: users })
    .from(practitioners)
    .innerJoin(users, eq(users.id, practitioners.userId))
    .where(eq(practitioners.practiceId, ctx.practiceId))
    .all();
  const encounterRows = invoiceIds.length
    ? db
        .select({ id: encounters.id, practitionerId: encounters.practitionerId, invoiceId: invoices.id })
        .from(invoices)
        .innerJoin(encounters, eq(encounters.id, invoices.encounterId))
        .where(inArray(invoices.id, invoiceIds))
        .all()
    : [];
  const byPractitioner = practitionerRows
    .map((pr) => {
      const invs = encounterRows.filter((e) => e.practitionerId === pr.practitioner.id).map((e) => invById.get(e.invoiceId)!).filter(Boolean);
      return {
        practitionerId: pr.practitioner.id,
        name: `Dr ${pr.user.firstName} ${pr.user.lastName}`,
        billedCents: invs.reduce((s, i) => s + i.totalCents, 0),
        paidCents: invs.reduce((s, i) => s + i.paidCents, 0),
      };
    })
    .filter((r) => r.billedCents > 0 || r.paidCents > 0);
  const unattributed = encounterRows.filter((e) => !e.practitionerId).map((e) => invById.get(e.invoiceId)!).filter(Boolean);
  if (unattributed.length) {
    byPractitioner.push({
      practitionerId: null,
      name: 'Unattributed',
      billedCents: unattributed.reduce((s, i) => s + i.totalCents, 0),
      paidCents: unattributed.reduce((s, i) => s + i.paidCents, 0),
    });
  }

  // Debtor ageing on outstanding balances
  const now = Date.now();
  const buckets = [
    { label: 'Current', min: -Infinity, max: 30 },
    { label: '31-60 days', min: 30, max: 60 },
    { label: '61-90 days', min: 60, max: 90 },
    { label: '90+ days', min: 90, max: Infinity },
  ];
  const debtorAgeing = buckets.map((b) => {
    const invs = invoiceRows.filter((i) => {
      const balance = i.totalCents - i.adjustedCents - i.paidCents;
      if (balance <= 0) return false;
      const ageDays = (now - (i.issuedAt ?? i.createdAt).getTime()) / 86_400_000;
      return ageDays >= b.min && ageDays < b.max;
    });
    return {
      bucket: b.label,
      outstandingCents: invs.reduce((s, i) => s + (i.totalCents - i.adjustedCents - i.paidCents), 0),
      invoiceCount: invs.length,
    };
  });

  // Claim problems
  const patientById = new Map(db.select().from(patients).where(eq(patients.practiceId, ctx.practiceId)).all().map((p) => [p.id, p]));
  const claimProblems = claimRows
    .filter((c) => ['REJECTED', 'FAILED'].includes(c.status))
    .map((c) => {
      const p = patientById.get(c.patientId);
      return {
        claimId: c.id,
        patientName: p ? `${p.firstName} ${p.lastName}` : 'Unknown',
        status: c.status,
        claimedCents: c.claimedCents,
        message: c.externalReference ?? null,
      };
    });

  // Reconciliation: stored paidCents vs sum of active payments
  let mismatches = 0;
  for (const inv of invoiceRows) {
    const actualPaid = paymentRows.filter((p) => p.invoiceId === inv.id).reduce((s, p) => s + p.amountCents, 0);
    if (actualPaid !== inv.paidCents) mismatches += 1;
  }

  return {
    totalBilledCents: totalBilled,
    totalPaidCents: medicalAidPaid + patientPaid,
    cashReceivedCents: cashReceived,
    medicalAidPaidCents: medicalAidPaid,
    patientPaidCents: patientPaid,
    adjustmentsCents: Math.abs(adjustmentsTotal),
    outstandingPatientBalanceCents: outstandingPatient,
    outstandingClaimedCents: outstandingClaimed,
    shortfallCents: shortfall,
    invoiceCounts,
    claimCounts,
    revenueByDay: [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, v]) => ({ day, ...v })),
    revenueByMethod: [...byMethod.entries()].map(([method, amountCents]) => ({ method, amountCents })),
    revenueByLocation: byLocation,
    revenueByPractitioner: byPractitioner,
    debtorAgeing,
    claimProblems,
    reconciliation: { invoicesChecked: invoiceRows.length, mismatches },
  };
}

/** What happened financially with a single encounter. */
export function encounterFinancialStory(db: DB, practiceId: string, encounterId: string) {
  const invoice = db.select().from(invoices).where(eq(invoices.encounterId, encounterId)).get() ?? null;
  const claim = invoice ? db.select().from(claims).where(eq(claims.invoiceId, invoice.id)).get() ?? null : null;
  const pays = invoice ? db.select().from(payments).where(eq(payments.invoiceId, invoice.id)).all() : [];
  return {
    invoice,
    claim,
    payments: pays,
    billedCents: invoice?.totalCents ?? 0,
    claimedCents: claim?.claimedCents ?? null,
    approvedCents: claim?.approvedCents ?? null,
    medicalAidPaidCents: pays.filter((p) => p.payerType === 'MEDICAL_AID' && p.status === 'ACTIVE').reduce((s, p) => s + p.amountCents, 0),
    patientPaidCents: pays.filter((p) => p.payerType === 'PATIENT' && p.status === 'ACTIVE').reduce((s, p) => s + p.amountCents, 0),
    shortfallCents: claim ? Math.max(0, claim.patientPortionCents) : null,
    outstandingCents: invoice ? Math.max(0, invoice.totalCents - invoice.adjustedCents - invoice.paidCents) : 0,
    claimStatus: claim?.status ?? null,
    paymentStatus: invoice?.status ?? null,
  };
}

export { sql };
