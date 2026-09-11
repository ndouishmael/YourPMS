'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client';

interface PatientHit { id: string; firstName: string; lastName: string }

export function AppointmentForm({
  locationId,
  locationName,
  date,
  practitioners,
}: {
  locationId: string;
  locationName: string;
  date: string;
  practitioners: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<PatientHit[]>([]);
  const [patientId, setPatientId] = useState('');
  const [patientName, setPatientName] = useState('');
  const [practitionerId, setPractitionerId] = useState('');
  const [time, setTime] = useState('09:00');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    try {
      const res = await api<{ patients: PatientHit[] }>(`/api/patients?q=${encodeURIComponent(query)}`);
      setHits(res.patients);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    }
  }

  async function book() {
    setBusy(true);
    setError(null);
    try {
      await api('/api/appointments', {
        method: 'POST',
        body: JSON.stringify({
          patientId,
          locationId,
          practitionerId: practitionerId || undefined,
          startsAt: new Date(`${date}T${time}:00`).toISOString(),
          reason: reason || undefined,
        }),
      });
      setOpen(false);
      setPatientId('');
      setPatientName('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not book appointment');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="card">
        <div className="card-body" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="muted small">Book an appointment at {locationName}</div>
          <button className="primary sm" onClick={() => setOpen(true)} data-testid="new-appointment">+ Book appointment</button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>Book appointment — {locationName}</h2>
        <button className="sm" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      <div className="card-body">
        {error && <div className="form-error">{error}</div>}
        {!patientId ? (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input placeholder="Find patient…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
              <button onClick={search}>Search</button>
            </div>
            {hits.map((p) => (
              <div className="queue-item" key={p.id}>
                <div className="q-name">{p.firstName} {p.lastName}</div>
                <button className="sm primary" onClick={() => { setPatientId(p.id); setPatientName(`${p.firstName} ${p.lastName}`); }}>Select</button>
              </div>
            ))}
          </>
        ) : (
          <div>
            <div className="small" style={{ marginBottom: 10 }}>
              Patient: <strong>{patientName}</strong>{' '}
              <button className="sm ghost" onClick={() => setPatientId('')}>change</button>
            </div>
            <div className="frow">
              <div className="field">
                <label className="f">Date</label>
                <input type="date" value={date} readOnly />
              </div>
              <div className="field">
                <label className="f">Time</label>
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} data-testid="appt-time" />
              </div>
            </div>
            <div className="field">
              <label className="f">Practitioner</label>
              <select value={practitionerId} onChange={(e) => setPractitionerId(e.target.value)}>
                <option value="">Any</option>
                {practitioners.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="f">Reason (optional)</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} data-testid="appt-reason" />
            </div>
            <button className="primary" onClick={book} disabled={busy} data-testid="appt-book">
              {busy ? <span className="spinner" /> : 'Book appointment'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
