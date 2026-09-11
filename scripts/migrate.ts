/**
 * Migration runner: applies drizzle SQL migrations inside a transaction and
 * records them in __drizzle_migrations. Idempotent.
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

function getDbPath(): string {
  return process.env.DATABASE_PATH ?? './data/yourpms.db';
}

export function migrate(dbPath = getDbPath()) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE IF NOT EXISTS __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash TEXT NOT NULL, created_at NUMERIC)');
  const migrationsDir = path.join(process.cwd(), 'drizzle');
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`No migrations directory at ${migrationsDir}. Run "npm run db:generate" first.`);
  }
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const applied = new Set(
    (db.prepare('SELECT hash FROM __drizzle_migrations').all() as Array<{ hash: string }>).map((r) => r.hash),
  );
  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sqlText = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const run = db.transaction(() => {
      for (const stmt of sqlText.split('--> statement-breakpoint')) {
        if (stmt.trim()) db.exec(stmt);
      }
      db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(file, Date.now());
    });
    run();
    count += 1;
  }
  return { applied: count, total: files.length };
}

if (require.main === module) {
  const result = migrate();
  console.log(`[migrate] applied ${result.applied}/${result.total} pending migrations`);
}
