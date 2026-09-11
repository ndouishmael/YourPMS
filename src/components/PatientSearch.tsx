'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RegisterForm } from './CheckInPanel';

export function PatientSearch({
  initialQuery,
  canCreate,
  defaultLocationId,
  defaultLocationName,
}: {
  initialQuery: string;
  canCreate: boolean;
  defaultLocationId: string;
  defaultLocationName: string;
}) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [showRegister, setShowRegister] = useState(false);

  return (
    <div className="card">
      <div className="card-head">
        <h2>Find a patient</h2>
        {canCreate && (
          <button className="sm" onClick={() => setShowRegister((s) => !s)}>
            {showRegister ? 'Cancel' : '+ Register patient'}
          </button>
        )}
      </div>
      <div className="card-body">
        {showRegister ? (
          <RegisterForm
            locationId={defaultLocationId}
            onRegistered={(p) => {
              setShowRegister(false);
              router.push(`/patients/${p.id}`);
            }}
          />
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              placeholder="Search by name, phone or ID number…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') router.push(`/patients?q=${encodeURIComponent(query)}`);
              }}
              data-testid="patients-search-input"
            />
            <button className="primary" onClick={() => router.push(`/patients?q=${encodeURIComponent(query)}`)}>
              Search
            </button>
          </div>
        )}
        {defaultLocationName && !showRegister && (
          <div className="small muted" style={{ marginTop: 8 }}>
            New patients are registered with home location <strong>{defaultLocationName}</strong>. Use the location switcher to change.
          </div>
        )}
      </div>
    </div>
  );
}
