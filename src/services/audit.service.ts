/**
 * Audit trail service.
 *
 * Append-only, hash-chained records: hash = sha256(prevHash + canonical fields).
 * Any mutation of a row breaks the chain and is detectable via verifyChain().
 * No application code path updates or deletes audit rows.
 */
import { desc, eq, and, sql, isNull } from 'drizzle-orm';
import type { DB } from '@/db';
import { auditLogs, securityEvents } from '@/db/schema';
import { sha256 } from '@/lib/crypto';

export interface AuditInput {
  db: DB;
  practiceId?: string | null;
  actorUserId?: string | null;
  actorRole?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  locationId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string | null;
}

function canonicalize(input: AuditInput, createdAt: number): string {
  const parts = [
    input.practiceId ?? '',
    input.actorUserId ?? '',
    input.actorRole ?? '',
    input.action,
    input.entityType ?? '',
    input.entityId ?? '',
    input.locationId ?? '',
    JSON.stringify(input.metadata ?? {}),
    String(createdAt),
  ];
  return parts.join('|');
}

export async function recordAudit(input: AuditInput): Promise<void> {
  const createdAt = Date.now();
  // Serialize chain writes with a transaction; compute prev hash inside.
  await input.db.transaction((tx) => {
    const last = tx
      .select({ hash: auditLogs.hash })
      .from(auditLogs)
      .orderBy(desc(auditLogs.seq))
      .limit(1)
      .all();
    const prevHash = last[0]?.hash ?? 'GENESIS';
    const seq = (tx.select({ n: sql<number>`coalesce(max(${auditLogs.seq}), 0)` }).from(auditLogs).all()[0]?.n ?? 0) + 1;
    const hash = sha256(prevHash + canonicalize(input, createdAt));
    tx.insert(auditLogs)
      .values({
        practiceId: input.practiceId ?? null,
        actorUserId: input.actorUserId ?? null,
        actorRole: input.actorRole ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        locationId: input.locationId ?? null,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        ip: input.ip,
        userAgent: input.userAgent,
        seq,
        prevHash,
        hash,
        createdAt: new Date(createdAt),
      })
      .run();
  });
}

export async function recordSecurityEvent(
  db: DB,
  event: {
    type: string;
    userId?: string | null;
    email?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    detail?: string;
  },
): Promise<void> {
  db.insert(securityEvents)
    .values({
      type: event.type,
      userId: event.userId ?? null,
      email: event.email ?? null,
      ip: event.ip,
      userAgent: event.userAgent,
      detail: event.detail,
    })
    .run();
}

/** Verify the full hash chain (tamper evidence). Returns first broken seq or null. */
export function verifyAuditChain(db: DB): { ok: boolean; brokenAtSeq?: number; count: number } {
  const rows = db.select().from(auditLogs).orderBy(auditLogs.seq).all();
  let prevHash = 'GENESIS';
  for (const row of rows) {
    const expected = sha256(
      prevHash +
        [
          row.practiceId ?? '',
          row.actorUserId ?? '',
          row.actorRole ?? '',
          row.action,
          row.entityType ?? '',
          row.entityId ?? '',
          row.locationId ?? '',
          row.metadata ?? '{}',
          String(row.createdAt.getTime()),
        ].join('|'),
    );
    if (row.prevHash !== prevHash || row.hash !== expected) {
      return { ok: false, brokenAtSeq: row.seq ?? undefined, count: rows.length };
    }
    prevHash = row.hash;
  }
  return { ok: true, count: rows.length };
}

export function listAudit(
  db: DB,
  opts: { practiceId?: string | null; limit?: number; action?: string } = {},
) {
  const limit = Math.min(opts.limit ?? 100, 500);
  const conds = [];
  if (typeof opts.practiceId === 'string') conds.push(eq(auditLogs.practiceId, opts.practiceId));
  else if (opts.practiceId === null) conds.push(isNull(auditLogs.practiceId));
  if (opts.action) conds.push(eq(auditLogs.action, opts.action));
  const q = db.select().from(auditLogs);
  const rows = conds.length
    ? q.where(conds.length === 1 ? conds[0] : and(...conds)).orderBy(desc(auditLogs.seq)).limit(limit).all()
    : q.orderBy(desc(auditLogs.seq)).limit(limit).all();
  return rows;
}

export function listSecurityEvents(db: DB, limit = 100) {
  return db.select().from(securityEvents).orderBy(desc(securityEvents.createdAt)).limit(limit).all();
}
