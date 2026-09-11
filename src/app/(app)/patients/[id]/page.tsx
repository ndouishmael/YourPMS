import { notFound } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { getPageAuth } from '@/lib/auth';
import { getDb } from '@/db';
import {
  getPatientAuthorized,
  getPatientMedicalAid,
  getPatientEncounterHistory,
  getPatientInvoiceSummary,
  listTransfersForPatient,
  getPatientDiagnosesHistory,
} from '@/services/patients.service';
import { rand, fmtDate, fmtDateTime, statusBadgeClass, humanStatus } from '@/lib/format';
import Link from 'next/link';
import { MedicalAidForm, TransferDecisionPanel } from '@/components/PatientPanels';

export const dynamic = 'force-dynamic';

export default async function PatientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await getPageAuth();
  if (!auth || auth.kind === 'PLATFORM') notFound();
  const db = getDb();
  const { id } = await params;
  const actor = { db, practiceId: auth.practiceId!, actorUserId: auth.user.id, actorRole: auth.role ?? '', locationIds: auth.locationIds };

  let data;
  try {
    data = getPatientAuthorized(actor, id);
  } catch {
    notFound();
  }
  const { patient, assignments } = data;
  const medicalAid = getPatientMedicalAid(db, id);
  const encounters = getPatientEncounterHistory(db, id);
  const invoices = getPatientInvoiceSummary(db, id);
  const transfers = listTransfersForPatient(db, id);
  const diagnosesHistory = auth.permissions.includes('clinical:access') ? getPatientDiagnosesHistory(db, id) : null;
  const canEdit = auth.permissions.includes('patients:edit');
  const canDecide = auth.permissions.includes('transfers:decide');

  const totalOutstanding = invoices
    .filter((i) => i.status !== 'VOID')
    .reduce((s, i) => s + Math.max(0, i.totalCents - i.adjustedCents - i.paidCents), 0);

  return (
    <AppShell active="patients" title={`${patient.firstName} ${patient.lastName}`} crumb={`Patient · home location stays with the patient`}>
      <div className="ws-grid">
        <div>
          <div className="card">
            <div className="card-head">
              <h2>Encounter history ({encounters.length})</h2>
            </div>
            <div className="card-body tight">
              {encounters.length === 0 && <div className="empty-state">No visits recorded.</div>}
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Treating location</th>
                    <th>Status</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {encounters.map((e) => (
                    <tr key={e.encounter.id}>
                      <td className="nowrap">{fmtDate(e.encounter.completedAt ?? e.encounter.createdAt)}</td>
                      <td>
                        {e.location.name}
                        {e.encounter.isCrossLocation && <span className="badge purple" style={{ marginLeft: 6 }}>cross-location</span>}
                      </td>
                      <td><span className={`badge ${statusBadgeClass(e.encounter.status)}`}>{humanStatus(e.encounter.status)}</span></td>
                      <td>
                        {auth.permissions.includes('clinical:access') ? (
                          <Link className="small" href={`/encounters/${e.encounter.id}`}>open encounter</Link>
                        ) : (
                          <span className="muted small">clinical access required</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {diagnosesHistory && diagnosesHistory.length > 0 && (
            <div className="card">
              <div className="card-head"><h2>Diagnoses history</h2></div>
              <div className="card-body tight">
                <table className="tbl">
                  <tbody>
                    {diagnosesHistory.map((d, i) => (
                      <tr key={i}>
                        <td className="mono">{d.code}</td>
                        <td>{d.description}</td>
                        <td className="muted small">{fmtDate(d.completedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-head"><h2>Invoices &amp; balances</h2></div>
            <div className="card-body tight">
              {invoices.length === 0 && <div className="empty-state">No invoices.</div>}
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Date</th>
                    <th>Total</th>
                    <th>Balance</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((i) => (
                    <tr key={i.id}>
                      <td><Link href={`/invoices/${i.id}`}>#{i.invoiceNumber}</Link></td>
                      <td className="muted">{fmtDate(i.createdAt)}</td>
                      <td>{rand(i.totalCents)}</td>
                      <td><strong>{rand(Math.max(0, i.totalCents - i.adjustedCents - i.paidCents))}</strong></td>
                      <td><span className={`badge ${statusBadgeClass(i.status)}`}>{humanStatus(i.status)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="card-body" style={{ fontWeight: 700 }}>
                Total outstanding: {rand(totalOutstanding)}
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="card">
            <div className="card-head"><h2>Patient details</h2></div>
            <div className="card-body">
              <div className="kv">
                <div className="k">Date of birth</div>
                <div>{fmtDate(patient.dateOfBirth)}</div>
                <div className="k">Phone</div>
                <div>{patient.phone ?? '—'}</div>
                <div className="k">ID number</div>
                <div>{patient.idNumber ?? '—'}</div>
                <div className="k">Home location</div>
                <div><strong>{encounters.find((e) => e.encounter.locationId === patient.homeLocationId)?.location.name ?? '—'}</strong></div>
                <div className="k">Cross-location access</div>
                <div>
                  {assignments.length === 0 ? <span className="muted">none</span> : assignments.length}
                </div>
                <div className="k">Registered</div>
                <div className="muted">{fmtDateTime(patient.createdAt)}</div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Medical aid</h2>
            </div>
            <div className="card-body">
              {medicalAid ? (
                <div className="kv">
                  <div className="k">Scheme</div>
                  <div>{medicalAid.scheme.name}</div>
                  <div className="k">Option</div>
                  <div>{medicalAid.option?.name ?? '—'}</div>
                  <div className="k">Membership no.</div>
                  <div className="mono">{medicalAid.aid.membershipNumber}</div>
                  <div className="k">Dependent code</div>
                  <div>{medicalAid.aid.dependentCode ?? '—'}</div>
                </div>
              ) : (
                <div className="muted small" style={{ marginBottom: 10 }}>No medical aid on file — patient will be billed as cash.</div>
              )}
              {canEdit && (
                <div style={{ marginTop: 10 }}>
                  <MedicalAidForm patientId={id} />
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Location &amp; transfers</h2>
            </div>
            <div className="card-body">
              {transfers.length === 0 && <div className="muted small">No transfer history.</div>}
              {transfers.map((t) => (
                <div key={t.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }} data-testid="transfer-history">
                  <div>
                    <span className={`badge ${statusBadgeClass(t.status)}`}>{humanStatus(t.status)}</span>{' '}
                    <span className="small">
                      {t.triggerEncounterCount} completed alternate-location encounters
                    </span>
                  </div>
                  {t.decidedAt && <div className="small muted">decided {fmtDateTime(t.decidedAt)}</div>}
                  {t.status === 'PENDING' && canDecide && (
                    <TransferDecisionPanel transferId={t.id} patientId={id} />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
