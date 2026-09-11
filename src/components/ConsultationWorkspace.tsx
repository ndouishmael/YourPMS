'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, formatRand } from '@/lib/client';

interface DxRow { icd10Code: string; isPrimary: boolean }
interface ItemRow { tariffCode: string; description: string; units: number; unitPriceCents: number }

/**
 * Doctor's consultation workspace: clinical note, ICD-10 diagnoses and
 * tariff/procedure items, ending in Complete Consultation.
 */
export function ConsultationWorkspace({
  encounterId,
  status,
  existingNote,
  existingDiagnoses,
  existingItems,
  canComplete,
}: {
  encounterId: string;
  status: string;
  existingNote: string;
  existingDiagnoses: DxRow[];
  existingItems: ItemRow[];
  canComplete: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState(existingNote);
  const [dxRows, setDxRows] = useState<DxRow[]>(existingDiagnoses.length ? existingDiagnoses : [{ icd10Code: '', isPrimary: true }]);
  const [itemRows, setItemRows] = useState<ItemRow[]>(existingItems.length ? existingItems : [{ tariffCode: '0190', description: '', units: 1, unitPriceCents: 0 }]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const totalCents = itemRows.reduce((s, i) => s + i.units * i.unitPriceCents, 0);

  async function saveNote() {
    setBusy('note');
    setError(null);
    setOkMsg(null);
    try {
      await api(`/api/encounters/${encounterId}/notes`, { method: 'POST', body: JSON.stringify({ note }) });
      setOkMsg('Clinical note saved.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save note');
    } finally {
      setBusy(null);
    }
  }

  async function saveClinical() {
    setBusy('clinical');
    setError(null);
    setOkMsg(null);
    try {
      const diagnoses = dxRows.filter((d) => d.icd10Code.trim());
      const items = itemRows
        .filter((i) => i.tariffCode.trim())
        .map((i) => ({ tariffCode: i.tariffCode, units: i.units, ...(i.unitPriceCents > 0 ? { unitPriceCents: i.unitPriceCents } : {}) }));
      if (!diagnoses.length || !items.length) {
        throw new Error('At least one ICD-10 diagnosis and one tariff item are required');
      }
      await api(`/api/encounters/${encounterId}/clinical`, {
        method: 'PUT',
        body: JSON.stringify({ diagnoses, items }),
      });
      setOkMsg('Diagnoses and tariff items saved.');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save clinical data');
    } finally {
      setBusy(null);
    }
  }

  async function complete() {
    if (!confirm('Complete the consultation? This validates billing information, issues the invoice and routes the encounter to reception for billing.')) return;
    setBusy('complete');
    setError(null);
    setOkMsg(null);
    try {
      // Ensure latest clinical data is saved first.
      const diagnoses = dxRows.filter((d) => d.icd10Code.trim());
      const items = itemRows.filter((i) => i.tariffCode.trim()).map((i) => ({ tariffCode: i.tariffCode, units: i.units, ...(i.unitPriceCents > 0 ? { unitPriceCents: i.unitPriceCents } : {}) }));
      if (note.trim()) await api(`/api/encounters/${encounterId}/notes`, { method: 'POST', body: JSON.stringify({ note }) });
      await api(`/api/encounters/${encounterId}/clinical`, { method: 'PUT', body: JSON.stringify({ diagnoses, items }) });
      const res = await api<{ invoice: { id: string; invoiceNumber: number } }>(`/api/encounters/${encounterId}/complete`, { method: 'POST' });
      router.push(`/invoices/${res.invoice.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete consultation');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      {error && <div className="form-error" data-testid="ws-error">{error}</div>}
      {okMsg && <div className="form-ok">{okMsg}</div>}

      <div className="card">
        <div className="card-head">
          <h2>Clinical note</h2>
          <span className="badge blue">{status === 'WITH_DOCTOR' ? 'In consultation' : status}</span>
        </div>
        <div className="card-body">
          <textarea
            rows={7}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="History, examination, assessment and plan…"
            data-testid="clinical-note"
          />
          <div style={{ marginTop: 8 }}>
            <button onClick={saveNote} disabled={busy !== null || !note.trim()} data-testid="save-note">
              {busy === 'note' ? <span className="spinner" /> : 'Save note'}
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Diagnoses (ICD-10)</h2>
          <button className="sm" onClick={() => setDxRows((r) => [...r, { icd10Code: '', isPrimary: false }])}>+ Add</button>
        </div>
        <div className="card-body">
          {dxRows.map((row, idx) => (
            <div className="li-row" key={idx}>
              <input
                style={{ width: 130 }}
                placeholder="e.g. J06.9"
                value={row.icd10Code}
                onChange={(e) => setDxRows((r) => r.map((x, i) => (i === idx ? { ...x, icd10Code: e.target.value.toUpperCase() } : x)))}
                data-testid={`dx-code-${idx}`}
              />
              <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <input
                  type="checkbox"
                  style={{ width: 'auto' }}
                  checked={row.isPrimary}
                  onChange={(e) => setDxRows((r) => r.map((x, i) => (i === idx ? { ...x, isPrimary: e.target.checked } : { ...x, isPrimary: false })))}
                />
                primary
              </label>
              {dxRows.length > 1 && (
                <button className="sm ghost" onClick={() => setDxRows((r) => r.filter((_, i) => i !== idx))}>✕</button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Tariff / procedure items</h2>
          <button className="sm" onClick={() => setItemRows((r) => [...r, { tariffCode: '', description: '', units: 1, unitPriceCents: 0 }])}>+ Add</button>
        </div>
        <div className="card-body line-items">
          {itemRows.map((row, idx) => (
            <div className="li-row" key={idx}>
              <input
                className="tariff"
                placeholder="Code"
                value={row.tariffCode}
                onChange={(e) => setItemRows((r) => r.map((x, i) => (i === idx ? { ...x, tariffCode: e.target.value.toUpperCase() } : x)))}
                data-testid={`tariff-code-${idx}`}
              />
              <span className="small muted nowrap">{row.description || '—'}</span>
              <input
                type="number"
                min={1}
                style={{ width: 70 }}
                value={row.units}
                onChange={(e) => setItemRows((r) => r.map((x, i) => (i === idx ? { ...x, units: Math.max(1, parseInt(e.target.value) || 1) } : x)))}
              />
              <input
                type="number"
                min={0}
                step={0.01}
                className="amt"
                placeholder="R per unit"
                value={row.unitPriceCents ? row.unitPriceCents / 100 : ''}
                onChange={(e) => setItemRows((r) => r.map((x, i) => (i === idx ? { ...x, unitPriceCents: Math.round((parseFloat(e.target.value) || 0) * 100) } : x)))}
                data-testid={`tariff-price-${idx}`}
              />
              {itemRows.length > 1 && (
                <button className="sm ghost" onClick={() => setItemRows((r) => r.filter((_, i) => i !== idx))}>✕</button>
              )}
            </div>
          ))}
          <hr className="divider" />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>Total: {formatRand(totalCents)}</strong>
            <button onClick={saveClinical} disabled={busy !== null} data-testid="save-clinical">
              {busy === 'clinical' ? <span className="spinner" /> : 'Save diagnoses & items'}
            </button>
          </div>
        </div>
      </div>

      {canComplete && (
        <div className="card">
          <div className="card-body" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div className="small muted">
              Completing saves the clinical record, validates billing information, issues the invoice and routes the patient to reception billing.
            </div>
            <button className="primary" style={{ fontSize: 15, padding: '10px 22px' }} onClick={complete} disabled={busy !== null} data-testid="complete-consultation">
              {busy === 'complete' ? <span className="spinner" /> : 'Complete Consultation'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
