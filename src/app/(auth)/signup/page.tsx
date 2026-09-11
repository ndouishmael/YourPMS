'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/client';

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    practiceName: '',
    practiceNumber: '',
    locationName: '',
    hpcsaNumber: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          hpcsaNumber: form.hpcsaNumber || undefined,
        }),
      });
      router.push('/dashboard');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed');
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card wide">
        <div className="logo">Your<span>PMS</span></div>
        <div className="sub">Set up your practice — user, practice, practice number and first location</div>
        {error && <div className="form-error">{error}</div>}
        <form onSubmit={submit}>
          <div className="frow">
            <div className="field">
              <label className="f">First name</label>
              <input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} required autoFocus />
            </div>
            <div className="field">
              <label className="f">Last name</label>
              <input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} required />
            </div>
          </div>
          <div className="field">
            <label className="f">Email</label>
            <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} required autoComplete="email" />
          </div>
          <div className="field">
            <label className="f">Password (minimum 10 characters)</label>
            <input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} required minLength={10} autoComplete="new-password" />
          </div>
          <hr className="divider" />
          <div className="frow">
            <div className="field">
              <label className="f">Practice name</label>
              <input value={form.practiceName} onChange={(e) => set('practiceName', e.target.value)} required placeholder="e.g. Dr X Family Practice" />
            </div>
            <div className="field">
              <label className="f">Practice number</label>
              <input value={form.practiceNumber} onChange={(e) => set('practiceNumber', e.target.value.replace(/\D/g, ''))} required placeholder="67809" inputMode="numeric" pattern="\d{6,10}" />
            </div>
          </div>
          <div className="frow">
            <div className="field">
              <label className="f">Initial location name</label>
              <input value={form.locationName} onChange={(e) => set('locationName', e.target.value)} required placeholder="e.g. Midrand" />
            </div>
            <div className="field">
              <label className="f">HPCSA number (optional)</label>
              <input value={form.hpcsaNumber} onChange={(e) => set('hpcsaNumber', e.target.value)} placeholder="MP 0123456" />
            </div>
          </div>
          <button className="primary" style={{ width: '100%' }} disabled={busy} type="submit">
            {busy ? <span className="spinner" /> : 'Create practice'}
          </button>
        </form>
        <hr className="divider" />
        <div className="small muted">
          Already have an account? <Link href="/login">Log in</Link>
        </div>
      </div>
    </div>
  );
}
