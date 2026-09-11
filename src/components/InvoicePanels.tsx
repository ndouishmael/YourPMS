'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, formatRand } from '@/lib/client';

/** Cash/card/EFT payment capture against an invoice. */
export function PaymentPanel({ invoiceId, balanceCents }: { invoiceId: string; balanceCents: number }) {
  const router = useRouter();
  const [rands, setRands] = useState((balanceCents / 100).toFixed(2));
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const amountCents = Math.round((parseFloat(rands) || 0) * 100);
      await api(`/api/invoices/${invoiceId}/payments`, {
        method: 'POST',
        body: JSON.stringify({ amountCents, method, reference: reference || undefined }),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {error && <div className="form-error" data-testid="payment-error">{error}</div>}
      <div className="field">
        <label className="f">Amount (balance {formatRand(balanceCents)})</label>
        <input
          type="number"
          min="0"
          step="0.01"
          value={rands}
          onChange={(e) => setRands(e.target.value)}
          data-testid="payment-amount"
        />
      </div>
      <div className="field">
        <label className="f">Method</label>
        <select value={method} onChange={(e) => setMethod(e.target.value)} data-testid="payment-method">
          <option value="CASH">Cash</option>
          <option value="CARD">Card</option>
          <option value="EFT">EFT</option>
        </select>
      </div>
      <div className="field">
        <label className="f">Reference (optional)</label>
        <input value={reference} onChange={(e) => setReference(e.target.value)} />
      </div>
      <button className="primary" style={{ width: '100%' }} onClick={pay} disabled={busy} data-testid="record-payment">
        {busy ? <span className="spinner" /> : `Record ${method.toLowerCase()} payment`}
      </button>
    </div>
  );
}

/** Medical-aid claim actions: submit, record scheme response, resubmit. */
export function ClaimPanel({
  invoiceId,
  claimId,
  claimedCents,
  status,
  canSubmit,
  canResubmit,
}: {
  invoiceId: string;
  claimId?: string;
  claimedCents: number;
  status: string;
  canSubmit?: boolean;
  canResubmit?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showResponse, setShowResponse] = useState(false);
  const [outcome, setOutcome] = useState('PROCESSED');
  const [paidRands, setPaidRands] = useState('');
  const [patientPortionRands, setPatientPortionRands] = useState('');
  const [message, setMessage] = useState('');

  async function submitClaim() {
    setBusy('submit');
    setError(null);
    try {
      await api(`/api/invoices/${invoiceId}/claims`, { method: 'POST' });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Claim submission failed');
    } finally {
      setBusy(null);
    }
  }

  async function resubmit() {
    setBusy('resubmit');
    setError(null);
    try {
      await api(`/api/claims/${claimId}/resubmit`, { method: 'POST' });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resubmission failed');
    } finally {
      setBusy(null);
    }
  }

  async function recordResponse() {
    setBusy('response');
    setError(null);
    try {
      const body: Record<string, unknown> = { outcome, message: message || undefined };
      if (outcome === 'PROCESSED') {
        const schemePaidCents = Math.round((parseFloat(paidRands) || 0) * 100);
        const patientPortionCents = Math.round((parseFloat(patientPortionRands) || 0) * 100);
        body.schemePaidCents = schemePaidCents;
        body.patientPortionCents = patientPortionCents;
        body.approvedCents = schemePaidCents + patientPortionCents;
      }
      await api(`/api/claims/${claimId}/response`, { method: 'POST', body: JSON.stringify(body) });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record response');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      {error && <div className="form-error" data-testid="claim-error">{error}</div>}
      {status === 'NONE' && canSubmit && (
        <button className="primary" style={{ width: '100%' }} onClick={submitClaim} disabled={busy !== null} data-testid="submit-claim">
          {busy === 'submit' ? <span className="spinner" /> : 'Submit medical-aid claim'}
        </button>
      )}
      {claimId && ['SUBMITTED', 'ACCEPTED', 'REJECTED', 'PROCESSED', 'FAILED'].includes(status) && (
        <>
          {['REJECTED', 'FAILED'].includes(status) && canResubmit && (
            <button className="primary" style={{ width: '100%', marginBottom: 10 }} onClick={resubmit} disabled={busy !== null} data-testid="resubmit-claim">
              {busy === 'resubmit' ? <span className="spinner" /> : 'Resubmit claim'}
            </button>
          )}
          <button className="sm" onClick={() => setShowResponse((s) => !s)} data-testid="toggle-response">
            {showResponse ? 'Cancel' : 'Record scheme response…'}
          </button>
          {showResponse && (
            <div style={{ marginTop: 10 }}>
              <div className="field">
                <label className="f">Outcome</label>
                <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                  <option value="ACCEPTED">Accepted</option>
                  <option value="PROCESSED">Processed (payment)</option>
                  <option value="REJECTED">Rejected</option>
                  <option value="FAILED">Failed</option>
                </select>
              </div>
              {outcome === 'PROCESSED' && (
                <>
                  <div className="field">
                    <label className="f">Scheme pays (claimed {formatRand(claimedCents)})</label>
                    <input type="number" min="0" step="0.01" value={paidRands} onChange={(e) => setPaidRands(e.target.value)} placeholder="e.g. 800.00" data-testid="scheme-paid" />
                  </div>
                  <div className="field">
                    <label className="f">Patient portion (shortfall)</label>
                    <input type="number" min="0" step="0.01" value={patientPortionRands} onChange={(e) => setPatientPortionRands(e.target.value)} placeholder="e.g. 200.00" data-testid="patient-portion" />
                  </div>
                </>
              )}
              <div className="field">
                <label className="f">Message (optional)</label>
                <input value={message} onChange={(e) => setMessage(e.target.value)} />
              </div>
              <button onClick={recordResponse} disabled={busy !== null} data-testid="record-response">
                {busy === 'response' ? <span className="spinner" /> : 'Record response'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Void / adjust / reverse admin actions. */
export function InvoiceAdminPanel({
  invoiceId,
  status,
  canAdjust,
  encounterId,
}: {
  invoiceId: string;
  status: string;
  canAdjust: boolean;
  encounterId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(path: string, body: Record<string, unknown>, key: string, confirmMsg: string) {
    if (!confirm(confirmMsg)) return;
    setBusy(key);
    setError(null);
    try {
      await api(path, { method: 'POST', body: JSON.stringify(body) });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      {error && <div className="form-error">{error}</div>}
      <div className="pill-row">
        {status !== 'VOID' && status !== 'PAID' && (
          <button
            className="sm danger"
            disabled={busy !== null}
            onClick={() => act(`/api/invoices/${invoiceId}/void`, { reason: prompt('Void reason?') ?? '' }, 'void', 'Void this invoice?')}
            data-testid="void-invoice"
          >
            Void invoice
          </button>
        )}
        {status === 'VOID' && (
          <button
            className="sm"
            disabled={busy !== null}
            onClick={() => act(`/api/invoices/${encounterId}/regenerate`, {}, 'regen', 'Re-issue the invoice from the encounter items?')}
          >
            Re-issue invoice
          </button>
        )}
      </div>
      {canAdjust && ['ISSUED', 'PARTIALLY_PAID', 'ADJUSTED'].includes(status) && (
        <div style={{ marginTop: 10 }}>
          <button
            className="sm"
            disabled={busy !== null}
            onClick={() => {
              const amount = prompt('Adjustment amount in Rand (reduces the balance)?');
              const reason = amount ? prompt('Reason (discount / write-off)?') ?? '' : '';
              if (amount) {
                act(
                  `/api/invoices/${invoiceId}/adjustments`,
                  { amountCents: Math.round(parseFloat(amount) * 100), type: reason.toLowerCase().includes('write') ? 'WRITE_OFF' : 'DISCOUNT', reason },
                  'adjust',
                  `Apply a ${amount} adjustment?`,
                );
              }
            }}
            data-testid="adjust-invoice"
          >
            Adjust / write off
          </button>
        </div>
      )}
    </div>
  );
}
