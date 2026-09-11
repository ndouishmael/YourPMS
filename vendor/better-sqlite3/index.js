'use strict';
/**
 * better-sqlite3 API-compatible shim backed by Node's built-in `node:sqlite`.
 *
 * Rationale: the YourPMS build environment cannot compile the native
 * better-sqlite3 addon (no access to nodejs.org headers) and cannot download
 * prebuilt binaries. Node >= 22.5 ships a synchronous SQLite driver whose
 * semantics closely match better-sqlite3, so we implement the small surface
 * drizzle-orm relies on:
 *
 *   db.prepare(sql)            -> Statement { run, get, all, raw, iterate }
 *   db.exec(sql)
 *   db.pragma(str)
 *   db.transaction(fn)         -> { deferred, immediate, exclusive }
 *   db.open, db.close()
 *
 * Raw mode (rows as arrays of values in result-column order) is emulated via
 * StatementSync#columns().
 */
const { DatabaseSync } = require('node:sqlite');

function toObjArrayResult(rows) {
  // node:sqlite returns [] when duplicate column names collide; drizzle never
  // generates duplicate result column names (it aliases every selected field),
  // so plain object rows are safe here. Assertion is kept for safety.
  return rows;
}

class RawStatement {
  constructor(stmt) {
    this._stmt = stmt;
  }
  all(...params) {
    const rows = this._stmt.all(...params);
    const cols = this._stmt.columns().map((c) => c.column);
    return rows.map((r) => cols.map((c) => r[c]));
  }
  get(...params) {
    const row = this._stmt.get(...params);
    if (row === undefined) return undefined;
    const cols = this._stmt.columns().map((c) => c.column);
    return cols.map((c) => row[c]);
  }
  iterate(...params) {
    const it = this._stmt.iterate(...params);
    const cols = this._stmt.columns().map((c) => c.column);
    return (function* () {
      for (const r of it) yield cols.map((c) => r[c]);
    })();
  }
}

class Statement {
  constructor(stmt) {
    this._stmt = stmt;
  }
  run(...params) {
    const res = this._stmt.run(...params);
    return { changes: res.changes, lastInsertRowid: res.lastInsertRowid };
  }
  get(...params) {
    return this._stmt.get(...params);
  }
  all(...params) {
    return toObjArrayResult(this._stmt.all(...params));
  }
  raw() {
    return new RawStatement(this._stmt);
  }
  iterate(...params) {
    return this._stmt.iterate(...params);
  }
}

class Database {
  constructor(path = ':memory:', options = {}) {
    this._db = new DatabaseSync(path, options);
    this.open = !!this._db.open;
    this.name = String(path);
    this.inTransaction = false;
  }
  prepare(sql) {
    return new Statement(this._db.prepare(sql));
  }
  exec(sql) {
    this._db.exec(sql);
  }
  pragma(src, options) {
    const isGet = typeof options === 'object' && options !== null && options.simple;
    const stmt = this._db.prepare(`PRAGMA ${src}`);
    return isGet ? stmt.get() : stmt.all();
  }
  close() {
    this._db.close();
    this.open = false;
  }
  transaction(fn) {
    const db = this;
    const wrap = (mode) =>
      (...args) => {
        if (db.inTransaction) {
          // Nested transaction: use savepoints like better-sqlite3 does.
          const sp = `sp_${Math.random().toString(36).slice(2)}`;
          db.exec(`savepoint ${sp}`);
          try {
            const result = fn(...args);
            db.exec(`release savepoint ${sp}`);
            return result;
          } catch (e) {
            db.exec(`rollback to savepoint ${sp}`);
            db.exec(`release savepoint ${sp}`);
            throw e;
          }
        }
        db.exec(`begin ${mode}`);
        db.inTransaction = true;
        try {
          const result = fn(...args);
          db.exec('commit');
          return result;
        } catch (e) {
          try {
            db.exec('rollback');
          } catch {
            /* connection already rolled back */
          }
          throw e;
        } finally {
          db.inTransaction = false;
        }
      };
    // Matches better-sqlite3: returns a wrapped function; does not execute fn.
    const tx = (...args) => wrap('deferred')(...args);
    tx.deferred = (...args) => wrap('deferred')(...args);
    tx.immediate = (...args) => wrap('immediate')(...args);
    tx.exclusive = (...args) => wrap('exclusive')(...args);
    return tx;
  }
}

module.exports = Database;
module.exports.default = Database;
module.exports.Database = Database;
