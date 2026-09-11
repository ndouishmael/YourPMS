import { notFound } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { getPageAuth } from '@/lib/auth';
import { getDb } from '@/db';
import { getEncounterDetail } from '@/services/scheduling.service';
import { clinicalRecord } from '@/services/encounters.service';
import { getPatientMedicalAid, getPatientEncounterHistory } from '@/services/patients.service';
import { encounterFinancialStory } from '@/services/finance.service';
import { rand, fmtDate, statusBadgeClass, humanStatus } from '@/lib/format';
import { ConsultationWorkspace } from '@/components/ConsultationWorkspace';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function EncounterPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await getPageAuth();
  if (!auth || auth.kind === 'PLATFORM') notFound();
  const db = getDb();
  const { id } = await params;

  let detail;
  try {
    detail = getEncounterDetail(db, auth.practiceId!, id);
  } catch {
    notFound();
  }
  if (!auth.locationIds.includes(detail.encounter.locationId)) notFound();

  const clinical = clinicalRecord(db, auth.practiceId!, id);
  const history = getPatientEncounterHistory(db, detail.patient.id).filter((h) => h.encounter.id !== id).slice(0, 8) as Array<{ encounter: typeof import('@/db/schema').encounters.$inferSelect; location: { name: string } }>;
  const medicalAid = getPatientMedicalAid(db, detail.patient.id);
  const financial = encounterFinancialStory(db, auth.practiceId!, id);
  const canEdit = auth.permissions.includes('encounter:start') && ['WAITING', 'WITH_DOCTOR'].includes(detail.encounter.status);
  const canComplete = auth.permissions.includes('encounter:complete') && detail.encounter.status === 'WITH_DOCTOR';

  return (
    <AppShell
      active="doctor"
      title={`${detail.patient.firstName} ${detail.patient.lastName}`}
      crumb={`Encounter · ${detail.location.name} · ${humanStatus(detail.encounter.status)}`}
    >
      <div className="ws-grid">
        <div>
          {canEdit && (
            <ConsultationWorkspace
              encounterId={id}
              status={detail.encounter.status}
              existingNote={clinical.notes[clinical.notes.length - 1]?.note ?? ''}
              existingDiagnoses={clinical.diagnoses.map((d) => ({ icd10Code: d.icd10Code, isPrimary: d.isPrimary }))}
              existingItems={clinical.items.map((i) => ({ tariffCode: i.tariffCode, description: i.description, units: i.units, unitPriceCents: i.unitPriceCents }))}
              canComplete={canComplete}
            />
          )}
          {!canEdit && clinical.notes.length > 0 && (
            <div className="card">
              <div className="card-head"><h2>Clinical note (history preserved)</h2></div>
              <div className="card-body">
                <div className="note-history">
                  {clinical.notes.map((n) => (
                    <div className="note-version" key={n.id}>
                      <strong className="small muted">Version {n.version}</strong>
                      <div>{n.note}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          {!canEdit && clinical.notes.length === 0 && (
            <div className="card"><div className="card-body empty-state">Consultation not yet started.</div></div>
          )}

          {financial.invoice && (
            <div className="card">
              <div className="card-head">
                <h2>Financial outcome</h2>
                <Link className="btn sm" href={`/invoices/${financial.invoice.id}`}>Invoice #{financial.invoice.invoiceNumber} →</Link>
              </div>
              <div className="card-body">
                <div className="kv">
                  <div className="k">Billed</div>
                  <div><strong>{rand(financial.billedCents)}</strong></div>
                  <div className="k">Claimed</div>
                  <div>{financial.claimedCents === null ? '—' : rand(financial.claimedCents)}</div>
                  <div className="k">Approved / processed</div>
                  <div>{financial.approvedCents === null ? '—' : rand(financial.approvedCents)}</div>
                  <div className="k">Medical-aid paid</div>
                  <div>{rand(financial.medicalAidPaidCents)}</div>
                  <div className="k">Patient paid</div>
                  <div>{rand(financial.patientPaidCents)}</div>
                  <div className="k">Shortfall (patient portion)</div>
                  <div>{financial.shortfallCents === null ? '—' : rand(financial.shortfallCents)}</div>
                  <div className="k">Outstanding</div>
                  <div><strong>{rand(financial.outstandingCents)}</strong></div>
                  <div className="k">Claim status</div>
                  <div>{financial.claimStatus ? <span className={`badge ${statusBadgeClass(financial.claimStatus)}`}>{humanStatus(financial.claimStatus)}</span> : '—'}</div>
                  <div className="k">Payment status</div>
                  <div><span className={`badge ${statusBadgeClass(financial.paymentStatus)}`}>{humanStatus(financial.paymentStatus)}</span></div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="card">
            <div className="card-head"><h2>Patient</h2></div>
            <div className="card-body">
              <div className="kv">
                <div className="k">Name</div>
                <div><Link href={`/patients/${detail.patient.id}`}>{detail.patient.firstName} {detail.patient.lastName}</Link></div>
                <div className="k">Date of birth</div>
                <div>{detail.patient.dateOfBirth ?? '—'}</div>
                <div className="k">Home location</div>
                <div>{detail.location.name}{detail.encounter.isCrossLocation && <span className="badge purple" style={{ marginLeft: 6 }}>treated away from home</span>}</div>
                <div className="k">Medical aid</div>
                <div>
                  {medicalAid ? `${medicalAid.scheme.name} · ${medicalAid.aid.membershipNumber}` : <span className="muted">none on file (cash patient)</span>}
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h2>Previous visits</h2></div>
            <div className="card-body">
              {history.length === 0 && <div className="muted small">No previous visits.</div>}
              {history.map((h) => (
                <div key={h.encounter.id} style={{ padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                  <div className="small" style={{ fontWeight: 600 }}>
                    {h.location.name} · {fmtDate(h.encounter.completedAt ?? h.encounter.createdAt)}
                  </div>
                  <div className="small muted">{h.encounter.status === 'CLOSED' ? 'closed' : h.encounter.status === 'AWAITING_BILLING' ? 'awaiting billing' : 'completed'}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
