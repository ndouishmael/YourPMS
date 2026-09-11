'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/client';

interface PatientHit {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  phone: string | null;
}

/** Reception check-in: search existing patients or register + check in a walk-in. */
export function CheckInPanel({ locationId, locationName }: { locationId: string; locationName: string }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<PatientHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRegister, setShowRegister] = useState(false);

  async function search() {
    setError(null);
    setOkMsg(null);
    setBusy(true);
    try {
      const res = await api<{ patients: PatientHit[] }>(`/api/patients?q=${encodeURIComponent(query)}`);
      setHits(res.patients);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setBusy(false);
    }
  }

  async function checkIn(patientId: string, patientName: string, appointmentId?: string) {
    setError(null);
    setBusy(true);
    try {
      await api('/api/queue', {
        method: 'POST',
        body: JSON.stringify({ patientId, locationId, appointmentId }),
      });
      setOkMsg(`${patientName} checked in and added to the ${locationName} waiting queue.`);
      setHits(null);
      setQuery('');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>Check-in — {locationName}</h2>
        <button className="sm" onClick={() => setShowRegister((s) => !s)}>
          {showRegister ? 'Cancel registration' : '+ Register new patient'}
        </button>
      </div>
      <div className="card-body">
        {error && <div className="form-error">{error}</div>}
        {okMsg && <div className="form-ok" data-testid="checkin-ok">{okMsg}</div>}
        {showRegister ? (
          <RegisterForm
            locationId={locationId}
            onRegistered={async (patient) => {
              setShowRegister(false);
              await checkIn(patient.id, `${patient.firstName} ${patient.lastName}`);
            }}
          />
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                placeholder="Search patient by name, phone or ID number…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && search()}
                data-testid="patient-search"
              />
              <button className="primary" onClick={search} disabled={busy}>
                {busy ? <span className="spinner" /> : 'Search'}
              </button>
            </div>
            {hits && (
              <div style={{ marginTop: 12 }}>
                {hits.length === 0 && <div className="empty-state">No patients found. Register them as a new patient.</div>}
                {hits.map((p) => (
                  <div className="queue-item" key={p.id} style={{ marginBottom: 6 }}>
                    <div>
                      <div className="q-name">{p.firstName} {p.lastName}</div>
                      <div className="q-meta">{p.dateOfBirth ?? ''} {p.phone ? `· ${p.phone}` : ''}</div>
                    </div>
                    <button className="sm primary" disabled={busy} onClick={() => checkIn(p.id, `${p.firstName} ${p.lastName}`)} data-testid={`checkin-${p.lastName.toLowerCase()}`}>
                      Check in
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function RegisterForm({
  locationId,
  onRegistered,
  compact,
}: {
  locationId: string;
  onRegistered: (patient: { id: string; firstName: string; lastName: string }) => void;
  compact?: boolean;
}) {
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    gender: '',
    phone: '',
    idNumber: '',
    email: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ patient: { id: string; firstName: string; lastName: string } }>('/api/patients', {
        method: 'POST',
        body: JSON.stringify({ ...form, homeLocationId: locationId }),
      });
      onRegistered(res.patient);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="form-error">{error}</div>}
      <div className="frow">
        <div className="field">
          <label className="f">First name</label>
          <input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} required data-testid="reg-firstname" />
        </div>
        <div className="field">
          <label className="f">Last name</label>
          <input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} required data-testid="reg-lastname" />
        </div>
      </div>
      <div className="frow">
        <div className="field">
          <label className="f">Date of birth</label>
          <input type="date" value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} data-testid="reg-dob" />
        </div>
        <div className="field">
          <label className="f">Gender</label>
          <select value={form.gender} onChange={(e) => set('gender', e.target.value)}>
            <option value="">—</option>
            <option>Female</option>
            <option>Male</option>
            <option>Other</option>
          </select>
        </div>
      </div>
      <div className="frow">
        <div className="field">
          <label className="f">Phone</label>
          <input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="082 000 0000" data-testid="reg-phone" />
        </div>
        <div className="field">
          <label className="f">ID number</label>
          <input value={form.idNumber} onChange={(e) => set('idNumber', e.target.value)} data-testid="reg-idnumber" />
        </div>
      </div>
      {!compact && (
        <div className="field">
          <label className="f">Email</label>
          <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </div>
      )}
      <button className="primary" type="submit" disabled={busy} data-testid="reg-submit">
        {busy ? <span className="spinner" /> : 'Register patient'}
      </button>
    </form>
  );
}
