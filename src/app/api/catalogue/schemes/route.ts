import { type NextRequest } from 'next/server';
import { json, handler } from '@/lib/api';
import { requirePracticeContext } from '@/lib/auth';
import { listSchemes } from '@/services/catalogue.service';

export const GET = handler(async (req: NextRequest) => {
  const ctx = requirePracticeContext(req);
  return json({ schemes: listSchemes(ctx.db) });
});
