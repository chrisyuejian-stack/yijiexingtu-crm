import {DatabaseSync} from 'node:sqlite';
import {performance} from 'node:perf_hooks';

const parameter = value => {
  if (value === undefined) throw new TypeError('D1 bind does not accept undefined');
  if (typeof value === 'boolean') return Number(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return value;
};
const row = value => value ? {...value} : null;

/** Synchronous batches never yield between BEGIN and COMMIT. One process per file. */
export class SqliteD1 {
  constructor(filename, {readOnly = false, cacheSize = 128} = {}) {
    this.database = new DatabaseSync(filename, {readOnly, enableForeignKeyConstraints: true});
    this.readOnly = readOnly;
    this.cache = new Map();
    this.cacheSize = cacheSize;
    this.closed = false;
    try {
      this.database.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
      if (!readOnly) this.database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');
      if (this.database.prepare('PRAGMA foreign_keys').get().foreign_keys !== 1) throw Error('SQLite foreign_keys must be ON');
    } catch (error) { this.database.close(); throw error; }
  }
  statement(sql) {
    if (this.closed) throw Error('Database closed');
    let statement = this.cache.get(sql);
    if (statement) this.cache.delete(sql);
    else statement = this.database.prepare(sql);
    this.cache.set(sql, statement);
    if (this.cache.size > this.cacheSize) this.cache.delete(this.cache.keys().next().value);
    return statement;
  }
  prepare(sql) {
    if (typeof sql !== 'string') throw new TypeError('SQL must be a string');
    const owner = this;
    return {
      owner, sql, params: [],
      bind(...params) { this.params = params.map(parameter); return this; },
      async first(column) {
        const result = row(owner.statement(sql).get(...this.params));
        if (column === undefined || result === null) return result;
        if (!Object.hasOwn(result, column)) throw Error('D1 column not found');
        return result[column];
      },
      async all() { return owner.execute(this, true); },
      async run() { return owner.execute(this, false); },
      async raw({columnNames = false} = {}) {
        const statement = owner.statement(sql), values = statement.all(...this.params);
        const names = statement.columns().map(x => x.name);
        return [...columnNames ? [names] : [], ...values.map(x => names.map(k => x[k]))];
      }
    };
  }
  execute(bound, query) {
    const started = performance.now(), statement = this.statement(bound.sql);
    const meta = {changes: 0, last_row_id: 0, duration: 0};
    let results;
    if (query) results = statement.all(...bound.params).map(row);
    else {
      const result = statement.run(...bound.params);
      // SQLite changes() is sticky for PRAGMA/DDL. D1 reports zero for them.
      if (/^\s*(?:INSERT|UPDATE|DELETE|REPLACE|WITH)\b/i.test(bound.sql)) meta.changes = Number(result.changes);
      meta.last_row_id = Number(result.lastInsertRowid);
    }
    meta.duration = performance.now() - started;
    return {success: true, ...results ? {results} : {}, meta};
  }
  async batch(statements) {
    if (!Array.isArray(statements) || statements.some(s => s.owner !== this)) throw new TypeError('Foreign D1 statement');
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const results = statements.map(s => this.execute(s, this.statement(s.sql).columns().length > 0));
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      try { this.database.exec('ROLLBACK'); } catch { /* Keep the original failure. */ }
      throw error;
    }
  }
  async exec(sql) {
    const started = performance.now(); this.database.exec(sql); this.cache.clear();
    return {count: 1, duration: performance.now() - started};
  }
  checkpoint() { if (!this.closed && !this.readOnly) this.database.exec('PRAGMA wal_checkpoint(TRUNCATE)'); }
  close() {
    if (this.closed) return;
    try { this.checkpoint(); } finally { this.cache.clear(); this.database.close(); this.closed = true; }
  }
}
