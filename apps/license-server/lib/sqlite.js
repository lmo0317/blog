// The database driver: Node's built-in node:sqlite where it exists (Node 22.5+), otherwise sql.js (SQLite
// compiled to WebAssembly) so the server also runs on hosts stuck on an old Node, such as cafe24's v14.
// Both expose the same small surface the services use: exec(), prepare().all/get/run().
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

let builtin = null;
try {
  // NM_SQLITE_DRIVER=sql.js forces the fallback, to test it on a new Node.
  if (process.env.NM_SQLITE_DRIVER !== 'sql.js') builtin = (await import('node:sqlite')).DatabaseSync;
} catch {
  builtin = null;
}

let SQL = null;
async function loadSqlJs() {
  if (!SQL) {
    const require = createRequire(import.meta.url);
    const initSqlJs = require('sql.js');
    SQL = await initSqlJs();
  }
  return SQL;
}
if (!builtin) await loadSqlJs();

const plain = (params) => params.map((value) => (value === undefined ? null : typeof value === 'boolean' ? Number(value) : value));

// sql.js keeps the whole database in memory; every write is saved back to the file (atomically, a moment
// later, so a burst of writes costs one save).
class SqlJsDatabase {
  constructor(file) {
    this.file = file === ':memory:' ? null : file;
    this.db = new SQL.Database(this.file && fs.existsSync(this.file) ? fs.readFileSync(this.file) : undefined);
    this.saveTimer = null;
    if (this.file) process.on('exit', () => this.flush());
  }

  exec(sql) {
    this.db.exec(sql);
    this.scheduleSave();
  }

  prepare(sql) {
    const query = (params, first) => {
      const stmt = this.db.prepare(sql);
      try {
        stmt.bind(plain(params));
        const rows = [];
        while (stmt.step()) {
          rows.push(stmt.getAsObject());
          if (first) break;
        }
        return rows;
      } finally {
        stmt.free();
      }
    };
    return {
      all: (...params) => query(params, false),
      get: (...params) => query(params, true)[0],
      run: (...params) => {
        this.db.run(sql, plain(params));
        const changes = this.db.getRowsModified();
        const lastInsertRowid = this.db.exec('SELECT last_insert_rowid() AS id')[0]?.values[0][0] ?? 0;
        this.scheduleSave();
        return { changes, lastInsertRowid };
      }
    };
  }

  scheduleSave() {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), 200);
  }

  flush() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.file) return;
    const tmp = `${this.file}.tmp`;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(tmp, Buffer.from(this.db.export()));
    fs.renameSync(tmp, this.file);
  }

  close() {
    this.flush();
    this.db.close();
  }
}

export const driver = builtin ? 'node:sqlite' : 'sql.js';

export function openDatabase(file) {
  return builtin ? new builtin(file) : new SqlJsDatabase(file);
}
