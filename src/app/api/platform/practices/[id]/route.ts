import { type NextRequest } from 'next/server';
import { json, handler } from '@/lib/api';
import { requireAuth } from '@/lib/auth';
import { platformPracticeDetail } from '@/services/platform.service';

export const GET = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = requireAuth(req);
  if (ctx.kind !== 'PLATFORM') return json({ error: 'Platform administrator access required', code: 'FORBIDDEN' }, 403);
  const { id } = await params;
  return json({ detail: platformPracticeDetail(ctx.db, id) });
});
