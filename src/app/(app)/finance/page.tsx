import AppShell from '@/components/AppShell';
import { pageLocation } from '@/lib/page-context';
import { financeSummary } from '@/services/finance.service';
import { rand } from '@/lib/format';
import { humanStatus } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function FinancePage({ searchParams }: { searchParams: Promise<{ loc?: string }> }) {
  const { auth, db, selected } = await pageLocation(await searchParams);
  const actor = { db, practiceId: auth.practiceId!, actorUserId: auth.user.id, actorRole: auth.role ?? '', locationIds: auth.locationIds };
  const summary = financeSummary(actor, { locationId: selected });

  return (
    <AppShell active="finance" title="Finance" crumb="billed ≠ claimed ≠ processed ≠ paid — tracked separately">
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="stat">
          <div className="label">Total billed</div>
          <div className="value">{rand(summary.totalBilledCents)}</div>
          <div className="hint">last 90 days</div>
        </div>
        <div className="stat">
          <div className="label">Cash received</div>
          <div className="value">{rand(summary.cashReceivedCents)}</div>
          <div className="hint">cash payments</div>
        </div>
        <div className="stat">
          <div className="label">Medical-aid paid</div>
          <div className="value">{rand(summary.medicalAidPaidCents)}</div>
          <div className="hint">scheme payments</div>
        </div>
        <div className="stat">
          <div className="label">Patient payments</div>
          <div className="value">{rand(summary.patientPaidCents)}</div>
          <div className="hint">incl. shortfalls settled</div>
        </div>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="stat">
          <div className="label">Patient shortfalls</div>
          <div className="value" data-testid="stat-shortfall">{rand(summary.shortfallCents)}</div>
          <div className="hint">processed claims, patient portion</div>
        </div>
        <div className="stat">
          <div className="label">Outstanding claims</div>
          <div className="value">{rand(summary.outstandingClaimedCents)}</div>
          <div className="hint">submitted / accepted</div>
        </div>
        <div className="stat">
          <div className="label">Outstanding patient balances</div>
          <div className="value" data-testid="stat-outstanding">{rand(summary.outstandingPatientBalanceCents)}</div>
          <div className="hint">open invoices</div>
        </div>
        <div className="stat">
          <div className="label">Reconciliation</div>
          <div className="value" style={{ color: summary.reconciliation.mismatches ? 'var(--danger)' : 'var(--ok)' }}>
            {summary.reconciliation.mismatches ? `${summary.reconciliation.mismatches} mismatches` : 'Clean'}
          </div>
          <div className="hint">{summary.reconciliation.invoicesChecked} invoices checked</div>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <div className="card-head"><h2>Revenue by day</h2></div>
          <div className="card-body tight">
            {summary.revenueByDay.length === 0 && <div className="empty-state">No billing activity yet.</div>}
            <table className="tbl">
              <thead>
                <tr><th>Day</th><th className="right">Billed</th><th className="right">Received</th></tr>
              </thead>
              <tbody>
                {summary.revenueByDay.slice(-14).map((d) => (
                  <tr key={d.day}>
                    <td>{d.day}</td>
                    <td className="right">{rand(d.billedCents)}</td>
                    <td className="right"><strong>{rand(d.paidCents)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Debtor ageing</h2></div>
          <div className="card-body tight">
            <table className="tbl">
              <thead>
                <tr><th>Bucket</th><th className="right">Invoices</th><th className="right">Outstanding</th></tr>
              </thead>
              <tbody>
                {summary.debtorAgeing.map((b) => (
                  <tr key={b.bucket}>
                    <td>{b.bucket}</td>
                    <td className="right">{b.invoiceCount}</td>
                    <td className="right"><strong>{rand(b.outstandingCents)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Revenue by practitioner</h2></div>
          <div className="card-body tight">
            {summary.revenueByPractitioner.length === 0 && <div className="empty-state">No attributed revenue yet.</div>}
            <table className="tbl">
              <thead>
                <tr><th>Practitioner</th><th className="right">Billed</th><th className="right">Received</th></tr>
              </thead>
              <tbody>
                {summary.revenueByPractitioner.map((p) => (
                  <tr key={p.practitionerId ?? 'unattributed'}>
                    <td>{p.name}</td>
                    <td className="right">{rand(p.billedCents)}</td>
                    <td className="right"><strong>{rand(p.paidCents)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Revenue by location / method / claims</h2></div>
          <div className="card-body">
            <table className="tbl">
              <thead><tr><th>Location</th><th className="right">Billed</th><th className="right">Received</th></tr></thead>
              <tbody>
                {summary.revenueByLocation.map((l) => (
                  <tr key={l.locationId}>
                    <td>{l.locationName}</td>
                    <td className="right">{rand(l.billedCents)}</td>
                    <td className="right"><strong>{rand(l.paidCents)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <hr className="divider" />
            <div className="pill-row">
              {summary.revenueByMethod.map((m) => (
                <span key={m.method} className="badge gray">{m.method}: {rand(m.amountCents)}</span>
              ))}
            </div>
            <hr className="divider" />
            <div className="pill-row">
              {Object.entries(summary.claimCounts).map(([status, count]) => (
                <span key={status} className="badge teal">{humanStatus(status)}: {count}</span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {summary.claimProblems.length > 0 && (
        <div className="card" style={{ marginTop: 4 }}>
          <div className="card-head"><h2>Claim problems</h2><span className="badge red">{summary.claimProblems.length}</span></div>
          <div className="card-body tight">
            <table className="tbl">
              <thead><tr><th>Patient</th><th>Status</th><th className="right">Claimed</th></tr></thead>
              <tbody>
                {summary.claimProblems.map((c) => (
                  <tr key={c.claimId}>
                    <td>{c.patientName}</td>
                    <td><span className="badge red">{humanStatus(c.status)}</span></td>
                    <td className="right">{rand(c.claimedCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppShell>
  );
}
