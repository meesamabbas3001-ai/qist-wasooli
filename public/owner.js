/* Qist Wasooli — owner dashboard */
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
function msg(id, text) { const e = $(id); e.textContent = text; e.style.display = text ? 'block' : 'none'; }

// Dukaan dar ka number copy karna (fee ke liye call/WhatsApp karne ke kaam)
async function copyNum(num, btn) {
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
  if (btn) { const old = btn.textContent; btn.textContent = '✓ Copy'; setTimeout(() => btn.textContent = old, 1600); }
}

$('login-btn').onclick = async () => {
  msg('login-err', '');
  try {
    await api('/api/owner/login', { method: 'POST', body: JSON.stringify({
      login: $('login-id').value.trim(), password: $('login-pass').value }) });
    enterApp();
  } catch (e) { msg('login-err', e.message); }
};
$('login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') $('login-btn').click(); });
$('logout-btn').onclick = async () => { await api('/api/logout', { method: 'POST' }); location.reload(); };

function enterApp() {
  $('login-screen').classList.add('hidden');
  $('app').classList.remove('hidden');
  loadAll();
}

async function loadAll() {
  const t = await api('/api/owner/totals');
  $('t-shops').textContent = t.shops;
  $('t-customers').textContent = t.customers;
  $('t-stuck').textContent = rs(t.stuck);
  $('t-income').textContent = rs(t.monthlyFeeIncome);
  $('fee-amount').value = t.fee_amount;

  const d = await api('/api/owner/shops');
  const box = $('shops-list');
  if (!d.shops.length) { box.innerHTML = '<div class="empty">Abhi koi dukaan nahi — upar se pehli dukaan banaein</div>'; return; }
  box.innerHTML = '';
  for (const s of d.shops) {
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div><b style="font-size:18px">${esc(s.name)}</b>
          ${s.active ? '<span class="badge green">Khuli hai</span>' : '<span class="badge red">Band hai</span>'}<br>
          <span class="muted">${esc(s.owner_name)} · ${esc(s.mobile)}</span>
          <button class="mini-btn copy" data-copyshop="${esc(s.mobile)}">📋 Copy</button></div>
      </div>
      <div class="kv"><span class="k">Customers</span><span class="v">${s.customers}</span></div>
      <div class="kv"><span class="k">Phansa hua (late)</span><span class="v" style="color:var(--red)">${rs(s.stuck)}</span></div>
      <div class="kv"><span class="k">Is mahine wasooli</span><span class="v" style="color:var(--green-d)">${rs(s.collected)}</span></div>
      <div class="kv"><span class="k">Fee ki akhri tareekh</span><span class="v">${esc(s.fee_due_date)}</span></div>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <button class="btn small" data-fee="${s.id}">💰 Fee Aa Gayi (+1 Mahina)</button>
        <button class="btn small ${s.active ? 'danger' : ''}" data-toggle="${s.id}">${s.active ? '🚫 Band Karein' : '✅ Khol Dein'}</button>
      </div>`;
    box.appendChild(el);
  }
  box.querySelectorAll('[data-copyshop]').forEach(b => b.onclick = () => copyNum(b.dataset.copyshop, b));
  box.querySelectorAll('[data-fee]').forEach(b => b.onclick = async () => {
    try { const r = await api(`/api/owner/shops/${b.dataset.fee}/fee-paid`, { method: 'POST' });
      alert('Fee jama! Nayi akhri tareekh: ' + r.fee_due_date); loadAll(); }
    catch (e) { alert(e.message); }
  });
  box.querySelectorAll('[data-toggle]').forEach(b => b.onclick = async () => {
    try { await api(`/api/owner/shops/${b.dataset.toggle}/toggle`, { method: 'POST' }); loadAll(); }
    catch (e) { alert(e.message); }
  });
}

$('shop-btn').onclick = async () => {
  msg('shop-err', ''); msg('shop-ok', '');
  try {
    const d = await api('/api/owner/shops', { method: 'POST', body: JSON.stringify({
      name: $('s-name').value, owner_name: $('s-owner').value,
      mobile: $('s-mobile').value, password: $('s-pass').value }) });
    msg('shop-ok', `✅ Dukaan ban gayi! Fee ki pehli akhri tareekh: ${d.fee_due_date}. Dukaan dar abhi login kar sakta hai.`);
    for (const id of ['s-name','s-owner','s-mobile','s-pass']) $(id).value = '';
    loadAll();
  } catch (e) { msg('shop-err', e.message); }
};

$('fee-btn').onclick = async () => {
  try { await api('/api/owner/settings', { method: 'POST',
    body: JSON.stringify({ fee_amount: $('fee-amount').value }) });
    msg('fee-ok', '✅ Fee save ho gayi'); loadAll(); }
  catch (e) { alert(e.message); }
};

$('pw-btn').onclick = async () => {
  msg('pw-err', ''); msg('pw-ok', '');
  try { await api('/api/owner/change-password', { method: 'POST', body: JSON.stringify({
    old_password: $('pw-old').value, new_password: $('pw-new').value }) });
    msg('pw-ok', '✅ Password badal gaya'); $('pw-old').value = ''; $('pw-new').value = ''; }
  catch (e) { msg('pw-err', e.message); }
};

(async () => {
  try { const me = await api('/api/me'); if (me.role === 'owner') enterApp(); }
  catch { /* login screen */ }
})();
