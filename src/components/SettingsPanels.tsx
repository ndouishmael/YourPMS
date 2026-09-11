'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client';
import { humanStatus } from '@/lib/format';

export function SettingsForm({
  transferThreshold,
  claimsAdapterId,
  adapters,
}: {
  practiceName: string;
  transferThreshold: number;
  claimsAdapterId: string;
  adapters: Array<{ id: string; name: string; configured: boolean }>;
}) {
  const router = useRouter();
  const [threshold, setThreshold] = useState(transferThreshold);
  const [adapterId, setAdapterId] = useState(claimsAdapterId);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api('/api/practice', { method: 'PATCH', body: JSON.stringify({ transferThreshold: threshold, claimsAdapterId: adapterId }) });
      setMsg('Settings saved.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save settings');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 14 }}>
      {error && <div className="form-error">{error}</div>}
      {msg && <div className="form-ok">{msg}</div>}
      <div className="frow">
        <div className="field">
          <label className="f">Patient transfer threshold (completed alternate-location encounters)</label>
          <input type="number" min={1} max={50} value={threshold} onChange={(e) => setThreshold(parseInt(e.target.value) || 2)} data-testid="threshold-input" />
        </div>
        <div className="field">
          <label className="f">Claims adapter</label>
          <select value={adapterId} onChange={(e) => setAdapterId(e.target.value)}>
            {adapters.map((a) => (
              <option key={a.id} value={a.id} disabled={!a.configured}>
                {a.name}{a.configured ? '' : ' — not configured'}
              </option>
            ))}
          </select>
        </div>
      </div>
      <button className="primary sm" onClick={save} disabled={busy} data-testid="save-settings">Save settings</button>
    </div>
  );
}

export function LocationManager({
  locations,
  canManage,
}: {
  locations: Array<{ id: string; name: string; isActive: boolean }>;
  canManage: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function addLocation() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api('/api/locations', { method: 'POST', body: JSON.stringify({ name }) });
      setName('');
      setMsg('Location created. Assign staff to it under Staff.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create location');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(loc: { id: string; isActive: boolean }) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/locations/${loc.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !loc.isActive }) });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update location');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {error && <div className="form-error">{error}</div>}
      {msg && <div className="form-ok">{msg}</div>}
      {locations.map((l) => (
        <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
          <div>
            <strong>{l.name}</strong>{' '}
            {!l.isActive && <span className="badge red">inactive</span>}
          </div>
          {canManage && (
            <button className="sm" disabled={busy} onClick={() => toggle(l)}>{l.isActive ? 'Deactivate' : 'Activate'}</button>
          )}
        </div>
      ))}
      {canManage && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input placeholder="New location name (e.g. Vaal)" value={name} onChange={(e) => setName(e.target.value)} data-testid="new-location-name" />
          <button className="primary" onClick={addLocation} disabled={busy || !name.trim()} data-testid="add-location">Add location</button>
        </div>
      )}
    </div>
  );
}

interface StaffRow {
  membershipId: string;
  name: string;
  email: string;
  role: string;
  status: string;
  locationNames: string;
  locationIds: string[];
}

export function StaffManager({
  staff,
  invitations,
  locations,
  canManage,
  viewerRole,
}: {
  staff: StaffRow[];
  invitations: Array<{ id: string; email: string; role: string; status: string; expiresAt: string }>;
  locations: Array<{ id: string; name: string }>;
  canManage: boolean;
  viewerRole: string;
}) {
  const router = useRouter();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', role: 'RECEPTIONIST', locationIds: [] as string[] });
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function invite() {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ acceptPath: string }>('/api/staff/invitations', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setInviteLink(res.acceptPath);
      setInviteOpen(false);
      setForm({ firstName: '', lastName: '', email: '', role: 'RECEPTIONIST', locationIds: [] });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invitation failed');
    } finally {
      setBusy(false);
    }
  }

  async function updateMember(membershipId: string, patch: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/staff/${membershipId}`, { method: 'PATCH', body: JSON.stringify(patch) });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {error && <div className="form-error" data-testid="staff-error">{error}</div>}
      {inviteLink && (
        <div className="form-ok">
          Invitation created. Deliver this secure link to the invitee (email delivery is a deployment integration):
          <div className="copyable" data-testid="invite-link">{inviteLink}</div>
        </div>
      )}
      <table className="tbl" style={{ marginBottom: 14 }}>
        <thead>
          <tr><th>Name</th><th>Email</th><th>Role</th><th>Authorized locations</th><th>Status</th>{canManage && <th></th>}</tr>
        </thead>
        <tbody>
          {staff.map((s) => (
            <tr key={s.membershipId}>
              <td><strong>{s.name}</strong>{s.role === 'OWNER' && <span className="badge teal" style={{ marginLeft: 6 }}>owner</span>}</td>
              <td className="muted">{s.email}</td>
              <td>{s.role}</td>
              <td className="small">{s.locationNames}</td>
              <td><span className={`badge ${s.status === 'ACTIVE' ? 'green' : 'red'}`}>{humanStatus(s.status)}</span></td>
              {canManage && (
                <td className="right">
                  {s.role !== 'OWNER' && (
                    <div className="pill-row" style={{ justifyContent: 'flex-end' }}>
                      <button className="sm" disabled={busy} onClick={() => updateMember(s.membershipId, { status: s.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' })}>
                        {s.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                      </button>
                      <button
                        className="sm"
                        disabled={busy}
                        onClick={() => {
                          const role = prompt('New role (MANAGER / RECEPTIONIST / PRACTITIONER)?', s.role);
                          if (role && ['MANAGER', 'RECEPTIONIST', 'PRACTITIONER'].includes(role)) {
                            updateMember(s.membershipId, { role });
                          }
                        }}
                      >
                        Role
                      </button>
                      <button
                        className="sm"
                        disabled={busy}
                        onClick={() => {
                          const ids = prompt('Authorized location ids (comma-separated)?', s.locationIds.join(','));
                          if (ids !== null) {
                            const parsed = ids.split(',').map((x) => x.trim()).filter(Boolean);
                            if (parsed.length) updateMember(s.membershipId, { locationIds: parsed });
                          }
                        }}
                      >
                        Locations
                      </button>
                    </div>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {invitations.length > 0 && (
        <>
          <h3>Pending invitations</h3>
          <table className="tbl">
            <thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Expires</th></tr></thead>
            <tbody>
              {invitations.map((i) => (
                <tr key={i.id}>
                  <td>{i.email}</td>
                  <td>{i.role}</td>
                  <td><span className={`badge ${i.status === 'PENDING' ? 'amber' : i.status === 'ACCEPTED' ? 'green' : 'gray'}`}>{i.status}</span></td>
                  <td className="muted">{i.expiresAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {canManage && (
        <div style={{ marginTop: 16 }}>
          {!inviteOpen ? (
            <button className="primary sm" onClick={() => setInviteOpen(true)} data-testid="add-receptionist">+ Invite staff member</button>
          ) : (
            <div className="card" style={{ marginBottom: 0 }}>
              <div className="card-head"><h2>Invite staff</h2><button className="sm" onClick={() => setInviteOpen(false)}>Cancel</button></div>
              <div className="card-body">
                <div className="frow">
                  <div className="field">
                    <label className="f">First name</label>
                    <input value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} data-testid="invite-firstname" />
                  </div>
                  <div className="field">
                    <label className="f">Last name</label>
                    <input value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} data-testid="invite-lastname" />
                  </div>
                </div>
                <div className="field">
                  <label className="f">Email</label>
                  <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} data-testid="invite-email" />
                </div>
                <div className="frow">
                  <div className="field">
                    <label className="f">Role</label>
                    <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} data-testid="invite-role">
                      <option value="RECEPTIONIST">Receptionist</option>
                      <option value="MANAGER">Practice Manager</option>
                      <option value="PRACTITIONER">Practitioner</option>
                    </select>
                  </div>
                  <div className="field">
                    <label className="f">Authorized locations</label>
                    <div className="pill-row">
                      {locations.map((l) => (
                        <label key={l.id} className="small" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <input
                            type="checkbox"
                            style={{ width: 'auto' }}
                            checked={form.locationIds.includes(l.id)}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                locationIds: e.target.checked ? [...f.locationIds, l.id] : f.locationIds.filter((x) => x !== l.id),
                              }))
                            }
                          />
                          {l.name}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
                <button className="primary" onClick={invite} disabled={busy || !form.email || !form.firstName || !form.lastName || !form.locationIds.length} data-testid="invite-submit">
                  {busy ? <span className="spinner" /> : 'Send invitation'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {viewerRole === 'RECEPTIONIST' && <div className="small muted" style={{ marginTop: 10 }}>Only practice owners and managers can invite staff.</div>}
    </div>
  );
}
