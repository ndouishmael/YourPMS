import AppShell from '@/components/AppShell';
import { pageLocation } from '@/lib/page-context';
import { searchPatients, listPendingTransfers } from '@/services/patients.service';
import { fmtDate } from '@/lib/format';
import Link from 'next/link';
import { PatientSearch } from '@/components/PatientSearch';

export const dynamic = 'force-dynamic';

export default async function PatientsPage({ searchParams }: { searchParams: Promise<{ loc?: string; q?: string }> }) {
  const sp = await searchParams;
  const { auth, db, selected, authorized } = await pageLocation(sp);
  const actor = { db, practiceId: auth.practiceId!, actorUserId: auth.user.id, actorRole: auth.role ?? '', locationIds: auth.locationIds };
  const query = sp.q ?? '';
  const patients = searchPatients(actor, query, 100);
  const transfers = listPendingTransfers(db, auth.practiceId!);
  const locNames = new Map(authorized.map((l) => [l.id, l.name]));
  const canCreate = auth.permissions.includes('patients:create');

  return (
    <AppShell active="patients" title="Patients" crumb={`${auth.practiceName} · patient records`}>
      {transfers.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>Transfer considerations pending</h2>
            <span className="badge amber">{transfers.length}</span>
          </div>
          <div className="card-body">
            {transfers.map((t) => (
              <div key={t.transfer.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', gap: 10 }} data-testid="transfer-pending">
                <div>
                  <strong>{t.patient.firstName} {t.patient.lastName}</strong>{' '}
                  <span className="muted small">
                    — {t.transfer.triggerEncounterCount} completed encounters at {locNames.get(t.transfer.toLocationId) ?? 'another location'}
                  </span>
                </div>
                <Link className="btn sm primary" href={`/patients/${t.patient.id}`}>Review transfer →</Link>
              </div>
            ))}
          </div>
        </div>
      )}

      <PatientSearch initialQuery={query} canCreate={canCreate} defaultLocationId={selected} defaultLocationName={locNames.get(selected) ?? ''} />

      <div className="card">
        <div className="card-head">
          <h2>{query ? `Search results (${patients.length})` : `Patients at your locations (${patients.length})`}</h2>
        </div>
        <div className="card-body tight">
          {patients.length === 0 && <div className="empty-state">No patients found.</div>}
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Date of birth</th>
                <th>Phone</th>
                <th>Home location</th>
              </tr>
            </thead>
            <tbody>
              {patients.map((p) => (
                <tr key={p.id} className="rowlink" data-testid="patient-row">
                  <td><Link href={`/patients/${p.id}`} style={{ fontWeight: 600 }}>{p.firstName} {p.lastName}</Link></td>
                  <td className="muted">{fmtDate(p.dateOfBirth)}</td>
                  <td className="muted">{p.phone ?? '—'}</td>
                  <td>{locNames.get(p.homeLocationId) ?? <span className="muted">other location</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
