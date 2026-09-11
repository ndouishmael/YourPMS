import { type NextRequest } from 'next/server';
import { json, handler } from '@/lib/api';
import { requirePracticeContext } from '@/lib/auth';
import { searchIcd10 } from '@/services/catalogue.service';

export const GET = handler(async (req: NextRequest) => {
  const ctx = requirePracticeContext(req);
  const q = req.nextUrl.searchParams.get('q') ?? '';
  return json({ codes: searchIcd10(ctx.db, q) });
});
