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
const { DatabaseSync } = require('node:sqlite');

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
if (fs.existsSync(SECRET_PATH)) {
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
const db = new DatabaseSync(DB_PATH);
db.exec(`
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
  CREATE INDEX IF NOT EXISTS idx_cust_shop ON customers(shop_id);
  CREATE INDEX IF NOT EXISTS idx_inst_cust ON installments(customer_id);
  CREATE INDEX IF NOT EXISTS idx_inst_shop_due ON installments(shop_id, due_date);
  CREATE INDEX IF NOT EXISTS idx_pay_cust ON payments(customer_id);
  CREATE INDEX IF NOT EXISTS idx_alloc_inst ON allocations(installment_id);
`);

// Default settings + owner seed
{
  const setFee = db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)');
  setFee.run('fee_amount', '6999');
  const ownerRow = db.prepare('SELECT id FROM owner LIMIT 1').get();
  if (!ownerRow) {
    const starter = process.env.QW_OWNER_PASSWORD || 'QistOwner#2026';
    db.prepare('INSERT INTO owner(login, pass_hash, name) VALUES (?, ?, ?)')
      .run('jafran', hashPassword(starter), 'Jafran (Owner)');
    console.log('[Qist Wasooli] Owner account ban gaya. Login: jafran (password README me hai — pehle login par badal lein)');
  }
}

// ---------------------------------------------------------------- backup (roz khud bakhud)
function makeBackup() {
  try {
    const stamp = todayStr();
    const dest = path.join(BACKUP_DIR, `qist-${stamp}.db`);
    if (!fs.existsSync(dest)) {
      db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
    }
    // purane backups saaf: sirf akhri 14 rakho
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.endsWith('.db')).sort();
    while (files.length > 14) {
      fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
    }
  } catch (e) { console.error('Backup error:', e.message); }
}
makeBackup();
setInterval(makeBackup, 24 * 60 * 60 * 1000).unref();

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
    req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('JSON ghalat hai')); }
    });
    req.on('error', reject);
  });
}
const rs = n => 'Rs. ' + Number(n || 0).toLocaleString('en-PK');

// Customer ke hisaab ke liye: har qist ki paid rakam allocations se
function installmentPaidMap(customerId) {
  const rows = db.prepare(`
    SELECT a.installment_id AS iid, COALESCE(SUM(a.amount),0) AS paid
    FROM allocations a JOIN installments i ON i.id = a.installment_id
    WHERE i.customer_id = ? GROUP BY a.installment_id`).all(customerId);
  const map = new Map();
  for (const r of rows) map.set(r.iid, r.paid);
  return map;
}
function customerTotals(customerId) {
  const inst = db.prepare('SELECT id, amount FROM installments WHERE customer_id = ?').all(customerId);
  const paidMap = installmentPaidMap(customerId);
  let total = 0, paid = 0;
  for (const i of inst) { total += i.amount; paid += (paidMap.get(i.id) || 0); }
  return { total, paid, remaining: total - paid };
}

// Auth guards — hamesha token se, kabhi client ki bheji shop_id se nahi
function requireShop(req, res) {
  const s = getSession(req);
  if (!s || s.role !== 'shop') { sendJSON(res, 401, { error: 'Pehle login karein' }); return null; }
  const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(s.id);
  if (!shop) { sendJSON(res, 401, { error: 'Dukaan nahi mili' }); return null; }
  if (!shop.active) { sendJSON(res, 403, { error: 'Aapki dukaan band hai. Fee ke liye owner se rabta karein.', blocked: true }); return null; }
  return shop;
}
function requireOwner(req, res) {
  const s = getSession(req);
  if (!s || s.role !== 'owner') { sendJSON(res, 401, { error: 'Pehle owner login karein' }); return null; }
  return db.prepare('SELECT * FROM owner WHERE id = ?').get(s.id);
}

// ---------------------------------------------------------------- API: auth
async function handleLogin(req, res) {
  const { mobile, password } = await readBody(req);
  const shop = db.prepare('SELECT * FROM shops WHERE mobile = ?').get(String(mobile || '').trim());
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
  const owner = db.prepare('SELECT * FROM owner WHERE login = ?').get(String(login || '').trim());
  if (!owner || !verifyPassword(password || '', owner.pass_hash)) {
    return sendJSON(res, 401, { error: 'Login ya password ghalat hai' });
  }
  const token = signToken({ role: 'owner', id: owner.id, exp: Date.now() + 30 * 24 * 3600 * 1000 });
  res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': sessionCookie(token) });
  res.end(JSON.stringify({ ok: true, name: owner.name }));
}

// ---------------------------------------------------------------- API: shop
function handleHome(req, res, shop) {
  const today = todayStr();
  const thisMonth = monthOf(today);
  // Aaj ki qistein
  const dueRows = db.prepare(`
    SELECT i.id, i.customer_id, i.amount, c.name, c.mobile
    FROM installments i JOIN customers c ON c.id = i.customer_id
    WHERE i.shop_id = ? AND i.due_date = ? ORDER BY c.name`).all(shop.id, today);
  const todayList = [];
  let todayTotal = 0;
  for (const r of dueRows) {
    const paid = db.prepare('SELECT COALESCE(SUM(amount),0) AS p FROM allocations WHERE installment_id = ?').get(r.id).p;
    const rem = r.amount - paid;
    if (rem > 0) { todayList.push({ customerId: r.customer_id, name: r.name, mobile: r.mobile, amount: rem }); todayTotal += rem; }
  }
  const monthExpected = db.prepare(`
    SELECT COALESCE(SUM(amount),0) AS s FROM installments
    WHERE shop_id = ? AND substr(due_date,1,7) = ?`).get(shop.id, thisMonth).s;
  const monthCollected = db.prepare(`
    SELECT COALESCE(SUM(amount),0) AS s FROM payments
    WHERE shop_id = ? AND substr(paid_at,1,7) = ?`).get(shop.id, thisMonth).s;
  // Late
  const lateRows = db.prepare(`
    SELECT i.id, i.amount FROM installments i
    WHERE i.shop_id = ? AND i.due_date < ?`).all(shop.id, today);
  let lateAmount = 0; const lateCust = new Set();
  const lateInstIds = [];
  for (const r of lateRows) {
    const paid = db.prepare('SELECT COALESCE(SUM(amount),0) AS p FROM allocations WHERE installment_id = ?').get(r.id).p;
    if (r.amount - paid > 0) {
      lateAmount += (r.amount - paid); lateInstIds.push(r.id);
    }
  }
  if (lateInstIds.length) {
    const q = db.prepare(`SELECT COUNT(DISTINCT customer_id) AS c FROM installments WHERE id IN (${lateInstIds.map(() => '?').join(',')})`).get(...lateInstIds);
    var lateCount = q.c;
  } else var lateCount = 0;
  sendJSON(res, 200, { todayList, todayTotal, monthExpected, monthCollected, lateCount, lateAmount, today });
}

function handleLate(req, res, shop) {
  const today = todayStr();
  const rows = db.prepare(`
    SELECT i.customer_id, i.due_date, i.amount, i.id, c.name, c.mobile
    FROM installments i JOIN customers c ON c.id = i.customer_id
    WHERE i.shop_id = ? AND i.due_date < ? ORDER BY i.due_date ASC`).all(shop.id, today);
  const byCust = new Map();
  for (const r of rows) {
    const paid = db.prepare('SELECT COALESCE(SUM(amount),0) AS p FROM allocations WHERE installment_id = ?').get(r.id).p;
    const rem = r.amount - paid;
    if (rem <= 0) continue;
    if (!byCust.has(r.customer_id)) {
      byCust.set(r.customer_id, {
        customerId: r.customer_id, name: r.name, mobile: r.mobile,
        oldestDue: r.due_date, overdueAmount: 0,
      });
    }
    byCust.get(r.customer_id).overdueAmount += rem;
  }
  const list = [...byCust.values()].map(c => {
    const totals = customerTotals(c.customerId);
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
  const insertCust = db.prepare(`
    INSERT INTO customers(shop_id, name, mobile, cnic, address, guarantor_name,
      guarantor_mobile, item_name, imei, total_price, advance, months, qist_day,
      first_month, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertInst = db.prepare(`
    INSERT INTO installments(customer_id, shop_id, seq, due_date, amount)
    VALUES (?,?,?,?,?)`);
  let custId;
  db.exec('BEGIN');
  try {
    const info = insertCust.run(shop.id, name, mobile, String(b.cnic || '').trim(),
      String(b.address || '').trim(), String(b.guarantor_name || '').trim(),
      String(b.guarantor_mobile || '').trim(), String(b.item_name || '').trim(),
      String(b.imei || '').trim(), totalPrice, advance, months, qistDay, firstMonth, todayStr());
    custId = info.lastInsertRowid;
    for (let i = 0; i < months; i++) {
      const amount = i < months - 1 ? base : balance - base * (months - 1);
      const due = `${addMonthsToYM(firstMonth, i)}-${String(qistDay).padStart(2, '0')}`;
      insertInst.run(custId, shop.id, i + 1, due, amount);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  sendJSON(res, 200, { ok: true, customerId: custId, monthly: base, balance });
}

function handleCustomers(req, res, shop, url) {
  const q = (url.searchParams.get('q') || '').trim();
  let rows;
  if (q) {
    rows = db.prepare(`SELECT * FROM customers WHERE shop_id = ? AND (name LIKE ? OR mobile LIKE ?) ORDER BY name`)
      .all(shop.id, `%${q}%`, `%${q}%`);
  } else {
    rows = db.prepare('SELECT * FROM customers WHERE shop_id = ? ORDER BY name LIMIT 500').all(shop.id);
  }
  const list = rows.map(c => {
    const t = customerTotals(c.id);
    return { id: c.id, name: c.name, mobile: c.mobile, item_name: c.item_name,
             total_price: c.total_price, remaining: t.remaining, paid: t.paid };
  });
  sendJSON(res, 200, { list });
}

function handleCustomerFile(req, res, shop, id) {
  const c = db.prepare('SELECT * FROM customers WHERE id = ? AND shop_id = ?').get(id, shop.id);
  if (!c) return sendJSON(res, 404, { error: 'Customer nahi mila' });
  const today = todayStr();
  const paidMap = installmentPaidMap(id);
  const inst = db.prepare('SELECT * FROM installments WHERE customer_id = ? ORDER BY seq').all(id)
    .map(i => {
      const paid = paidMap.get(i.id) || 0;
      const remaining = i.amount - paid;
      let status = 'baqi';
      if (remaining <= 0) status = 'jama';
      else if (i.due_date < today) status = 'late';
      else if (paid > 0) status = 'aadhi';
      return { id: i.id, seq: i.seq, due_date: i.due_date, amount: i.amount, paid, remaining, status };
    });
  const payments = db.prepare('SELECT * FROM payments WHERE customer_id = ? ORDER BY id DESC').all(id);
  const t = customerTotals(id);
  sendJSON(res, 200, { customer: c, installments: inst, payments,
                       totals: { plan: t.total, paid: t.paid, remaining: t.remaining } });
}

async function handleAddPayment(req, res, shop, customerId) {
  const c = db.prepare('SELECT * FROM customers WHERE id = ? AND shop_id = ?').get(customerId, shop.id);
  if (!c) return sendJSON(res, 404, { error: 'Customer nahi mila' });
  const b = await readBody(req);
  const amount = Math.round(Number(b.amount));
  if (!amount || amount <= 0) return sendJSON(res, 400, { error: 'Rakam sahi likhein' });
  const t = customerTotals(customerId);
  if (amount > t.remaining) {
    return sendJSON(res, 400, { error: `Baqi sirf ${rs(t.remaining)} hai — is se zyada nahi likh sakte` });
  }
  // FIFO: sab se purani qist pehle
  const inst = db.prepare('SELECT * FROM installments WHERE customer_id = ? ORDER BY seq').all(customerId);
  const paidMap = installmentPaidMap(customerId);
  let left = amount;
  db.exec('BEGIN');
  try {
    const info = db.prepare('INSERT INTO payments(customer_id, shop_id, amount, paid_at, created_at) VALUES (?,?,?,?,?)')
      .run(customerId, shop.id, amount, todayStr(), new Date().toISOString());
    const payId = info.lastInsertRowid;
    const insAlloc = db.prepare('INSERT INTO allocations(payment_id, installment_id, amount) VALUES (?,?,?)');
    for (const i of inst) {
      if (left <= 0) break;
      const rem = i.amount - (paidMap.get(i.id) || 0);
      if (rem <= 0) continue;
      const give = Math.min(rem, left);
      insAlloc.run(payId, i.id, give);
      left -= give;
    }
    db.exec('COMMIT');
    sendJSON(res, 200, { ok: true, paymentId: payId, newRemaining: t.remaining - amount });
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function handleDeletePayment(req, res, shop, paymentId) {
  const p = db.prepare('SELECT * FROM payments WHERE id = ? AND shop_id = ?').get(paymentId, shop.id);
  if (!p) return sendJSON(res, 404, { error: 'Payment nahi mili' });
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM allocations WHERE payment_id = ?').run(paymentId);
    db.prepare('DELETE FROM payments WHERE id = ?').run(paymentId);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  sendJSON(res, 200, { ok: true });
}

// ---------------------------------------------------------------- API: owner
function shopStats(shopId) {
  const today = todayStr();
  const thisMonth = monthOf(today);
  const customers = db.prepare('SELECT COUNT(*) AS c FROM customers WHERE shop_id = ?').get(shopId).c;
  const inst = db.prepare('SELECT id, amount FROM installments WHERE shop_id = ? AND due_date < ?').all(shopId, today);
  let stuck = 0;
  for (const i of inst) {
    const paid = db.prepare('SELECT COALESCE(SUM(amount),0) AS p FROM allocations WHERE installment_id = ?').get(i.id).p;
    stuck += Math.max(0, i.amount - paid);
  }
  const collected = db.prepare('SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE shop_id = ? AND substr(paid_at,1,7) = ?')
    .get(shopId, thisMonth).s;
  return { customers, stuck, collected };
}
function handleOwnerShops(req, res) {
  const fee = Number(db.prepare("SELECT value FROM settings WHERE key='fee_amount'").get().value);
  const shops = db.prepare('SELECT id, name, owner_name, mobile, fee_due_date, active, created_at FROM shops ORDER BY name').all()
    .map(s => ({ ...s, fee_amount: fee, ...shopStats(s.id) }));
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
  const exists = db.prepare('SELECT id FROM shops WHERE mobile = ?').get(mobile);
  if (exists) return sendJSON(res, 400, { error: 'Ye mobile number pehle se kisi dukaan par hai' });
  const feeDue = addOneMonthToDate(todayStr());
  const info = db.prepare('INSERT INTO shops(name, owner_name, mobile, pass_hash, fee_due_date, active, created_at) VALUES (?,?,?,?,?,1,?)')
    .run(name, ownerName, mobile, hashPassword(password), feeDue, todayStr());
  sendJSON(res, 200, { ok: true, shopId: info.lastInsertRowid, fee_due_date: feeDue });
}
function handleOwnerFeePaid(req, res, shopId) {
  const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(shopId);
  if (!shop) return sendJSON(res, 404, { error: 'Dukaan nahi mili' });
  const next = addOneMonthToDate(shop.fee_due_date);
  db.prepare('UPDATE shops SET fee_due_date = ? WHERE id = ?').run(next, shopId);
  sendJSON(res, 200, { ok: true, fee_due_date: next });
}
function handleOwnerToggle(req, res, shopId) {
  const shop = db.prepare('SELECT * FROM shops WHERE id = ?').get(shopId);
  if (!shop) return sendJSON(res, 404, { error: 'Dukaan nahi mili' });
  const next = shop.active ? 0 : 1;
  db.prepare('UPDATE shops SET active = ? WHERE id = ?').run(next, shopId);
  sendJSON(res, 200, { ok: true, active: next });
}
function handleOwnerTotals(req, res) {
  const fee = Number(db.prepare("SELECT value FROM settings WHERE key='fee_amount'").get().value);
  const shopsCount = db.prepare('SELECT COUNT(*) AS c FROM shops').get().c;
  const activeCount = db.prepare('SELECT COUNT(*) AS c FROM shops WHERE active = 1').get().c;
  const custCount = db.prepare('SELECT COUNT(*) AS c FROM customers').get().c;
  let stuck = 0;
  const shops = db.prepare('SELECT id FROM shops').all();
  for (const s of shops) stuck += shopStats(s.id).stuck;
  sendJSON(res, 200, { shops: shopsCount, activeShops: activeCount, customers: custCount,
                       stuck, monthlyFeeIncome: activeCount * fee, fee_amount: fee });
}
async function handleOwnerSettings(req, res) {
  const b = await readBody(req);
  const fee = Math.round(Number(b.fee_amount));
  if (!fee || fee < 0) return sendJSON(res, 400, { error: 'Fee ki rakam sahi likhein' });
  db.prepare("UPDATE settings SET value = ? WHERE key = 'fee_amount'").run(String(fee));
  sendJSON(res, 200, { ok: true, fee_amount: fee });
}
async function handleOwnerChangePassword(req, res, owner) {
  const b = await readBody(req);
  if (!verifyPassword(b.old_password || '', owner.pass_hash)) {
    return sendJSON(res, 400, { error: 'Purana password ghalat hai' });
  }
  if (!b.new_password || String(b.new_password).length < 6) {
    return sendJSON(res, 400, { error: 'Naya password kam az kam 6 harf ka rakhein' });
  }
  db.prepare('UPDATE owner SET pass_hash = ? WHERE id = ?').run(hashPassword(b.new_password), owner.id);
  sendJSON(res, 200, { ok: true });
}
function handleOwnerBackup(req, res) {
  const stamp = todayStr();
  const dest = path.join(BACKUP_DIR, `qist-${stamp}.db`);
  if (!fs.existsSync(dest)) db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
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
  if (p === '/') p = '/index.html';
  if (p === '/owner') p = '/owner.html';
  const file = path.join(PUBLIC_DIR, path.normalize(p).replace(/^([/\\])+/, ''));
  if (!file.startsWith(PUBLIC_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found');
  }
  const ext = path.extname(file);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' });
  res.end(fs.readFileSync(file));
}

// ---------------------------------------------------------------- router
const handler = async (req, res) => {
  try {
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
        const shop = db.prepare('SELECT id, name FROM shops WHERE id = ?').get(s.id);
        return sendJSON(res, 200, { role: 'shop', shop });
      }
      const owner = db.prepare('SELECT id, name FROM owner WHERE id = ?').get(s.id);
      return sendJSON(res, 200, { role: 'owner', owner });
    }

    // Shop routes
    if (p.startsWith('/api/') && !p.startsWith('/api/owner/')) {
      const shop = requireShop(req, res);
      if (!shop) return;
      if (p === '/api/home' && m === 'GET') return handleHome(req, res, shop);
      if (p === '/api/late' && m === 'GET') return handleLate(req, res, shop);
      if (p === '/api/customers' && m === 'GET') return handleCustomers(req, res, shop, url);
      if (p === '/api/customers' && m === 'POST') return await handleAddCustomer(req, res, shop);
      const custMatch = p.match(/^\/api\/customers\/(\d+)$/);
      if (custMatch && m === 'GET') return handleCustomerFile(req, res, shop, Number(custMatch[1]));
      const payMatch = p.match(/^\/api\/customers\/(\d+)\/payments$/);
      if (payMatch && m === 'POST') return await handleAddPayment(req, res, shop, Number(payMatch[1]));
      const delMatch = p.match(/^\/api\/payments\/(\d+)$/);
      if (delMatch && m === 'DELETE') return handleDeletePayment(req, res, shop, Number(delMatch[1]));
      return sendJSON(res, 404, { error: 'Route nahi mila' });
    }

    // Owner routes
    if (p.startsWith('/api/owner/')) {
      const owner = requireOwner(req, res);
      if (!owner) return;
      if (p === '/api/owner/shops' && m === 'GET') return handleOwnerShops(req, res);
      if (p === '/api/owner/shops' && m === 'POST') return await handleOwnerAddShop(req, res);
      if (p === '/api/owner/totals' && m === 'GET') return handleOwnerTotals(req, res);
      if (p === '/api/owner/settings' && m === 'POST') return await handleOwnerSettings(req, res);
      if (p === '/api/owner/change-password' && m === 'POST') return await handleOwnerChangePassword(req, res, owner);
      if (p === '/api/owner/backup' && m === 'GET') return handleOwnerBackup(req, res);
      const feeMatch = p.match(/^\/api\/owner\/shops\/(\d+)\/fee-paid$/);
      if (feeMatch && m === 'POST') return handleOwnerFeePaid(req, res, Number(feeMatch[1]));
      const togMatch = p.match(/^\/api\/owner\/shops\/(\d+)\/toggle$/);
      if (togMatch && m === 'POST') return handleOwnerToggle(req, res, Number(togMatch[1]));
      return sendJSON(res, 404, { error: 'Route nahi mila' });
    }

    if (p.startsWith('/api/')) return sendJSON(res, 404, { error: 'Route nahi mila' });
    return serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    sendJSON(res, 500, { error: 'Server me kharabi — dobara koshish karein' });
  }
};

// Asal server sirf tab chale jab file seedhi chalayi jaye (node server.js).
// Vercel par yehi handler har request ka jawab deta hai.
if (require.main === module) {
  http.createServer(handler).listen(PORT, () => {
    console.log(`[Qist Wasooli] chal raha hai: http://localhost:${PORT}  (dukaan) | /owner (owner)`);
  });
}
module.exports = handler;
