import AppShell from '@/components/AppShell';
import { pageLocation } from '@/lib/page-context';
import { listAppointments } from '@/services/scheduling.service';
import { listPractitionersWrap } from '@/services/appointments.helpers';
import { fmtTime, fmtDate, statusBadgeClass, humanStatus } from '@/lib/format';
import { AppointmentForm } from '@/components/AppointmentForm';

export const dynamic = 'force-dynamic';

export default async function AppointmentsPage({ searchParams }: { searchParams: Promise<{ loc?: string; date?: string }> }) {
  const sp = await searchParams;
  const { auth, db, selected, selectedLocName } = await pageLocation(sp);
  const actor = { db, practiceId: auth.practiceId!, actorUserId: auth.user.id, actorRole: auth.role ?? '', locationIds: auth.locationIds };
  const date = sp.date ?? new Date().toISOString().slice(0, 10);
  const appointments = listAppointments(actor, { date, locationId: selected });
  const practitioners = listPractitionersWrap(db, auth.practiceId!);
  const canCreate = auth.permissions.includes('appointments:manage');

  return (
    <AppShell active="appointments" title="Appointments" crumb={`${selectedLocName} · ${fmtDate(new Date(date + 'T12:00:00'))}`}>
      {canCreate && (
        <AppointmentForm locationId={selected} locationName={selectedLocName} date={date} practitioners={practitioners.map((p) => ({ id: p.practitioner.id, name: `Dr ${p.user.firstName} ${p.user.lastName}` }))} />
      )}

      <div className="card">
        <div className="card-head">
          <h2>Appointments — {selectedLocName}</h2>
          <span className="badge gray">{appointments.length} on {date}</span>
        </div>
        <div className="card-body tight">
          {appointments.length === 0 && <div className="empty-state">No appointments for this day.</div>}
          <table className="tbl">
            <thead>
              <tr>
                <th>Time</th>
                <th>Patient</th>
                <th>Practitioner</th>
                <th>Reason</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {appointments.map((a) => (
                <tr key={a.appointment.id}>
                  <td className="nowrap">{fmtTime(a.appointment.startsAt)}–{fmtTime(new Date(a.appointment.startsAt.getTime() + a.appointment.durationMinutes * 60000))}</td>
                  <td>{a.patient.firstName} {a.patient.lastName}</td>
                  <td className="muted">{practitioners.find((p) => p.practitioner.id === a.appointment.practitionerId) ? `Dr ${practitioners.find((p) => p.practitioner.id === a.appointment.practitionerId)!.user.firstName}` : '—'}</td>
                  <td className="muted">{a.appointment.reason ?? '—'}</td>
                  <td><span className={`badge ${statusBadgeClass(a.appointment.status)}`}>{humanStatus(a.appointment.status)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
