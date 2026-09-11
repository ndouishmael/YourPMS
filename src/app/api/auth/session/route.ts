import { type NextRequest } from 'next/server';
import { json, handler } from '@/lib/api';
import { requireAuth } from '@/lib/auth';

export const GET = handler(async (req: NextRequest) => {
  const ctx = requireAuth(req);
  return json({
    user: {
      id: ctx.user.id,
      email: ctx.user.email,
      firstName: ctx.user.firstName,
      lastName: ctx.user.lastName,
      platformRole: ctx.user.platformRole,
    },
    kind: ctx.kind,
    practiceId: ctx.practiceId,
    practiceName: ctx.practiceName,
    role: ctx.role,
    locationIds: ctx.locationIds,
    permissions: ctx.permissions,
    supportGrantId: ctx.supportGrantId,
  });
});
