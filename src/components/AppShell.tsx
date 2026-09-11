import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getPageAuth } from '@/lib/auth';
import { listLocations, listNotifications } from '@/services/practice.service';
import { getDb } from '@/db';
import { SidebarNav, LocationSwitcher, SupportBanner, LogoutButton } from '@/components/ShellClient';

export default async function AppShell({
  children,
  active,
  title,
  crumb,
}: {
  children: React.ReactNode;
  active: string;
  title: string;
  crumb?: string;
}) {
  const auth = await getPageAuth();
  if (!auth) redirect('/login');
  if (auth.kind === 'PLATFORM') redirect('/platform');

  const db = getDb();
  const locations = listLocations(db, auth.practiceId!).filter((l) => auth.locationIds.includes(l.id));
  const notifications = listNotifications(db, auth.practiceId!, 20);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">Your<span>PMS</span></div>
          <div className="sub">{auth.practiceName ?? 'Practice'}</div>
        </div>
        <SidebarNav
          permissions={auth.permissions}
          active={active}
          pendingNotifications={notifications.filter((n) => !n.readAt).length}
        />
        <div className="side-footer">
          <div className="who">
            {auth.user.firstName} {auth.user.lastName}
          </div>
          <div className="small" style={{ opacity: 0.8 }}>
            {auth.role === 'OWNER' ? 'Practice Owner' : auth.role === 'MANAGER' ? 'Practice Manager' : auth.role === 'SUPPORT' ? 'Platform Support' : auth.role === 'PRACTITIONER' ? 'Practitioner' : 'Receptionist'}
          </div>
          <LogoutButton />
        </div>
      </aside>
      <div className="main">
        {auth.kind === 'SUPPORT' && <SupportBanner practiceName={auth.practiceName ?? ''} />}
        <header className="topbar">
          <div>
            <h1 style={{ margin: 0 }}>{title}</h1>
            {crumb && <div className="crumb">{crumb}</div>}
          </div>
          {locations.length > 0 && <LocationSwitcher locations={locations.map((l) => ({ id: l.id, name: l.name }))} />}
        </header>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}

export { Link };
