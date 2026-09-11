import { redirect } from 'next/navigation';
import { getPageAuth } from '@/lib/auth';
import { getDb } from '@/db';
import { listPractices, platformMetrics, listSupportGrants } from '@/services/platform.service';
import { listSecurityEvents } from '@/services/audit.service';
import { listAudit, verifyAuditChain } from '@/services/audit.service';
import { fmtDateTime } from '@/lib/format';
import { PlatformHeader, SupportAccessPanel } from '@/components/PlatformClient';

export const dynamic = 'force-dynamic';

export default async function PlatformPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const auth = await getPageAuth();
  if (!auth) redirect('/login');
  if (auth.kind !== 'PLATFORM') redirect('/dashboard');
  const { tab } = await searchParams;
  const activeTab = tab ?? 'overview';
  const db = getDb();

  const practices = listPractices(db);
  const metrics = platformMetrics(db);
  const grants = listSupportGrants(db);
  const securityEvents = listSecurityEvents(db, 30);
  const auditLogs = listAudit(db, { limit: 60 });
  const chain = verifyAuditChain(db);

  return (
    <div>
      <PlatformHeader email={auth.user.email} activeTab={activeTab} />
      <div className="content">
        {activeTab === 'overview' && (
          <>
            <div className="grid cols-4" style={{ marginBottom: 18 }}>
              <div className="stat"><div className="label">Practices</div><div className="value">{metrics.practices}</div><div className="hint">tenants on the platform</div></div>
              <div className="stat"><div className="label">Users</div><div className="value">{metrics.users}</div><div className="hint">all platform users</div></div>
              <div className="stat"><div className="label">Patients</div><div className="value">{metrics.patients}</div><div className="hint">across all practices</div></div>
              <div className="stat"><div className="label">Encounters</div><div className="value">{metrics.encounters}</div><div className="hint">clinical visits</div></div>
            </div>
            <div className="grid cols-4" style={{ marginBottom: 18 }}>
              <div className="stat"><div className="label">Invoices</div><div className="value">{metrics.invoices}</div></div>
              <div className="stat"><div className="label">Payments</div><div className="value">{metrics.payments}</div></div>
              <div className="stat"><div className="label">Claims</div><div className="value">{metrics.claims}</div></div>
              <div className="stat">
                <div className="label">Database</div>
                <div className="value" style={{ fontSize: 16 }}>{(metrics.db.sizeBytes / 1024 / 1024).toFixed(2)} MB</div>
                <div className="hint">{metrics.db.journalMode} · FK {metrics.db.foreignKeys === '1' ? 'on' : metrics.db.foreignKeys} · {metrics.db.pageCount} pages</div>
              </div>
            </div>
            <div className="card">
              <div className="card-head"><h2>Practices</h2><span className="badge gray">{practices.length}</span></div>
              <div className="card-body tight">
                <table className="tbl">
                  <thead>
                    <tr><th>Practice</th><th>Number</th><th>Locations</th><th>Staff</th><th>Patients</th><th>Encounters</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {practices.map((p) => (
                      <tr key={p.practice.id}>
                        <td><strong>{p.practice.name}</strong></td>
                        <td className="mono">{p.practice.practiceNumber}</td>
                        <td>{p.locationCount}</td>
                        <td>{p.staffCount}</td>
                        <td>{p.patientCount}</td>
                        <td>{p.encounterCount}</td>
                        <td><span className={`badge ${p.practice.status === 'ACTIVE' ? 'green' : 'red'}`}>{p.practice.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {activeTab === 'support' && (
          <>
            <div className="alert warn">
              Support access is <strong>explicit, scoped, time-limited and audited</strong>. A reason is mandatory; access is read-only and expires automatically.
            </div>
            <SupportAccessPanel
              practices={practices.map((p) => ({ id: p.practice.id, name: p.practice.name }))}
              activeGrants={grants
                .filter((g) => g.grant.status === 'ACTIVE')
                .map((g) => ({ id: g.grant.id, practiceName: g.practice.name, expiresAt: g.grant.expiresAt.toISOString(), adminEmail: g.admin.email }))}
            />
            <div className="card">
              <div className="card-head"><h2>Support access history</h2></div>
              <div className="card-body tight">
                {grants.length === 0 && <div className="empty-state">No support access has ever been granted.</div>}
                <table className="tbl">
                  <thead>
                    <tr><th>Admin</th><th>Practice</th><th>Reason</th><th>Window</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {grants.map((g) => (
                      <tr key={g.grant.id}>
                        <td>{g.admin.email}</td>
                        <td><strong>{g.practice.name}</strong></td>
                        <td className="small muted" style={{ maxWidth: 280 }}>{g.grant.reason}</td>
                        <td className="small">{fmtDateTime(g.grant.startsAt)} → {fmtDateTime(g.grant.expiresAt)}</td>
                        <td>
                          <span className={`badge ${g.grant.status === 'ACTIVE' ? 'green' : g.grant.status === 'REVOKED' ? 'red' : 'gray'}`}>{g.grant.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {activeTab === 'security' && (
          <div className="card">
            <div className="card-head"><h2>Security events (latest 30)</h2></div>
            <div className="card-body tight">
              {securityEvents.length === 0 && <div className="empty-state">No security events.</div>}
              <table className="tbl">
                <thead><tr><th>When</th><th>Type</th><th>Email / user</th><th>IP</th><th>Detail</th></tr></thead>
                <tbody>
                  {securityEvents.map((e) => (
                    <tr key={e.id}>
                      <td className="nowrap muted small">{fmtDateTime(e.createdAt)}</td>
                      <td><span className={`badge ${['LOGIN_FAILED', 'RATE_LIMITED', 'CSRF_REJECTED', 'ORIGIN_REJECTED'].includes(e.type) ? 'red' : 'gray'}`}>{e.type}</span></td>
                      <td className="small">{e.email ?? e.userId ?? '—'}</td>
                      <td className="small mono">{e.ip ?? '—'}</td>
                      <td className="small muted">{e.detail ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'audit' && (
          <>
            <div className="alert info">
              Platform-wide audit hash chain: <strong style={{ color: chain.ok ? 'var(--ok)' : 'var(--danger)' }}>{chain.ok ? `VALID (${chain.count} records)` : 'TAMPERING DETECTED'}</strong>
            </div>
            <div className="card">
              <div className="card-head"><h2>Platform audit log (latest 60, all practices)</h2></div>
              <div className="card-body tight">
                <table className="tbl">
                  <thead><tr><th>When</th><th>Action</th><th>Actor role</th><th>Details</th></tr></thead>
                  <tbody>
                    {auditLogs.map((l) => (
                      <tr key={l.id}>
                        <td className="nowrap muted small">{fmtDateTime(l.createdAt)}</td>
                        <td><span className="badge gray">{l.action}</span></td>
                        <td className="small">{l.actorRole ?? '—'}</td>
                        <td className="small muted" style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.metadata ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
