'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'support', label: 'Support Access' },
  { key: 'security', label: 'Security Events' },
  { key: 'audit', label: 'Platform Audit' },
];

export function PlatformHeader({ email, activeTab }: { email: string; activeTab: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <div className="topbar" style={{ position: 'static', marginBottom: 0, flexDirection: 'column', alignItems: 'stretch', padding: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 22px', background: '#1e1b4b' }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 18, color: '#fff' }}>YourPMS <span style={{ color: '#a5b4fc' }}>Platform</span></div>
          <div className="small" style={{ color: '#a5b4fc' }}>{email} · platform administrator</div>
        </div>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api('/api/auth/logout', { method: 'POST' });
            } finally {
              router.push('/login');
              router.refresh();
            }
          }}
        >
          {busy ? <span className="spinner dark" /> : 'Log out'}
        </button>
      </div>
      <div className="tabs" style={{ padding: '0 22px', background: 'var(--surface)' }}>
        {TABS.map((t) => (
          <Link key={t.key} href={`/platform?tab=${t.key}`} className={activeTab === t.key ? 'active' : ''}>
            {t.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

export function SupportAccessPanel({
  practices,
  activeGrants,
}: {
  practices: Array<{ id: string; name: string }>;
  activeGrants: Array<{ id: string; practiceName: string; expiresAt: string; adminEmail: string }>;
}) {
  const router = useRouter();
  const [practiceId, setPracticeId] = useState(practices[0]?.id ?? '');
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState(60);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [grantId, setGrantId] = useState<string | null>(null);

  async function create() {
    setBusy('create');
    setError(null);
    try {
      const res = await api<{ grant: { id: string } }>('/api/platform/support-access', {
        method: 'POST',
        body: JSON.stringify({ practiceId, reason, minutes }),
      });
      setGrantId(res.grant.id);
      setReason('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create grant');
    } finally {
      setBusy(null);
    }
  }

  async function enter() {
    if (!grantId) return;
    setBusy('enter');
    setError(null);
    try {
      await api('/api/platform/support-access/enter', { method: 'POST', body: JSON.stringify({ grantId }) });
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not enter support mode');
    } finally {
      setBusy(null);
    }
  }

  async function revoke(id: string) {
    setBusy(id);
    setError(null);
    try {
      await api(`/api/platform/support-access/${id}/revoke`, { method: 'POST' });
      if (grantId === id) setGrantId(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revoke');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card">
      <div className="card-head"><h2>Request scoped support access</h2></div>
      <div className="card-body">
        {error && <div className="form-error">{error}</div>}
        <div className="frow">
          <div className="field">
            <label className="f">Target practice</label>
            <select value={practiceId} onChange={(e) => setPracticeId(e.target.value)}>
              {practices.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="f">Duration (minutes, max 240)</label>
            <input type="number" min={5} max={240} value={minutes} onChange={(e) => setMinutes(parseInt(e.target.value) || 60)} />
          </div>
        </div>
        <div className="field">
          <label className="f">Reason (required, min 10 characters — recorded in the audit trail)</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Tenant reported invoice numbering issue — investigating" data-testid="support-reason" />
        </div>
        <div className="pill-row">
          <button className="primary" onClick={create} disabled={busy !== null || reason.trim().length < 10} data-testid="support-create">
            {busy === 'create' ? <span className="spinner" /> : 'Create support grant'}
          </button>
          {grantId && (
            <button onClick={enter} disabled={busy !== null} data-testid="support-enter">
              {busy === 'enter' ? <span className="spinner dark" /> : 'Enter practice (read-only)'}
            </button>
          )}
        </div>
        {activeGrants.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div className="small" style={{ fontWeight: 700, marginBottom: 6 }}>Active grants</div>
            {activeGrants.map((g) => (
              <div key={g.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <span className="small">
                  <strong>{g.practiceName}</strong> — {g.adminEmail} · expires {new Date(g.expiresAt).toLocaleTimeString('en-ZA')}
                </span>
                <button className="sm danger" disabled={busy !== null} onClick={() => revoke(g.id)} data-testid={`support-revoke`}>
                  {busy === g.id ? <span className="spinner" /> : 'Revoke now'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
