import AppShell from '@/components/AppShell';
import { pageLocation } from '@/lib/page-context';
import { getPractice, listStaff, listInvitations, listPractitioners } from '@/services/practice.service';
import { listAdapters } from '@/services/claims/adapters';
import { fmtDate } from '@/lib/format';
import { SettingsForm, LocationManager, StaffManager } from '@/components/SettingsPanels';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const { auth, db, authorized } = await pageLocation({});
  const practice = getPractice(db, auth.practiceId!);
  const staff = listStaff(db, auth.practiceId!);
  const invitations = listInvitations(db, auth.practiceId!);
  const practitioners = listPractitioners(db, auth.practiceId!);
  const canManage = auth.permissions.includes('settings:manage');
  const canManageStaff = auth.permissions.includes('staff:manage');
  const locNames = new Map(authorized.map((l) => [l.id, l.name]));

  return (
    <AppShell active="settings" title="Settings" crumb={`${auth.practiceName} · practice administration`}>
      <div className="grid cols-2">
        <div className="card">
          <div className="card-head"><h2>Practice</h2></div>
          <div className="card-body">
            <div className="kv">
              <div className="k">Practice name</div>
              <div><strong>{practice.name}</strong></div>
              <div className="k">Practice number</div>
              <div className="mono">{practice.practiceNumber}</div>
              <div className="k">Practitioners</div>
              <div>{practitioners.map((p) => `Dr ${p.user.firstName} ${p.user.lastName}`).join(', ')}</div>
            </div>
            {canManage && (
              <SettingsForm
                practiceName={practice.name}
                transferThreshold={practice.transferThreshold}
                claimsAdapterId={practice.claimsAdapterId}
                adapters={listAdapters().map((a) => ({ id: a.id, name: a.name, configured: a.configured }))}
              />
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Locations</h2><span className="badge gray">{authorized.length}</span></div>
          <div className="card-body">
            <LocationManager
              locations={authorized.map((l) => ({ id: l.id, name: l.name, isActive: l.isActive }))}
              canManage={auth.permissions.includes('locations:manage')}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Staff</h2>
          <span className="badge gray">{staff.length} members</span>
        </div>
        <div className="card-body">
          <StaffManager
            staff={staff.map((s) => ({
              membershipId: s.membershipId,
              name: `${s.firstName} ${s.lastName}`,
              email: s.email,
              role: s.role,
              status: s.status,
              locationNames: s.locationIds.map((l) => locNames.get(l) ?? '✕').join(', ') || 'none',
              locationIds: s.locationIds,
            }))}
            invitations={invitations.map((i) => ({
              id: i.id,
              email: i.email,
              role: i.role,
              status: i.acceptedAt ? 'ACCEPTED' : i.revokedAt ? 'REVOKED' : i.expiresAt.getTime() < Date.now() ? 'EXPIRED' : 'PENDING',
              expiresAt: fmtDate(i.expiresAt),
            }))}
            locations={authorized.map((l) => ({ id: l.id, name: l.name }))}
            canManage={canManageStaff}
            viewerRole={auth.role ?? ''}
          />
        </div>
      </div>
    </AppShell>
  );
}
