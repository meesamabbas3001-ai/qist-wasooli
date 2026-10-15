/**
 * Qist Wasooli — db.js
 * Database ki do shaklein, ek hi interface (prepare/exec/dump — sab async):
 *  1) LOCAL  — node:sqlite file (client ke apne server / laptop par; pehle jaisi).
 *  2) TURSO  — hosted libSQL (Vercel par asal data ke liye). Jab env me
 *     TURSO_DATABASE_URL + TURSO_AUTH_TOKEN hon to ye wala chalta hai,
 *     warna local file. SQL dono par ek hi (SQLite) hai.
 */
'use strict';

const { DatabaseSync } = require('node:sqlite');

// ---------------------------------------------------------------- values
function encodeVal(v) {
  if (v === null || v === undefined) return { type: 'null' };
  if (typeof v === 'number') {
    return Number.isInteger(v)
      ? { type: 'integer', value: String(v) }
      : { type: 'float', value: v };
  }
  if (typeof v === 'bigint') return { type: 'integer', value: String(v) };
  if (typeof v === 'boolean') return { type: 'integer', value: v ? '1' : '0' };
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) {
    return { type: 'blob', value: Buffer.from(v).toString('base64') };
  }
  return { type: 'text', value: String(v) };
}

function decodeVal(v, decltype) {
  if (!v || v.type === 'null' || v.value === null || v.value === undefined) return null;
  const dt = String(decltype || '').toUpperCase();
  if (v.type === 'blob' || dt.includes('BLOB')) {
    return Buffer.from(String(v.value), 'base64');
  }
  if (v.type === 'integer') return Number(v.value);
  if (v.type === 'float') return typeof v.value === 'number' ? v.value : Number(v.value);
  if (dt.includes('INT')) { const n = Number(v.value); return Number.isNaN(n) ? v.value : n; }
  if (dt.includes('REAL') || dt.includes('FLOA') || dt.includes('DOUB')) {
    const n = Number(v.value); return Number.isNaN(n) ? v.value : n;
  }
  return v.value;
}

// ---------------------------------------------------------------- local
class LocalDb {
  constructor(dbPath) {
    this.inner = new DatabaseSync(dbPath);
    this.isLocal = true;
  }
  prepare(sql) {
    const st = this.inner.prepare(sql);
    return {
      run: async (...a) => {
        const r = st.run(...a);
        return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
      },
      get: async (...a) => st.get(...a),
      all: async (...a) => st.all(...a),
    };
  }
  async exec(sql) { this.inner.exec(sql); }
  async tableNames() {
    return this.inner
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all().map(r => r.name);
  }
  async dump() {
    const out = { app: 'Qist Wasooli', kind: 'backup-json', tables: {} };
    for (const t of await this.tableNames()) {
      const rows = this.inner.prepare(`SELECT * FROM "${t}"`).all();
      out.tables[t] = rows.map(row => {
        const o = {};
        for (const [k, v] of Object.entries(row)) {
          o[k] = (Buffer.isBuffer(v) || v instanceof Uint8Array) ? { $blob: Buffer.from(v).toString('base64') } : v;
        }
        return o;
      });
    }
    return out;
  }
}

// ---------------------------------------------------------------- turso
class TursoDb {
  constructor(url, token) {
    this.base = url.replace(/^libsql:\/\//, 'https://').replace(/\/+$/, '');
    this.token = token;
    this.isLocal = false;
    this.baton = null;   // transaction/session ka raabta
    this.inTx = false;
  }

  async pipeline(requests) {
    const body = { requests };
    if (this.baton) body.baton = this.baton;
    const r = await fetch(this.base + '/v2/pipeline', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error('Database (Turso) jawab nahi de raha: HTTP ' + r.status + ' ' + txt.slice(0, 200));
    }
    const j = await r.json();
    if (j.baton) this.baton = j.baton;
    return j.results || [];
  }

  // ek statement chalao; rows chahiye hon to object rows milte hain
  async execute(sql, args = []) {
    const upper = sql.trimStart().toUpperCase();
    const isBegin = upper.startsWith('BEGIN');
    const isEnd = upper.startsWith('COMMIT') || upper.startsWith('ROLLBACK');
    const requests = [{
      type: 'execute',
      stmt: { sql, args: args.map(encodeVal) },
    }];
    // transaction ke bahar session band kar do; andar khula rakho (baton)
    if (!this.inTx && !isBegin) requests.push({ type: 'close' });
    const results = await this.pipeline(requests);
    // session band ki thi to us ka baton ainda istemal ke liye na rakho
    if (!this.inTx && !isBegin) this.baton = null;
    const res = results[0];
    if (!res || res.type !== 'ok') {
      const msg = res && res.error ? res.error.message : 'naamaloome ghalti';
      if (isEnd) { this.inTx = false; this.baton = null; }
      throw new Error('Database ghalti: ' + msg);
    }
    if (isBegin) this.inTx = true;
    if (isEnd) { this.inTx = false; this.baton = null; }
    const result = res.response && res.response.result ? res.response.result : {};
    const cols = (result.cols || []).map(c => ({ name: c.name, decltype: c.decltype }));
    const rows = (result.rows || []).map(row =>
      row.map((v, i) => decodeVal(v, cols[i] && cols[i].decltype)));
    return {
      cols,
      rows,
      changes: result.affected_row_count || 0,
      lastInsertRowid: result.last_insert_rowid != null ? Number(result.last_insert_rowid) : 0,
    };
  }

  rowObjects(executed) {
    return executed.rows.map(row => {
      const o = {};
      executed.cols.forEach((c, i) => { o[c.name] = row[i]; });
      return o;
    });
  }

  prepare(sql) {
    return {
      run: async (...a) => {
        const r = await this.execute(sql, a);
        return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
      },
      get: async (...a) => {
        const r = await this.execute(sql, a);
        const rows = this.rowObjects(r);
        return rows.length ? rows[0] : undefined;
      },
      all: async (...a) => {
        const r = await this.execute(sql, a);
        return this.rowObjects(r);
      },
    };
  }

  async exec(sql) {
    // kai statements hon (schema) to ek ek karke — sab ek hi pipeline me
    const parts = String(sql).split(/;\s*(?:\n|$)/).map(s => s.trim()).filter(Boolean);
    for (const part of parts) await this.execute(part, []);
  }

  async tableNames() {
    const rows = await this.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all();
    return rows.map(r => r.name);
  }

  async dump() {
    const out = { app: 'Qist Wasooli', kind: 'backup-json', tables: {} };
    for (const t of await this.tableNames()) {
      const rows = await this.prepare(`SELECT * FROM "${t}"`).all();
      out.tables[t] = rows.map(row => {
        const o = {};
        for (const [k, v] of Object.entries(row)) {
          o[k] = (Buffer.isBuffer(v) || v instanceof Uint8Array) ? { $blob: Buffer.from(v).toString('base64') } : v;
        }
        return o;
      });
    }
    return out;
  }
}

// ---------------------------------------------------------------- factory
function createDb(dbPath) {
  const url = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;
  if (url && token) {
    console.log('[Qist Wasooli] Database: Turso (hosted) — data server par mehfooz rahega');
    return new TursoDb(url, token);
  }
  return new LocalDb(dbPath);
}

module.exports = { createDb };
