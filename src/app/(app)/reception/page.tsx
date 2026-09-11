import AppShell from '@/components/AppShell';
import { pageLocation } from '@/lib/page-context';
import { getQueueView } from '@/services/scheduling.service';
import { rand, fmtTime } from '@/lib/format';
import { CheckInPanel } from '@/components/CheckInPanel';
import { QueueActions } from '@/components/QueueActions';
import { listAppointments } from '@/services/scheduling.service';

export const dynamic = 'force-dynamic';

export default async function ReceptionPage({ searchParams }: { searchParams: Promise<{ loc?: string }> }) {
  const { auth, db, selected, selectedLocName } = await pageLocation(await searchParams);
  const actor = { db, practiceId: auth.practiceId!, actorUserId: auth.user.id, actorRole: auth.role ?? '', locationIds: auth.locationIds };
  const queue = getQueueView(actor, selected);
  const today = new Date().toISOString().slice(0, 10);
  const todaysAppointments = listAppointments(actor, { date: today, locationId: selected }).filter(
    (a) => a.appointment.status === 'BOOKED',
  );

  return (
    <AppShell active="reception" title="Reception" crumb={`${selectedLocName} · front desk`}>
      <CheckInPanel locationId={selected} locationName={selectedLocName} />

      <div className="queue-board" data-testid="queue-board">
        <div className="queue-col waiting">
          <div className="q-head">
            <div className="q-title">Waiting</div>
            <div className="q-count">{queue.waiting.length}</div>
          </div>
          <div className="q-list">
            {queue.waiting.length === 0 && <div className="queue-empty">No patients waiting</div>}
            {queue.waiting.map((w) => (
              <div className="queue-item" key={w.encounterId} data-testid="queue-waiting">
                <div>
                  <div className="q-name">{w.patientName}</div>
                  <div className="q-meta">
                    Checked in {fmtTime(w.checkedInAt)}
                    {w.isCrossLocation && <span className="badge purple" style={{ marginLeft: 6 }}>cross-location</span>}
                  </div>
                </div>
                <div className="q-actions">
                  <QueueActions encounterId={w.encounterId} mode="waiting" />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="queue-col doctor">
          <div className="q-head">
            <div className="q-title">With Doctor</div>
            <div className="q-count">{queue.withDoctor.length}</div>
          </div>
          <div className="q-list">
            {queue.withDoctor.length === 0 && <div className="queue-empty">Nobody with the doctor</div>}
            {queue.withDoctor.map((w) => (
              <div className="queue-item" key={w.encounterId} data-testid="queue-withdoctor">
                <div>
                  <div className="q-name">{w.patientName}</div>
                  <div className="q-meta">
                    {w.practitionerName ?? 'Doctor'}
                    {w.startedAt ? ` · since ${fmtTime(w.startedAt)}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="queue-col billing">
          <div className="q-head">
            <div className="q-title">Billing</div>
            <div className="q-count">{queue.billing.length}</div>
          </div>
          <div className="q-list">
            {queue.billing.length === 0 && <div className="queue-empty">Nothing to bill</div>}
            {queue.billing.map((b) => (
              <div className="queue-item" key={b.encounterId} data-testid="queue-billing">
                <div>
                  <div className="q-name">{b.patientName}</div>
                  <div className="q-meta">
                    {rand(b.totalCents)} · {b.hasClaim ? `claim ${b.claimStatus}` : b.balanceCents > 0 ? 'balance due' : 'settling'}
                  </div>
                </div>
                <div className="q-actions">
                  <QueueActions encounterId={b.encounterId} invoiceId={b.invoiceId} mode="billing" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-head">
          <h2>Today&apos;s booked appointments — {selectedLocName}</h2>
          <span className="badge amber">{todaysAppointments.length} booked</span>
        </div>
        <div className="card-body tight">
          {todaysAppointments.length === 0 && <div className="empty-state">No booked appointments for today.</div>}
          <table className="tbl">
            <thead>
              <tr>
                <th>Time</th>
                <th>Patient</th>
                <th>Reason</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {todaysAppointments.map((a) => (
                <tr key={a.appointment.id}>
                  <td className="nowrap">{fmtTime(a.appointment.startsAt)}</td>
                  <td>{a.patient.firstName} {a.patient.lastName}</td>
                  <td className="muted">{a.appointment.reason ?? '—'}</td>
                  <td className="right">
                    <QueueActions
                      encounterId=""
                      mode="checkin-appointment"
                      appointmentId={a.appointment.id}
                      patientId={a.patient.id}
                      locationId={selected}
                      patientName={`${a.patient.firstName} ${a.patient.lastName}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
