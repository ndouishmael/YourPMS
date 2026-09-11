import { redirect } from 'next/navigation';
import { getPageAuth } from '@/lib/auth';

export default async function Home() {
  const auth = await getPageAuth();
  if (!auth) redirect('/login');
  redirect(auth.kind === 'PLATFORM' ? '/platform' : '/dashboard');
}
