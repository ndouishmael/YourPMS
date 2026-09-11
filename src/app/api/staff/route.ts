import { type NextRequest } from 'next/server';
import { json, handler } from '@/lib/api';
import { requirePracticeContext, requirePermission } from '@/lib/auth';
import { listStaff, listLocations, listPractitioners } from '@/services/practice.service';

export const GET = handler(async (req: NextRequest) => {
  const ctx = requirePracticeContext(req);
  requirePermission(ctx, 'staff:view');
  const staff = listStaff(ctx.db, ctx.practiceId!);
  const locations = listLocations(ctx.db, ctx.practiceId!);
  const practitioners = listPractitioners(ctx.db, ctx.practiceId!);
  return json({ staff, locations, practitioners });
});
