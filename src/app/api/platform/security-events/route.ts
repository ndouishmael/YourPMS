import { type NextRequest } from 'next/server';
import { json, handler } from '@/lib/api';
import { requireAuth } from '@/lib/auth';
import { listSecurityEvents } from '@/services/audit.service';

export const GET = handler(async (req: NextRequest) => {
  const ctx = requireAuth(req);
  if (ctx.kind !== 'PLATFORM') return json({ error: 'Platform administrator access required', code: 'FORBIDDEN' }, 403);
  return json({ events: listSecurityEvents(ctx.db, 200) });
});
