# Qist Wasooli — Guide

Qiston (installments) par cheezein bechne wali dukaanon ke liye hisaab ka system.
Dukaan dar kagaz ki copy ki jagah mobile par: customer add kare, qist jama kare,
late walon ki list dekhe. Owner (admin) saari dukaanain, fee aur kul hisaab dekhe.

**Khaas baat:** is system ko chalane ke liye sirf **Node.js** chahiye — koi library,
koi install, koi fees nahi. Code saaf aur saada rakha hai taake kal koi bhi
developer isay sambhal sake.

---

## 1. Chalana kaise hai

```
node server.js
```

Phir browser me:
- **Dukaan dar ke liye:** `http://<server-ka-address>:3000/`
- **Owner ke liye:** `http://<server-ka-address>:3000/owner`

Port badalna ho to: `PORT=8080 node server.js`

## 2. Pehle login

**Owner (pehli baar):**
- Login ID: `jafran`
- Password: `QistOwner#2026`
- ⚠️ **Pehle login ke baad Owner Dashboard → Settings → Password Badlein** se
  apna password lazmi badal lein.

(Server lagate waqt `QW_OWNER_PASSWORD` de kar apna pehla password bhi tay kiya ja
sakta hai — phir ye wala kaam nahi karega.)

## 3. Dukaan kaise banani hai (Owner)

1. Owner login karein → **Nayi Dukaan Banaein** wala hissa.
2. Dukaan ka naam, maalik ka naam, mobile number aur login password likhein.
3. **Dukaan Banaein** dabate hi dukaan ka login foran chal jata hai.
4. Dukaan dar ko bas yahi batana hai: *link kholo → apna mobile number +
   password likho → andar.*

Dukaan ki pehli fee ki akhri tareekh khud bakhud **ek mahina aage** lag jati hai.

## 4. Fee ka hisaab (Owner)

- Har dukaan ke card par **Fee ki akhri tareekh** nazar aati hai.
- Fee mil jaye to **"💰 Fee Aa Gayi (+1 Mahina)"** dabate hi tareekh ek mahina
  aage chali jati hai. Kuch likhne ki zaroorat nahi.
- Fee na mile aur dukaan band karni ho to **"🚫 Band Karein"** — dukaan dar login
  nahi kar sakega, lekin **us ka data bilkul mehfooz rehta hai**. Fee aate hi
  **"✅ Khol Dein"** dabane par sab waisa ka waisa wapas milta hai.
- Mahana fee ki rakam **Settings** me ek jagah se badli ja sakti hai
  (shuru me Rs. 6,999). Owner ki kul mahana kamai Dashboard par khud banti hai.

## 5. Dukaan dar ka roz ka kaam

- **Aaj Ka Kaam:** aaj jin ki qist hai un ki list, aaj ka kul paisa, is mahine ka
  aana tha / aa gaya, aur phansa hua paisa.
- **Late List:** tareekh guzarne wale — sab se purana upar. 7+ din = peela nishan,
  30+ din = lal nishan. Har customer ke aage **Call** ka button hai — aur har number ke sath **Copy** ka button bhi: number copy karke dialer ya WhatsApp me paste kar sakte hain.
- **Naya Customer:** naam, mobile, cheez, qeemat, advance, mahine — bas.
  Qiston ka plan khud ban jata hai. Agar hisaab barabar na baithe to farq akhri
  qist me khud adjust ho jata hai — kul rakam 1 rupaya bhi idhar udhar nahi hoti.
- **Qist Jama:** customer ki file kholo → rakam likho → **Jama Karein**.
  Paisa sab se purani qist me pehle bharta hai (aadhi qist bhi chalti hai).
  Baqi se zyada rakam system likhne hi nahi deta.
- **Galti ho jaye:** Payment History me us payment ko **Delete** kar do —
  hisaab khud pehle jaisa ho jayega.
- **Search:** Customers wali screen par naam ya mobile likhte hi customer
  nikal aata hai.

Phone ki home screen par icon lagana: browser ke menu se
**"Add to Home screen"** — phir app ki tarah khulega.

## 6. Backup kahan hota hai

- Data is file me rehta hai: `data/qist.db`
- Roz khud bakhud backup banta hai: `data/backups/` me (akhri 14 din ke rehte hain).
- Owner Dashboard → Settings → **Backup Download Karein** se kabhi bhi copy
  apne paas rakhi ja sakti hai.
- Server badalna ho to bas poora `qist-wasooli` folder naye server par rakh kar
  `node server.js` chalana hai — data sath chalta hai.

## 7. Hifazat (Security)

- Saare password **hashed** hain — na page ke code me, na database me asli
  password nazar aata hai.
- Login server par check hota hai, sirf browser me nahi.
- Har dukaan ka data us ke login se bandha hai — ek dukaan dusri ka data
  kisi surat nahi dekh sakti (na screen par, na link badal kar).

## 8. Test report

Brief (Part F) ki 14 teston ki khud bakhud report:

```
node tests/run-tests.js
```

2026-10-14 ko chalai gayi: **14/14 PASS** — login ki hifazat, dukaanon ki
alag data wali deewaar, dono plan hisaab (7500 wala aur 90000/7 wala),
FIFO jama, zyada rakam par rok, delete par hisaab wapas, late/lal nishan,
search, fee +1 mahina, band/khol par data mehfooz, aur owner totals —
sab haath ke hisaab se mile.

## 9. Files ka naqsha

```
server.js            — poora backend (login, hisaab, database)
public/index.html    — dukaan dar ki screens
public/app.js        — dukaan dar ka logic
public/owner.html    — owner dashboard
public/owner.js      — owner ka logic
public/style.css     — design (mobile-first)
data/qist.db         — database (khud banti hai)
data/backups/        — roz ke backup
tests/run-tests.js   — 14 teston ki report
```

## 8. PDF, Hisaab aur Photo (naye features)

- **Dukaan ka PDF:** Dukaan dar jab chahe "Poora Data PDF" button se apne saaray customers ka hisaab ek PDF me download kar sakta hai — phone par khul jati hai.
- **Owner ki PDF report:** Owner dashboard se "PDF Report" download hoti hai (saari dukaanon ka hisaab). Purani .db wali file ab "Backup File (.db)" ke naam se alag hai — wo sirf technical kaam ke liye hai.
- **Khud bakhud PDF:** Roz ke backup ke sath har dukaan ka PDF bhi `data/backups/pdf-<tareekh>/` me khud ban jata hai — app ko kuch ho jaye to parhne wala record mehfooz rehta hai.
- **Har customer ka saaf hisaab:** Customer File me "Is Mahinay Ka Hisaab" wala card har customer ka alag hisaab dikhata hai — har mahine ki qist kitni hai, is mahine ki qist mili ya nahi, kul kitni qistein baqi hain.
- **Photo:** Customer File me customer ki photo aur cheez (item) ki photo lagayi ja sakti hai, badli aur hatayi bhi ja sakti hai. Photo sirf usi dukaan ko dikhti hai jis ka customer hai.

## Data storage (2026-10-15 se)

- **Vercel par:** data **Turso** (hosted SQLite) me rehta hai — env `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` (Vercel project se jude hue, free Starter plan: 5GB). Site redeploy ho ya band ho, data mehfooz rehta hai.
- **Client ke apne server par:** wahi purana tareeqa — local `data/qist.db` file (koi env na ho to yehi chalta hai).
- **Backup:** Owner dashboard se database download (hosted mode me JSON, local mode me .db file). Is ke ilawa Turso apni copy rakhta hai.
- **Dukaan hatana:** Owner API `DELETE /api/owner/shops/<id>` — dukaan ka saara data sath saaf ho jata hai.
