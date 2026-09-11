import AppShell from '@/components/AppShell';
import { pageLocation } from '@/lib/page-context';
import { getQueueView, listRecentEncounters } from '@/services/scheduling.service';
import { fmtTime, fmtDateTime, statusBadgeClass, humanStatus } from '@/lib/format';
import { StartEncounterButton } from '@/components/QueueActions';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function DoctorPage({ searchParams }: { searchParams: Promise<{ loc?: string }> }) {
  const { auth, db, selected, selectedLocName } = await pageLocation(await searchParams);
  const actor = { db, practiceId: auth.practiceId!, actorUserId: auth.user.id, actorRole: auth.role ?? '', locationIds: auth.locationIds };
  const queue = getQueueView(actor, selected);
  const recent = listRecentEncounters(actor, 12);

  return (
    <AppShell active="doctor" title="Consultations" crumb={`${selectedLocName} · clinical workspace`}>
      <div className="queue-board">
        <div className="queue-col waiting">
          <div className="q-head">
            <div className="q-title">Waiting</div>
            <div className="q-count">{queue.waiting.length}</div>
          </div>
          <div className="q-list">
            {queue.waiting.length === 0 && <div className="queue-empty">No patients waiting</div>}
            {queue.waiting.map((w) => (
              <div className="queue-item" key={w.encounterId} data-testid="doc-waiting">
                <div>
                  <div className="q-name">{w.patientName}</div>
                  <div className="q-meta">
                    Since {fmtTime(w.checkedInAt)}
                    {w.isCrossLocation && <span className="badge purple" style={{ marginLeft: 6 }}>cross-location</span>}
                  </div>
                </div>
                <StartEncounterButton encounterId={w.encounterId} patientName={w.patientName} />
              </div>
            ))}
          </div>
        </div>
        <div className="queue-col doctor">
          <div className="q-head">
            <div className="q-title">In consultation</div>
            <div className="q-count">{queue.withDoctor.length}</div>
          </div>
          <div className="q-list">
            {queue.withDoctor.length === 0 && <div className="queue-empty">No active consultations</div>}
            {queue.withDoctor.map((w) => (
              <div className="queue-item" key={w.encounterId}>
                <div>
                  <div className="q-name">{w.patientName}</div>
                  <div className="q-meta">{w.practitionerName ?? 'Doctor'} · since {fmtTime(w.startedAt)}</div>
                </div>
                <Link className="btn sm primary" href={`/encounters/${w.encounterId}`}>Open workspace</Link>
              </div>
            ))}
          </div>
        </div>
        <div className="queue-col billing">
          <div className="q-head">
            <div className="q-title">Awaiting billing</div>
            <div className="q-count">{queue.billing.length}</div>
          </div>
          <div className="q-list">
            {queue.billing.length === 0 && <div className="queue-empty">Nothing awaiting billing</div>}
            {queue.billing.map((b) => (
              <div className="queue-item" key={b.encounterId}>
                <div>
                  <div className="q-name">{b.patientName}</div>
                  <div className="q-meta">completed · with reception</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-head">
          <h2>Recent encounters — your locations</h2>
        </div>
        <div className="card-body tight">
          {recent.length === 0 && <div className="empty-state">No encounters yet.</div>}
          <table className="tbl">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Location</th>
                <th>Status</th>
                <th>Checked in</th>
                <th>Completed</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.encounter.id}>
                  <td><Link href={`/patients/${r.patient.id}`}>{r.patient.firstName} {r.patient.lastName}</Link></td>
                  <td>{r.location.name}</td>
                  <td><span className={`badge ${statusBadgeClass(r.encounter.status)}`}>{humanStatus(r.encounter.status)}</span></td>
                  <td className="muted">{fmtDateTime(r.encounter.checkedInAt)}</td>
                  <td className="muted">{fmtDateTime(r.encounter.completedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
