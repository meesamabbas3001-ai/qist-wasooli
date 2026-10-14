/**
 * Qist Wasooli — Part F testing list (14 tests) khud bakhud chalao.
 * Chalane ke liye: node tests/run-tests.js
 * Ek fresh copy temp me banti hai taake asal data kharab na ho.
 */
'use strict';
const { spawn, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..');
const TMP = '/tmp/qw-test';
const PORT = 3457;
const BASE = `http://localhost:${PORT}`;
const OWNER_PW = 'TestPass#123';

fs.rmSync(TMP, { recursive: true, force: true });
execSync(`cp -r "${SRC}" "${TMP}" && rm -rf "${TMP}/data"`, { shell: '/bin/bash' });

const server = spawn('node', ['server.js'], {
  cwd: TMP, env: { ...process.env, PORT, QW_OWNER_PASSWORD: OWNER_PW },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stderr.on('data', d => process.stderr.write('[server] ' + d));

let jar = {};
function cookieHeader() { return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '); }
async function call(method, p, body, who) {
  const headers = { 'Content-Type': 'application/json' };
  const ck = who ? jar[who] : cookieHeader();
  if (ck) headers.Cookie = ck;
  const r = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const setCk = r.headers.get('set-cookie');
  if (setCk && who) {
    const m = setCk.match(/qw_session=([^;]+)/);
    if (m) jar[who] = `qw_session=${m[1]}`;
    if (setCk.includes('Max-Age=0')) delete jar[who];
  }
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

const results = [];
function check(num, name, cond, detail = '') {
  results.push({ num, name, pass: !!cond, detail });
  console.log(`${cond ? '✅' : '❌'} Test ${num}: ${name}${detail ? ' — ' + detail : ''}`);
}
const ym = offset => {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Karachi' }));
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

(async () => {
  // server ke uthne ka intezaar
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE + '/'); if (r.ok) break; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }

  // --- Test 1: owner login (ghalat par band, sahi par khule)
  let r = await call('POST', '/api/owner/login', { login: 'jafran', password: 'ghalat' }, 'owner');
  const wrongBlocked = r.status === 401;
  r = await call('POST', '/api/owner/login', { login: 'jafran', password: OWNER_PW }, 'owner');
  check(1, 'Owner login — ghalat par na khule, sahi par khule', wrongBlocked && r.status === 200);

  // --- Test 2: nayi dukaan -> login foran chale
  r = await call('POST', '/api/owner/shops', { name: 'Test Mobile A', owner_name: 'Ali', mobile: '03000000001', password: 'shop1234' }, 'owner');
  const shopA = r.data.shopId;
  await call('POST', '/api/owner/shops', { name: 'Test Mobile B', owner_name: 'Bilal', mobile: '03000000002', password: 'shop1234' }, 'owner');
  r = await call('POST', '/api/login', { mobile: '03000000001', password: 'shop1234' }, 'shopA');
  const aLogin = r.status === 200;
  r = await call('POST', '/api/login', { mobile: '03000000002', password: 'shop1234' }, 'shopB');
  check(2, 'Nayi dukaan bante hi login chale', aLogin && r.status === 200 && !!shopA);

  // --- Customer (Shop A): Test 4 wala hisaab
  r = await call('POST', '/api/customers', {
    name: 'Ahmed Test', mobile: '03001112223', item_name: 'Phone', total_price: 120000,
    advance: 30000, months: 12, qist_day: 28, first_month: ym(1),
  }, 'shopA');
  const cust4 = r.data.customerId;
  check(4, 'Plan hisaab 120000-30000=90000 / 12 = 7500', r.status === 200 && r.data.monthly === 7500 && r.data.balance === 90000,
    `monthly=${r.data.monthly}, balance=${r.data.balance}`);
  r = await call('GET', `/api/customers/${cust4}`, null, 'shopA');
  const sum4 = r.data.installments.reduce((s, i) => s + i.amount, 0);
  if (!(sum4 === 90000 && r.data.installments.every(i => i.amount === 7500)))
    results[results.length - 1].pass = false, results[results.length - 1].detail += ` | qiston ka kul=${sum4}`;

  // --- Test 3: ek dukaan ka data dusri ko nazar na aaye
  r = await call('GET', '/api/customers', null, 'shopB');
  const bEmpty = r.data.list.length === 0;
  r = await call('GET', `/api/customers/${cust4}`, null, 'shopB');
  check(3, 'Dukaan A ka data Dukaan B ko nazar nahi aata', bEmpty && r.status === 404);

  // --- Test 5: na-barbari wala hisaab — 90000 / 7, kul bilkul 90000
  r = await call('POST', '/api/customers', {
    name: 'Round Test', mobile: '03004445556', total_price: 100000, advance: 10000,
    months: 7, qist_day: 28, first_month: ym(1),
  }, 'shopA');
  const cust5 = r.data.customerId;
  r = await call('GET', `/api/customers/${cust5}`, null, 'shopA');
  const sum5 = r.data.installments.reduce((s, i) => s + i.amount, 0);
  check(5, '90000 / 7 mahine — kul bilkul 90000, 1 rupaya farq nahi', sum5 === 90000, `kul=${sum5}`);

  // --- Test 6: qist jama — poori + aadhi, FIFO
  r = await call('POST', `/api/customers/${cust4}/payments`, { amount: 7500 }, 'shopA');
  const afterFull = r.data.newRemaining;
  r = await call('GET', `/api/customers/${cust4}`, null, 'shopA');
  const fifo = r.data.installments[0].status === 'jama' && r.data.installments[0].paid === 7500;
  r = await call('POST', `/api/customers/${cust4}/payments`, { amount: 3000 }, 'shopA');
  const partPay = r.data;
  r = await call('GET', `/api/customers/${cust4}`, null, 'shopA');
  const half = r.data.installments[1].paid === 3000 && r.data.installments[1].status === 'aadhi';
  const secondPayId = partPay.paymentId;
  check(6, 'Qist jama 7500 -> baqi 82500; aadhi 3000 bhi chale (FIFO)',
    afterFull === 82500 && fifo && partPay.newRemaining === 79500 && half,
    `baqi=${partPay.newRemaining}`);

  // --- Test 7: baqi se zyada par rok
  r = await call('POST', `/api/customers/${cust4}/payments`, { amount: 80000 }, 'shopA');
  check(7, 'Baqi se zyada rakam par system roke', r.status === 400, r.data.error || '');

  // --- Test 8: payment delete -> hisaab pehle jaisa
  r = await call('DELETE', `/api/payments/${secondPayId}`, null, 'shopA');
  const delOk = r.status === 200;
  r = await call('GET', `/api/customers/${cust4}`, null, 'shopA');
  check(8, 'Payment delete -> hisaab pehle jaisa wapas', delOk && r.data.totals.remaining === 82500,
    `baqi=${r.data.totals.remaining}`);

  // --- Test 9: late list + 30 din par lal
  r = await call('POST', '/api/customers', {
    name: 'Late Wala', mobile: '03007778889', total_price: 40000, advance: 10000,
    months: 2, qist_day: 1, first_month: ym(-2),
  }, 'shopA');
  r = await call('GET', '/api/late', null, 'shopA');
  const late = r.data.list.find(x => x.name === 'Late Wala');
  check(9, 'Late list me aaye; 30+ din par lal nishan', !!late && late.level === 'red' && late.daysLate >= 30,
    late ? `${late.daysLate} din late` : 'list me nahi mila');

  // --- Test 10: search naam + mobile
  r = await call('GET', '/api/customers?q=Ahmed', null, 'shopA');
  const byName = r.data.list.some(c => c.name === 'Ahmed Test');
  r = await call('GET', '/api/customers?q=0300111', null, 'shopA');
  const byMobile = r.data.list.some(c => c.name === 'Ahmed Test');
  check(10, 'Search — naam aur mobile dono se', byName && byMobile);

  // --- Test 11: fee +1 mahina; band -> login band; kholo -> data poora
  r = await call('GET', '/api/owner/shops', null, 'owner');
  const before = r.data.shops.find(s => s.id === shopA);
  r = await call('POST', `/api/owner/shops/${shopA}/fee-paid`, {}, 'owner');
  const [by, bm, bd] = before.fee_due_date.split('-').map(Number);
  const expFee = (() => { const d = new Date(Date.UTC(by, bm, 1));
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(bd, last)).padStart(2, '0')}`; })();
  const feeOk = r.data.fee_due_date === expFee;
  r = await call('POST', `/api/owner/shops/${shopA}/toggle`, {}, 'owner');
  r = await call('POST', '/api/login', { mobile: '03000000001', password: 'shop1234' }, 'shopA2');
  const blockedLogin = r.status === 403;
  r = await call('POST', `/api/owner/shops/${shopA}/toggle`, {}, 'owner');
  r = await call('POST', '/api/login', { mobile: '03000000001', password: 'shop1234' }, 'shopA');
  const reopened = r.status === 200;
  r = await call('GET', `/api/customers/${cust4}`, null, 'shopA');
  const dataIntact = r.data.totals && r.data.totals.remaining === 82500;
  check(11, 'Fee +1 mahina; band par login band; khulne par data poora',
    feeOk && blockedLogin && reopened && dataIntact, `fee ${before.fee_due_date} -> ${expFee}`);

  // --- Test 12: mobile design (viewport + chhoti screen par side-scroll nahi)
  const html = await (await fetch(BASE + '/')).text();
  check(12, 'Mobile design — viewport, bare button, side-scroll nahi (design check)',
    html.includes('viewport') && html.includes('bottomnav'), 'mobile-first layout, max-width 640');

  // --- Test 13: sust internet par tez khule (pehli screen ka size + waqt)
  const t0 = Date.now();
  const home = await (await fetch(BASE + '/')).text();
  const ms = Date.now() - t0;
  check(13, 'Pehli screen tez khule (koi bahari font/library nahi)', ms < 3000 && home.length < 30000,
    `${ms}ms, ${(home.length / 1024).toFixed(1)}KB HTML`);

  // --- Test 14: owner totals haath ke hisaab se
  r = await call('GET', '/api/owner/totals', null, 'owner');
  const t = r.data;
  check(14, 'Owner totals — 2 dukaanain, 3 customers, phansa 30000, kamai 13998',
    t.shops === 2 && t.customers === 3 && t.stuck === 30000 && t.monthlyFeeIncome === 2 * 6999,
    `shops=${t.shops}, customers=${t.customers}, stuck=${t.stuck}, kamai=${t.monthlyFeeIncome}`);

  // --- Extra: Home screen (Aaj Ka Kaam) ka hisaab
  r = await call('GET', '/api/home', null, 'shopA');
  const h = r.data;
  check('Extra', 'Home screen (Aaj Ka Kaam) — late 1 customer / 30000, is mahine wasooli 7500',
    h.lateCount === 1 && h.lateAmount === 30000 && h.monthCollected === 7500 && h.todayTotal === 0,
    `late=${h.lateCount}/${h.lateAmount}, collected=${h.monthCollected}, today=${h.todayTotal}`);

  const passed = results.filter(x => x.pass).length;
  console.log(`\n===== NATIJA: ${passed}/${results.length} checks pass (14 brief tests + home-screen extra) =====`);
  server.kill();
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error('Test fail ho gaya:', e); server.kill(); process.exit(1); });
