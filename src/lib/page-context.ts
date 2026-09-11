import { redirect } from 'next/navigation';
import { getPageAuth } from '@/lib/auth';
import { listLocations } from '@/services/practice.service';
import { getDb } from '@/db';
import { forbidden } from '@/lib/errors';

/** Resolve the selected location for a page (?loc= or first authorized). */
export async function pageLocation(searchParams: { loc?: string }) {
  const auth = await getPageAuth();
  if (!auth) redirect('/login');
  if (auth.kind === 'PLATFORM') redirect('/platform');
  const db = getDb();
  const authorized = listLocations(db, auth.practiceId!).filter((l) => auth.locationIds.includes(l.id));
  if (!authorized.length) throw forbidden('You are not authorized for any location');
  const selected = searchParams.loc && authorized.some((l) => l.id === searchParams.loc) ? searchParams.loc : authorized[0].id;
  const selectedLocation = authorized.find((l) => l.id === selected)!;
  return { auth, db, authorized, selected, selectedLocation, selectedLocName: selectedLocation.name };
}
