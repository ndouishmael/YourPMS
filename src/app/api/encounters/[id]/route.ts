import { type NextRequest } from 'next/server';
import { json, handler } from '@/lib/api';
import { requirePracticeContext } from '@/lib/auth';
import { clinicalRecord } from '@/services/encounters.service';
import { getEncounterDetail } from '@/services/scheduling.service';
import { encounterFinancialStory } from '@/services/finance.service';

export const GET = handler(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = requirePracticeContext(req);
  const { id } = await params;
  const detail = getEncounterDetail(ctx.db, ctx.practiceId!, id);
  if (!ctx.locationIds.includes(detail.encounter.locationId)) {
    return json({ error: 'You are not authorized for this encounter location', code: 'FORBIDDEN' }, 403);
  }
  const clinical = ctx.permissions.includes('clinical:access')
    ? clinicalRecord(ctx.db, ctx.practiceId!, id)
    : null;
  const financial = encounterFinancialStory(ctx.db, ctx.practiceId!, id);
  return json({ encounter: detail.encounter, patient: detail.patient, location: detail.location, clinical, financial });
});
