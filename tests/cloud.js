/* Cloud-mode test against the Firebase Emulator Suite (needs Java 11+ and firebase-tools).
   Start the emulators from the project root first (uses firebase.json + firestore.rules):
     npx firebase-tools emulators:start --only auth,firestore --project demo-tcs
   then:  node tests/cloud.js     (the page is opened with ?emu, which uses a demo config + the local emulators)
   Exit code 0 = all passed. */
const http = require('http');
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { try { ({ chromium } = require('playwright-core')); } catch (e2) { console.error('playwright not found'); process.exit(2); } }

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const PROJECT = 'demo-tcs';
const results = [];
function check(name, ok, info) { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '  ' + JSON.stringify(info) : '')); }

function serve() {
  return new Promise(res => {
    const srv = http.createServer((req, resp) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { resp.writeHead(404); resp.end(); return; }
      resp.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(resp);
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}
function req(method, url) {
  return new Promise((res, rej) => {
    const r = http.request(url, { method, headers: { Authorization: 'Bearer owner' } }, resp => { resp.resume(); resp.on('end', () => res(resp.statusCode)); });
    r.on('error', rej); r.end();
  });
}
const benign = t => /fonts\.(googleapis|gstatic)\.com|ERR_INTERNET|permission|PERMISSION_DENIED|Could not reach Cloud Firestore backend|firebasejs|net::ERR_FAILED|insufficient permissions|400 \(Bad Request\)/i.test(t);

(async () => {
  try {
    await req('DELETE', `http://127.0.0.1:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`);
    await req('DELETE', `http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/accounts`);
  } catch (e) { console.error('Emulators not reachable on 127.0.0.1:9099 / :8080. Start them first (see header).'); process.exit(2); }

  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch({ args: ARGS });
  const errs = [];
  async function device(url) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    page.on('console', m => { if (m.type() === 'error' && !benign(m.text())) errs.push(m.text()); });
    page.on('pageerror', e => errs.push('pageerror: ' + e.message));
    await page.goto(base + (url || '?emu'));
    await page.waitForFunction(() => window.TCS && TCS.ready && TCS.menu.screen, null, { timeout: 60000 });
    return { ctx, page };
  }
  async function form(page, isCreate, user, pass) {
    if (await page.evaluate(() => TCS.menu.screen) !== 'auth') await page.evaluate(() => TCS.menu.open('auth'));
    await page.click(isCreate ? '[data-act=create]' : '[data-act=login]');
    await page.fill('#m-user', user); await page.fill('#m-pass', pass);
    if (isCreate) await page.fill('#m-pass2', pass);
    await page.click('button[type=submit]');
  }
  const toProfiles = page => page.waitForFunction(() => TCS.menu.screen === 'profiles', null, { timeout: 20000 });
  const loaded = page => page.waitForFunction(() => TCS.state.loaded && !TCS.paused, null, { timeout: 20000 });
  const cloudDoc = (page, uid, slot) => page.evaluate(async ([uid, slot]) => {
    const F = TCS.fb.F, db = F.getFirestore(TCS.fb.app);
    const s = await F.getDoc(F.doc(db, 'users', uid, 'slots', String(slot)));
    return s.exists() ? Object.assign(s.data(), { parsed: JSON.parse(s.data().data) }) : null;
  }, [uid, slot]);

  let failed = false;
  try {
    const user = 'Cloud_' + Date.now().toString(36).slice(-5), pass = 'maple123';

    // ---- device A: sign up, play, save
    const A = await device();
    check('cloud mode active with ?emu', await A.page.evaluate(() => TCS.cloud.active && !!TCS.fb));
    await form(A.page, true, user, '12345');
    await A.page.waitForTimeout(300);
    check('password needs 6 characters', /6 characters/.test(await A.page.textContent('.menu-err[data-for="m-pass"]')));
    await A.page.fill('#m-pass', pass); await A.page.fill('#m-pass2', pass); await A.page.click('button[type=submit]');
    await toProfiles(A.page);
    check('status icon shown next to name', await A.page.$('.menu-head .cloud-ico') !== null);
    const uidA = await A.page.evaluate(() => TCS.cloud.uid);
    await A.page.click('.slot-empty[data-slot="0"]');
    await loaded(A.page);
    await A.page.evaluate(async () => {
      const S = TCS.state; S.addWood(5e5); S.buy('rookie', 10); S.renameSlot(S.profile.username, 0, 'Phone Test'); S.data.profileName = 'Phone Test';
      S.save(); await TCS.cloud.flush();
    });
    const woodA = await A.page.evaluate(() => TCS.state.data.wood);
    await A.page.evaluate(() => TCS.menu.logout());
    await A.page.waitForTimeout(800);
    const docA = await (async () => { const d = await device(); await form(d.page, false, user, pass); await toProfiles(d.page); const r = await cloudDoc(d.page, uidA, 0); await d.ctx.close(); return r; })();
    check('save reached Firestore', docA && docA.profileName === 'Phone Test' && Math.abs(docA.wood - woodA) < woodA * 0.01 + 50, docA && { w: docA.wood, woodA });

    // duplicate name (different case) is rejected
    const D = await device();
    await form(D.page, true, user.toUpperCase(), 'another1');
    await D.page.waitForTimeout(1500);
    check('username taken (case-insensitive)', /taken/i.test(await D.page.textContent('.menu-err[data-for="m-user"]')));
    await form(D.page, false, user, 'wrongpass');
    await D.page.waitForTimeout(1500);
    check('wrong password message', (await D.page.textContent('.menu-err-form')) === 'Wrong username or password');
    await D.ctx.close();

    // ---- device B (fresh storage): sign in, same profile + wood, welcome-back card
    await new Promise(r => setTimeout(r, 7000));  // be "away" for a few seconds
    const B = await device();
    await form(B.page, false, user.toLowerCase(), pass);
    await toProfiles(B.page);
    await B.page.waitForFunction(() => !!document.querySelector('.slot[data-slot="0"] .slot-name'), null, { timeout: 15000 });
    check('device B sees the cloud profile', await B.page.inputValue('.slot[data-slot="0"] .slot-name') === 'Phone Test');
    await B.page.click('.slot[data-slot="0"] [data-act=play]');
    await loaded(B.page);
    const b = await B.page.evaluate(() => ({ wood: TCS.state.data.wood, rookie: TCS.state.data.owned.rookie, pend: TCS.state.data.pendingOffline && TCS.state.data.pendingOffline.amount }));
    check('device B has the same wood + upgrades', Math.abs(b.wood - woodA) < woodA * 0.01 + 50 && b.rookie === 10, b);
    await B.page.waitForTimeout(1500);
    check('welcome-back card on device B', b.pend > 0 && await B.page.$('#offline-card') !== null, b);
    await B.page.evaluate(async () => { TCS.ui._collectOffline(); await new Promise(r => setTimeout(r, 300)); await TCS.cloud.flush(); });
    await B.page.waitForTimeout(800);
    const docB = await cloudDoc(B.page, uidA, 0);
    check('collect clears pending in the cloud', docB && !docB.parsed.pendingOffline, docB && docB.parsed.pendingOffline);

    // ---- admin Shiv grants wood to B while B is playing
    const Z = await device();
    await form(Z.page, true, 'Shiv', 'admin123');
    await toProfiles(Z.page);
    await Z.page.click('.slot-empty[data-slot="0"]');
    await loaded(Z.page);
    await Z.page.waitForFunction(() => TCS.state.isAdmin(), null, { timeout: 10000 });
    const rows = await Z.page.evaluate(() => TCS.state.adminTargets());
    const row = rows.find(r => r.username === user && r.slot === 0);
    check('admin lists other players', !!row, rows.map(r => r.username));
    const search = await Z.page.evaluate(u => TCS.state.adminTargets(u), user.toLowerCase());
    check('admin username search', search.length === 1 && search[0].key === uidA);
    const before = await B.page.evaluate(() => TCS.state.data.wood);
    const G = 7.5e9;
    check('admin grant written', await Z.page.evaluate(([k, n]) => TCS.state.adminGiveWood(k, 0, n), [row.key, G]));
    await B.page.waitForFunction(g => TCS.state.data.wood >= g, G, { timeout: 15000 }).catch(() => {});
    const after = await B.page.evaluate(() => TCS.state.data.wood);
    check('grant arrives on the running client', after - before >= G, { before, after });
    await B.page.evaluate(async () => { TCS.state.save(); await TCS.cloud.flush(); });
    await B.page.waitForTimeout(1000);
    const docG = await cloudDoc(B.page, uidA, 0);
    check('grant not overwritten in the cloud save', docG && docG.wood >= G, docG && docG.wood);
    const left = await B.page.evaluate(async uid => { const F = TCS.fb.F, db = F.getFirestore(TCS.fb.app); return (await F.getDocs(F.collection(db, 'users', uid, 'grants'))).size; }, uidA);
    check('grant consumed (deleted)', left === 0, left);

    // ---- rules: a normal player can't read others' saves / write grants / claim names
    const uidZ = await Z.page.evaluate(() => TCS.cloud.uid);
    const denied = await B.page.evaluate(async uidZ => {
      const F = TCS.fb.F, db = F.getFirestore(TCS.fb.app), out = {};
      const t = async (k, fn) => { try { await fn(); out[k] = 'allowed'; } catch (e) { out[k] = e.code || e.message; } };
      await t('readOther', () => F.getDoc(F.doc(db, 'users', uidZ, 'slots', '0')));
      await t('groupQuery', () => F.getDocs(F.query(F.collectionGroup(db, 'slots'), F.limit(5))));
      await t('grant', () => F.addDoc(F.collection(db, 'users', TCS.cloud.uid, 'grants'), { slot: 0, amount: 1e9, by: TCS.cloud.uid, at: F.serverTimestamp() }));
      await t('claimName', () => F.setDoc(F.doc(db, 'usernames', 'someoneelse'), { uid: TCS.cloud.uid, username: 'someoneelse' }));
      await t('writeOther', () => F.setDoc(F.doc(db, 'users', uidZ, 'slots', '1'), { x: 1 }));
      await t('readOwn', () => F.getDoc(F.doc(db, 'users', TCS.cloud.uid, 'slots', '0')));
      return out;
    }, uidZ);
    check('rules deny non-admin access', ['readOther', 'groupQuery', 'grant', 'claimName', 'writeOther'].every(k => denied[k] === 'permission-denied') && denied.readOwn === 'allowed', denied);

    // ---- stays logged in across reload; rename + delete hit the cloud
    await B.page.evaluate(() => TCS.menu.switchProfile());
    await B.page.reload();
    await B.page.waitForFunction(() => window.TCS && TCS.ready && TCS.menu.screen === 'profiles', null, { timeout: 30000 }).catch(async e => { console.log('screen', await B.page.evaluate(() => JSON.stringify([!!window.TCS, window.TCS && TCS.ready, window.TCS && TCS.menu && TCS.menu.screen, window.TCS && TCS.cloud && TCS.cloud.uid])).catch(x => 'ERR ' + x.message)); throw e; });
    check('stays logged in after reload', await B.page.evaluate(() => TCS.cloud.uid) === uidA);
    await B.page.click('.slot-empty[data-slot="1"]'); await loaded(B.page);
    await B.page.evaluate(() => TCS.menu.switchProfile());
    await B.page.waitForTimeout(1500);
    await B.page.evaluate(() => TCS.state.deleteSlot(TCS.cloud.username, 1));
    await B.page.waitForTimeout(1000);
    check('delete removes the cloud slot', (await cloudDoc(B.page, uidA, 1)) === null);
    await B.page.evaluate(() => TCS.menu.logout());
    check('log out signs out', await B.page.evaluate(() => !TCS.cloud.uid && TCS.menu.screen === 'auth'));

    // ---- migration: a local account on this device moves to the cloud on first cloud login
    const M = await device('');   // local mode (no ?emu)
    const mu = 'local_' + Date.now().toString(36).slice(-4);
    await form(M.page, true, mu, 'birch123'); await toProfiles(M.page);
    await M.page.click('.slot-empty[data-slot="0"]'); await loaded(M.page);
    await M.page.evaluate(() => { TCS.state.addWood(4242); TCS.state.save(); TCS.menu.logout(); });
    await M.page.goto(base + '?emu');
    await M.page.waitForFunction(() => window.TCS && TCS.ready && TCS.menu.screen, null, { timeout: 60000 });
    await form(M.page, false, mu, 'birch123');
    await toProfiles(M.page);
    const muid = await M.page.evaluate(() => TCS.cloud.uid);
    await M.page.waitForTimeout(1500);
    const md = await cloudDoc(M.page, muid, 0);
    check('local account migrated with its slots', !!muid && md && md.wood >= 4242, md && md.wood);

    // ---- offline: SDK blocked -> plays from the local cache with the remembered session
    const O = await device();
    await form(O.page, false, user, pass); await toProfiles(O.page);
    await O.page.waitForTimeout(1500);
    await O.ctx.route('**/www.gstatic.com/**', r => r.abort());
    await O.page.reload();
    await O.page.waitForFunction(() => window.TCS && TCS.ready && TCS.menu.screen === 'profiles', null, { timeout: 30000 });
    const off = await O.page.evaluate(() => ({ fb: !!TCS.fb, uid: TCS.cloud.uid, ico: !!document.querySelector('.cloud-ico.off'), info: TCS.state.slotInfo(TCS.cloud.username, 0) }));
    check('offline: cached session + slots, offline icon', !off.fb && off.uid === uidA && off.ico && off.info && off.info.wood >= G, off);
    await O.ctx.close();

    check('no unexpected console errors', errs.length === 0, errs.slice(0, 5));
  } catch (e) { console.error(e); failed = true; }
  await browser.close(); srv.close();
  console.log('\n' + results.filter(r => r.ok).length + '/' + results.length + ' checks passed');
  process.exit(failed || results.some(r => !r.ok) ? 1 : 0);
})();
