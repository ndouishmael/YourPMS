/**
 * Catalogue: ICD-10 codes, tariff items, medical schemes & options.
 * Reference data for the clinical and billing workflows.
 */
import { eq, like, or, sql, and } from 'drizzle-orm';
import type { DB } from '@/db';
import { icd10Codes, tariffItems, medicalSchemes, medicalSchemeOptions } from '@/db/schema';

export function searchIcd10(db: DB, query: string, limit = 25) {
  const q = query.trim();
  if (!q) return db.select().from(icd10Codes).limit(limit).all();
  const pattern = `%${q.replace(/[%_]/g, '')}%`;
  return db
    .select()
    .from(icd10Codes)
    .where(or(like(sql`lower(${icd10Codes.code})`, q.toLowerCase()), like(sql`lower(${icd10Codes.description})`, pattern.toLowerCase())))
    .all()
    .slice(0, limit);
}

export function searchTariffs(db: DB, query: string, limit = 25) {
  const q = query.trim();
  if (!q) return db.select().from(tariffItems).limit(limit).all();
  const pattern = `%${q.replace(/[%_]/g, '')}%`;
  return db
    .select()
    .from(tariffItems)
    .where(
      and(
        eq(tariffItems.isActive, true),
        or(like(sql`lower(${tariffItems.code})`, q.toLowerCase()), like(sql`lower(${tariffItems.description})`, pattern.toLowerCase())),
      ),
    )
    .all()
    .slice(0, limit);
}

export function listSchemes(db: DB) {
  const schemes = db.select().from(medicalSchemes).all();
  const options = db.select().from(medicalSchemeOptions).all();
  return schemes.map((s) => ({ ...s, options: options.filter((o) => o.schemeId === s.id) }));
}

export function getTariffByCode(db: DB, code: string) {
  return db.select().from(tariffItems).where(eq(tariffItems.code, code.toUpperCase())).get();
}
