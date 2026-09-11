'use client';

import { Suspense, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/client';

function AcceptForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/accept-invitation', { method: 'POST', body: JSON.stringify({ token, password }) });
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept invitation');
      setBusy(false);
    }
  }

  if (!token) {
    return <div className="form-error">This invitation link is missing its token. Ask your practice manager for a new invitation.</div>;
  }

  return (
    <form onSubmit={submit}>
      {error && <div className="form-error">{error}</div>}
      <div className="field">
        <label className="f">Choose a password (minimum 10 characters)</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} autoFocus autoComplete="new-password" />
      </div>
      <button className="primary" style={{ width: '100%' }} disabled={busy} type="submit">
        {busy ? <span className="spinner" /> : 'Accept invitation & create account'}
      </button>
    </form>
  );
}

export default function AcceptInvitationPage() {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="logo">Your<span>PMS</span></div>
        <div className="sub">You have been invited to join a practice. Your practice, role and location permissions are already set by the invitation.</div>
        <Suspense fallback={<div className="muted">Loading…</div>}>
          <AcceptForm />
        </Suspense>
      </div>
    </div>
  );
}
