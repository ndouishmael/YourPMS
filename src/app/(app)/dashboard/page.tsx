import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { pageLocation } from '@/lib/page-context';
import { getQueueView } from '@/services/scheduling.service';
import { financeSummary } from '@/services/finance.service';
import { listNotifications, listPendingTransfers } from '@/services/dashboard.helpers';
import { rand } from '@/lib/format';

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ loc?: string }> }) {
  const { auth, db } = await pageLocation(await searchParams);
  const notifications = listNotifications(db, auth.practiceId!, 8);
  const transfers = listPendingTransfers(db, auth.practiceId!);
  const actor = { db, practiceId: auth.practiceId!, actorUserId: auth.user.id, actorRole: auth.role ?? '', locationIds: auth.locationIds };
  const summary = financeSummary(actor, {});
  const allQueues = auth.locationIds.map((l) => getQueueView(actor, l));

  const totalWaiting = allQueues.reduce((s, q) => s + q.waiting.length, 0);
  const totalWithDoctor = allQueues.reduce((s, q) => s + q.withDoctor.length, 0);
  const totalBilling = allQueues.reduce((s, q) => s + q.billing.length, 0);

  return (
    <AppShell active="dashboard" title="Practice Dashboard" crumb={`${auth.practiceName} · overview`}>
      <div className="grid cols-4" style={{ marginBottom: 18 }}>
        <div className="stat">
          <div className="label">Waiting</div>
          <div className="value" data-testid="stat-waiting">{totalWaiting}</div>
          <div className="hint">patients in queue</div>
        </div>
        <div className="stat">
          <div className="label">With doctor</div>
          <div className="value" data-testid="stat-withdoctor">{totalWithDoctor}</div>
          <div className="hint">consultations in progress</div>
        </div>
        <div className="stat">
          <div className="label">Billing bucket</div>
          <div className="value" data-testid="stat-billing">{totalBilling}</div>
          <div className="hint">awaiting reception action</div>
        </div>
        <div className="stat">
          <div className="label">Outstanding balances</div>
          <div className="value">{rand(summary.outstandingPatientBalanceCents)}</div>
          <div className="hint">patients owe the practice</div>
        </div>
      </div>

      {transfers.length > 0 && (
        <div className="alert warn">
          <strong>{transfers.length} patient transfer{transfers.length > 1 ? 's' : ''} awaiting decision.</strong>{' '}
          Patients have completed enough alternate-location encounters to consider a permanent home-location transfer.{' '}
          <Link href="/patients">Review transfers →</Link>
        </div>
      )}

      <div className="grid cols-2">
        <div className="card">
          <div className="card-head">
            <h2>Finance at a glance (90 days)</h2>
            <Link href="/finance" className="btn sm">Full dashboard →</Link>
          </div>
          <div className="card-body">
            <div className="kv">
              <div className="k">Total billed</div>
              <div><strong>{rand(summary.totalBilledCents)}</strong></div>
              <div className="k">Cash received</div>
              <div>{rand(summary.cashReceivedCents)}</div>
              <div className="k">Medical-aid payments</div>
              <div>{rand(summary.medicalAidPaidCents)}</div>
              <div className="k">Patient payments</div>
              <div>{rand(summary.patientPaidCents)}</div>
              <div className="k">Patient shortfalls</div>
              <div>{rand(summary.shortfallCents)}</div>
              <div className="k">Outstanding claims</div>
              <div>{rand(summary.outstandingClaimedCents)}</div>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Notifications</h2>
          </div>
          <div className="card-body">
            {notifications.length === 0 && <div className="empty-state">Nothing new.</div>}
            {notifications.slice(0, 6).map((n) => (
              <div key={n.id} style={{ padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{n.title}</div>
                <div className="small muted">{n.body}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
