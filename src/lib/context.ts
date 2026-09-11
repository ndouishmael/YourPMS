/** Bridge from the auth context to service-layer actor contexts. */
import type { NextRequest } from 'next/server';
import { requirePracticeContext, type AuthContext } from '@/lib/auth';
import type { ActorContext } from '@/services/scheduling.service';
import type { PatientAccessContext } from '@/services/patients.service';

export function actorContextFrom(req: NextRequest, ctx?: AuthContext): ActorContext & PatientAccessContext {
  const auth = ctx ?? requirePracticeContext(req);
  return {
    db: auth.db,
    practiceId: auth.practiceId!,
    actorUserId: auth.user.id,
    actorRole: auth.role ?? 'UNKNOWN',
    locationIds: auth.locationIds,
    ip: auth.ip,
    userAgent: auth.userAgent,
  };
}
