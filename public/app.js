/* Qist Wasooli — dukaan (shopkeeper) app */
'use strict';
const $ = id => document.getElementById(id);
const rs = n => 'Rs. ' + Number(n || 0).toLocaleString('en-PK');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Kuch ghalat ho gaya');
  return data;
}
function showErr(id, msg) { const e = $(id); e.textContent = msg; e.style.display = msg ? 'block' : 'none'; }

// Number copy karna — dabate hi clipboard me, phir dialer/WhatsApp me paste karke call
async function copyNumber(num, btn) {
  let done = true;
  try { await navigator.clipboard.writeText(num); }
  catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = num; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      done = document.execCommand('copy'); ta.remove();
    } catch { done = false; }
  }
  const t = $('toast');
  t.textContent = done ? '📋 Number copy ho gaya: ' + num : 'Number: ' + num;
  t.style.display = 'block';
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => t.style.display = 'none', 1800);
  if (btn) {
    const old = btn.textContent;
    btn.textContent = '✓ Copy';
    btn.classList.add('ok');
    setTimeout(() => { btn.textContent = old; btn.classList.remove('ok'); }, 1600);
  }
}

// ---------------- login
$('login-btn').onclick = async () => {
  showErr('login-err', '');
  try {
    const d = await api('/api/login', { method: 'POST', body: JSON.stringify({
      mobile: $('login-mobile').value.trim(), password: $('login-pass').value }) });
    $('shop-name').textContent = d.shop.name;
    enterApp();
  } catch (e) { showErr('login-err', e.message); }
};
$('login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') $('login-btn').click(); });
$('logout-btn').onclick = async () => { await api('/api/logout', { method: 'POST' }); location.reload(); };

async function enterApp() {
  $('login-screen').classList.add('hidden');
  $('app').classList.remove('hidden');
  showView('home');
}

// ---------------- navigation
let currentFileId = null;
function showView(v) {
  for (const s of ['home', 'late', 'add', 'customers', 'file'])
    $('view-' + s).classList.toggle('hidden', s !== v);
  document.querySelectorAll('.bottomnav button').forEach(b =>
    b.classList.toggle('on', b.dataset.view === v));
  if (v === 'home') loadHome();
  if (v === 'late') loadLate();
  if (v === 'customers') loadCustomers($('search').value.trim());
  window.scrollTo(0, 0);
}
document.querySelectorAll('.bottomnav button').forEach(b =>
  b.onclick = () => showView(b.dataset.view));
$('file-back').onclick = () => showView('customers');

// ---------------- home
async function loadHome() {
  try {
    const d = await api('/api/home');
    $('st-today').textContent = rs(d.todayTotal);
    $('st-late').textContent = rs(d.lateAmount);
    $('st-month-exp').textContent = rs(d.monthExpected);
    $('st-month-got').textContent = rs(d.monthCollected);
    const box = $('today-list');
    if (!d.todayList.length) { box.innerHTML = '<div class="empty">Aaj kisi ki qist nahi hai 🎉</div>'; return; }
    box.innerHTML = '';
    for (const c of d.todayList) {
      const b = document.createElement('button');
      b.className = 'row-item';
      b.innerHTML = `<span class="grow"><span class="nm">${esc(c.name)}</span><br>
        <span class="sm">${esc(c.mobile)}</span></span><span class="amt">${rs(c.amount)}</span>`;
      b.onclick = () => openFile(c.customerId);
      box.appendChild(b);
    }
  } catch (e) { /* session khatam ho to login par */ }
}

// ---------------- late list
async function loadLate() {
  const d = await api('/api/late');
  const box = $('late-list');
  if (!d.list.length) { box.innerHTML = '<div class="empty">Koi late nahi hai — zabardast! 🎉</div>'; return; }
  box.innerHTML = '';
  for (const c of d.list) {
    const badge = c.level === 'red' ? `<span class="badge red">${c.daysLate} din late</span>`
      : c.level === 'yellow' ? `<span class="badge yellow">${c.daysLate} din late</span>`
      : `<span class="badge gray">${c.daysLate} din late</span>`;
    const row = document.createElement('div');
    row.className = 'row-item';
    row.innerHTML = `<span class="grow"><span class="nm">${esc(c.name)}</span> ${badge}<br>
      <span class="sm">${esc(c.mobile)} · Baqi: <b>${rs(c.totalRemaining)}</b></span></span>
      <button class="copy-btn" data-copy="${esc(c.mobile)}">📋 Copy</button>
      <a class="call-btn" href="tel:${esc(c.mobile)}">📞 Call</a>`;
    row.querySelector('[data-copy]').onclick = e => { e.stopPropagation(); copyNumber(c.mobile, e.currentTarget); };
    row.onclick = e => { if (e.target.tagName !== 'A' && e.target.tagName !== 'BUTTON') openFile(c.customerId); };
    box.appendChild(row);
  }
}

// ---------------- add customer
$('add-btn').onclick = async () => {
  showErr('add-err', ''); showErr('add-ok', '');
  const body = {
    name: $('f-name').value, mobile: $('f-mobile').value, cnic: $('f-cnic').value,
    address: $('f-address').value, guarantor_name: $('f-gname').value,
    guarantor_mobile: $('f-gmobile').value, item_name: $('f-item').value,
    imei: $('f-imei').value, total_price: $('f-price').value,
    advance: $('f-advance').value, months: $('f-months').value,
    qist_day: $('f-day').value, first_month: $('f-first').value,
  };
  try {
    const d = await api('/api/customers', { method: 'POST', body: JSON.stringify(body) });
    const ok = $('add-ok');
    ok.textContent = `✅ Customer ban gaya! Har mahine ki qist: ${rs(d.monthly)} · Kul baqi: ${rs(d.balance)}`;
    ok.style.display = 'block';
    for (const id of ['f-name','f-mobile','f-cnic','f-address','f-gname','f-gmobile','f-item','f-imei','f-price','f-advance','f-months','f-day'])
      $(id).value = '';
    setTimeout(() => openFile(d.customerId), 900);
  } catch (e) { showErr('add-err', e.message); }
};

// ---------------- customers + search
let searchTimer;
$('search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadCustomers($('search').value.trim()), 250);
});
async function loadCustomers(q) {
  const d = await api('/api/customers' + (q ? '?q=' + encodeURIComponent(q) : ''));
  const box = $('cust-list');
  if (!d.list.length) { box.innerHTML = '<div class="empty">Koi customer nahi mila</div>'; return; }
  box.innerHTML = '';
  for (const c of d.list) {
    const b = document.createElement('button');
    b.className = 'row-item';
    b.innerHTML = `<span class="grow"><span class="nm">${esc(c.name)}</span><br>
      <span class="sm">${esc(c.mobile)}${c.item_name ? ' · ' + esc(c.item_name) : ''}</span></span>
      <span class="amt">${c.remaining > 0 ? rs(c.remaining) + ' baqi' : '✅ Clear'}</span>
      <span class="copy-btn" data-copy="${esc(c.mobile)}" style="margin-left:8px">📋</span>`;
    b.querySelector('[data-copy]').onclick = e => { e.stopPropagation(); copyNumber(c.mobile, null); };
    b.onclick = () => openFile(c.id);
    box.appendChild(b);
  }
}

// ---------------- customer file
async function openFile(id) {
  currentFileId = id;
  const d = await api('/api/customers/' + id);
  const c = d.customer;
  $('file-name').textContent = c.name;
  const statusBadge = s => s === 'jama' ? '<span class="badge green">Jama</span>'
    : s === 'late' ? '<span class="badge red">Late</span>'
    : s === 'aadhi' ? '<span class="badge yellow">Aadhi</span>'
    : '<span class="badge gray">Baqi</span>';
  let html = `
  <div class="card">
    <div class="kv"><span class="k">Mobile</span><span class="v">${esc(c.mobile)}<button class="mini-btn copy" data-copyfile="${esc(c.mobile)}">📋 Copy</button><a class="mini-btn call" href="tel:${esc(c.mobile)}">📞 Call</a></span></div>
    <div class="kv"><span class="k">Cheez</span><span class="v">${esc(c.item_name || '-')}</span></div>
    ${c.imei ? `<div class="kv"><span class="k">IMEI/Serial</span><span class="v">${esc(c.imei)}</span></div>` : ''}
    <div class="kv"><span class="k">Kul Qeemat</span><span class="v">${rs(c.total_price)}</span></div>
    <div class="kv"><span class="k">Advance</span><span class="v">${rs(c.advance)}</span></div>
    <div class="kv"><span class="k">Jama ho gaya</span><span class="v" style="color:var(--green-d)">${rs(d.totals.paid)}</span></div>
    <div class="kv"><span class="k">Baqi</span><span class="v" style="color:var(--red)">${rs(d.totals.remaining)}</span></div>
    ${c.guarantor_name ? `<div class="kv"><span class="k">Guarantor</span><span class="v">${esc(c.guarantor_name)} (${esc(c.guarantor_mobile)})<button class="mini-btn copy" data-copyfile="${esc(c.guarantor_mobile)}">📋 Copy</button></span></div>` : ''}
    ${c.cnic ? `<div class="kv"><span class="k">CNIC</span><span class="v">${esc(c.cnic)}</span></div>` : ''}
    ${c.address ? `<div class="kv"><span class="k">Address</span><span class="v">${esc(c.address)}</span></div>` : ''}
  </div>
  <div class="card">
    <h3 style="margin-bottom:6px">💰 Qist Jama Karein</h3>
    <div class="err" id="pay-err"></div>
    <label class="f">Rakam (Rs.) — baqi: ${rs(d.totals.remaining)}</label>
    <input id="pay-amount" type="number" inputmode="numeric" placeholder="Masalan: 7500">
    <button class="btn orange" id="pay-btn">Ek Tap — Jama Karein</button>
    <p class="muted mt">Paisa sab se purani qist mein pehle bhara jata hai. Aadhi qist bhi chalegi.</p>
  </div>
  <div class="card">
    <h3 style="margin-bottom:8px">📋 Qiston ka Plan</h3>
    <table class="plan"><tr><th>#</th><th>Tareekh</th><th>Qist</th><th>Jama</th><th>Halat</th></tr>
    ${d.installments.map(i => `<tr><td>${i.seq}</td><td>${i.due_date}</td><td>${rs(i.amount)}</td><td>${rs(i.paid)}</td><td>${statusBadge(i.status)}</td></tr>`).join('')}
    </table>
  </div>
  <div class="card">
    <h3 style="margin-bottom:8px">🧾 Payment History</h3>
    ${d.payments.length ? d.payments.map(p => `
      <div class="kv"><span class="k">${p.paid_at}</span>
      <span class="v">${rs(p.amount)} <button class="del-btn" data-delpay="${p.id}">✕ Delete</button></span></div>`).join('')
      : '<p class="muted">Abhi koi payment nahi aayi</p>'}
    <p class="muted mt">Galti ho jaye to payment delete karein — hisaab khud pehle jaisa ho jayega.</p>
  </div>`;
  $('file-body').innerHTML = html;
  showView('file');

  document.querySelectorAll('[data-copyfile]').forEach(b =>
    b.onclick = () => copyNumber(b.dataset.copyfile, b));

  $('pay-btn').onclick = async () => {
    showErr('pay-err', '');
    try {
      await api(`/api/customers/${id}/payments`, { method: 'POST',
        body: JSON.stringify({ amount: $('pay-amount').value }) });
      openFile(id);
    } catch (e) { showErr('pay-err', e.message); }
  };
  document.querySelectorAll('[data-delpay]').forEach(b => b.onclick = async () => {
    if (!confirm('Ye payment delete kar dein? Hisaab pehle jaisa ho jayega.')) return;
    try { await api('/api/payments/' + b.dataset.delpay, { method: 'DELETE' }); openFile(id); }
    catch (e) { alert(e.message); }
  });
}

// ---------------- start: pehle se login hai?
(async () => {
  try {
    const me = await api('/api/me');
    if (me.role === 'shop') { $('shop-name').textContent = me.shop.name; enterApp(); }
  } catch { /* login screen dikhao */ }
})();
