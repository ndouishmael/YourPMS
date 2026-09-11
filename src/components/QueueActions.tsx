'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/client';

/** Inline actions for queue items on the reception and doctor dashboards. */
export function QueueActions({
  invoiceId,
  mode,
  appointmentId,
  patientId,
  locationId,
  patientName,
}: {
  encounterId?: string;
  invoiceId?: string;
  mode: 'waiting' | 'billing' | 'checkin-appointment';
  appointmentId?: string;
  patientId?: string;
  locationId?: string;
  patientName?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  if (error) return <span className="small" style={{ color: 'var(--danger)' }}>{error}</span>;

  if (mode === 'checkin-appointment') {
    return (
      <button
        className="sm primary"
        disabled={busy}
        data-testid={`checkin-appt-${patientName?.toLowerCase().replace(/\s+/g, '-')}`}
        onClick={() =>
          run(() =>
            api('/api/queue', {
              method: 'POST',
              body: JSON.stringify({ patientId, locationId, appointmentId }),
            }),
          )
        }
      >
        {busy ? <span className="spinner" /> : 'Check in'}
      </button>
    );
  }

  if (mode === 'waiting') {
    return (
      <span className="muted small">awaiting doctor</span>
    );
  }

  // billing
  return (
    <Link className="btn sm primary" href={`/invoices/${invoiceId}`} data-testid="open-invoice">
      Bill →
    </Link>
  );
}

/** Doctor action: start the encounter for a waiting patient. */
export function StartEncounterButton({ encounterId, patientName }: { encounterId: string; patientName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span>
      {error && <div className="small" style={{ color: 'var(--danger)', marginTop: 4 }}>{error}</div>}
      <button
        className="sm primary"
        disabled={busy}
        data-testid={`start-encounter-${patientName.toLowerCase().replace(/\s+/g, '-')}`}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api(`/api/queue/${encounterId}/start`, { method: 'POST' });
            router.push(`/encounters/${encounterId}`);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not start encounter');
            setBusy(false);
          }
        }}
      >
        {busy ? <span className="spinner" /> : 'See patient'}
      </button>
    </span>
  );
}
