import { type NextRequest } from 'next/server';
import { json, handler } from '@/lib/api';
import { requireAuth } from '@/lib/auth';
import { listPractices } from '@/services/platform.service';

export const GET = handler(async (req: NextRequest) => {
  const ctx = requireAuth(req);
  if (ctx.kind !== 'PLATFORM') return json({ error: 'Platform administrator access required', code: 'FORBIDDEN' }, 403);
  return json({ practices: listPractices(ctx.db) });
});
