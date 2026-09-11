/**
 * Platform administration ("God Mode") with scoped, auditable, time-limited
 * support access. Platform admins are NOT unrestricted users: entering a
 * practice requires an explicit reason, is time-boxed, read-only, and every
 * action is audited.
 */
import { and, eq, desc, sql } from 'drizzle-orm';
import type { DB } from '@/db';
import {
  practices,
  locations,
  users,
  memberships,
  patients,
  encounters,
  invoices,
  payments,
  claims,
  supportAccessGrants,
  practitioners,
} from '@/db/schema';
import { badRequest, notFound, forbidden } from '@/lib/errors';
import { recordAudit } from './audit.service';

export interface PlatformContext {
  db: DB;
  actorUserId: string;
  ip?: string;
  userAgent?: string;
}

export function listPractices(db: DB) {
  const rows = db
    .select({ practice: practices })
    .from(practices)
    .all()
    .map((r) => r.practice)
    .sort((a, b) => a.name.localeCompare(b.name));
  return rows.map((p) => {
    const locs = db.select().from(locations).where(eq(locations.practiceId, p.id)).all();
    const staff = db.select().from(memberships).where(eq(memberships.practiceId, p.id)).all();
    const patientCount = db.select({ n: sql<number>`count(*)` }).from(patients).where(eq(patients.practiceId, p.id)).get()?.n ?? 0;
    const encounterCount = db.select({ n: sql<number>`count(*)` }).from(encounters).where(eq(encounters.practiceId, p.id)).get()?.n ?? 0;
    return { practice: p, locationCount: locs.length, staffCount: staff.length, patientCount, encounterCount };
  });
}

export function platformPracticeDetail(db: DB, practiceId: string) {
  const practice = db.select().from(practices).where(eq(practices.id, practiceId)).get();
  if (!practice) throw notFound('Practice not found');
  const locs = db.select().from(locations).where(eq(locations.practiceId, practiceId)).all();
  const staff = db
    .select({ membership: memberships, user: users })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.practiceId, practiceId))
    .all();
  const prs = db
    .select({ practitioner: practitioners, user: users })
    .from(practitioners)
    .innerJoin(users, eq(users.id, practitioners.userId))
    .where(eq(practitioners.practiceId, practiceId))
    .all();
  const counts = {
    patients: db.select({ n: sql<number>`count(*)` }).from(patients).where(eq(patients.practiceId, practiceId)).get()?.n ?? 0,
    encounters: db.select({ n: sql<number>`count(*)` }).from(encounters).where(eq(encounters.practiceId, practiceId)).get()?.n ?? 0,
    invoices: db.select({ n: sql<number>`count(*)` }).from(invoices).where(eq(invoices.practiceId, practiceId)).get()?.n ?? 0,
    payments: db.select({ n: sql<number>`count(*)` }).from(payments).where(eq(payments.practiceId, practiceId)).get()?.n ?? 0,
    claims: db.select({ n: sql<number>`count(*)` }).from(claims).where(eq(claims.practiceId, practiceId)).get()?.n ?? 0,
  };
  return { practice, locations: locs, staff, practitioners: prs, counts };
}

export function platformMetrics(db: DB) {
  return {
    practices: db.select({ n: sql<number>`count(*)` }).from(practices).get()?.n ?? 0,
    users: db.select({ n: sql<number>`count(*)` }).from(users).get()?.n ?? 0,
    patients: db.select({ n: sql<number>`count(*)` }).from(patients).get()?.n ?? 0,
    encounters: db.select({ n: sql<number>`count(*)` }).from(encounters).get()?.n ?? 0,
    invoices: db.select({ n: sql<number>`count(*)` }).from(invoices).get()?.n ?? 0,
    payments: db.select({ n: sql<number>`count(*)` }).from(payments).get()?.n ?? 0,
    claims: db.select({ n: sql<number>`count(*)` }).from(claims).get()?.n ?? 0,
    activeSupportGrants:
      db
        .select({ n: sql<number>`count(*)` })
        .from(supportAccessGrants)
        .where(eq(supportAccessGrants.status, 'ACTIVE'))
        .get()?.n ?? 0,
    db: platformDbInfo(db),
  };
}

export function platformDbInfo(db: DB) {
  const client = db.$client as unknown as { name: string; pragma: (s: string) => unknown; prepare: (s: string) => { get: () => unknown } };
  let pageSize = 4096;
  let pageCount = 0;
  let journalMode = 'unknown';
  let foreignKeys = 'unknown';
  try {
    const pc = client.pragma('page_count') as Array<{ page_count?: number }>;
    pageCount = Number(Array.isArray(pc) ? pc[0]?.page_count : (pc as { page_count?: number })?.page_count ?? 0);
    const ps = client.pragma('page_size') as Array<{ page_size?: number }>;
    pageSize = Number(Array.isArray(ps) ? ps[0]?.page_size : (ps as { page_size?: number })?.page_size ?? 4096);
    const jm = client.pragma('journal_mode') as Array<{ journal_mode?: string }>;
    journalMode = String(Array.isArray(jm) ? jm[0]?.journal_mode : 'unknown');
    const fk = client.pragma('foreign_keys') as Array<{ foreign_keys?: number }>;
    foreignKeys = String(Array.isArray(fk) ? fk[0]?.foreign_keys : 'unknown');
  } catch {
    /* informational only */
  }
  return { pageSize, pageCount, sizeBytes: pageSize * pageCount, journalMode, foreignKeys };
}

/* ------------------------------------------------------------------ */
/* Support access (scoped god mode)                                   */
/* ------------------------------------------------------------------ */

export async function createSupportGrant(
  ctx: PlatformContext,
  input: { practiceId: string; reason: string; minutes?: number },
) {
  const { db } = ctx;
  const practice = db.select().from(practices).where(eq(practices.id, input.practiceId)).get();
  if (!practice) throw notFound('Practice not found');
  if (!input.reason?.trim() || input.reason.trim().length < 10) {
    throw badRequest('A support reason of at least 10 characters is required');
  }
  const minutes = input.minutes ?? 60;
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 240) {
    throw badRequest('Support access duration must be 5-240 minutes');
  }
  const [grant] = db
    .insert(supportAccessGrants)
    .values({
      platformAdminUserId: ctx.actorUserId,
      practiceId: practice.id,
      reason: input.reason.trim(),
      startsAt: new Date(),
      expiresAt: new Date(Date.now() + minutes * 60_000),
    })
    .returning()
    .all();

  await recordAudit({
    db,
    practiceId: practice.id,
    actorUserId: ctx.actorUserId,
    actorRole: 'PLATFORM_ADMIN',
    action: 'SUPPORT_ACCESS_GRANTED',
    entityType: 'support_grant',
    entityId: grant.id,
    metadata: { reason: input.reason.trim(), expiresAt: grant.expiresAt.toISOString(), minutes },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return grant;
}

export async function revokeSupportGrant(ctx: PlatformContext, grantId: string) {
  const { db } = ctx;
  const grant = db.select().from(supportAccessGrants).where(eq(supportAccessGrants.id, grantId)).get();
  if (!grant) throw notFound('Support grant not found');
  db.update(supportAccessGrants)
    .set({ status: 'REVOKED', revokedAt: new Date(), revokedByUserId: ctx.actorUserId })
    .where(eq(supportAccessGrants.id, grant.id))
    .run();
  await recordAudit({
    db,
    practiceId: grant.practiceId,
    actorUserId: ctx.actorUserId,
    actorRole: 'PLATFORM_ADMIN',
    action: 'SUPPORT_ACCESS_REVOKED',
    entityType: 'support_grant',
    entityId: grant.id,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return { ok: true };
}

export function listSupportGrants(db: DB, limit = 50) {
  return db
    .select({ grant: supportAccessGrants, practice: practices, admin: users })
    .from(supportAccessGrants)
    .innerJoin(practices, eq(practices.id, supportAccessGrants.practiceId))
    .innerJoin(users, eq(users.id, supportAccessGrants.platformAdminUserId))
    .all()
    .sort((a, b) => b.grant.createdAt.getTime() - a.grant.createdAt.getTime())
    .slice(0, limit);
}

export function getActiveGrant(db: DB, grantId: string) {
  const grant = db.select().from(supportAccessGrants).where(eq(supportAccessGrants.id, grantId)).get();
  if (!grant) throw notFound('Support grant not found');
  if (grant.status !== 'ACTIVE' || grant.expiresAt.getTime() < Date.now()) {
    throw forbidden('Support access is not active');
  }
  return grant;
}

/** Enter practice support mode: bind the grant to the admin's session (route layer). */
export async function enterSupportMode(ctx: PlatformContext, grantId: string) {
  const grant = getActiveGrant(ctx.db, grantId);
  if (grant.platformAdminUserId !== ctx.actorUserId) throw forbidden('This support grant belongs to another administrator');
  await recordAudit({
    db: ctx.db,
    practiceId: grant.practiceId,
    actorUserId: ctx.actorUserId,
    actorRole: 'PLATFORM_ADMIN',
    action: 'SUPPORT_ACCESS_ENTERED',
    entityType: 'support_grant',
    entityId: grant.id,
    metadata: { practiceId: grant.practiceId },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return grant;
}

/** Leave support mode (audited). */
export async function exitSupportMode(ctx: PlatformContext, practiceId: string) {
  await recordAudit({
    db: ctx.db,
    practiceId,
    actorUserId: ctx.actorUserId,
    actorRole: 'PLATFORM_ADMIN',
    action: 'SUPPORT_ACCESS_EXITED',
    entityType: 'practice',
    entityId: practiceId,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
}

export function listPlatformUsers(db: DB) {
  return db.select().from(users).where(eq(users.platformRole, 'PLATFORM_ADMIN')).all();
}

export { desc };
