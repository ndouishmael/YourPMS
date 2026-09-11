/**
 * Authentication service: practitioner onboarding (signup), login, logout,
 * staff invitation acceptance.
 */
import { eq, sql } from 'drizzle-orm';
import type { DB } from '@/db';
import {
  users,
  practices,
  locations,
  memberships,
  locationMemberships,
  practitioners,
  invitations,
} from '@/db/schema';
import { hashPassword, verifyPassword, sha256, generateToken } from '@/lib/crypto';
import { badRequest, unauthorized, notFound, AppError } from '@/lib/errors';
import { INVITABLE_ROLES, type PracticeRole } from '@/lib/rbac';
import { recordAudit } from './audit.service';

export interface SignupInput {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  practiceName: string;
  practiceNumber: string;
  locationName: string;
  hpcsaNumber?: string;
}

export interface AuthMeta {
  ip?: string;
  userAgent?: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function getUserByEmail(db: DB, email: string) {
  return db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${normalizeEmail(email)}`)
    .get();
}

/**
 * Practitioner onboarding: creates User -> Practice -> Initial Location ->
 * OWNER membership -> Practitioner profile in one transaction, then the caller
 * creates the authenticated session.
 */
export async function signupPractitioner(db: DB, input: SignupInput, meta: AuthMeta) {
  const email = normalizeEmail(input.email);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('Invalid email address');
  if (input.password.length < 10) throw badRequest('Password must be at least 10 characters');
  if (!input.firstName.trim() || !input.lastName.trim()) throw badRequest('First and last name are required');
  if (!input.practiceName.trim()) throw badRequest('Practice name is required');
  if (!/^\d{4,10}$/.test(input.practiceNumber.trim())) {
    throw badRequest('Practice number must be 4-10 digits');
  }
  if (!input.locationName.trim()) throw badRequest('Initial location name is required');

  const existing = await getUserByEmail(db, email);
  if (existing) throw new AppError('An account with this email already exists', 409, 'EMAIL_TAKEN');

  const existingNumber = db.select().from(practices).where(eq(practices.practiceNumber, input.practiceNumber.trim())).get();
  if (existingNumber) throw new AppError('This practice number is already registered', 409, 'PRACTICE_NUMBER_TAKEN');

  const userId: string = await db.transaction((tx) => {
    const [user] = tx
      .insert(users)
      .values({
        email,
        passwordHash: hashPassword(input.password),
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
      })
      .returning()
      .all();
    const [practice] = tx
      .insert(practices)
      .values({
        name: input.practiceName.trim(),
        practiceNumber: input.practiceNumber.trim(),
      })
      .returning()
      .all();
    const [location] = tx
      .insert(locations)
      .values({ practiceId: practice.id, name: input.locationName.trim() })
      .returning()
      .all();
    const [membership] = tx
      .insert(memberships)
      .values({ practiceId: practice.id, userId: user.id, role: 'OWNER' })
      .returning()
      .all();
    tx.insert(locationMemberships).values({ membershipId: membership.id, locationId: location.id }).run();
    tx.insert(practitioners)
      .values({ practiceId: practice.id, userId: user.id, hpcsaNumber: input.hpcsaNumber?.trim() || null })
      .run();
    return user.id;
  });

  await recordAudit({
    db,
    practiceId: null,
    actorUserId: userId,
    actorRole: 'OWNER',
    action: 'ACCOUNT_CREATED',
    entityType: 'user',
    entityId: userId,
    metadata: { email, onboarding: 'practitioner_signup' },
    ...meta,
  });

  return { userId, email };
}

export async function login(db: DB, email: string, password: string, meta: AuthMeta) {
  const user = await getUserByEmail(db, email ?? '');
  if (!user || !user.isActive || !verifyPassword(password ?? '', user.passwordHash)) {
    throw unauthorized('Invalid email or password');
  }
  await recordAudit({
    db,
    actorUserId: user.id,
    action: 'LOGIN',
    entityType: 'user',
    entityId: user.id,
    metadata: { email: user.email },
    ...meta,
  });
  return user;
}

export async function logout(db: DB, userId: string, meta: AuthMeta) {
  await recordAudit({ db, actorUserId: userId, action: 'LOGOUT', entityType: 'user', entityId: userId, ...meta });
}

/* ------------------------------------------------------------------ */
/* Staff invitations                                                  */
/* ------------------------------------------------------------------ */

export interface InviteInput {
  practiceId: string;
  invitedByUserId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: PracticeRole;
  locationIds: string[];
}

export async function createInvitation(db: DB, input: InviteInput, meta: AuthMeta) {
  const email = normalizeEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('Invalid email address');
  if (!INVITABLE_ROLES.includes(input.role)) throw badRequest('Role cannot be assigned via invitation');
  if (!input.locationIds.length) throw badRequest('At least one authorized location is required');
  if (!input.firstName.trim() || !input.lastName.trim()) throw badRequest('First and last name are required');

  // All locations must belong to the inviting practice.
  for (const locId of input.locationIds) {
    const loc = db.select().from(locations).where(eq(locations.id, locId)).get();
    if (!loc || loc.practiceId !== input.practiceId) throw badRequest('Invalid location selection');
  }

  const existingUser = await getUserByEmail(db, email);
  if (existingUser) {
    const m = db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, existingUser.id))
      .get();
    if (m) throw new AppError('This user already belongs to a practice', 409, 'ALREADY_MEMBER');
  }

  const token = generateToken(24);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const [invitation] = db
    .insert(invitations)
    .values({
      practiceId: input.practiceId,
      email,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      role: input.role,
      locationIds: JSON.stringify([...new Set(input.locationIds)]),
      tokenHash: sha256(token),
      invitedByUserId: input.invitedByUserId,
      expiresAt,
    })
    .returning()
    .all();

  await recordAudit({
    db,
    practiceId: input.practiceId,
    actorUserId: input.invitedByUserId,
    action: 'STAFF_INVITED',
    entityType: 'invitation',
    entityId: invitation.id,
    metadata: { email, role: input.role, locationIds: input.locationIds },
    ...meta,
  });

  // Phase 1: the invitation link is delivered out-of-band (email relay is a
  // deployment concern). The API returns the accept path only to the inviter.
  return { invitation, token, acceptPath: `/accept-invitation?token=${token}` };
}

export interface AcceptInvitationInput {
  token: string;
  password: string;
}

/**
 * Accept a staff invitation: the practice, role and location permissions come
 * from the invitation row — the invitee cannot influence them.
 */
export async function acceptInvitation(db: DB, input: AcceptInvitationInput, meta: AuthMeta) {
  if (input.password.length < 10) throw badRequest('Password must be at least 10 characters');
  const invitation = db
    .select()
    .from(invitations)
    .where(eq(invitations.tokenHash, sha256(input.token ?? '')))
    .get();
  if (!invitation) throw notFound('Invitation not found');
  if (invitation.acceptedAt) throw new AppError('Invitation already used', 410, 'INVITATION_USED');
  if (invitation.revokedAt) throw new AppError('Invitation revoked', 410, 'INVITATION_REVOKED');
  if (invitation.expiresAt.getTime() < Date.now()) throw new AppError('Invitation expired', 410, 'INVITATION_EXPIRED');

  const existingUser = await getUserByEmail(db, invitation.email);
  if (existingUser) {
    const m = db.select().from(memberships).where(eq(memberships.userId, existingUser.id)).get();
    if (m) throw new AppError('This user already belongs to a practice', 409, 'ALREADY_MEMBER');
  }

  const locationIds = JSON.parse(invitation.locationIds) as string[];
  const userId: string = await db.transaction((tx) => {
    let uid: string;
    if (existingUser) {
      uid = existingUser.id;
      tx.update(users).set({ passwordHash: hashPassword(input.password) }).where(eq(users.id, uid)).run();
    } else {
      const [u] = tx
        .insert(users)
        .values({
          email: invitation.email,
          passwordHash: hashPassword(input.password),
          firstName: invitation.firstName,
          lastName: invitation.lastName,
        })
        .returning()
        .all();
      uid = u.id;
    }
    const [membership] = tx
      .insert(memberships)
      .values({ practiceId: invitation.practiceId, userId: uid, role: invitation.role })
      .returning()
      .all();
    for (const locId of locationIds) {
      tx.insert(locationMemberships).values({ membershipId: membership.id, locationId: locId }).run();
    }
    if (invitation.role === 'PRACTITIONER') {
      tx.insert(practitioners).values({ practiceId: invitation.practiceId, userId: uid }).run();
    }
    tx.update(invitations).set({ acceptedAt: new Date() }).where(eq(invitations.id, invitation.id)).run();
    return uid;
  });

  await recordAudit({
    db,
    practiceId: invitation.practiceId,
    actorUserId: userId,
    actorRole: invitation.role,
    action: 'INVITATION_ACCEPTED',
    entityType: 'invitation',
    entityId: invitation.id,
    metadata: { email: invitation.email, role: invitation.role, locationIds },
    ...meta,
  });

  return { userId, practiceId: invitation.practiceId };
}
