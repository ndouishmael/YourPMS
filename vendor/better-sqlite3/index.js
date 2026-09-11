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
 * StatementSync#columns(). Because node:sqlite returns row objects keyed by
 * column NAME, duplicate column names (e.g. `select a.id, b.id from ... join
 * ...`) would collapse to the last value. Drizzle relies on raw mode for all
 * field-mapped queries, so we transparently rewrite the SELECT / RETURNING
 * column lists with unique positional aliases before executing raw-mode reads.
 * Object-mode reads (no .raw()) keep the original SQL and column names.
 */
const { DatabaseSync } = require('node:sqlite');

/* ------------------------------------------------------------------ */
/* SQL rewriting for raw mode                                         */
/* ------------------------------------------------------------------ */

/**
 * Split a comma-separated SQL list at depth-0 commas (quote & paren aware).
 */
function splitTopLevel(list) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let current = '';
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (quote) {
      current += ch;
      if (ch === quote) {
        // Handle escaped quotes ('' or "")
        if (list[i + 1] === quote) {
          current += list[i + 1];
          i++;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * Find the index of a top-level keyword (word boundary, case-insensitive,
 * outside quotes/parens) in `sql`, starting at `from`.
 */
function findTopLevelKeyword(sql, keyword, from = 0) {
  let depth = 0;
  let quote = null;
  for (let i = from; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      if (ch === quote) {
        if (sql[i + 1] === quote) i++;
        else quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth === 0) {
      // match keyword with word boundaries
      const before = sql[i - 1];
      if (
        /[a-zA-Z]/.test(ch) &&
        (!before || !/[a-zA-Z_"]/.test(before)) &&
        sql.slice(i, i + keyword.length).toLowerCase() === keyword &&
        !/[a-zA-Z_]/.test(sql[i + keyword.length] ?? '')
      ) {
        // ensure it is not part of a quoted identifier (we track quotes above)
        return i;
      }
    }
  }
  return -1;
}

/**
 * Rewrite `select <list> from ...` / `... returning <list>` so every result
 * column carries a unique positional alias. Returns the original string when
 * no rewrite is applicable.
 */
function transformForRaw(sql) {
  const trimmed = sql.trim();
  const prefixMatch = /^\s*(select\s+(?:distinct\s+)?)/i.exec(trimmed);
  if (prefixMatch) {
    const listStart = prefixMatch[1].length;
    const fromIdx = findTopLevelKeyword(trimmed, 'from', listStart);
    if (fromIdx === -1) return sql; // e.g. `select 1` — no columns problem
    const list = trimmed.slice(listStart, fromIdx);
    const aliased = aliasList(list);
    return trimmed.slice(0, listStart) + aliased + ' ' + trimmed.slice(fromIdx);
  }
  // insert/update/delete ... returning <list>
  const retIdx = findTopLevelKeyword(trimmed, 'returning');
  if (retIdx !== -1) {
    const before = trimmed.slice(0, retIdx + 'returning'.length);
    const list = trimmed.slice(retIdx + 'returning'.length);
    return before + ' ' + aliasList(list);
  }
  return sql;
}

function aliasList(list) {
  const items = splitTopLevel(list);
  return items.map((item, i) => `(${item}) as "__ypms_c${i}"`).join(', ');
}

/* ------------------------------------------------------------------ */
/* Statements                                                         */
/* ------------------------------------------------------------------ */

class RawStatement {
  constructor(sql, params, stmt) {
    this._stmt = stmt;
    this._params = params;
    void sql;
  }
  _cols() {
    // `name` is the result-set label (alias when aliased); `column` is the
    // origin column name. Row objects are keyed by `name`.
    return this._stmt.columns().map((c) => c.name);
  }
  all(...params) {
    const p = params.length ? params : this._params;
    const rows = this._stmt.all(...p);
    const cols = this._cols();
    return rows.map((r) => cols.map((c) => r[c]));
  }
  get(...params) {
    const p = params.length ? params : this._params;
    const row = this._stmt.get(...p);
    if (row === undefined) return undefined;
    const cols = this._cols();
    return cols.map((c) => row[c]);
  }
  iterate(...params) {
    const p = params.length ? params : this._params;
    const it = this._stmt.iterate(...p);
    const cols = this._cols();
    return (function* () {
      for (const r of it) yield cols.map((c) => r[c]);
    })();
  }
}

class Statement {
  constructor(sql, stmt, db) {
    this._sql = sql;
    this._stmt = stmt;
    this._db = db;
    this._rawStmt = null;
  }
  _raw() {
    if (this._rawStmt === null) {
      const transformed = transformForRaw(this._sql);
      const stmt = transformed === this._sql ? this._stmt : this._db._db.prepare(transformed);
      this._rawStmt = { transformed, stmt };
    }
    return this._rawStmt;
  }
  run(...params) {
    const res = this._stmt.run(...params);
    return { changes: res.changes, lastInsertRowid: res.lastInsertRowid };
  }
  get(...params) {
    return this._stmt.get(...params);
  }
  all(...params) {
    return this._stmt.all(...params);
  }
  raw() {
    const r = this._raw();
    return new RawStatement(r.transformed, [], r.stmt);
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
    return new Statement(sql, this._db.prepare(sql), this);
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
