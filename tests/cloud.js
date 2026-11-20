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
      try { await F.addDoc(F.collection(db, 'duels'), { a: TCS.cloud.uid, b: u, aName: TCS.cloud.username, bName: 'x', kind: 'logs', amount: 9e5, status: 'pending', createdAt: F.serverTimestamp(), startAt: null, ta: null, tb: null, pa: 0, pb: 0, winner: '', endAt: null, paidA: false, paidB: false }); return 'allowed'; }
      catch (e) { return e.code; }
    }, uidQ);
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

    // logs duel: Q mashes Space and wins 200k; P barely chops
    const W = 2e5;
    const dl = await P.page.evaluate(u => TCS.friends.challenge(u, 'logs', '200k'), uidQ);
    await Q.page.waitForSelector('.duel-card', { timeout: 10000 }).catch(() => {});
    check('incoming duel card shown', dl.ok && await Q.page.$('.duel-card') !== null, dl);
    await Q.page.click('.duel-card [data-act=acc]');
    await P.page.waitForFunction(() => !!TCS.friends.live, null, { timeout: 10000 }).catch(() => {});
    await Q.page.waitForFunction(() => !!TCS.friends.live, null, { timeout: 10000 }).catch(() => {});
    check('both players enter the duel overlay', await P.page.$('#duel-ov') !== null && await Q.page.$('#duel-ov') !== null);
    const preChop = await Q.page.evaluate(() => TCS.friends.chop());
    await Q.page.waitForTimeout(3300);
    // a cheating finish (100 chops right after GO) is rejected by the rules' click-rate cap
    const cheat = await P.page.evaluate(async id => {
      const F = TCS.fb.F, db = F.getFirestore(TCS.fb.app);
      try { await F.updateDoc(F.doc(db, 'duels', id), { status: 'done', winner: TCS.cloud.uid, endAt: F.serverTimestamp(), pa: 100, ta: F.serverTimestamp() }); return 'allowed'; } catch (e) { return e.code; }
    }, dl.id);
    const burst = await Q.page.evaluate(() => { let n = 0; for (let i = 0; i < 60; i++) if (TCS.friends.chop()) n++; return n; });
    check('anti-cheat: no chops before GO, burst capped, rules reject a fake finish', !preChop && burst <= 20 && cheat === 'permission-denied', { preChop, burst, cheat });
    await Q.page.waitForTimeout(1000);
    for (let i = 0; i < 400; i++) {
      if (await Q.page.evaluate(() => !TCS.friends.live || TCS.friends.live.mine >= TCS.data.DUEL_HP)) break;
      await Q.page.keyboard.press('Space'); if (i % 8 === 0) await P.page.keyboard.press('Space');
      await Q.page.waitForTimeout(60);
    }
    const oppSeen = await P.page.evaluate(() => TCS.friends.live ? TCS.friends.live.opp : -1);
    check('opponent progress shows live', oppSeen > 20, oppSeen);
    await P.page.waitForFunction(() => __res.length >= 1, null, { timeout: 20000 }).catch(() => {});
    await Q.page.waitForFunction(() => __res.length >= 1, null, { timeout: 20000 }).catch(() => {});
    const rp = await P.page.evaluate(() => ({ res: __res, wood: TCS.state.data.wood, txt: (document.querySelector('.dv-result') || {}).textContent }));
    const rq = await Q.page.evaluate(() => ({ res: __res, wood: TCS.state.data.wood, txt: (document.querySelector('.dv-result') || {}).textContent }));
    check('exactly one winner (Q won, P lost)', rp.res.length === 1 && rq.res.length === 1 && rq.res[0].won && !rp.res[0].won, { p: rp.res, q: rq.res });
    check('balances after logs duel', Math.abs(rp.wood - (1e6 - W)) < 1 && Math.abs(rq.wood - (5e5 + W)) < 1, { p: rp.wood, q: rq.wood });
    check('result line shown', /you won \+200K logs/i.test(rq.txt || '') && /you lost/i.test(rp.txt || ''), [rp.txt, rq.txt]);
    await Q.page.waitForTimeout(4500);
    check('result auto-closes', await Q.page.$('#duel-ov') === null);
    const cq = await cloudDoc(Q.page, uidQ, 0);
    check('winnings flushed to the cloud save', cq && Math.abs(cq.parsed.wood - (5e5 + W)) < 1, cq && cq.parsed.wood);
    await P.page.waitForTimeout(1500);
    const gone = await P.page.evaluate(async id => { const F = TCS.fb.F, db = F.getFirestore(TCS.fb.app); try { return (await F.getDoc(F.doc(db, 'duels', id))).exists(); } catch (e) { return e.code; } }, dl.id);
    check('duel doc cleaned up after both paid', gone === false || gone === 'permission-denied', gone);

    // payout exactly once across a reload
    await Q.page.evaluate(() => TCS.menu.switchProfile()); await Q.page.reload();
    await Q.page.waitForFunction(() => window.TCS && TCS.ready && TCS.menu.screen === 'profiles', null, { timeout: 60000 }).catch(async e => { console.log('menu state', await Q.page.evaluate(() => JSON.stringify({ s: TCS.menu && TCS.menu.screen, u: TCS.cloud.username, uid: TCS.cloud.uid, fb: !!TCS.fb, loaded: TCS.state.loaded, keys: Object.keys(localStorage) }))); throw e; });
    await Q.page.evaluate(() => TCS.menu.startGame(TCS.cloud.username, 0)); await loaded(Q.page);
    await Q.page.waitForFunction(() => TCS.friends.active, null, { timeout: 10000 });
    await Q.page.waitForTimeout(2500);
    const wq2 = await Q.page.evaluate(() => { window.__res = []; TCS.bus.on('duelResult', e => __res.push(e)); return TCS.state.data.wood; });
    check('no double payout after reload', Math.abs(wq2 - (5e5 + W)) < 1, wq2);

    // acorn duel: P wins 5 acorns
    const da = await P.page.evaluate(u => TCS.friends.challenge(u, 'acorns', 5), uidQ);
    await Q.page.waitForFunction(id => TCS.friends.duels[id] && TCS.friends.duels[id].status === 'pending', da.id, { timeout: 10000 }).catch(() => {});
    const accA = await Q.page.evaluate(id => TCS.friends.acceptDuel(id), da.id);
    await P.page.waitForFunction(() => !!TCS.friends.live, null, { timeout: 10000 }).catch(() => {});
    await P.page.waitForTimeout(3300);
    for (let i = 0; i < 400; i++) {
      if (await P.page.evaluate(() => !TCS.friends.live || TCS.friends.live.mine >= TCS.data.DUEL_HP)) break;
      await P.page.keyboard.press('Space'); await P.page.waitForTimeout(60);
    }
    await P.page.waitForFunction(() => __res.length >= 2, null, { timeout: 20000 }).catch(() => {});
    await Q.page.waitForFunction(() => __res.length >= 1, null, { timeout: 20000 }).catch(() => {});
    const ap = await P.page.evaluate(() => ({ a: TCS.state.data.acorns, r: __res[1] })), aq = await Q.page.evaluate(() => ({ a: TCS.state.data.acorns, r: __res[0] }));
    check('acorn wager: winner +5, loser -5', da.ok && accA.ok && ap.a === 55 && aq.a === 15 && ap.r && ap.r.won && aq.r && !aq.r.won, { da, accA, ap, aq });
    await P.ctx.close(); await Q.ctx.close(); await R.ctx.close();

    check('no unexpected console errors', errs.length === 0, errs.slice(0, 5));
  } catch (e) { console.error(e); failed = true; }
  await browser.close(); srv.close();
  console.log('\n' + results.filter(r => r.ok).length + '/' + results.length + ' checks passed');
  process.exit(failed || results.some(r => !r.ok) ? 1 : 0);
})();
