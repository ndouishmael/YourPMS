/**
 * Practice management: settings, locations, staff memberships.
 * All operations are tenant-scoped by practiceId resolved from the session.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DB } from '@/db';
import {
  practices,
  locations,
  memberships,
  locationMemberships,
  users,
  practitioners,
  invitations,
  notifications,
} from '@/db/schema';
import { badRequest, notFound, forbidden } from '@/lib/errors';
import { INVITABLE_ROLES, type PracticeRole } from '@/lib/rbac';
import { recordAudit } from './audit.service';

export function getPractice(db: DB, practiceId: string) {
  const practice = db.select().from(practices).where(eq(practices.id, practiceId)).get();
  if (!practice) throw notFound('Practice not found');
  return practice;
}

export function listLocations(db: DB, practiceId: string) {
  return db.select().from(locations).where(eq(locations.practiceId, practiceId)).all();
}

export function listLocationsByIds(db: DB, ids: string[]) {
  if (!ids.length) return [];
  return db.select().from(locations).where(inArray(locations.id, ids)).all();
}

export function getLocation(db: DB, practiceId: string, locationId: string) {
  const loc = db.select().from(locations).where(eq(locations.id, locationId)).get();
  if (!loc || loc.practiceId !== practiceId) throw notFound('Location not found');
  return loc;
}

export async function createLocation(
  db: DB,
  params: { practiceId: string; name: string; code?: string; actorUserId: string },
  meta: { ip?: string; userAgent?: string } = {},
) {
  if (!params.name.trim()) throw badRequest('Location name is required');
  const dup = db
    .select()
    .from(locations)
    .where(and(eq(locations.practiceId, params.practiceId), sql`lower(${locations.name}) = ${params.name.trim().toLowerCase()}`))
    .get();
  if (dup) throw badRequest('A location with this name already exists');
  const [loc] = db
    .insert(locations)
    .values({ practiceId: params.practiceId, name: params.name.trim(), code: params.code?.trim() || null })
    .returning()
    .all();
  await recordAudit({
    db,
    practiceId: params.practiceId,
    actorUserId: params.actorUserId,
    action: 'LOCATION_CREATED',
    entityType: 'location',
    entityId: loc.id,
    metadata: { name: loc.name },
    ...meta,
  });
  return loc;
}

export async function updateLocation(
  db: DB,
  params: { practiceId: string; locationId: string; name?: string; isActive?: boolean; actorUserId: string },
  meta: { ip?: string; userAgent?: string } = {},
) {
  const loc = getLocation(db, params.practiceId, params.locationId);
  const patch: Partial<typeof locations.$inferInsert> = {};
  if (params.name !== undefined) {
    if (!params.name.trim()) throw badRequest('Location name cannot be empty');
    patch.name = params.name.trim();
  }
  if (params.isActive !== undefined) patch.isActive = params.isActive;
  const [updated] = db.update(locations).set(patch).where(eq(locations.id, loc.id)).returning().all();
  await recordAudit({
    db,
    practiceId: params.practiceId,
    actorUserId: params.actorUserId,
    action: 'LOCATION_UPDATED',
    entityType: 'location',
    entityId: loc.id,
    metadata: { patch: { name: params.name, isActive: params.isActive } },
    ...meta,
  });
  return updated;
}

export async function updatePracticeSettings(
  db: DB,
  params: { practiceId: string; transferThreshold?: number; claimsAdapterId?: string; name?: string; actorUserId: string },
  meta: { ip?: string; userAgent?: string } = {},
) {
  const practice = getPractice(db, params.practiceId);
  const patch: Partial<typeof practices.$inferInsert> = {};
  if (params.transferThreshold !== undefined) {
    if (!Number.isInteger(params.transferThreshold) || params.transferThreshold < 1 || params.transferThreshold > 50) {
      throw badRequest('Transfer threshold must be an integer between 1 and 50');
    }
    patch.transferThreshold = params.transferThreshold;
  }
  if (params.claimsAdapterId !== undefined) patch.claimsAdapterId = params.claimsAdapterId;
  if (params.name !== undefined) {
    if (!params.name.trim()) throw badRequest('Practice name cannot be empty');
    patch.name = params.name.trim();
  }
  const [updated] = db.update(practices).set(patch).where(eq(practices.id, practice.id)).returning().all();
  await recordAudit({
    db,
    practiceId: params.practiceId,
    actorUserId: params.actorUserId,
    action: 'SETTINGS_UPDATED',
    entityType: 'practice',
    entityId: params.practiceId,
    metadata: { patch: { ...patch } },
    ...meta,
  });
  return updated;
}

/* ------------------------------------------------------------------ */
/* Staff                                                              */
/* ------------------------------------------------------------------ */

export interface StaffMember {
  membershipId: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  status: string;
  locationIds: string[];
}

export function listStaff(db: DB, practiceId: string): StaffMember[] {
  const rows = db
    .select({ membership: memberships, user: users })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.practiceId, practiceId))
    .all();
  const memIds = rows.map((r) => r.membership.id);
  const lms = memIds.length
    ? db.select().from(locationMemberships).where(inArray(locationMemberships.membershipId, memIds)).all()
    : [];
  const byMembership = new Map<string, string[]>();
  for (const lm of lms) {
    const arr = byMembership.get(lm.membershipId) ?? [];
    arr.push(lm.locationId);
    byMembership.set(lm.membershipId, arr);
  }
  return rows.map((r) => ({
    membershipId: r.membership.id,
    userId: r.user.id,
    firstName: r.user.firstName,
    lastName: r.user.lastName,
    email: r.user.email,
    role: r.membership.role,
    status: r.membership.status,
    locationIds: byMembership.get(r.membership.id) ?? [],
  }));
}

export async function updateStaffMember(
  db: DB,
  params: {
    practiceId: string;
    membershipId: string;
    actorUserId: string;
    role?: PracticeRole;
    status?: 'ACTIVE' | 'SUSPENDED';
    locationIds?: string[];
  },
  meta: { ip?: string; userAgent?: string } = {},
) {
  const membership = db.select().from(memberships).where(eq(memberships.id, params.membershipId)).get();
  if (!membership || membership.practiceId !== params.practiceId) throw notFound('Staff member not found');
  if (membership.role === 'OWNER') throw forbidden('The practice owner membership cannot be modified');

  if (params.locationIds !== undefined) {
    if (!params.locationIds.length) throw badRequest('At least one location is required');
    const locs = db.select().from(locations).where(eq(locations.practiceId, params.practiceId)).all();
    const valid = new Set(locs.map((l) => l.id));
    for (const l of params.locationIds) if (!valid.has(l)) throw badRequest('Invalid location selection');
    await db.transaction((tx) => {
      tx.delete(locationMemberships).where(eq(locationMemberships.membershipId, membership.id)).run();
      for (const locId of new Set(params.locationIds!)) {
        tx.insert(locationMemberships).values({ membershipId: membership.id, locationId: locId }).run();
      }
    });
  }
  if (params.role !== undefined) {
    if (!INVITABLE_ROLES.includes(params.role)) throw badRequest('Invalid role');
    db.update(memberships).set({ role: params.role }).where(eq(memberships.id, membership.id)).run();
  }
  if (params.status !== undefined) {
    db.update(memberships).set({ status: params.status }).where(eq(memberships.id, membership.id)).run();
  }

  await recordAudit({
    db,
    practiceId: params.practiceId,
    actorUserId: params.actorUserId,
    action: 'STAFF_UPDATED',
    entityType: 'membership',
    entityId: membership.id,
    metadata: { role: params.role, status: params.status, locationIds: params.locationIds },
    ...meta,
  });
  return { ok: true };
}

export function listInvitations(db: DB, practiceId: string) {
  return db
    .select()
    .from(invitations)
    .where(eq(invitations.practiceId, practiceId))
    .all()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function getPractitionerForUser(db: DB, practiceId: string, userId: string) {
  return db
    .select()
    .from(practitioners)
    .where(and(eq(practitioners.practiceId, practiceId), eq(practitioners.userId, userId)))
    .get();
}

export function listPractitioners(db: DB, practiceId: string) {
  return db
    .select({ practitioner: practitioners, user: users })
    .from(practitioners)
    .innerJoin(users, eq(users.id, practitioners.userId))
    .where(eq(practitioners.practiceId, practiceId))
    .all();
}

export function listNotifications(db: DB, practiceId: string, limit = 50) {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.practiceId, practiceId))
    .all()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);
}

export function notifyPractice(
  db: DB,
  params: { practiceId: string; type: string; title: string; body?: string; linkPath?: string },
) {
  db.insert(notifications)
    .values({
      practiceId: params.practiceId,
      type: params.type,
      title: params.title,
      body: params.body ?? null,
      linkPath: params.linkPath ?? null,
    })
    .run();
}
