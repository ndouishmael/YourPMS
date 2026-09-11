'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client';

const NAV: Array<{ href: string; key: string; label: string; icon: string; permission?: string; rolesOnly?: string[] }> = [
  { href: '/dashboard', key: 'dashboard', label: 'Dashboard', icon: '⌂' },
  { href: '/reception', key: 'reception', label: 'Reception', icon: '⎙', permission: 'queue:manage' },
  { href: '/doctor', key: 'doctor', label: 'Consultations', icon: '✚', permission: 'clinical:access' },
  { href: '/patients', key: 'patients', label: 'Patients', icon: '☺', permission: 'patients:view' },
  { href: '/appointments', key: 'appointments', label: 'Appointments', icon: '🗓', permission: 'appointments:manage' },
  { href: '/billing', key: 'billing', label: 'Billing Bucket', icon: '₹', permission: 'billing:manage' },
  { href: '/finance', key: 'finance', label: 'Finance', icon: '📈', permission: 'finance:view' },
  { href: '/audit', key: 'audit', label: 'Audit Trail', icon: '🛡', permission: 'audit:view' },
  { href: '/settings', key: 'settings', label: 'Settings', icon: '⚙', permission: 'practice:view' },
];

export function SidebarNav({
  permissions,
  active,
  pendingNotifications,
}: {
  permissions: string[];
  active: string;
  pendingNotifications: number;
}) {
  const pathname = usePathname();
  return (
    <nav>
      <div className="side-section">Workspace</div>
      {NAV.filter((n) => !n.permission || permissions.includes(n.permission)).map((item) => (
        <Link
          key={item.key}
          href={item.href}
          className={active === item.key || pathname.startsWith(item.href) ? 'active' : ''}
        >
          <span className="ic">{item.icon}</span>
          {item.label}
          {item.key === 'settings' && pendingNotifications > 0 && (
            <span className="badge amber" style={{ marginLeft: 'auto' }}>
              {pendingNotifications}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}

export function LocationSwitcher({ locations }: { locations: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get('loc') ?? locations[0]?.id;
  if (locations.length <= 1) {
    return locations.length === 1 ? (
      <span className="badge teal" style={{ fontSize: 12 }}>{locations[0].name}</span>
    ) : null;
  }
  return (
    <div className="loc-switcher" data-testid="location-switcher">
      {locations.map((l) => (
        <button
          key={l.id}
          className={`loc-chip${current === l.id ? ' active' : ''}`}
          onClick={() => {
            const next = new URLSearchParams(params.toString());
            next.set('loc', l.id);
            router.push(`${pathname}?${next.toString()}`);
          }}
          data-testid={`loc-${l.name.toLowerCase().replace(/\s+/g, '-')}`}
        >
          {l.name}
        </button>
      ))}
    </div>
  );
}

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="sm"
      style={{ marginTop: 6 }}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api('/api/auth/logout', { method: 'POST' });
        } finally {
          router.push('/login');
          router.refresh();
        }
      }}
    >
      {busy ? <span className="spinner dark" /> : 'Log out'}
    </button>
  );
}

export function SupportBanner({ practiceName }: { practiceName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <div className="banner-support">
      <div>
        <strong>Scoped support access</strong> — read-only, audited view of <strong>{practiceName}</strong>. Expires automatically.
      </div>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api('/api/platform/support-access/exit', { method: 'POST' });
            router.push('/platform');
            router.refresh();
          } finally {
            setBusy(false);
          }
        }}
      >
        Exit support mode
      </button>
    </div>
  );
}
