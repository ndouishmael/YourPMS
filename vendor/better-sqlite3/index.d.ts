/**
 * Type declarations for the local better-sqlite3 shim (see index.js).
 * Covers the surface used by drizzle-orm and application code.
 */
declare module 'better-sqlite3' {
  interface RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }
  interface RawStatement {
    all(...params: unknown[]): unknown[][];
    get(...params: unknown[]): unknown[] | undefined;
    iterate(...params: unknown[]): IterableIterator<unknown[]>;
  }
  interface Statement {
    run(...params: unknown[]): RunResult;
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
    raw(): RawStatement;
    iterate(...params: unknown[]): IterableIterator<Record<string, unknown>>;
  }
  type TransactionMode = 'deferred' | 'immediate' | 'exclusive';
  interface Transaction {
    (...args: unknown[]): unknown;
    deferred<T>(fn: () => T): T;
    immediate<T>(fn: () => T): T;
    exclusive<T>(fn: () => T): T;
  }
  class Database {
    constructor(path?: string, options?: Record<string, unknown>);
    open: boolean;
    inTransaction: boolean;
    name: string;
    prepare(sql: string): Statement;
    exec(sql: string): void;
    pragma(source: string, options?: { simple?: boolean }): unknown;
    transaction(fn?: () => unknown): Transaction;
    close(): void;
  }
  export = Database;
}
