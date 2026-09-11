import { notFound } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { getPageAuth } from '@/lib/auth';
import { getDb } from '@/db';
import { getInvoiceAuthorized } from '@/services/billing.service';
import { getClaimDetail } from '@/services/claims.service';
import { rand, fmtDateTime, statusBadgeClass, humanStatus } from '@/lib/format';
import Link from 'next/link';
import { PaymentPanel, ClaimPanel, InvoiceAdminPanel } from '@/components/InvoicePanels';

export const dynamic = 'force-dynamic';

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await getPageAuth();
  if (!auth || auth.kind === 'PLATFORM') notFound();
  const db = getDb();
  const { id } = await params;
  const actor = { db, practiceId: auth.practiceId!, actorUserId: auth.user.id, actorRole: auth.role ?? '', locationIds: auth.locationIds };

  let data;
  try {
    data = getInvoiceAuthorized(actor, id);
  } catch {
    notFound();
  }
  const { invoice, patient, lines, payments, adjustments, claim } = data;
  const claimDetail = claim ? getClaimDetail(actor, claim.id) : null;
  const balance = invoice.totalCents - invoice.adjustedCents - invoice.paidCents;
  const canPay = auth.permissions.includes('payments:record');
  const canClaim = auth.permissions.includes('claims:submit');
  const canAdmin = auth.permissions.includes('invoices:void');

  return (
    <AppShell
      active="billing"
      title={`Invoice #${invoice.invoiceNumber}`}
      crumb={`${patient.firstName} ${patient.lastName} · ${humanStatus(invoice.status)}`}
    >
      <div className="ws-grid">
        <div>
          <div className="card">
            <div className="card-head">
              <h2>Invoice #{invoice.invoiceNumber}</h2>
              <span className={`badge ${statusBadgeClass(invoice.status)}`} data-testid="invoice-status">{humanStatus(invoice.status)}</span>
            </div>
            <div className="card-body">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Code</th>
                    <th>Description</th>
                    <th className="right">Units</th>
                    <th className="right">Unit price</th>
                    <th className="right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td className="mono">{l.tariffCode}</td>
                      <td>{l.description}</td>
                      <td className="right">{l.units}</td>
                      <td className="right">{rand(l.unitPriceCents)}</td>
                      <td className="right"><strong>{rand(l.amountCents)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <hr className="divider" />
              <div className="kv" style={{ gridTemplateColumns: '1fr 140px' }}>
                <div className="k right">Total</div>
                <div className="right"><strong>{rand(invoice.totalCents)}</strong></div>
                <div className="k right">Adjustments</div>
                <div className="right">{rand(invoice.adjustedCents)}</div>
                <div className="k right">Paid</div>
                <div className="right">{rand(invoice.paidCents)}</div>
                <div className="k right" style={{ fontWeight: 700 }}>Balance due</div>
                <div className="right" style={{ fontWeight: 750 }} data-testid="invoice-balance">{rand(balance)}</div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h2>Payments</h2></div>
            <div className="card-body">
              {payments.length === 0 && <div className="muted small">No payments recorded.</div>}
              <table className="tbl">
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td>{fmtDateTime(p.receivedAt)}</td>
                      <td>{p.payerType === 'MEDICAL_AID' ? <span className="badge purple">Medical aid</span> : <span className="badge teal">Patient</span>}</td>
                      <td>{p.method}</td>
                      <td className="right"><strong>{rand(p.amountCents)}</strong></td>
                      <td>
                        {p.status === 'ACTIVE' ? (
                          <span className="badge green">active</span>
                        ) : (
                          <span className="badge red">reversed: {p.reversalReason}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {adjustments.length > 0 && (
                <>
                  <hr className="divider" />
                  <div className="small muted">Adjustments:</div>
                  {adjustments.map((a) => (
                    <div className="small" key={a.id}>
                      {a.type}: <strong>{rand(a.amountCents)}</strong> — {a.reason}
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>

          {claimDetail && (
            <div className="card">
              <div className="card-head">
                <h2>Claim</h2>
                <span className={`badge ${statusBadgeClass(claimDetail.claim.status)}`}>{humanStatus(claimDetail.claim.status)}</span>
              </div>
              <div className="card-body">
                <div className="kv">
                  <div className="k">Claimed</div>
                  <div>{rand(claimDetail.claim.claimedCents)}</div>
                  <div className="k">Approved</div>
                  <div>{claimDetail.claim.approvedCents === null ? '—' : rand(claimDetail.claim.approvedCents)}</div>
                  <div className="k">Scheme paid</div>
                  <div>{rand(claimDetail.claim.schemePaidCents)}</div>
                  <div className="k">Patient portion (shortfall)</div>
                  <div>{rand(claimDetail.claim.patientPortionCents)}</div>
                  <div className="k">Reference</div>
                  <div className="mono">{claimDetail.claim.externalReference ?? '—'}</div>
                </div>
                <hr className="divider" />
                <div className="small muted">Tracking:</div>
                {claimDetail.tracking.map((t) => (
                  <div className="small" key={t.id}>
                    · {fmtDateTime(t.createdAt)} — <strong>{humanStatus(t.status)}</strong> {t.detail ? `— ${t.detail}` : ''}
                  </div>
                ))}
                {auth.permissions.includes('claims:respond') && (
                  <ClaimPanel
                    invoiceId={invoice.id}
                    claimId={claimDetail.claim.id}
                    claimedCents={claimDetail.claim.claimedCents}
                    status={claimDetail.claim.status}
                    canResubmit={auth.permissions.includes('claims:submit')}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        <div>
          <div className="card">
            <div className="card-head"><h2>Take payment</h2></div>
            <div className="card-body">
              {canPay && ['ISSUED', 'PARTIALLY_PAID', 'ADJUSTED'].includes(invoice.status) ? (
                <PaymentPanel invoiceId={invoice.id} balanceCents={balance} />
              ) : (
                <div className="muted small">
                  {invoice.status === 'PAID' ? 'Invoice fully paid.' : invoice.status === 'VOID' ? 'Invoice voided.' : 'Payments are not accepted in this state.'}
                </div>
              )}
            </div>
          </div>

          {canClaim && !claim && ['ISSUED', 'PARTIALLY_PAID'].includes(invoice.status) && (
            <div className="card">
              <div className="card-head"><h2>Medical aid</h2></div>
              <div className="card-body">
                <ClaimPanel invoiceId={invoice.id} claimedCents={invoice.totalCents} status="NONE" canSubmit />
              </div>
            </div>
          )}

          {canAdmin && (
            <div className="card">
              <div className="card-head"><h2>Admin</h2></div>
              <div className="card-body">
                <InvoiceAdminPanel
                  invoiceId={invoice.id}
                  status={invoice.status}
                  canAdjust={auth.permissions.includes('payments:adjust')}
                  encounterId={invoice.encounterId}
                />
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-body small muted">
              Patient: <Link href={`/patients/${patient.id}`}>{patient.firstName} {patient.lastName}</Link>
              {data.encounter && <> · Encounter <Link href={`/encounters/${data.encounter.id}`}>open workspace</Link></>}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
