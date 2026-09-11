/**
 * Role-based access control.
 *
 * Roles: PLATFORM_ADMIN, OWNER, MANAGER, RECEPTIONIST, PRACTITIONER.
 * Permissions are computed server-side from the membership row; the UI merely
 * mirrors them. A platform admin in scoped support mode receives the SUPPORT
 * role, which is read-only by design.
 */

export const ROLES = ['OWNER', 'MANAGER', 'RECEPTIONIST', 'PRACTITIONER'] as const;
export type PracticeRole = (typeof ROLES)[number];
export type AnyRole = PracticeRole | 'PLATFORM_ADMIN' | 'SUPPORT';

export const PERMISSIONS = [
  // practice management
  'practice:manage',
  'practice:view',
  'locations:manage',
  'staff:manage',
  'staff:view',
  'settings:manage',
  // clinical
  'patients:create',
  'patients:view',
  'patients:edit',
  'clinical:access', // view clinical notes / diagnoses
  'encounter:start',
  'encounter:complete',
  'queue:manage', // check-in, queue view
  'appointments:manage',
  // billing & finance
  'billing:manage',
  'payments:record',
  'payments:reverse',
  'payments:adjust',
  'invoices:void',
  'claims:submit',
  'claims:respond',
  'finance:view',
  // audit & transfers
  'audit:view',
  'transfers:decide',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const MATRIX: Record<AnyRole, Permission[]> = {
  PLATFORM_ADMIN: [], // platform admins have no practice permissions; support access is scoped separately
  SUPPORT: [
    'practice:view',
    'staff:view',
    'patients:view',
    'clinical:access',
    'billing:manage',
    'finance:view',
    'audit:view',
  ],
  OWNER: [...PERMISSIONS], // full practice control
  MANAGER: [
    'practice:view',
    'locations:manage',
    'staff:manage',
    'staff:view',
    'settings:manage',
    'patients:create',
    'patients:view',
    'patients:edit',
    'queue:manage',
    'appointments:manage',
    'billing:manage',
    'payments:record',
    'payments:reverse',
    'payments:adjust',
    'invoices:void',
    'claims:submit',
    'claims:respond',
    'finance:view',
    'audit:view',
    'transfers:decide',
  ],
  RECEPTIONIST: [
    'practice:view',
    'staff:view',
    'patients:create',
    'patients:view',
    'patients:edit',
    'queue:manage',
    'appointments:manage',
    'billing:manage',
    'payments:record',
    'claims:submit',
    'finance:view',
  ],
  PRACTITIONER: [
    'practice:view',
    'staff:view',
    'patients:view',
    'clinical:access',
    'encounter:start',
    'encounter:complete',
    'appointments:manage',
    'queue:manage',
  ],
};

export function roleHas(role: AnyRole, permission: Permission): boolean {
  return MATRIX[role]?.includes(permission) ?? false;
}

export function permissionsFor(role: AnyRole): Permission[] {
  return [...(MATRIX[role] ?? [])];
}

/** Roles that may be assigned via staff invitation (never OWNER — single owner per practice). */
export const INVITABLE_ROLES: PracticeRole[] = ['MANAGER', 'RECEPTIONIST', 'PRACTITIONER'];
