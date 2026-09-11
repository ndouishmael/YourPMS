import AppShell from '@/components/AppShell';
import { pageLocation } from '@/lib/page-context';
import { getQueueView } from '@/services/scheduling.service';
import { rand } from '@/lib/format';
import Link from 'next/link';
import { listClaims } from '@/services/claims.service';
import { humanStatus, statusBadgeClass, fmtDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ loc?: string }> }) {
  const { auth, db, selected, selectedLocName } = await pageLocation(await searchParams);
  const actor = { db, practiceId: auth.practiceId!, actorUserId: auth.user.id, actorRole: auth.role ?? '', locationIds: auth.locationIds };
  const queue = getQueueView(actor, selected);
  const problemClaims = listClaims(actor, ['REJECTED', 'FAILED', 'SUBMITTED', 'ACCEPTED']);

  return (
    <AppShell active="billing" title="Billing Bucket" crumb={`${selectedLocName} · reception billing`}>
      <div className="alert info">
        The billing bucket lists consultations that need <strong>immediate receptionist billing action</strong> (cash or medical-aid claim).
        Once the immediate action is taken the item leaves the bucket — longer-running claim processing continues under Claims.
      </div>

      {queue.billing.length === 0 ? (
        <div className="card"><div className="card-body empty-state" data-testid="bucket-empty">Billing bucket is empty. 🎉</div></div>
      ) : (
        queue.billing.map((b) => (
          <div className="bucket-item" key={b.encounterId} data-testid="bucket-item">
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{b.patientName}</div>
              <div className="small muted">
                Invoice #{b.invoiceNumber} ·{' '}
                {b.hasClaim ? <>claim <span className={`badge ${statusBadgeClass(b.claimStatus ?? '')}`}>{humanStatus(b.claimStatus ?? '')}</span></> : 'no claim yet'}
              </div>
            </div>
            <div className="bk-amount" data-testid="bucket-amount">{rand(b.totalCents)}</div>
            <div className="small">
              {b.balanceCents > 0 ? <>Balance <strong>{rand(b.balanceCents)}</strong></> : <span className="badge green">settled</span>}
            </div>
            <div className="bucket-actions">
              <Link className="btn sm primary" href={`/invoices/${b.invoiceId}`} data-testid="bucket-open">
                Open billing →
              </Link>
            </div>
          </div>
        ))
      )}

      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-head">
          <h2>Claims in flight &amp; problems</h2>
          <span className="badge gray">{problemClaims.length} claims</span>
        </div>
        <div className="card-body tight">
          {problemClaims.length === 0 && <div className="empty-state">No claims in flight.</div>}
          <table className="tbl">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Scheme</th>
                <th>Claimed</th>
                <th>Status</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {problemClaims.map((c) => (
                <tr key={c.claim.id}>
                  <td>{c.patient.firstName} {c.patient.lastName}</td>
                  <td className="muted">{c.scheme.name}</td>
                  <td>{rand(c.claim.claimedCents)}</td>
                  <td><span className={`badge ${statusBadgeClass(c.claim.status)}`}>{humanStatus(c.claim.status)}</span></td>
                  <td className="muted small">{fmtDateTime(c.claim.updatedAt)}</td>
                  <td className="right"><Link className="btn sm" href={`/invoices/${c.claim.invoiceId}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
