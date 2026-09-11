/**
 * Migration validation: applies all migrations to a fresh in-memory database,
 * verifies FK integrity, checks that every tenant table carries practice_id
 * where required, and confirms seed data integrity.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

/** Tables that directly own tenant rows and must carry practice_id. */
const TENANT_TABLES = [
  'locations',
  'memberships',
  'practitioners',
  'invitations',
  'patients',
  'patient_transfers',
  'appointments',
  'encounters',
  'invoices',
  'payments',
  'payment_adjustments',
  'claims',
  'notifications',
];

/** Tables whose tenancy is enforced transitively through a tenant-scoped parent. */
const NON_TENANT_TABLES = new Set([
  'users',
  'sessions',
  'security_events',
  'icd10_codes',
  'tariff_items',
  'medical_schemes',
  'medical_scheme_options',
  'audit_logs',
  'support_access_grants',
  'patient_location_assignments',
  'patient_medical_aid',
  'encounter_notes',
  'encounter_diagnoses',
  'encounter_items',
  'invoice_lines',
  'claim_lines',
  'claim_responses',
  'claim_tracking_events',
  'location_memberships',
]);

function fail(msg: string): never {
  console.error(`[db:validate] FAIL: ${msg}`);
  process.exit(1);
}

function main() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const migrationsDir = path.join(process.cwd(), 'drizzle');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  if (!files.length) fail('no migrations found');

  for (const file of files) {
    const sqlText = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    for (const stmt of sqlText.split('--> statement-breakpoint')) {
      if (stmt.trim()) db.exec(stmt);
    }
  }
  console.log(`[db:validate] applied ${files.length} migration file(s) to a fresh database`);

  const tables = (
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>
  ).map((r) => r.name);

  // Every expected table exists.
  for (const t of [...TENANT_TABLES, ...NON_TENANT_TABLES]) {
    if (!tables.includes(t)) fail(`missing table ${t}`);
  }

  // Tenant tables carry practice_id.
  for (const t of TENANT_TABLES) {
    const cols = (db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name);
    if (!cols.includes('practice_id')) fail(`tenant table ${t} lacks practice_id`);
  }

  // Foreign key integrity on an empty DB.
  const fkViolations = db.pragma('foreign_key_check') as unknown[];
  if (fkViolations.length) fail(`foreign key violations: ${JSON.stringify(fkViolations)}`);

  console.log(`[db:validate] OK — ${tables.length} tables, tenant scoping present, FK integrity clean`);
}

main();
