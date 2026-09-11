'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/client';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      // Determine destination from the session.
      const session = await api<{ kind: string }>('/api/auth/session');
      router.push(session.kind === 'PLATFORM' ? '/platform' : '/dashboard');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="logo">Your<span>PMS</span></div>
        <div className="sub">Practice management for South African medical practices</div>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={submit}>
          <div className="field">
            <label className="f">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" autoFocus />
          </div>
          <div className="field">
            <label className="f">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          </div>
          <button className="primary" style={{ width: '100%' }} disabled={busy} type="submit">
            {busy ? <span className="spinner" /> : 'Log in'}
          </button>
        </form>
        <hr className="divider" />
        <div className="small muted">
          New practitioner? <Link href="/signup">Create your practice</Link>
        </div>
      </div>
    </div>
  );
}
