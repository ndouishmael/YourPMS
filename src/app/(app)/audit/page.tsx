import AppShell from '@/components/AppShell';
import { pageLocation } from '@/lib/page-context';
import { listAudit, verifyAuditChain } from '@/services/audit.service';
import { fmtDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function AuditPage() {
  const { auth, db } = await pageLocation({});
  const logs = listAudit(db, { practiceId: auth.practiceId, limit: 200 });
  const chain = verifyAuditChain(db);

  return (
    <AppShell active="audit" title="Audit Trail" crumb="append-only · hash-chained (tamper-evident)">
      <div className="alert info">
        Hash-chain verification: <strong style={{ color: chain.ok ? 'var(--ok)' : 'var(--danger)' }}>{chain.ok ? `VALID — ${chain.count} records intact` : `BROKEN at seq ${chain.brokenAtSeq}`}</strong>.
        Audit records are append-only; no application path can modify or delete them.
      </div>
      <div className="card">
        <div className="card-head">
          <h2>Recent events ({logs.length})</h2>
        </div>
        <div className="card-body tight">
          <table className="tbl">
            <thead>
              <tr><th>When</th><th>Action</th><th>Actor</th><th>Entity</th><th>Details</th></tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="nowrap muted small">{fmtDateTime(l.createdAt)}</td>
                  <td><span className="badge gray">{l.action}</span></td>
                  <td className="small">{l.actorRole ?? '—'}</td>
                  <td className="small mono">{l.entityType}:{l.entityId?.slice(-8) ?? '—'}</td>
                  <td className="small muted" style={{ maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.metadata ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
