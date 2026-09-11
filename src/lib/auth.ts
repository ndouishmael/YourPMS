/**
 * Authentication & authorization core.
 *
 * - Opaque session tokens (256-bit), stored hashed (SHA-256) server-side.
 * - Sessions expire (absolute TTL) and are revoked on logout.
 * - Fresh token per login => session fixation is structurally impossible.
 * - CSRF: double-submit token bound to the session + Origin/Fetch-Site checks.
 * - The practice/tenant context is ALWAYS resolved from the authenticated
 *   session (DB membership row) — never from request input.
 * - Location authorization is enforced per-request against location_memberships.
 */
import { cookies } from 'next/headers';
import { eq, and } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { getDb } from '@/db';
import { sessions, users, memberships, locations, locationMemberships, practices, supportAccessGrants } from '@/db/schema';
import { sha256, generateToken, constantTimeEqual } from '@/lib/crypto';
import { unauthorized, forbidden, AppError } from '@/lib/errors';
import { roleHas, type AnyRole, type Permission, permissionsFor } from '@/lib/rbac';
import type { PracticeRole } from '@/lib/rbac';

export const SESSION_COOKIE = 'ypms_session';
export const CSRF_COOKIE = 'ypms_csrf';
/** Absolute session lifetime. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
/** Idle timeout. */
export const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  platformRole: string | null;
}

export interface AuthContext {
  db: ReturnType<typeof getDb>;
  sessionId: string;
  csrfToken: string;
  user: SessionUser;
  kind: 'PLATFORM' | 'PRACTICE' | 'SUPPORT';
  practiceId: string | null;
  practiceName: string | null;
  role: AnyRole | null;
  locationIds: string[];
  permissions: Permission[];
  supportGrantId: string | null;
  ip: string;
  userAgent: string;
}

/* ------------------------------------------------------------------ */
/* Session lifecycle                                                  */
/* ------------------------------------------------------------------ */

export function cookieSecurityOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production' || process.env.FORCE_SECURE_COOKIES === 'true',
    path: '/',
  };
}

export function createSession(
  userId: string,
  meta: { ip?: string; userAgent?: string } = {},
): { token: string; csrfToken: string; expiresAt: Date } {
  const db = getDb();
  const token = generateToken(32);
  const csrfToken = generateToken(24);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  db.insert(sessions)
    .values({
      userId,
      tokenHash: sha256(token),
      csrfToken,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 500) ?? null,
      expiresAt,
    })
    .run();
  return { token, csrfToken, expiresAt };
}

export function revokeSession(token: string): void {
  const db = getDb();
  db.update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.tokenHash, sha256(token)))
    .run();
}

export function revokeAllUserSessions(userId: string): void {
  const db = getDb();
  db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.userId, userId)).run();
}

interface ResolvedSession {
  sessionId: string;
  csrfToken: string;
  user: SessionUser;
  supportGrantId: string | null;
}

/** Validate a session token; returns null when invalid/expired/revoked. */
export function resolveSessionToken(token: string | undefined | null): ResolvedSession | null {
  if (!token) return null;
  const db = getDb();
  const row = db
    .select({
      session: sessions,
      user: users,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, sha256(token)))
    .get();
  if (!row) return null;
  const { session, user } = row;
  const now = Date.now();
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() < now) return null;
  if (now - session.lastSeenAt.getTime() > SESSION_IDLE_MS) return null;
  if (!user.isActive) return null;
  // Touch lastSeenAt at most once per minute to avoid a write per request.
  if (now - session.lastSeenAt.getTime() > 60_000) {
    db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, session.id)).run();
  }
  return {
    sessionId: session.id,
    csrfToken: session.csrfToken,
    supportGrantId: session.supportGrantId,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      platformRole: user.platformRole,
    },
  };
}

/* ------------------------------------------------------------------ */
/* CSRF & origin validation                                           */
/* ------------------------------------------------------------------ */

export function isMutatingMethod(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

/**
 * Validate Origin (and Sec-Fetch-Site when present) against the request Host.
 * Blocks cross-site mutations even before CSRF token comparison.
 */
export function validateOrigin(req: NextRequest): boolean {
  const host = req.headers.get('host');
  if (!host) return false;
  const origin = req.headers.get('origin');
  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (originUrl.host !== host) return false;
    } catch {
      return false;
    }
  }
  const fetchSite = req.headers.get('sec-fetch-site');
  if (fetchSite && !['same-origin', 'same-site', 'none'].includes(fetchSite)) return false;
  return true;
}

export function validateCsrf(req: NextRequest, sessionCsrfToken: string): boolean {
  const header = req.headers.get('x-csrf-token');
  if (!header) return false;
  return constantTimeEqual(header, sessionCsrfToken);
}

/* ------------------------------------------------------------------ */
/* Auth context resolution                                            */
/* ------------------------------------------------------------------ */

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return 'unknown';
}

/** Resolve the full authorization context from a request. 401/403 on failure. */
export function requireAuth(req: NextRequest): AuthContext {
  const db = getDb();
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const resolved = resolveSessionToken(token);
  if (!resolved) throw unauthorized();

  if (isMutatingMethod(req.method)) {
    if (!validateOrigin(req)) {
      throw new AppError('Cross-origin request rejected', 403, 'ORIGIN_REJECTED');
    }
    if (!validateCsrf(req, resolved.csrfToken)) {
      throw new AppError('Invalid or missing CSRF token', 403, 'CSRF_REJECTED');
    }
  }

  const ip = clientIp(req);
  const userAgent = req.headers.get('user-agent') ?? '';

  // Platform administrator without active support grant.
  if (resolved.user.platformRole === 'PLATFORM_ADMIN' && !resolved.supportGrantId) {
    return {
      db,
      sessionId: resolved.sessionId,
      csrfToken: resolved.csrfToken,
      user: resolved.user,
      kind: 'PLATFORM',
      practiceId: null,
      practiceName: null,
      role: 'PLATFORM_ADMIN',
      locationIds: [],
      permissions: [],
      supportGrantId: null,
      ip,
      userAgent,
    };
  }

  // Scoped platform support access into a practice.
  if (resolved.user.platformRole === 'PLATFORM_ADMIN' && resolved.supportGrantId) {
    const grant = db
      .select()
      .from(supportAccessGrants)
      .where(eq(supportAccessGrants.id, resolved.supportGrantId))
      .get();
    if (!grant || grant.status !== 'ACTIVE' || grant.expiresAt.getTime() < Date.now()) {
      // Expired grant: fall back to platform context (no practice data).
      return {
        db,
        sessionId: resolved.sessionId,
        csrfToken: resolved.csrfToken,
        user: resolved.user,
        kind: 'PLATFORM',
        practiceId: null,
        practiceName: null,
        role: 'PLATFORM_ADMIN',
        locationIds: [],
        permissions: [],
        supportGrantId: null,
        ip,
        userAgent,
      };
    }
    const practice = db.select().from(practices).where(eq(practices.id, grant.practiceId)).get();
    const locs = db.select().from(locations).where(eq(locations.practiceId, grant.practiceId)).all();
    return {
      db,
      sessionId: resolved.sessionId,
      csrfToken: resolved.csrfToken,
      user: resolved.user,
      kind: 'SUPPORT',
      practiceId: grant.practiceId,
      practiceName: practice?.name ?? null,
      role: 'SUPPORT',
      locationIds: locs.map((l) => l.id),
      permissions: permissionsFor('SUPPORT'),
      supportGrantId: grant.id,
      ip,
      userAgent,
    };
  }

  // Practice user: context derived exclusively from the membership row.
  const membership = db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, resolved.user.id), eq(memberships.status, 'ACTIVE')))
    .get();
  if (!membership) throw forbidden('Your account is not attached to an active practice');
  const practice = db.select().from(practices).where(eq(practices.id, membership.practiceId)).get();
  if (!practice || practice.status !== 'ACTIVE') throw forbidden('Practice is not active');

  const locs = db
    .select({ location: locations })
    .from(locationMemberships)
    .innerJoin(locations, eq(locations.id, locationMemberships.locationId))
    .where(eq(locationMemberships.membershipId, membership.id))
    .all();

  return {
    db,
    sessionId: resolved.sessionId,
    csrfToken: resolved.csrfToken,
    user: resolved.user,
    kind: 'PRACTICE',
    practiceId: practice.id,
    practiceName: practice.name,
    role: membership.role as PracticeRole,
    locationIds: locs.map((l) => l.location.id),
    permissions: permissionsFor(membership.role as PracticeRole),
    supportGrantId: null,
    ip,
    userAgent,
  };
}

/** Require an authenticated practice context (practice staff or scoped support). */
export function requirePracticeContext(req: NextRequest): AuthContext {
  const ctx = requireAuth(req);
  if (ctx.kind !== 'PRACTICE' && ctx.kind !== 'SUPPORT') {
    throw forbidden('Practice context required');
  }
  return ctx;
}

export function requirePermission(ctx: AuthContext, permission: Permission): void {
  if (!ctx.permissions.includes(permission)) {
    throw forbidden(`Missing permission: ${permission}`);
  }
}

export function hasPermission(ctx: AuthContext, permission: Permission): boolean {
  return ctx.permissions.includes(permission);
}

/**
 * Location authorization. Throws 403 unless the location belongs to the
 * context's practice AND the user is authorized for it.
 */
export function requireLocationAccess(ctx: AuthContext, locationId: string): void {
  const db = getDb();
  const loc = db.select().from(locations).where(eq(locations.id, locationId)).get();
  if (!loc || loc.practiceId !== ctx.practiceId) {
    throw forbidden('Location not found in this practice');
  }
  if (!ctx.locationIds.includes(locationId)) {
    throw forbidden('You are not authorized for this location');
  }
}

export function assertRole(role: AnyRole, permission: Permission): boolean {
  return roleHas(role, permission);
}

/* ------------------------------------------------------------------ */
/* Page-level (server component) auth                                  */
/* ------------------------------------------------------------------ */

export interface PageAuthContext {
  user: SessionUser;
  kind: 'PLATFORM' | 'PRACTICE' | 'SUPPORT';
  practiceId: string | null;
  practiceName: string | null;
  role: AnyRole | null;
  locationIds: string[];
  permissions: Permission[];
  supportGrantId: string | null;
}

/** Resolve auth for server components (read-only, no CSRF needed). */
export async function getPageAuth(): Promise<PageAuthContext | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const resolved = resolveSessionToken(token);
  if (!resolved) return null;
  const db = getDb();

  if (resolved.user.platformRole === 'PLATFORM_ADMIN') {
    if (!resolved.supportGrantId) {
      return {
        user: resolved.user,
        kind: 'PLATFORM',
        practiceId: null,
        practiceName: null,
        role: 'PLATFORM_ADMIN',
        locationIds: [],
        permissions: [],
        supportGrantId: null,
      };
    }
    const grant = db.select().from(supportAccessGrants).where(eq(supportAccessGrants.id, resolved.supportGrantId)).get();
    if (!grant || grant.status !== 'ACTIVE' || grant.expiresAt.getTime() < Date.now()) {
      return {
        user: resolved.user,
        kind: 'PLATFORM',
        practiceId: null,
        practiceName: null,
        role: 'PLATFORM_ADMIN',
        locationIds: [],
        permissions: [],
        supportGrantId: null,
      };
    }
    const practice = db.select().from(practices).where(eq(practices.id, grant.practiceId)).get();
    const locs = db.select().from(locations).where(eq(locations.practiceId, grant.practiceId)).all();
    return {
      user: resolved.user,
      kind: 'SUPPORT',
      practiceId: grant.practiceId,
      practiceName: practice?.name ?? null,
      role: 'SUPPORT',
      locationIds: locs.map((l) => l.id),
      permissions: permissionsFor('SUPPORT'),
      supportGrantId: grant.id,
    };
  }

  const membership = db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, resolved.user.id), eq(memberships.status, 'ACTIVE')))
    .get();
  if (!membership) return null;
  const practice = db.select().from(practices).where(eq(practices.id, membership.practiceId)).get();
  if (!practice) return null;
  const locs = db
    .select({ location: locations })
    .from(locationMemberships)
    .innerJoin(locations, eq(locations.id, locationMemberships.locationId))
    .where(eq(locationMemberships.membershipId, membership.id))
    .all();
  return {
    user: resolved.user,
    kind: 'PRACTICE',
    practiceId: practice.id,
    practiceName: practice.name,
    role: membership.role as PracticeRole,
    locationIds: locs.map((l) => l.location.id),
    permissions: permissionsFor(membership.role as PracticeRole),
    supportGrantId: null,
  };
}
