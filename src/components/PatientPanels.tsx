'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client';

export function MedicalAidForm({ patientId }: { patientId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [schemes, setSchemes] = useState<Array<{ id: string; name: string; options: Array<{ id: string; name: string }> }>>([]);
  const [form, setForm] = useState({ schemeId: '', schemeOptionId: '', membershipNumber: '', dependentCode: '', mainMemberName: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadSchemes() {
    setOpen(true);
    if (schemes.length) return;
    try {
      const res = await api<{ schemes: typeof schemes }>('/api/catalogue/schemes');
      setSchemes(res.schemes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load schemes');
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/patients/${patientId}/medical-aid`, {
        method: 'PUT',
        body: JSON.stringify({
          schemeId: form.schemeId,
          schemeOptionId: form.schemeOptionId || undefined,
          membershipNumber: form.membershipNumber,
          dependentCode: form.dependentCode || undefined,
          mainMemberName: form.mainMemberName || undefined,
        }),
      });
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save medical aid');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="sm" onClick={loadSchemes} data-testid="edit-medical-aid">
        {busy ? <span className="spinner dark" /> : 'Set / update medical aid'}
      </button>
    );
  }
  const selectedScheme = schemes.find((s) => s.id === form.schemeId);
  return (
    <div>
      {error && <div className="form-error">{error}</div>}
      <div className="field">
        <label className="f">Scheme</label>
        <select value={form.schemeId} onChange={(e) => setForm((f) => ({ ...f, schemeId: e.target.value, schemeOptionId: '' }))}>
          <option value="">Select scheme…</option>
          {schemes.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>
      {selectedScheme && (
        <div className="field">
          <label className="f">Option</label>
          <select value={form.schemeOptionId} onChange={(e) => setForm((f) => ({ ...f, schemeOptionId: e.target.value }))}>
            <option value="">—</option>
            {selectedScheme.options.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
      )}
      <div className="field">
        <label className="f">Membership number</label>
        <input value={form.membershipNumber} onChange={(e) => setForm((f) => ({ ...f, membershipNumber: e.target.value }))} data-testid="ma-membership" />
      </div>
      <div className="frow">
        <div className="field">
          <label className="f">Dependent code</label>
          <input value={form.dependentCode} onChange={(e) => setForm((f) => ({ ...f, dependentCode: e.target.value }))} placeholder="e.g. 01" />
        </div>
        <div className="field">
          <label className="f">Main member name</label>
          <input value={form.mainMemberName} onChange={(e) => setForm((f) => ({ ...f, mainMemberName: e.target.value }))} />
        </div>
      </div>
      <div className="pill-row">
        <button className="primary sm" onClick={save} disabled={busy || !form.schemeId || !form.membershipNumber} data-testid="ma-save">
          Save medical aid
        </button>
        <button className="sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

export function TransferDecisionPanel({ transferId, patientId }: { transferId: string; patientId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(decision: 'APPROVE' | 'REJECT') {
    const note = decision === 'APPROVE' ? prompt('Confirm permanent transfer. Note (optional)?') ?? '' : prompt('Reason for rejecting the transfer?') ?? '';
    setBusy(decision.toLowerCase() as 'approve' | 'reject');
    setError(null);
    try {
      await api(`/api/patients/${patientId}/transfers`, {
        method: 'POST',
        body: JSON.stringify({ transferId, decision, note: note || undefined }),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record decision');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      {error && <div className="form-error">{error}</div>}
      <div className="pill-row">
        <button className="sm primary" disabled={busy !== null} onClick={() => decide('APPROVE')} data-testid="transfer-approve">
          {busy === 'approve' ? <span className="spinner" /> : 'Confirm transfer'}
        </button>
        <button className="sm" disabled={busy !== null} onClick={() => decide('REJECT')} data-testid="transfer-reject">
          {busy === 'reject' ? <span className="spinner dark" /> : 'Reject'}
        </button>
      </div>
    </div>
  );
}
