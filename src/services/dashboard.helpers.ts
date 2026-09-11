/** Small aggregation helpers for dashboard pages. */
import { getDb } from '@/db';
import { listNotifications, listPractitioners } from './practice.service';
import { listPendingTransfers } from './patients.service';

export const db = () => getDb();
export { listNotifications, listPendingTransfers, listPractitioners };
