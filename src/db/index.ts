/**
 * Database client. SQLite via the local better-sqlite3-compatible shim
 * (vendor/better-sqlite3, backed by node:sqlite). The schema is portable:
 * swapping the driver for the native better-sqlite3 or libsql client requires
 * no application changes.
 */
import Database from 'better-sqlite3';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export type DB = ReturnType<typeof createDb>;

let _db: ReturnType<typeof drizzleSqlite<typeof schema>> | null = null;
let _client: InstanceType<typeof Database> | null = null;

export function getDatabasePath(): string {
  return process.env.DATABASE_PATH ?? './data/yourpms.db';
}

export function createDb(path?: string) {
  const dbPath = path ?? getDatabasePath();
  if (dbPath !== ':memory:') {
    const fs = require('node:fs') as typeof import('node:fs');
    fs.mkdirSync(dbPath.split('/').slice(0, -1).join('/') || '.', { recursive: true });
  }
  const client = new Database(dbPath);
  // Hardening pragmas (no-op extras are cheap; WAL improves concurrency).
  client.pragma('journal_mode = WAL');
  client.pragma('foreign_keys = ON');
  return drizzleSqlite({ client, schema });
}

/** Singleton used by the Next.js app. */
export function getDb() {
  if (!_db) {
    _db = createDb();
    _client = _db.$client as unknown as InstanceType<typeof Database>;
  }
  return _db;
}

/** Raw client (for migrations / pragma tuning). */
export function getRawClient() {
  getDb();
  return _client!;
}

export * as tables from './schema';
