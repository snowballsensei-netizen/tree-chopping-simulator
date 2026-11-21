/* Cloud-mode test against the Firebase Emulator Suite (needs Java 11+ and firebase-tools).
   Start the emulators from the project root first (uses firebase.json + firestore.rules):
     npx firebase-tools emulators:start --only auth,firestore --project demo-tcs
   then:  node tests/cloud.js     (the page is opened with ?emu, which uses a demo config + the local emulators)
   SHOTS=<dir> also saves duel screenshots (desktop logs duel seen by Q/winner + P/loser, phone 390x844 acorn duel seen by P/winner + Q/loser).
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
    if (!process.env.DUELS_ONLY) {   // DUELS_ONLY=1 runs just the friends/duels part

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

    // ---- admin gives acorns, takes logs, takes acorns (never below 0)
    const a0 = await B.page.evaluate(() => ({ w: TCS.state.data.wood, a: TCS.state.data.acorns || 0, e: TCS.state.data.acornsEarned || 0 }));
    check('admin give acorns written', await Z.page.evaluate(k => TCS.state.adminAdjust(k, 0, 'acorns', 12), row.key));
    await B.page.waitForFunction(a => (TCS.state.data.acorns || 0) >= a + 12, a0.a, { timeout: 15000 }).catch(() => {});
    const a1 = await B.page.evaluate(() => ({ w: TCS.state.data.wood, a: TCS.state.data.acorns, e: TCS.state.data.acornsEarned }));
    check('acorns arrive (spendable + bonus)', a1.a === a0.a + 12 && a1.e === a0.e + 12, { a0, a1 });
    check('admin take logs written', await Z.page.evaluate(k => TCS.state.adminAdjust(k, 0, 'logs', -1e9), row.key));
    check('admin take acorns written', await Z.page.evaluate(k => TCS.state.adminAdjust(k, 0, 'acorns', -5), row.key));
    await B.page.waitForFunction(([w, a]) => TCS.state.data.wood <= w - 1e9 + 1e6 && TCS.state.data.acorns === a - 5, [a1.w, a1.a], { timeout: 15000 }).catch(() => {});
    const a2 = await B.page.evaluate(() => ({ w: TCS.state.data.wood, a: TCS.state.data.acorns, e: TCS.state.data.acornsEarned }));
    check('logs + acorns taken on the running client', a2.w <= a1.w - 1e9 + 1e6 && a2.a === a1.a - 5 && a2.e === a1.e - 5, { a1, a2 });
    check('take never below 0', await Z.page.evaluate(k => TCS.state.adminAdjust(k, 0, 'acorns', -1e6), row.key) &&
      await B.page.waitForFunction(() => TCS.state.data.acorns === 0, null, { timeout: 15000 }).then(() => true, () => false));

    // ---- rules: a normal player can't read others' saves / write grants / claim names
    const uidZ = await Z.page.evaluate(() => TCS.cloud.uid);
    const denied = await B.page.evaluate(async uidZ => {
      const F = TCS.fb.F, db = F.getFirestore(TCS.fb.app), out = {};
      const t = async (k, fn) => { try { await fn(); out[k] = 'allowed'; } catch (e) { out[k] = e.code || e.message; } };
      await t('readOther', () => F.getDoc(F.doc(db, 'users', uidZ, 'slots', '0')));
      await t('groupQuery', () => F.getDocs(F.query(F.collectionGroup(db, 'slots'), F.limit(5))));
      await t('grant', () => F.addDoc(F.collection(db, 'users', TCS.cloud.uid, 'grants'), { slot: 0, amount: 1e9, by: TCS.cloud.uid, at: F.serverTimestamp() }));
      await t('grantAcorns', () => F.addDoc(F.collection(db, 'users', TCS.cloud.uid, 'grants'), { slot: 0, amount: 50, kind: 'acorns', by: TCS.cloud.uid, at: F.serverTimestamp() }));
      await t('takeFromOther', () => F.addDoc(F.collection(db, 'users', uidZ, 'grants'), { slot: 0, amount: -1e9, kind: 'logs', by: TCS.cloud.uid, at: F.serverTimestamp() }));
      await t('claimName', () => F.setDoc(F.doc(db, 'usernames', 'someoneelse'), { uid: TCS.cloud.uid, username: 'someoneelse' }));
      await t('writeOther', () => F.setDoc(F.doc(db, 'users', uidZ, 'slots', '1'), { x: 1 }));
      await t('readOwn', () => F.getDoc(F.doc(db, 'users', TCS.cloud.uid, 'slots', '0')));
      return out;
    }, uidZ);
    check('rules deny non-admin access', ['readOther', 'groupQuery', 'grant', 'grantAcorns', 'takeFromOther', 'claimName', 'writeOther'].every(k => denied[k] === 'permission-denied') && denied.readOwn === 'allowed', denied);

    // ---- leaderboard: own doc, rules, unauthenticated read, a big player shows (highlighted) on the merged menu board
    const lbW = await B.page.evaluate(async () => {
      const ok = await TCS.leaderboard.push(true), F = TCS.fb.F, db = F.getFirestore(TCS.fb.app);
      const d = (await F.getDoc(F.doc(db, 'leaderboard', TCS.cloud.uid))).data(), s = TCS.state.data;
      return { ok, d: { username: d.username, wins: d.wins, logs: d.logs, rebirths: d.rebirths, acorns: d.acorns }, lt: s.lifetimeWood, r: s.stats.rebirths, ae: s.acornsEarned, me: TCS.cloud.username };
    });
    check('leaderboard doc written with the player values', lbW.ok && lbW.d.username === lbW.me && lbW.d.logs > 0 && lbW.d.logs <= lbW.lt && lbW.d.logs >= lbW.lt * 0.9
      && lbW.d.rebirths === lbW.r && lbW.d.acorns === lbW.ae && lbW.d.wins === 0, lbW);
    const lbRules = await B.page.evaluate(async uidZ => {
      const F = TCS.fb.F, db = F.getFirestore(TCS.fb.app), out = {}, me = TCS.cloud.uid, u = TCS.cloud.username;
      const doc = o => Object.assign({ username: u, wins: 0, logs: 1, rebirths: 0, acorns: 0, at: F.serverTimestamp() }, o);
      const t = async (k, fn) => { try { await fn(); out[k] = 'allowed'; } catch (e) { out[k] = e.code || e.message; } };
      await t('other', () => F.setDoc(F.doc(db, 'leaderboard', uidZ), doc({})));
      await t('wrongName', () => F.setDoc(F.doc(db, 'leaderboard', me), doc({ username: 'someoneelse' })));
      await t('negative', () => F.setDoc(F.doc(db, 'leaderboard', me), doc({ acorns: -1 })));
      await t('negLogs', () => F.setDoc(F.doc(db, 'leaderboard', me), doc({ logs: -5 })));
      await t('winsJump', () => F.setDoc(F.doc(db, 'leaderboard', me), doc({ wins: 500 })));
      await t('extraKey', () => F.setDoc(F.doc(db, 'leaderboard', me), doc({ x: 1 })));
      await t('delete', () => F.deleteDoc(F.doc(db, 'leaderboard', me)));
      await t('own', () => TCS.leaderboard.push(true).then(ok => { if (!ok) throw new Error('push failed'); }));
      return out;
    }, uidZ);
    check('rules: leaderboard rejects other uid / wrong name / negatives / wins jump / extra keys / delete', ['other', 'wrongName', 'negative', 'negLogs', 'winsJump', 'extraKey', 'delete'].every(k => lbRules[k] === 'permission-denied') && lbRules.own === 'allowed', lbRules);
    await B.page.evaluate(() => { TCS.state.data.lifetimeWood = 1e40; TCS.state.save(); return TCS.leaderboard.push(true); });
    await B.page.evaluate(() => { TCS.menu.switchProfile(); TCS.leaderboard.select('logs'); });
    const meRow = await B.page.waitForFunction(() => { const r = document.querySelector('.lb-card .lb-row.me'); return r && r.dataset.rank === '1' && r.querySelector('.lb-name').textContent === TCS.cloud.username && document.querySelectorAll('.lb-card .lb-row').length === 50; }, null, { timeout: 15000 }).then(() => true, () => false);
    check('big player tops the merged logs board, own row highlighted', meRow);
    const V = await device();
    const anon = await V.page.evaluate(async () => {
      const F = TCS.fb.F, db = F.getFirestore(TCS.fb.app);
      let n = -1; try { n = (await F.getDocs(F.query(F.collection(db, 'leaderboard'), F.orderBy('logs', 'desc'), F.limit(50)))).size; } catch (e) { n = e.code; }
      TCS.leaderboard.select('logs');
      return { n, uid: TCS.cloud.uid };
    });
    const seen = await V.page.waitForFunction(u => { const r = document.querySelector('.lb-card .lb-row[data-rank="1"]'); return r && r.querySelector('.lb-name').textContent === u && !r.classList.contains('me'); }, lbW.me, { timeout: 15000 }).then(() => true, () => false);
    check('unauthenticated leaderboard read + real player merged into the board', anon.n >= 1 && !anon.uid && seen, { anon, seen });
    await V.ctx.close();

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
    const M = await device('?local');   // local mode (no ?emu)
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
    await Promise.all([A, B, Z, M].map(x => x.ctx.close()));   // fewer WebGL pages for the duel part
    }

    // ---- friends + duels: two fresh accounts P and Q, plus an outsider R
    const sfx = Date.now().toString(36).slice(-5), pn = 'Pduel_' + sfx, qn = 'Qduel_' + sfx;
    const P = await device(), Q = await device();
    for (const [X, n] of [[P, pn], [Q, qn]]) {
      await form(X.page, true, n, 'duel1234'); await toProfiles(X.page);
      await X.page.click('.slot-empty[data-slot="0"]'); await loaded(X.page);
      await X.page.waitForFunction(() => TCS.friends.active, null, { timeout: 10000 });
      await X.page.evaluate(() => { window.__res = []; TCS.bus.on('duelResult', e => __res.push(e)); });
    }
    const uidP = await P.page.evaluate(() => TCS.cloud.uid), uidQ = await Q.page.evaluate(() => TCS.cloud.uid);
    const setBal = (X, w, a) => X.page.evaluate(async ([w, a]) => { const d = TCS.state.data; d.wood = w; d.acorns = a; TCS.state.save(); await TCS.friends.writePresence(); }, [w, a]);
    await setBal(P, 1e6, 50); await setBal(Q, 5e5, 20);
    check('friends button shown in cloud mode', await P.page.isVisible('.friends-btn'));
    await P.page.keyboard.press('f');
    check('F opens the friends panel', await P.page.isVisible('#friends-panel'));
    await P.page.fill('#friends-panel .fr-add', qn.toLowerCase()); await P.page.press('#friends-panel .fr-add', 'Enter');
    await Q.page.waitForFunction(u => !!TCS.friends.incoming[u], uidP, { timeout: 10000 }).catch(() => {});
    check('friend request arrives + badge dot', await Q.page.evaluate(u => !!TCS.friends.incoming[u], uidP) && await Q.page.$('.friends-btn.dot') !== null);
    await Q.page.keyboard.press('f');
    await Q.page.click('#friends-panel .fr-row.req [data-act=acc]');
    await P.page.waitForFunction(u => !!TCS.friends.friends[u], uidQ, { timeout: 10000 }).catch(() => {});
    await Q.page.waitForFunction(u => !!TCS.friends.friends[u], uidP, { timeout: 10000 }).catch(() => {});
    check('friend request accepted (both sides)', await P.page.evaluate(u => !!TCS.friends.friends[u], uidQ) && await Q.page.evaluate(u => !!TCS.friends.friends[u] && !Object.keys(TCS.friends.incoming).length, uidP));
    await P.page.keyboard.press('Escape'); await Q.page.keyboard.press('Escape');

    // insufficient funds: at send (own + opponent's published balance), at accept, and in the rules
    const bad1 = await P.page.evaluate(u => TCS.friends.challenge(u, 'logs', 5e6), uidQ);
    const bad2 = await P.page.evaluate(u => TCS.friends.challenge(u, 'logs', '600k'), uidQ);
    const bad3 = await P.page.evaluate(u => TCS.friends.challenge(u, 'acorns', 30), uidQ);
    const rulesFunds = await P.page.evaluate(async u => {
      const F = TCS.fb.F, db = F.getFirestore(TCS.fb.app);
      try { await F.addDoc(F.collection(db, 'duels'), { a: TCS.cloud.uid, b: u, aName: TCS.cloud.username, bName: 'x', kind: 'logs', amount: 9e5, status: 'pending', createdAt: F.serverTimestamp(), startAt: null, ta: null, tb: null, pa: 0, pb: 0, winner: '', endAt: null, paidA: false, paidB: false, aStage: 0, aCos: '||' }); return 'allowed'; }
      catch (e) { return e.code; }
    }, uidQ);
    // the challenger's look (aStage int 0..7 + aCos string) is validated; a doc with neither is an old-style (v1, 100-chop) duel
    const looks = await P.page.evaluate(async u => {
      const F = TCS.fb.F, db = F.getFirestore(TCS.fb.app), out = {};
      const base = () => ({ a: TCS.cloud.uid, b: u, aName: TCS.cloud.username, bName: 'x', kind: 'logs', amount: 10, status: 'pending', createdAt: F.serverTimestamp(), startAt: null, ta: null, tb: null, pa: 0, pb: 0, winner: '', endAt: null, paidA: false, paidB: false });
      const tryIt = async (k, extra) => { try { const r = await F.addDoc(F.collection(db, 'duels'), Object.assign(base(), extra)); out[k] = 'allowed'; await F.updateDoc(r, { status: 'cancelled' }).catch(() => {}); } catch (e) { out[k] = e.code; } };
      await tryIt('legacy', {});
      await tryIt('halfLook', { aStage: 2 });
      await tryIt('badStage', { aStage: 9, aCos: '||' });
      await tryIt('floatStage', { aStage: 1.5, aCos: '||' });
      await tryIt('badCos', { aStage: 2, aCos: 7 });
      await tryIt('longCos', { aStage: 2, aCos: 'x'.repeat(60) });
      await tryIt('ok', { aStage: 2, aCos: 'crown|beard|' });
      return out;
    }, uidQ);
    check('rules: invalid aStage/aCos rejected, old-style duel allowed', looks.legacy === 'allowed' && ['halfLook', 'badStage', 'floatStage', 'badCos', 'longCos'].every(k => looks[k] === 'permission-denied') && looks.ok === 'allowed', looks);
    await P.page.waitForTimeout(800);
    check('insufficient funds rejected at send (+ rules)', !bad1.ok && /not enough/i.test(bad1.error) && !bad2.ok && /match/i.test(bad2.error) && !bad3.ok && rulesFunds === 'permission-denied', { bad1, bad2, bad3, rulesFunds });
    const small = await P.page.evaluate(u => TCS.friends.challenge(u, 'logs', 1000), uidQ);
    await Q.page.waitForFunction(id => TCS.friends.duels[id], small.id, { timeout: 10000 });
    await setBal(Q, 500, 20);
    const bad4 = await Q.page.evaluate(id => TCS.friends.acceptDuel(id), small.id);
    check('insufficient funds rejected at accept', small.ok && !bad4.ok && /not enough/i.test(bad4.error), { small, bad4 });
    const R = await device(); await form(R.page, true, 'Rout_' + sfx, 'duel1234'); await toProfiles(R.page);
    const outsider = await R.page.evaluate(async id => {
      const F = TCS.fb.F, db = F.getFirestore(TCS.fb.app), out = {};
      try { await F.getDoc(F.doc(db, 'duels', id)); out.read = 'allowed'; } catch (e) { out.read = e.code; }
      try { await F.updateDoc(F.doc(db, 'duels', id), { status: 'declined' }); out.write = 'allowed'; } catch (e) { out.write = e.code; }
      return out;
    }, small.id).catch(e => ({ err: e.message }));
    check('rules: a third user cannot read/update the duel', outsider.read === 'permission-denied' && outsider.write === 'permission-denied', outsider);
    await Q.page.evaluate(id => TCS.friends.declineDuel(id), small.id);
    await P.page.waitForFunction(id => !TCS.friends.duels[id] || TCS.friends.duels[id].status === 'declined', small.id, { timeout: 10000 }).catch(() => {});
    await setBal(Q, 5e5, 20);

    // different looks: P = Redwood Valley, cowboy hat + goggles; Q = Crystal Caverns, crown + braid + rocket boots
    const setLook = (X, st, eq) => X.page.evaluate(([st, eq]) => { const d = TCS.state.data; d.speciesIndex = d.species = st; d.equipped = eq; TCS.fx.applyEquipped(); TCS.state.save(); }, [st, eq]);
    await setLook(P, 3, { hat: 'cowboy', face: 'goggles', boots: null }); await setLook(Q, 6, { hat: 'crown', face: 'braid', boots: 'rocketboots' });
    const SHOTS = process.env.SHOTS, shot = async (X, n) => { if (SHOTS) await X.page.screenshot({ path: path.join(SHOTS, n + '.png') }); };

    // logs duel: Q mashes Space and wins 200k; P barely chops
    const W = 2e5;
    const dl = await P.page.evaluate(u => TCS.friends.challenge(u, 'logs', '200k'), uidQ);
    await Q.page.waitForSelector('.duel-card', { timeout: 10000 }).catch(() => {});
    check('incoming duel card shown', dl.ok && await Q.page.$('.duel-card') !== null, dl);
    await Q.page.click('.duel-card [data-act=acc]');
    await P.page.waitForFunction(() => !!TCS.friends.live, null, { timeout: 10000 }).catch(() => {});
    await Q.page.waitForFunction(() => !!TCS.friends.live, null, { timeout: 10000 }).catch(() => {});
    check('both players enter the duel overlay', await P.page.$('#duel-ov') !== null && await Q.page.$('#duel-ov') !== null);
    const vsTxt = X => X.page.evaluate(() => { const e = document.querySelector('#duel-ov.intro .dv-vs'); return e ? e.textContent.toLowerCase() : null; });
    const vsP = await vsTxt(P), vsQ = await vsTxt(Q);
    const trk = X => X.page.evaluate(() => TCS.audio.track);
    const trP = await trk(P), trQ = await trk(Q);
    check('battle music during the duel', trP === 'battle' && trQ === 'battle', [trP, trQ]);
    check('VS intro shows both names', [vsP, vsQ].every(t => t && t.indexOf(pn.toLowerCase()) >= 0 && t.indexOf(qn.toLowerCase()) >= 0 && /vs/.test(t)), [vsP, vsQ]);
    await Q.page.waitForTimeout(700); await shot(Q, 'duel-desktop-1-vs');
    const seen = X => X.page.evaluate(() => { const s = TCS.duel3d.sides; return s && { active: TCS.duel3d.active, me: [s.me.stage, s.me.cos], op: [s.op.stage, s.op.cos] }; });
    const sp = await seen(P), sq = await seen(Q);
    check('both clients see the opponent\'s stage + cosmetics', sp && sq && sp.active && sq.active
      && sp.me[0] === 3 && sp.op[0] === 6 && sp.op[1].hat === 'crown' && sp.op[1].face === 'braid' && sp.op[1].boots === 'rocketboots'
      && sq.me[0] === 6 && sq.op[0] === 3 && sq.op[1].hat === 'cowboy' && sq.op[1].face === 'goggles' && !sq.op[1].boots, { sp, sq });
    const preChop = await Q.page.evaluate(() => TCS.friends.chop());
    // READY -> SET -> GO! (GO! only once chops count)
    const words = []; let goLive = null;
    for (let tEnd = Date.now() + 4300; Date.now() < tEnd;) {
      const w = await Q.page.evaluate(() => { const b = document.querySelector('.dv-big'); return { t: b ? b.textContent : '', live: !!TCS.friends.live && performance.now() >= TCS.friends.live.goAt }; });
      if (w.t && words[words.length - 1] !== w.t) { words.push(w.t); if (w.t === 'SET' && SHOTS) { await Q.page.waitForTimeout(350); await shot(Q, 'duel-desktop-1b-set'); } if (w.t === 'GO!') goLive = w.live; }
      await Q.page.waitForTimeout(80);
    }
    check('READY / SET / GO! countdown, GO! when chopping opens', words.join(',') === 'READY,SET,GO!' && goLive === true, { words, goLive });
    // a cheating finish (250 chops right after GO) is rejected by the rules' click-rate cap
    const cheat = await P.page.evaluate(async id => {
      const F = TCS.fb.F, db = F.getFirestore(TCS.fb.app);
      try { await F.updateDoc(F.doc(db, 'duels', id), { status: 'done', winner: TCS.cloud.uid, endAt: F.serverTimestamp(), pa: 250, ta: F.serverTimestamp() }); return 'allowed'; } catch (e) { return e.code; }
    }, dl.id);
    const burst = await Q.page.evaluate(() => { let n = 0; for (let i = 0; i < 60; i++) if (TCS.friends.chop()) n++; return n; });
    check('anti-cheat: no chops before GO, burst capped, rules reject a fake finish', !preChop && burst <= 20 && cheat === 'permission-denied', { preChop, burst, cheat });
    await Q.page.waitForTimeout(1000);
    const t0 = Date.now(); let over = null;
    for (let i = 0; i < 700; i++) {
      if (await Q.page.evaluate(() => !TCS.friends.live || TCS.friends.live.mine >= TCS.data.DUEL_HP)) break;
      await Q.page.keyboard.press('Space'); if (i % 8 === 0) await P.page.keyboard.press('Space');
      if (i === 120) await shot(Q, 'duel-desktop-2-mid');
      // once the rate cap allows it (> 16.8 s after startAt), more than 250 chops is still rejected
      if (over === null && Date.now() - t0 > 12500) over = await P.page.evaluate(async id => {
        const F = TCS.fb.F, db = F.getFirestore(TCS.fb.app);
        try { await F.updateDoc(F.doc(db, 'duels', id), { pa: 251, ta: F.serverTimestamp() }); return 'allowed'; } catch (e) { return e.code; }
      }, dl.id);
      await Q.page.waitForTimeout(50);
    }
    await Q.page.waitForTimeout(700); await shot(Q, 'duel-desktop-3-fall');
    check('rules reject more than 250 chops', over === 'permission-denied', over);
    const oppSeen = await P.page.evaluate(() => TCS.friends.live ? TCS.friends.live.opp : -1);
    check('opponent progress shows live', oppSeen > 20, oppSeen);
    await P.page.waitForFunction(() => __res.length >= 1, null, { timeout: 20000 }).catch(() => {});
    await Q.page.waitForFunction(() => __res.length >= 1, null, { timeout: 20000 }).catch(() => {});
    await Promise.all([P, Q].map(X => X.page.waitForSelector('.dv-outro', { timeout: 4000 }).catch(() => {})));   // shown once the falling tree lands
    const outroOf = X => X.page.evaluate(() => { const o = document.querySelector('.dv-outro'), w = document.querySelector('.dv-slot.dv-winner');
      return { res: __res, wood: TCS.state.data.wood, name: o && o.querySelector('.dv-win-n').textContent, wager: o && o.querySelector('.dv-win-w').textContent,
        title: o && o.querySelector('.dv-win-t').textContent, dw: TCS.state.data.duelWins, winSlot: w && (w.classList.contains('me') ? 'me' : 'op'), outro3d: !!(TCS.duel3d.sides && (TCS.duel3d.sides.me.role || TCS.duel3d.sides.op.role)) }; });
    const rp = await outroOf(P), rq = await outroOf(Q);
    check('exactly one winner (Q won, P lost)', rp.res.length === 1 && rq.res.length === 1 && rq.res[0].won && !rp.res[0].won, { p: rp.res, q: rq.res });
    check('balances after logs duel', Math.abs(rp.wood - (1e6 - W)) < 1 && Math.abs(rq.wood - (5e5 + W)) < 1, { p: rp.wood, q: rq.wood });
    await Q.page.waitForTimeout(900); await shot(P, 'duel-desktop-5-outro-loser'); await shot(Q, 'duel-desktop-4-outro-winner');
    check('outro shows the winner name on both clients', rp.title === 'WINNER' && rq.title === 'WINNER' && rp.name.toLowerCase() === qn.toLowerCase() && rq.name.toLowerCase() === qn.toLowerCase()
      && rq.winSlot === 'me' && rp.winSlot === 'op' && rp.outro3d && rq.outro3d, { p: [rp.name, rp.winSlot], q: [rq.name, rq.winSlot] });
    check('wager line in the outro', /^\+200K logs$/i.test(rq.wager || '') && /^−200K logs$/i.test(rp.wager || ''), [rp.wager, rq.wager]);
    await Q.page.waitForTimeout(3200);
    check('outro auto-closes', await Q.page.$('#duel-ov') === null && await P.page.$('#duel-ov') === null);
    const tq = await Q.page.evaluate(() => ({ t: TCS.audio.track, b: TCS.audio.battle })), tp = await P.page.evaluate(() => ({ t: TCS.audio.track, b: TCS.audio.battle }));
    check('stage music resumes after the duel', tq.t === 'stage6' && !tq.b && tp.t === 'stage3' && !tp.b, { tp, tq });
    const cq = await cloudDoc(Q.page, uidQ, 0);
    check('winnings flushed to the cloud save', cq && Math.abs(cq.parsed.wood - (5e5 + W)) < 1, cq && cq.parsed.wood);
    await P.page.waitForFunction(async id => { const F = TCS.fb.F, db = F.getFirestore(TCS.fb.app); try { return !(await F.getDoc(F.doc(db, 'duels', id))).exists(); } catch (e) { return true; } }, dl.id, { timeout: 10000, polling: 500 }).catch(() => {});
    const gone = await P.page.evaluate(async id => { const F = TCS.fb.F, db = F.getFirestore(TCS.fb.app); try { return (await F.getDoc(F.doc(db, 'duels', id))).exists(); } catch (e) { return e.code; } }, dl.id);
    check('duel doc cleaned up after both paid', gone === false || gone === 'permission-denied', gone);

    // payout exactly once across a reload
    await Q.page.evaluate(() => TCS.menu.switchProfile()); await Q.page.reload();
    await Q.page.waitForFunction(() => window.TCS && TCS.ready && TCS.menu.screen === 'profiles', null, { timeout: 60000 }).catch(async e => { console.log('menu state', await Q.page.evaluate(() => JSON.stringify({ s: TCS.menu && TCS.menu.screen, u: TCS.cloud.username, uid: TCS.cloud.uid, fb: !!TCS.fb, loaded: TCS.state.loaded, keys: Object.keys(localStorage) }))); throw e; });
    await Q.page.evaluate(() => TCS.menu.startGame(TCS.cloud.username, 0)); await loaded(Q.page);
    await Q.page.waitForFunction(() => TCS.friends.active, null, { timeout: 10000 });
    await Q.page.waitForFunction(() => TCS.state.loaded && TCS.state.data.wood > 0, null, { timeout: 15000 }).catch(() => {});
    await Q.page.waitForTimeout(2500);
    const wq2 = await Q.page.evaluate(() => { window.__res = []; TCS.bus.on('duelResult', e => __res.push(e)); return TCS.state.data.wood; });
    check('no double payout after reload', Math.abs(wq2 - (5e5 + W)) < 1, wq2);
    const dwOk = await Q.page.waitForFunction(async () => { const F = TCS.fb.F, db = F.getFirestore(TCS.fb.app); await TCS.leaderboard.push(true);
      const d = await F.getDoc(F.doc(db, 'leaderboard', TCS.cloud.uid)); return TCS.state.data.duelWins === 1 && d.exists() && d.data().wins === 1; }, null, { timeout: 15000, polling: 1000 }).then(() => true, () => false);
    check('duel win counted once (save + leaderboard doc, after reload)', rq.dw === 1 && rp.dw === 0 && dwOk, { q: rq.dw, p: rp.dw, dwOk });

    // acorn duel: P wins 5 acorns
    const da = await P.page.evaluate(u => TCS.friends.challenge(u, 'acorns', 5), uidQ);
    await Q.page.waitForFunction(id => TCS.friends.duels[id] && TCS.friends.duels[id].status === 'pending', da.id, { timeout: 10000 }).catch(() => {});
    if (SHOTS) { await P.page.setViewportSize({ width: 390, height: 844 }); await Q.page.setViewportSize({ width: 390, height: 844 }); }
    const accA = await Q.page.evaluate(id => TCS.friends.acceptDuel(id), da.id);
    await P.page.waitForFunction(() => !!TCS.friends.live, null, { timeout: 10000 }).catch(() => {});
    await P.page.waitForTimeout(700); await shot(P, 'duel-phone-1-vs');
    await P.page.waitForFunction(() => { const b = document.querySelector('.dv-big'); return b && b.textContent === 'GO!'; }, null, { timeout: 6000, polling: 50 }).catch(() => {});
    await P.page.waitForTimeout(120); await shot(P, 'duel-phone-1b-go');
    for (let i = 0; i < 700; i++) {
      if (await P.page.evaluate(() => !TCS.friends.live || TCS.friends.live.mine >= TCS.data.DUEL_HP)) break;
      await P.page.keyboard.press('Space'); if (i % 6 === 0) await Q.page.keyboard.press('Space');
      if (i === 120) await shot(P, 'duel-phone-2-mid');
      await P.page.waitForTimeout(50);
    }
    await P.page.waitForTimeout(700); await shot(P, 'duel-phone-3-fall');
    await P.page.waitForSelector('.dv-outro', { timeout: 6000 }).catch(() => {});
    await P.page.waitForTimeout(900); await shot(Q, 'duel-phone-5-outro-loser'); await shot(P, 'duel-phone-4-outro-winner');
    await P.page.waitForFunction(() => __res.length >= 2, null, { timeout: 20000 }).catch(() => {});
    await Q.page.waitForFunction(() => __res.length >= 1, null, { timeout: 20000 }).catch(() => {});
    const ap = await P.page.evaluate(() => ({ a: TCS.state.data.acorns, r: __res[1] })), aq = await Q.page.evaluate(() => ({ a: TCS.state.data.acorns, r: __res[0] }));
    const dw2 = { p: await P.page.evaluate(() => TCS.state.data.duelWins), q: await Q.page.evaluate(() => TCS.state.data.duelWins) };
    check('acorn duel win counted for P only', dw2.p === 1 && dw2.q === 1, dw2);
    check('acorn wager: winner +5, loser -5', da.ok && accA.ok && ap.a === 55 && aq.a === 15 && ap.r && ap.r.won && aq.r && !aq.r.won, { da, accA, ap, aq });
    await P.ctx.close(); await Q.ctx.close(); await R.ctx.close();

    check('no unexpected console errors', errs.length === 0, errs.slice(0, 5));
  } catch (e) { console.error(e); failed = true; }
  await browser.close(); srv.close();
  console.log('\n' + results.filter(r => r.ok).length + '/' + results.length + ' checks passed');
  process.exit(failed || results.some(r => !r.ok) ? 1 : 0);
})();
