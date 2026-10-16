/**
 * Qist Wasooli — server.js
 * Installment (qist) recovery web app for mobile/electronics/bike shops.
 * Zero-dependency: sirf Node.js built-ins (http, sqlite, crypto).
 * Chalane ke liye:  node server.js   (port: env PORT ya 3000)
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createDb } = require('./db');

// ---------------------------------------------------------------- config
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.QW_DATA_DIR || (process.env.VERCEL ? '/tmp/qist-wasooli-data' : path.join(ROOT, 'data'));
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const DB_PATH = path.join(DATA_DIR, 'qist.db');
const SECRET_PATH = path.join(DATA_DIR, 'secret.txt');
const TZ = 'Asia/Karachi';

fs.mkdirSync(BACKUP_DIR, { recursive: true });

// Session signing secret (pehli baar banta hai, phir wahi rehta hai)
let SECRET;
if (process.env.QW_SECRET) {
  SECRET = process.env.QW_SECRET;
} else if (fs.existsSync(SECRET_PATH)) {
  SECRET = fs.readFileSync(SECRET_PATH, 'utf8').trim();
} else {
  SECRET = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_PATH, SECRET, { mode: 0o600 });
}

// ---------------------------------------------------------------- dates
function todayStr() {
  // Pakistan ki tareekh (YYYY-MM-DD)
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}
function daysBetween(a, b) {
  // a,b = 'YYYY-MM-DD' -> b - a (dinon mein)
  const da = Date.parse(a + 'T00:00:00Z');
  const db = Date.parse(b + 'T00:00:00Z');
  return Math.round((db - da) / 86400000);
}
function addMonthsToYM(ym, n) {
  // 'YYYY-MM' + n mahine -> 'YYYY-MM'
  const [y, m] = ym.split('-').map(Number);
  const total = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}
function addOneMonthToDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + 1, 1));
  const lastDay = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function monthOf(dateStr) { return dateStr.slice(0, 7); }

// ---------------------------------------------------------------- passwords
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(pw, stored) {
  try {
    const [salt, hash] = stored.split(':');
    const calc = crypto.scryptSync(String(pw), salt, 64);
    const orig = Buffer.from(hash, 'hex');
    return calc.length === orig.length && crypto.timingSafeEqual(calc, orig);
  } catch { return false; }
}

// ---------------------------------------------------------------- database
const db = createDb(DB_PATH);
const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS owner (
    id INTEGER PRIMARY KEY, login TEXT UNIQUE NOT NULL,
    pass_hash TEXT NOT NULL, name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS shops (
    id INTEGER PRIMARY KEY, name TEXT NOT NULL, owner_name TEXT NOT NULL,
    mobile TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL,
    fee_due_date TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY, shop_id INTEGER NOT NULL REFERENCES shops(id),
    name TEXT NOT NULL, mobile TEXT NOT NULL, cnic TEXT DEFAULT '',
    address TEXT DEFAULT '', guarantor_name TEXT DEFAULT '',
    guarantor_mobile TEXT DEFAULT '', item_name TEXT DEFAULT '',
    imei TEXT DEFAULT '', total_price INTEGER NOT NULL,
    advance INTEGER NOT NULL, months INTEGER NOT NULL,
    qist_day INTEGER NOT NULL, first_month TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS installments (
    id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id),
    shop_id INTEGER NOT NULL, seq INTEGER NOT NULL,
    due_date TEXT NOT NULL, amount INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id),
    shop_id INTEGER NOT NULL, amount INTEGER NOT NULL,
    paid_at TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS allocations (
    id INTEGER PRIMARY KEY, payment_id INTEGER NOT NULL REFERENCES payments(id),
    installment_id INTEGER NOT NULL REFERENCES installments(id),
    amount INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_id INTEGER NOT NULL, customer_id INTEGER NOT NULL,
    kind TEXT NOT NULL, data BLOB NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(customer_id, kind)
  );
  CREATE INDEX IF NOT EXISTS idx_cust_shop ON customers(shop_id);
  CREATE INDEX IF NOT EXISTS idx_inst_cust ON installments(customer_id);
  CREATE INDEX IF NOT EXISTS idx_inst_shop_due ON installments(shop_id, due_date);
  CREATE INDEX IF NOT EXISTS idx_pay_cust ON payments(customer_id);
  CREATE INDEX IF NOT EXISTS idx_alloc_inst ON allocations(installment_id);
`;

// ==== INIT-DB START ====
// Database tayyar karna: schema + zaroori seeds. Pehli request par chalta
// hai, phir dobara nahi. Local file ho ya Turso — yehi ek rasta hai.
let initPromise = null;
function initDb() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await db.exec(SCHEMA_SQL);

    // Default settings + owner seed
    const setFee = db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)');
    await setFee.run('fee_amount', '6999');
    const ownerRow = await db.prepare('SELECT id FROM owner LIMIT 1').get();
    if (!ownerRow) {
      const starter = process.env.QW_OWNER_PASSWORD || 'QistOwner#2026';
      await db.prepare('INSERT INTO owner(login, pass_hash, name) VALUES (?, ?, ?)')
        .run('jafran', hashPassword(starter), 'Jafran (Owner)');
      console.log('[Qist Wasooli] Owner account ban gaya. Login: jafran (password README me hai — pehle login par badal lein)');
    }

    // Demo dukaan seed — SIRF Vercel demo par (VERCEL env) ya QW_DEMO_SEED=1 par.
    // Asal client server par ye NAHI banti (wahan sirf asal dukaanain hoti hain).
    if (process.env.VERCEL === '1' || process.env.QW_DEMO_SEED === '1') {
      const DEMO_MOBILE = '03123456789';
      const DEMO_PASS = '123';
      // Purani demo dukaan (personal number wali) ho to usay saaf kar do —
      // personal number public demo login par nahi hona chahiye.
      const oldDemo = await db.prepare('SELECT id FROM shops WHERE mobile = ?').get('03289507102');
      if (oldDemo) {
        await db.prepare('DELETE FROM allocations WHERE payment_id IN (SELECT id FROM payments WHERE shop_id = ?)').run(oldDemo.id);
        await db.prepare('DELETE FROM payments WHERE shop_id = ?').run(oldDemo.id);
        await db.prepare('DELETE FROM installments WHERE shop_id = ?').run(oldDemo.id);
        await db.prepare('DELETE FROM photos WHERE shop_id = ?').run(oldDemo.id);
        await db.prepare('DELETE FROM customers WHERE shop_id = ?').run(oldDemo.id);
        await db.prepare('DELETE FROM shops WHERE id = ?').run(oldDemo.id);
      }
      const demoRow = await db.prepare('SELECT id FROM shops WHERE mobile = ?').get(DEMO_MOBILE);
      if (!demoRow) {
        const now = new Date();
        const iso = d => d.toISOString().slice(0, 10);
        const addM = (d, m) => { const x = new Date(d); x.setMonth(x.getMonth() + m); return x; };
        const ym = d => iso(d).slice(0, 7);
        const day = Math.min(now.getDate(), 28);
        const shopId = (await db.prepare('INSERT INTO shops(name, owner_name, mobile, pass_hash, fee_due_date, active, created_at) VALUES (?,?,?,?,?,1,?)')
          .run('Messam Mobile Zone (Demo)', 'Messam Abbas', DEMO_MOBILE, hashPassword(DEMO_PASS), iso(addM(now, 12)), iso(now))).lastInsertRowid;
        const insCust = db.prepare(`INSERT INTO customers(shop_id, name, mobile, cnic, address, guarantor_name,
          guarantor_mobile, item_name, imei, total_price, advance, months, qist_day,
          first_month, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
        const insInst = db.prepare('INSERT INTO installments(customer_id, shop_id, seq, due_date, amount) VALUES (?,?,?,?,?)');
        const insPay = db.prepare('INSERT INTO payments(customer_id, shop_id, amount, paid_at, created_at) VALUES (?,?,?,?,?)');
        const insAlloc = db.prepare('INSERT INTO allocations(payment_id, installment_id, amount) VALUES (?,?,?)');
        const addDemoCustomer = async (c, startOffset, pays) => {
          const cid = (await insCust.run(shopId, c.name, c.mobile, '', '', c.gname || '', c.gmobile || '',
            c.item, c.imei || '', c.total, c.advance, c.months, day, ym(addM(now, startOffset)), iso(now))).lastInsertRowid;
          const balance = c.total - c.advance;
          const base = Math.floor(balance / c.months);
          const insts = [];
          for (let i = 0; i < c.months; i++) {
            const amount = i < c.months - 1 ? base : balance - base * (c.months - 1);
            const due = `${ym(addM(now, startOffset + i))}-${String(day).padStart(2, '0')}`;
            insts.push({ id: (await insInst.run(cid, shopId, i + 1, due, amount)).lastInsertRowid, left: amount });
          }
          for (const pay of pays) {
            const pid = (await insPay.run(cid, shopId, pay.amount, pay.date, pay.date)).lastInsertRowid;
            let left = pay.amount;
            for (const inst of insts) {
              if (left <= 0) break;
              const take = Math.min(left, inst.left);
              if (take > 0) { await insAlloc.run(pid, inst.id, take); inst.left -= take; left -= take; }
            }
          }
        };
        await addDemoCustomer({ name: 'Ahmed Raza', mobile: '03001110001', item: 'Samsung A55', total: 30000, advance: 6000, months: 6 },
          -5, [-5, -4, -3, -2].map(o => ({ amount: 4000, date: iso(addM(now, o)) })));
        await addDemoCustomer({ name: 'Bilal Ahmed', mobile: '03004440004', item: 'iPhone 12', imei: '359876543210123', gname: 'Shahid Iqbal', gmobile: '03004440009', total: 150000, advance: 30000, months: 8 },
          -2, [{ amount: 15000, date: iso(addM(now, -2)) }, { amount: 5000, date: iso(addM(now, -1)) }]);
        await addDemoCustomer({ name: 'Sana Tariq', mobile: '03007770007', item: 'Infinix Note 40', total: 48000, advance: 8000, months: 5 }, -1, []);
        console.log('[Qist Wasooli] Demo dukaan tayyar: ' + DEMO_MOBILE + ' / ' + DEMO_PASS);
      }
    }

    // Backup sirf local (file wali) mode me — Turso par data hosted rehta
    // hai; wahan backup = owner ka database download + Turso ki apni copy.
    if (db.isLocal) {
      makeBackup().catch(e => console.error('Backup error:', e.message));
      setInterval(() => makeBackup().catch(e => console.error('Backup error:', e.message)),
        24 * 60 * 60 * 1000).unref();
    }
  })();
  return initPromise;
}
// ==== INIT-DB END ====

// ---------------------------------------------------------------- PDF (bina library ke — asal khulne wali PDF)
const fmt = n => 'Rs ' + Number(n || 0).toLocaleString('en-US');

function escPdfText(s) {
  return String(s == null ? '' : s)
    .replace(/[\u2014\u2013]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function makePdf(lines) {
  const W = 595, H = 842, M = 46;
  const pages = [];
  let cur = [], y = H - 52;
  for (const ln of lines) {
    const size = ln.s || 11;
    if (y - size * 1.35 < 48 && cur.length) { pages.push(cur); cur = []; y = H - 52; }
    y -= size * 1.35;
    cur.push({ t: escPdfText(ln.t), s: size, b: !!ln.b, y: Math.round(y) });
    y -= (ln.sp == null ? 5 : ln.sp);
  }
  if (cur.length || !pages.length) pages.push(cur);
  const objs = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  objs[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';
  const kids = [];
  pages.forEach((pageLines, i) => {
    const pageId = 5 + i * 2, contId = 6 + i * 2;
    kids.push(`${pageId} 0 R`);
    const content = pageLines.map(l =>
      `BT /${l.b ? 'F2' : 'F1'} ${l.s} Tf ${M} ${l.y} Td (${l.t}) Tj ET`).join('\n');
    objs[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contId} 0 R >>`;
    objs[contId] = `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`;
  });
  objs[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 1; i < objs.length; i++) {
    if (!objs[i]) continue;
    offsets[i] = Buffer.byteLength(out, 'latin1');
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefPos = Buffer.byteLength(out, 'latin1');
  const n = objs.length;
  out += `xref\n0 ${n}\n0000000000 65535 f \n`;
  for (let i = 1; i < n; i++) out += `${String(offsets[i] || 0).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

async function shopPdfLines(shop) {
  const today = todayStr();
  const custs = await db.prepare('SELECT * FROM customers WHERE shop_id = ? ORDER BY name').all(shop.id);
  // Poori dukaan ki qistein + un par jama rakam — sirf 2 sawalon me (hosted DB par tez rahe)
  const instsAll = await db.prepare('SELECT * FROM installments WHERE shop_id = ? ORDER BY seq').all(shop.id);
  const paidRows = await db.prepare(`
    SELECT a.installment_id AS iid, COALESCE(SUM(a.amount),0) AS paid
    FROM allocations a JOIN installments i ON i.id = a.installment_id
    WHERE i.shop_id = ? GROUP BY a.installment_id`).all(shop.id);
  const paidMap = new Map(paidRows.map(r => [r.iid, r.paid]));
  const instByCust = new Map();
  for (const i of instsAll) {
    if (!instByCust.has(i.customer_id)) instByCust.set(i.customer_id, []);
    instByCust.get(i.customer_id).push(i);
  }
  let kulHisaab = 0, kulJama = 0;
  const body = [];
  custs.forEach((c, idx) => {
    const insts = instByCust.get(c.id) || [];
    let total = 0, paidSum = 0, jama = 0, late = 0, lateAmt = 0;
    for (const i of insts) {
      const paid = paidMap.get(i.id) || 0;
      total += i.amount; paidSum += paid;
      if (paid >= i.amount) jama++;
      else if (i.due_date < today) { late++; lateAmt += i.amount - paid; }
    }
    const t = { total, paid: paidSum, remaining: total - paidSum };
    kulHisaab += t.total; kulJama += t.paid;
    const monthly = insts.length > 1 ? insts[1].amount : (insts[0] ? insts[0].amount : 0);
    body.push({ t: `${idx + 1}. ${c.name}  -  ${c.mobile}`, s: 12, b: true, sp: 2 });
    body.push({ t: `Cheez: ${c.item_name || '-'}    Kul qeemat: ${fmt(c.total_price)}    Advance: ${fmt(c.advance)}`, sp: 2 });
    body.push({ t: `Har mahine ki qist: ${fmt(monthly)} x ${c.months} mahine   |   Jama ho gaya: ${fmt(t.paid)}   |   Baqaya: ${fmt(t.remaining)}`, sp: 2 });
    body.push({ t: `Qistein: ${jama} jama, ${insts.length - jama} baqi${late ? `   |   Late: ${late} (${fmt(lateAmt)})` : ''}${c.cnic ? `   |   CNIC: ${c.cnic}` : ''}`, sp: 10 });
  });
  return [
    { t: 'Qist Wasooli - Poora Data', s: 18, b: true, sp: 4 },
    { t: `Dukaan: ${shop.name}  (Maalik: ${shop.owner_name})`, s: 12, b: true, sp: 2 },
    { t: `Mobile: ${shop.mobile}     Tareekh: ${today}`, sp: 10 },
    { t: `Kul customers: ${custs.length}   |   Kul hisaab: ${fmt(kulHisaab)}   |   Jama: ${fmt(kulJama)}   |   Baqaya: ${fmt(kulHisaab - kulJama)}`, b: true, sp: 12 },
    { t: 'HAR CUSTOMER KA HISAB', s: 13, b: true, sp: 8 },
    ...(body.length ? body : [{ t: 'Abhi koi customer nahi hai.' }]),
    { t: 'Ye PDF Qist Wasooli app se khud bani hai - record ke liye mehfooz rakhein.', s: 9, sp: 2 },
  ];
}

async function ownerPdfLines() {
  const today = todayStr();
  const fee = Number((await db.prepare("SELECT value FROM settings WHERE key='fee_amount'").get()).value);
  const shops = await db.prepare('SELECT * FROM shops ORDER BY name').all();
  const active = shops.filter(s => s.active).length;
  const custCount = (await db.prepare('SELECT COUNT(*) AS c FROM customers').get()).c;
  const stats = await allShopStats();
  let stuck = 0;
  const body = [];
  shops.forEach((s, idx) => {
    const st = stats.get(s.id) || { customers: 0, stuck: 0, collected: 0 };
    stuck += st.stuck;
    body.push({ t: `${idx + 1}. ${s.name}  -  Maalik: ${s.owner_name}  -  ${s.mobile}`, s: 12, b: true, sp: 2 });
    body.push({ t: `Halat: ${s.active ? 'Active' : 'Band'}   |   Fee ki agli tareekh: ${s.fee_due_date}   |   Fee: ${fmt(fee)}/mahina`, sp: 2 });
    body.push({ t: `Customers: ${st.customers}   |   Jama hua (is dukaan par): ${fmt(st.collected)}   |   Phansa hua (late): ${fmt(st.stuck)}`, sp: 10 });
  });
  return [
    { t: 'Qist Wasooli - Owner Report', s: 18, b: true, sp: 4 },
    { t: `Tareekh: ${today}`, sp: 10 },
    { t: `Kul dukaanein: ${shops.length} (Active: ${active})   |   Kul customers: ${custCount}`, b: true, sp: 2 },
    { t: `Phansa hua kul: ${fmt(stuck)}   |   Mahana fee aamdani: ${fmt(active * fee)}`, b: true, sp: 12 },
    { t: 'HAR DUKAAN KA HISAB', s: 13, b: true, sp: 8 },
    ...(body.length ? body : [{ t: 'Abhi koi dukaan nahi hai.' }]),
    { t: 'Ye PDF Qist Wasooli app se khud bani hai - record ke liye mehfooz rakhein.', s: 9, sp: 2 },
  ];
}

function sendPdf(res, lines, filename) {
  const buf = makePdf(lines);
  res.writeHead(200, { 'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename}"`, 'Content-Length': buf.length });
  res.end(buf);
}
async function handleShopPdf(req, res, shop) { sendPdf(res, await shopPdfLines(shop), `qist-data-${todayStr()}.pdf`); }

// ---------------------------------------------------------------- customer photo
async function findOwnCustomer(shop, id) {
  return await db.prepare('SELECT * FROM customers WHERE id = ? AND shop_id = ?').get(id, shop.id);
}
async function handlePhotoPost(req, res, shop, id) {
  if (!await findOwnCustomer(shop, id)) return sendJSON(res, 404, { error: 'Customer nahi mila' });
  const b = await readBody(req);
  const kind = b.kind === 'item' ? 'item' : 'customer';
  const m = String(b.image || '').match(/^data:image\/(jpeg|png);base64,(.+)$/);
  if (!m) return sendJSON(res, 400, { error: 'Photo sahi bhejein' });
  const buf = Buffer.from(m[2], 'base64');
  if (!buf.length || buf.length > 2 * 1024 * 1024) return sendJSON(res, 400, { error: 'Photo bohat bari hai' });
  // Hosted (Turso) mode me photo base64 text ban kar jati hai — wapas ate
  // waqt db.js use khud asal bytes me badal deta hai. Local par seedha BLOB.
  const dataVal = db.isLocal ? buf : buf.toString('base64');
  await db.prepare(`INSERT INTO photos(shop_id, customer_id, kind, data, created_at) VALUES(?,?,?,?,?)
              ON CONFLICT(customer_id, kind) DO UPDATE SET data = excluded.data, created_at = excluded.created_at`)
    .run(shop.id, id, kind, dataVal, todayStr());
  sendJSON(res, 200, { ok: true });
}
async function handlePhotoGet(req, res, shop, id, kind) {
  if (!await findOwnCustomer(shop, id)) return sendJSON(res, 404, { error: 'Customer nahi mila' });
  const ph = await db.prepare('SELECT data FROM photos WHERE customer_id = ? AND kind = ?').get(id, kind);
  if (!ph) return sendJSON(res, 404, { error: 'Photo nahi hai' });
  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=120' });
  res.end((Buffer.isBuffer(ph.data) || ph.data instanceof Uint8Array)
    ? Buffer.from(ph.data) : Buffer.from(String(ph.data), 'base64'));
}
async function handlePhotoDelete(req, res, shop, id, kind) {
  if (!await findOwnCustomer(shop, id)) return sendJSON(res, 404, { error: 'Customer nahi mila' });
  await db.prepare('DELETE FROM photos WHERE customer_id = ? AND kind = ?').run(id, kind);
  sendJSON(res, 200, { ok: true });
}

// ---------------------------------------------------------------- backup (roz khud bakhud)
async function makeBackup() {
  try {
    const stamp = todayStr();
    const dest = path.join(BACKUP_DIR, `qist-${stamp}.db`);
    if (!fs.existsSync(dest)) {
      await db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
    }
    // purane backups saaf: sirf akhri 14 rakho
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db')).sort();
    while (files.length > 14) {
      fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
    }
    // har dukaan ka PDF bhi bana kar rakho (app ko kuch ho jaye to parhne wala record maujood rahe)
    try {
      const pdir = path.join(BACKUP_DIR, `pdf-${stamp}`);
      if (!fs.existsSync(pdir)) {
        fs.mkdirSync(pdir, { recursive: true });
        for (const s of await db.prepare('SELECT * FROM shops').all()) {
          fs.writeFileSync(path.join(pdir, `shop-${s.id}.pdf`), makePdf(await shopPdfLines(s)));
        }
      }
      const dirs = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('pdf-')).sort();
      while (dirs.length > 14) fs.rmSync(path.join(BACKUP_DIR, dirs.shift()), { recursive: true, force: true });
    } catch (e) { console.error('PDF backup error:', e.message); }
  } catch (e) { console.error('Backup error:', e.message); }
}
// (backup ab initDb se shuru hota hai — local mode me)

// ---------------------------------------------------------------- sessions
function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function readToken(token) {
  try {
    const [body, sig] = String(token).split('.');
    const expect = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}
function sessionCookie(token) {
  return `qw_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${30 * 24 * 3600}`;
}
function getSession(req) {
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/qw_session=([^;]+)/);
  if (!m) return null;
  return readToken(decodeURIComponent(m[1]));
}

// ---------------------------------------------------------------- helpers
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 4e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('JSON ghalat hai')); }
    });
    req.on('error', reject);
  });
}
const rs = n => 'Rs. ' + Number(n || 0).toLocaleString('en-PK');

// Customer ke hisaab ke liye: har qist ki paid rakam allocations se
async function installmentPaidMap(customerId) {
  const rows = await db.prepare(`
    SELECT a.installment_id AS iid, COALESCE(SUM(a.amount),0) AS paid
    FROM allocations a JOIN installments i ON i.id = a.installment_id
    WHERE i.customer_id = ? GROUP BY a.installment_id`).all(customerId);
  const map = new Map();
  for (const r of rows) map.set(r.iid, r.paid);
  return map;
}
async function customerTotals(customerId) {
  const inst = await db.prepare('SELECT id, amount FROM installments WHERE customer_id = ?').all(customerId);
  const paidMap = await installmentPaidMap(customerId);
  let total = 0, paid = 0;
  for (const i of inst) { total += i.amount; paid += (paidMap.get(i.id) || 0); }
  return { total, paid, remaining: total - paid };
}

// Auth guards — hamesha token se, kabhi client ki bheji shop_id se nahi
async function requireShop(req, res) {
  const s = getSession(req);
  if (!s || s.role !== 'shop') { sendJSON(res, 401, { error: 'Pehle login karein' }); return null; }
  const shop = await db.prepare('SELECT * FROM shops WHERE id = ?').get(s.id);
  if (!shop) { sendJSON(res, 401, { error: 'Dukaan nahi mili' }); return null; }
  if (!shop.active) { sendJSON(res, 403, { error: 'Aapki dukaan band hai. Fee ke liye owner se rabta karein.', blocked: true }); return null; }
  return shop;
}
async function requireOwner(req, res) {
  const s = getSession(req);
  if (!s || s.role !== 'owner') { sendJSON(res, 401, { error: 'Pehle owner login karein' }); return null; }
  return await db.prepare('SELECT * FROM owner WHERE id = ?').get(s.id);
}

// ---------------------------------------------------------------- API: auth
async function handleLogin(req, res) {
  const { mobile, password } = await readBody(req);
  const shop = await db.prepare('SELECT * FROM shops WHERE mobile = ?').get(String(mobile || '').trim());
  if (!shop || !verifyPassword(password || '', shop.pass_hash)) {
    return sendJSON(res, 401, { error: 'Number ya password ghalat hai' });
  }
  if (!shop.active) {
    return sendJSON(res, 403, { error: 'Aapki dukaan band hai. Fee ke liye owner se rabta karein.', blocked: true });
  }
  const token = signToken({ role: 'shop', id: shop.id, exp: Date.now() + 30 * 24 * 3600 * 1000 });
  res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': sessionCookie(token) });
  res.end(JSON.stringify({ ok: true, shop: { id: shop.id, name: shop.name } }));
}
async function handleOwnerLogin(req, res) {
  const { login, password } = await readBody(req);
  const owner = await db.prepare('SELECT * FROM owner WHERE login = ?').get(String(login || '').trim());
  if (!owner || !verifyPassword(password || '', owner.pass_hash)) {
    return sendJSON(res, 401, { error: 'Login ya password ghalat hai' });
  }
  const token = signToken({ role: 'owner', id: owner.id, exp: Date.now() + 30 * 24 * 3600 * 1000 });
  res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': sessionCookie(token) });
  res.end(JSON.stringify({ ok: true, name: owner.name }));
}

// ---------------------------------------------------------------- API: shop
async function handleHome(req, res, shop) {
  const today = todayStr();
  const thisMonth = monthOf(today);
  // Aaj ki qistein (har qist par jama rakam sath hi — ek hi sawal, hosted DB par tez)
  const dueRows = await db.prepare(`
    SELECT i.id, i.customer_id, i.amount, COALESCE(SUM(a.amount),0) AS paid, c.name, c.mobile
    FROM installments i JOIN customers c ON c.id = i.customer_id
    LEFT JOIN allocations a ON a.installment_id = i.id
    WHERE i.shop_id = ? AND i.due_date = ? GROUP BY i.id ORDER BY c.name`).all(shop.id, today);
  const todayList = [];
  let todayTotal = 0;
  for (const r of dueRows) {
    const rem = r.amount - r.paid;
    if (rem > 0) { todayList.push({ customerId: r.customer_id, name: r.name, mobile: r.mobile, amount: rem }); todayTotal += rem; }
  }
  const monthExpected = (await db.prepare(`
    SELECT COALESCE(SUM(amount),0) AS s FROM installments
    WHERE shop_id = ? AND substr(due_date,1,7) = ?`).get(shop.id, thisMonth)).s;
  const monthCollected = (await db.prepare(`
    SELECT COALESCE(SUM(amount),0) AS s FROM payments
    WHERE shop_id = ? AND substr(paid_at,1,7) = ?`).get(shop.id, thisMonth)).s;
  // Late
  const lateRows = await db.prepare(`
    SELECT i.id, i.customer_id, i.amount, COALESCE(SUM(a.amount),0) AS paid
    FROM installments i LEFT JOIN allocations a ON a.installment_id = i.id
    WHERE i.shop_id = ? AND i.due_date < ? GROUP BY i.id`).all(shop.id, today);
  let lateAmount = 0;
  const lateCust = new Set();
  for (const r of lateRows) {
    const rem = r.amount - r.paid;
    if (rem > 0) { lateAmount += rem; lateCust.add(r.customer_id); }
  }
  const lateCount = lateCust.size;
  sendJSON(res, 200, { todayList, todayTotal, monthExpected, monthCollected, lateCount, lateAmount, today });
}

async function handleLate(req, res, shop) {
  const today = todayStr();
  const rows = await db.prepare(`
    SELECT i.customer_id, i.due_date, i.amount, i.id, COALESCE(SUM(a.amount),0) AS paid, c.name, c.mobile
    FROM installments i JOIN customers c ON c.id = i.customer_id
    LEFT JOIN allocations a ON a.installment_id = i.id
    WHERE i.shop_id = ? AND i.due_date < ? GROUP BY i.id ORDER BY i.due_date ASC`).all(shop.id, today);
  const byCust = new Map();
  for (const r of rows) {
    const rem = r.amount - r.paid;
    if (rem <= 0) continue;
    if (!byCust.has(r.customer_id)) {
      byCust.set(r.customer_id, {
        customerId: r.customer_id, name: r.name, mobile: r.mobile,
        oldestDue: r.due_date, overdueAmount: 0,
      });
    }
    byCust.get(r.customer_id).overdueAmount += rem;
  }
  const totalsMap = await customerTotalsMap([...byCust.keys()]);
  const list = [...byCust.values()].map(c => {
    const totals = totalsMap.get(c.customerId) || { total: 0, paid: 0, remaining: 0 };
    const daysLate = daysBetween(c.oldestDue, today);
    return { ...c, daysLate, totalRemaining: totals.remaining,
             level: daysLate >= 30 ? 'red' : (daysLate >= 7 ? 'yellow' : 'normal') };
  }).sort((a, b) => b.daysLate - a.daysLate);
  sendJSON(res, 200, { list, today });
}

async function handleAddCustomer(req, res, shop) {
  const b = await readBody(req);
  const name = String(b.name || '').trim();
  const mobile = String(b.mobile || '').trim();
  const totalPrice = Math.round(Number(b.total_price));
  const advance = Math.round(Number(b.advance));
  const months = Math.round(Number(b.months));
  const qistDay = Math.round(Number(b.qist_day));
  const firstMonth = String(b.first_month || '').trim();
  if (!name || !mobile) return sendJSON(res, 400, { error: 'Naam aur mobile number lazmi hain' });
  if (!totalPrice || totalPrice <= 0) return sendJSON(res, 400, { error: 'Kul qeemat sahi likhein' });
  if (isNaN(advance) || advance < 0 || advance >= totalPrice) return sendJSON(res, 400, { error: 'Advance qeemat se kam hona chahiye' });
  if (!months || months < 1 || months > 60) return sendJSON(res, 400, { error: 'Qiston ki tadaad 1 se 60 ke darmiyan rakhein' });
  if (!qistDay || qistDay < 1 || qistDay > 28) return sendJSON(res, 400, { error: 'Qist ki tareekh 1 se 28 ke darmiyan rakhein' });
  if (!/^\d{4}-\d{2}$/.test(firstMonth)) return sendJSON(res, 400, { error: 'Pehli qist ka mahina sahi chunein' });

  const balance = totalPrice - advance;
  const base = Math.floor(balance / months);
  const insertCust = await db.prepare(`
    INSERT INTO customers(shop_id, name, mobile, cnic, address, guarantor_name,
      guarantor_mobile, item_name, imei, total_price, advance, months, qist_day,
      first_month, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertInst = await db.prepare(`
    INSERT INTO installments(customer_id, shop_id, seq, due_date, amount)
    VALUES (?,?,?,?,?)`);
  let custId;
  await db.exec('BEGIN');
  try {
    const info = await insertCust.run(shop.id, name, mobile, String(b.cnic || '').trim(),
      String(b.address || '').trim(), String(b.guarantor_name || '').trim(),
      String(b.guarantor_mobile || '').trim(), String(b.item_name || '').trim(),
      String(b.imei || '').trim(), totalPrice, advance, months, qistDay, firstMonth, todayStr());
    custId = info.lastInsertRowid;
    for (let i = 0; i < months; i++) {
      const amount = i < months - 1 ? base : balance - base * (months - 1);
      const due = `${addMonthsToYM(firstMonth, i)}-${String(qistDay).padStart(2, '0')}`;
      await insertInst.run(custId, shop.id, i + 1, due, amount);
    }
    await db.exec('COMMIT');
  } catch (e) { await db.exec('ROLLBACK'); throw e; }
  sendJSON(res, 200, { ok: true, customerId: custId, monthly: base, balance });
}

async function handleCustomers(req, res, shop, url) {
  const q = (url.searchParams.get('q') || '').trim();
  let rows;
  if (q) {
    rows = await db.prepare(`SELECT * FROM customers WHERE shop_id = ? AND (name LIKE ? OR mobile LIKE ?) ORDER BY name`)
      .all(shop.id, `%${q}%`, `%${q}%`);
  } else {
    rows = await db.prepare('SELECT * FROM customers WHERE shop_id = ? ORDER BY name LIMIT 500').all(shop.id);
  }
  // Kul hisaab aur mahana qist — sab customers ke liye sirf 2 sawal (hosted DB par tez)
  const totalsMap = await customerTotalsMap(rows.map(c => c.id));
  const mRows = await db.prepare('SELECT customer_id, seq, amount FROM installments WHERE shop_id = ? AND seq IN (1,2)').all(shop.id);
  const monthly = new Map();
  for (const r of mRows) {
    if (!monthly.has(r.customer_id)) monthly.set(r.customer_id, {});
    monthly.get(r.customer_id)[r.seq] = r.amount;
  }
  const list = rows.map(c => {
    const t = totalsMap.get(c.id) || { total: 0, paid: 0, remaining: 0 };
    const mm = monthly.get(c.id) || {};
    return { id: c.id, name: c.name, mobile: c.mobile, item_name: c.item_name,
             total_price: c.total_price, remaining: t.remaining, paid: t.paid,
             monthly: mm[2] != null ? mm[2] : (mm[1] != null ? mm[1] : 0) };
  });
  sendJSON(res, 200, { list });
}

async function handleCustomerFile(req, res, shop, id) {
  const c = await db.prepare('SELECT * FROM customers WHERE id = ? AND shop_id = ?').get(id, shop.id);
  if (!c) return sendJSON(res, 404, { error: 'Customer nahi mila' });
  const today = todayStr();
  const paidMap = await installmentPaidMap(id);
  const inst = (await db.prepare('SELECT * FROM installments WHERE customer_id = ? ORDER BY seq').all(id))
    .map(i => {
      const paid = paidMap.get(i.id) || 0;
      const remaining = i.amount - paid;
      let status = 'baqi';
      if (remaining <= 0) status = 'jama';
      else if (i.due_date < today) status = 'late';
      else if (paid > 0) status = 'aadhi';
      return { id: i.id, seq: i.seq, due_date: i.due_date, amount: i.amount, paid, remaining, status };
    });
  const payments = await db.prepare('SELECT * FROM payments WHERE customer_id = ? ORDER BY id DESC').all(id);
  const t = await customerTotals(id);
  const ym = today.slice(0, 7);
  const thisMonth = inst.filter(i => i.due_date.slice(0, 7) === ym);
  const hisaab = {
    mahanaQist: inst.length > 1 ? inst[1].amount : (inst[0] ? inst[0].amount : 0),
    kulQistein: inst.length,
    jamaQistein: inst.filter(i => i.status === 'jama').length,
    baqiQistein: inst.filter(i => i.status !== 'jama').length,
    lateQistein: inst.filter(i => i.status === 'late').length,
    isMahine: thisMonth.map(i => ({ seq: i.seq, due_date: i.due_date, amount: i.amount,
                                    paid: i.paid, remaining: i.remaining, status: i.status })),
    isMahineBaqi: thisMonth.reduce((s, i) => s + i.remaining, 0),
  };
  const photoRows = await db.prepare('SELECT kind FROM photos WHERE customer_id = ?').all(id);
  const photos = { customer: photoRows.some(r => r.kind === 'customer'),
                   item: photoRows.some(r => r.kind === 'item') };
  sendJSON(res, 200, { customer: c, installments: inst, payments, hisaab, photos,
                       totals: { plan: t.total, paid: t.paid, remaining: t.remaining } });
}

async function handleAddPayment(req, res, shop, customerId) {
  const c = await db.prepare('SELECT * FROM customers WHERE id = ? AND shop_id = ?').get(customerId, shop.id);
  if (!c) return sendJSON(res, 404, { error: 'Customer nahi mila' });
  const b = await readBody(req);
  const amount = Math.round(Number(b.amount));
  if (!amount || amount <= 0) return sendJSON(res, 400, { error: 'Rakam sahi likhein' });
  const t = await customerTotals(customerId);
  if (amount > t.remaining) {
    return sendJSON(res, 400, { error: `Baqi sirf ${rs(t.remaining)} hai — is se zyada nahi likh sakte` });
  }
  // FIFO: sab se purani qist pehle
  const inst = await db.prepare('SELECT * FROM installments WHERE customer_id = ? ORDER BY seq').all(customerId);
  const paidMap = await installmentPaidMap(customerId);
  let left = amount;
  await db.exec('BEGIN');
  try {
    const info = await db.prepare('INSERT INTO payments(customer_id, shop_id, amount, paid_at, created_at) VALUES (?,?,?,?,?)')
      .run(customerId, shop.id, amount, todayStr(), new Date().toISOString());
    const payId = info.lastInsertRowid;
    const insAlloc = await db.prepare('INSERT INTO allocations(payment_id, installment_id, amount) VALUES (?,?,?)');
    for (const i of inst) {
      if (left <= 0) break;
      const rem = i.amount - (paidMap.get(i.id) || 0);
      if (rem <= 0) continue;
      const give = Math.min(rem, left);
      await insAlloc.run(payId, i.id, give);
      left -= give;
    }
    await db.exec('COMMIT');
    sendJSON(res, 200, { ok: true, paymentId: payId, newRemaining: t.remaining - amount });
  } catch (e) { await db.exec('ROLLBACK'); throw e; }
}

async function handleDeletePayment(req, res, shop, paymentId) {
  const p = await db.prepare('SELECT * FROM payments WHERE id = ? AND shop_id = ?').get(paymentId, shop.id);
  if (!p) return sendJSON(res, 404, { error: 'Payment nahi mili' });
  await db.exec('BEGIN');
  try {
    await db.prepare('DELETE FROM allocations WHERE payment_id = ?').run(paymentId);
    await db.prepare('DELETE FROM payments WHERE id = ?').run(paymentId);
    await db.exec('COMMIT');
  } catch (e) { await db.exec('ROLLBACK'); throw e; }
  sendJSON(res, 200, { ok: true });
}

// ---------------------------------------------------------------- API: owner
// Kai customers ke kul hisaab ek sath — sirf 2 sawal (hosted DB par tez)
async function customerTotalsMap(customerIds) {
  const map = new Map();
  if (!customerIds.length) return map;
  const ph = customerIds.map(() => '?').join(',');
  const inst = await db.prepare(`SELECT customer_id, id, amount FROM installments WHERE customer_id IN (${ph})`).all(...customerIds);
  const paidRows = await db.prepare(`
    SELECT i.customer_id AS cid, a.installment_id AS iid, COALESCE(SUM(a.amount),0) AS paid
    FROM allocations a JOIN installments i ON i.id = a.installment_id
    WHERE i.customer_id IN (${ph}) GROUP BY a.installment_id`).all(...customerIds);
  const paidMap = new Map(paidRows.map(r => [r.iid, r.paid]));
  for (const i of inst) {
    if (!map.has(i.customer_id)) map.set(i.customer_id, { total: 0, paid: 0, remaining: 0 });
    const t = map.get(i.customer_id);
    t.total += i.amount;
    t.paid += (paidMap.get(i.id) || 0);
  }
  for (const t of map.values()) t.remaining = t.total - t.paid;
  return map;
}
// Saari dukaanon ke stats ek sath — sirf 3 sawal (owner dashboard ke liye)
async function allShopStats() {
  const today = todayStr();
  const thisMonth = monthOf(today);
  const map = new Map();
  const ensure = id => {
    if (!map.has(id)) map.set(id, { customers: 0, stuck: 0, collected: 0 });
    return map.get(id);
  };
  for (const r of await db.prepare('SELECT shop_id, COUNT(*) AS c FROM customers GROUP BY shop_id').all()) {
    ensure(r.shop_id).customers = r.c;
  }
  const lateRows = await db.prepare(`
    SELECT i.shop_id, i.amount, COALESCE(SUM(a.amount),0) AS paid
    FROM installments i LEFT JOIN allocations a ON a.installment_id = i.id
    WHERE i.due_date < ? GROUP BY i.id`).all(today);
  for (const r of lateRows) ensure(r.shop_id).stuck += Math.max(0, r.amount - r.paid);
  for (const r of await db.prepare(`
    SELECT shop_id, COALESCE(SUM(amount),0) AS s FROM payments
    WHERE substr(paid_at,1,7) = ? GROUP BY shop_id`).all(thisMonth)) {
    ensure(r.shop_id).collected = r.s;
  }
  return map;
}
async function handleOwnerShops(req, res) {
  const fee = Number((await db.prepare("SELECT value FROM settings WHERE key='fee_amount'").get()).value);
  const stats = await allShopStats();
  const shops = (await db.prepare('SELECT id, name, owner_name, mobile, fee_due_date, active, created_at FROM shops ORDER BY name').all())
    .map(s => ({ ...s, fee_amount: fee, ...(stats.get(s.id) || { customers: 0, stuck: 0, collected: 0 }) }));
  sendJSON(res, 200, { shops, fee_amount: fee });
}
async function handleOwnerAddShop(req, res) {
  const b = await readBody(req);
  const name = String(b.name || '').trim();
  const ownerName = String(b.owner_name || '').trim();
  const mobile = String(b.mobile || '').trim();
  const password = String(b.password || '');
  if (!name || !ownerName || !mobile || password.length < 4) {
    return sendJSON(res, 400, { error: 'Dukaan ka naam, maalik, mobile aur kam az kam 4 harf ka password lazmi hai' });
  }
  const exists = await db.prepare('SELECT id FROM shops WHERE mobile = ?').get(mobile);
  if (exists) return sendJSON(res, 400, { error: 'Ye mobile number pehle se kisi dukaan par hai' });
  const feeDue = addOneMonthToDate(todayStr());
  const info = await db.prepare('INSERT INTO shops(name, owner_name, mobile, pass_hash, fee_due_date, active, created_at) VALUES (?,?,?,?,?,1,?)')
    .run(name, ownerName, mobile, hashPassword(password), feeDue, todayStr());
  sendJSON(res, 200, { ok: true, shopId: info.lastInsertRowid, fee_due_date: feeDue });
}
async function handleOwnerDeleteShop(req, res, shopId) {
  const shop = await db.prepare('SELECT * FROM shops WHERE id = ?').get(shopId);
  if (!shop) return sendJSON(res, 404, { error: 'Dukaan nahi mili' });
  await db.exec('BEGIN');
  try {
    await db.prepare('DELETE FROM allocations WHERE payment_id IN (SELECT id FROM payments WHERE shop_id = ?)').run(shopId);
    await db.prepare('DELETE FROM allocations WHERE installment_id IN (SELECT id FROM installments WHERE shop_id = ?)').run(shopId);
    await db.prepare('DELETE FROM payments WHERE shop_id = ?').run(shopId);
    await db.prepare('DELETE FROM installments WHERE shop_id = ?').run(shopId);
    await db.prepare('DELETE FROM photos WHERE shop_id = ?').run(shopId);
    await db.prepare('DELETE FROM customers WHERE shop_id = ?').run(shopId);
    await db.prepare('DELETE FROM shops WHERE id = ?').run(shopId);
    await db.exec('COMMIT');
  } catch (e) { await db.exec('ROLLBACK'); throw e; }
  sendJSON(res, 200, { ok: true });
}
async function handleOwnerFeePaid(req, res, shopId) {
  const shop = await db.prepare('SELECT * FROM shops WHERE id = ?').get(shopId);
  if (!shop) return sendJSON(res, 404, { error: 'Dukaan nahi mili' });
  const next = addOneMonthToDate(shop.fee_due_date);
  await db.prepare('UPDATE shops SET fee_due_date = ? WHERE id = ?').run(next, shopId);
  sendJSON(res, 200, { ok: true, fee_due_date: next });
}
async function handleOwnerToggle(req, res, shopId) {
  const shop = await db.prepare('SELECT * FROM shops WHERE id = ?').get(shopId);
  if (!shop) return sendJSON(res, 404, { error: 'Dukaan nahi mili' });
  const next = shop.active ? 0 : 1;
  await db.prepare('UPDATE shops SET active = ? WHERE id = ?').run(next, shopId);
  sendJSON(res, 200, { ok: true, active: next });
}
async function handleOwnerTotals(req, res) {
  const fee = Number((await db.prepare("SELECT value FROM settings WHERE key='fee_amount'").get()).value);
  const shopsCount = (await db.prepare('SELECT COUNT(*) AS c FROM shops').get()).c;
  const activeCount = (await db.prepare('SELECT COUNT(*) AS c FROM shops WHERE active = 1').get()).c;
  const custCount = (await db.prepare('SELECT COUNT(*) AS c FROM customers').get()).c;
  const stats = await allShopStats();
  let stuck = 0;
  for (const st of stats.values()) stuck += st.stuck;
  sendJSON(res, 200, { shops: shopsCount, activeShops: activeCount, customers: custCount,
                       stuck, monthlyFeeIncome: activeCount * fee, fee_amount: fee });
}
async function handleOwnerSettings(req, res) {
  const b = await readBody(req);
  const fee = Math.round(Number(b.fee_amount));
  if (!fee || fee < 0) return sendJSON(res, 400, { error: 'Fee ki rakam sahi likhein' });
  await db.prepare("UPDATE settings SET value = ? WHERE key = 'fee_amount'").run(String(fee));
  sendJSON(res, 200, { ok: true, fee_amount: fee });
}
async function handleOwnerChangePassword(req, res, owner) {
  const b = await readBody(req);
  if (!verifyPassword(b.old_password || '', owner.pass_hash)) {
    return sendJSON(res, 400, { error: 'Purana password ghalat hai' });
  }
  if (!b.new_password || String(b.new_password).length < 4) {
    return sendJSON(res, 400, { error: 'Naya password kam az kam 4 harf ka rakhein' });
  }
  await db.prepare('UPDATE owner SET pass_hash = ? WHERE id = ?').run(hashPassword(b.new_password), owner.id);
  sendJSON(res, 200, { ok: true });
}
async function handleOwnerBackup(req, res) {
  sendPdf(res, await ownerPdfLines(), `qist-owner-report-${todayStr()}.pdf`);
}
async function handleOwnerBackupDb(req, res) {
  const stamp = todayStr();
  if (!db.isLocal) {
    // Hosted (Turso) mode: poora data ek JSON file ki surat me download
    const dump = await db.dump();
    dump.created_at = new Date().toISOString();
    const body = JSON.stringify(dump, null, 1);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="qist-backup-${stamp}.json"` });
    return res.end(body);
  }
  const dest = path.join(BACKUP_DIR, `qist-${stamp}.db`);
  if (!fs.existsSync(dest)) await db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  const data = fs.readFileSync(dest);
  res.writeHead(200, { 'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="qist-backup-${stamp}.db"` });
  res.end(data);
}

// ---------------------------------------------------------------- static files
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function serveStatic(req, res, url) {
  let p = url.pathname;
  if (p === '/') p = '/home.html';
  if (p === '/app') p = '/index.html';
  if (p === '/owner') p = '/owner.html';
  const file = path.join(PUBLIC_DIR, path.normalize(p).replace(/^([/\\])+/, ''));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found');
  }
  const ext = path.extname(file);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' });
  let body = fs.readFileSync(file);
  if (p === '/home.html') {
    // Landing page me SEO head (canonical/OG/schema) aur FAQ section yahan
    // jorte hain — home.html bari file hai, is liye ye hisse alag chhoti
    // files (seo-head.html, faq-section.html) me rakhe hain.
    try {
      let html = body.toString('utf8');
      const seoHead = fs.readFileSync(path.join(PUBLIC_DIR, 'seo-head.html'), 'utf8');
      const faqSection = fs.readFileSync(path.join(PUBLIC_DIR, 'faq-section.html'), 'utf8');
      html = html.replace('</head>', seoHead + '\n</head>');
      html = html.replace('<section>\n  <div class="wrap">\n    <div class="demo">',
        faqSection + '\n<section>\n  <div class="wrap">\n    <div class="demo">');
      body = Buffer.from(html, 'utf8');
    } catch (e) { /* SEO files na hon to asal page hi serve hoga */ }
  }
  res.end(body);
}

// ---------------------------------------------------------------- router
const routeRequest = async (req, res) => {
  try {
    await initDb();
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const m = req.method;

    if (p === '/api/login' && m === 'POST') return await handleLogin(req, res);
    if (p === '/api/owner/login' && m === 'POST') return await handleOwnerLogin(req, res);
    if (p === '/api/logout' && m === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json',
        'Set-Cookie': 'qw_session=; HttpOnly; Path=/; Max-Age=0' });
      return res.end('{"ok":true}');
    }
    if (p === '/api/me' && m === 'GET') {
      const s = getSession(req);
      if (!s) return sendJSON(res, 401, { error: 'Login nahi hai' });
      if (s.role === 'shop') {
        const shop = await db.prepare('SELECT id, name FROM shops WHERE id = ?').get(s.id);
        return sendJSON(res, 200, { role: 'shop', shop });
      }
      const owner = await db.prepare('SELECT id, name FROM owner WHERE id = ?').get(s.id);
      return sendJSON(res, 200, { role: 'owner', owner });
    }

    // Shop routes
    if (p.startsWith('/api/') && !p.startsWith('/api/owner/')) {
      const shop = await requireShop(req, res);
      if (!shop) return;
      if (p === '/api/home' && m === 'GET') return await handleHome(req, res, shop);
      if (p === '/api/late' && m === 'GET') return await handleLate(req, res, shop);
      if (p === '/api/customers' && m === 'GET') return await handleCustomers(req, res, shop, url);
      if (p === '/api/customers' && m === 'POST') return await handleAddCustomer(req, res, shop);
      const custMatch = p.match(/^\/api\/customers\/(\d+)$/);
      if (custMatch && m === 'GET') return await handleCustomerFile(req, res, shop, Number(custMatch[1]));
      const payMatch = p.match(/^\/api\/customers\/(\d+)\/payments$/);
      if (payMatch && m === 'POST') return await handleAddPayment(req, res, shop, Number(payMatch[1]));
      const delMatch = p.match(/^\/api\/payments\/(\d+)$/);
      if (delMatch && m === 'DELETE') return await handleDeletePayment(req, res, shop, Number(delMatch[1]));
      if (p === '/api/export/pdf' && m === 'GET') return await handleShopPdf(req, res, shop);
      const photoMatch = p.match(/^\/api\/customers\/(\d+)\/photo\/(customer|item)$/);
      if (photoMatch && m === 'GET') return await handlePhotoGet(req, res, shop, Number(photoMatch[1]), photoMatch[2]);
      if (photoMatch && m === 'DELETE') return await handlePhotoDelete(req, res, shop, Number(photoMatch[1]), photoMatch[2]);
      const photoPost = p.match(/^\/api\/customers\/(\d+)\/photo$/);
      if (photoPost && m === 'POST') return await handlePhotoPost(req, res, shop, Number(photoPost[1]));
      return sendJSON(res, 404, { error: 'Route nahi mila' });
    }

    // Owner routes
    if (p.startsWith('/api/owner/')) {
      const owner = await requireOwner(req, res);
      if (!owner) return;
      if (p === '/api/owner/shops' && m === 'GET') return await handleOwnerShops(req, res);
      if (p === '/api/owner/shops' && m === 'POST') return await handleOwnerAddShop(req, res);
      if (p === '/api/owner/totals' && m === 'GET') return await handleOwnerTotals(req, res);
      if (p === '/api/owner/settings' && m === 'POST') return await handleOwnerSettings(req, res);
      if (p === '/api/owner/change-password' && m === 'POST') return await handleOwnerChangePassword(req, res, owner);
      if (p === '/api/owner/backup' && m === 'GET') return await handleOwnerBackup(req, res);
      if (p === '/api/owner/backup-db' && m === 'GET') return await handleOwnerBackupDb(req, res);
      const delShopMatch = p.match(/^\/api\/owner\/shops\/(\d+)$/);
      if (delShopMatch && m === 'DELETE') return await handleOwnerDeleteShop(req, res, Number(delShopMatch[1]));
      const feeMatch = p.match(/^\/api\/owner\/shops\/(\d+)\/fee-paid$/);
      if (feeMatch && m === 'POST') return await handleOwnerFeePaid(req, res, Number(feeMatch[1]));
      const togMatch = p.match(/^\/api\/owner\/shops\/(\d+)\/toggle$/);
      if (togMatch && m === 'POST') return await handleOwnerToggle(req, res, Number(togMatch[1]));
      return sendJSON(res, 404, { error: 'Route nahi mila' });
    }

    if (p.startsWith('/api/')) return sendJSON(res, 404, { error: 'Route nahi mila' });
    return serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    sendJSON(res, 500, { error: 'Server me kharabi — dobara koshish karein' });
  }
};

// API requests ek ek karke chalti hain — hisaab (khas tor par BEGIN..COMMIT
// wale hisse) kabhi aapas me ulajh nahi sakte, chahe database local ho ya hosted.
let apiTail = Promise.resolve();
function apiLock(fn) {
  const run = apiTail.then(fn, fn);
  apiTail = run.then(() => {}, () => {});
  return run;
}
const handler = async (req, res) => {
  let p = '';
  try { p = new URL(req.url, 'http://x').pathname; } catch {}
  if (p.startsWith('/api/')) return apiLock(() => routeRequest(req, res));
  return routeRequest(req, res);
};

// Asal server sirf tab chale jab file seedhi chalayi jaye (node server.js).
// Vercel par yehi handler har request ka jawab deta hai.
if (require.main === module) {
  http.createServer(handler).listen(PORT, () => {
    console.log(`[Qist Wasooli] chal raha hai: http://localhost:${PORT}  (dukaan) | /owner (owner)`);
  });
}
module.exports = handler;
