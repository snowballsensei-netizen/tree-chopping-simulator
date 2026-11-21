/* End-to-end headless check for Tree Chopping Simulator.
   Run:  npm i -D playwright   (or have playwright resolvable)   then   npx playwright install chromium
         node tests/e2e.js
   Starts its own static server on a free port and stops it at the end. Exit code 0 = all passed. */
const http = require('http');
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { try { ({ chromium } = require('playwright-core')); } catch (e2) { console.error('playwright not found: run `npm i -D playwright && npx playwright install chromium`'); process.exit(2); } }

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml' };
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

const results = [];
function check(name, ok, info) { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '  ' + (typeof info === 'string' ? info : JSON.stringify(info)) : '')); }

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

// ignore only third-party web font hiccups (offline machines); everything else counts
const benign = t => /fonts\.(googleapis|gstatic)\.com/.test(t);
function watch(page, errs) {
  page.on('console', m => { if (m.type() === 'error' && !benign(m.text() + ' ' + JSON.stringify(m.location()))) errs.push(m.text()); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
}

async function snapshot(page) {
  return page.evaluate(() => {
    const d = TCS.state.data;
    return { wood: d.wood, lifetimeWood: d.lifetimeWood, owned: Object.fromEntries(Object.entries(d.owned).filter(([, n]) => n > 0)),
      acorns: d.acorns, acornsEarned: d.acornsEarned, speciesIndex: d.speciesIndex, perks: d.perks,
      achievements: Object.keys(d.achievements).filter(k => d.achievements[k]).sort(),
      cosmetics: Object.keys(d.cosmetics).filter(k => d.cosmetics[k]).sort(), equipped: d.equipped,
      stats: { clicks: d.stats.clicks, chops: d.stats.chops, height: d.stats.height, rebirths: d.stats.rebirths },
      perSecond: TCS.state.perSecond() };
  });
}

(async () => {
  const srv = await serve();
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch({ args: ARGS });
  let failed = false;
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    const errs = []; watch(page, errs);
    await page.goto(base + '?local&nodaily');
    await page.waitForFunction(() => window.TCS && TCS.ready, null, { timeout: 30000 });
    await page.waitForTimeout(600);

    // ---- leaderboards on the title menu (?local: bots only)
    {
      await page.waitForSelector('.lb-card .lb-row', { timeout: 10000 });
      const lb = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.lb-card .lb-row')], vals = TCS.leaderboard.board().rows.map(r => r.value);
        const c = document.querySelector('.lb-card'), cr = c.getBoundingClientRect(), col = document.querySelector('.menu-col').getBoundingClientRect(), pill = document.querySelector('.menu-online').getBoundingClientRect();
        return { vis: getComputedStyle(c).display !== 'none' && cr.width > 0, tabs: c.querySelectorAll('.lb-tab').length, rows: rows.length,
          sorted: vals.every((v, i) => i === 0 || vals[i - 1] >= v), overlap: cr.left < col.right || cr.top < pill.bottom };
      });
      check('leaderboard on the menu: 4 tabs, 50 rows, sorted, clear of the menu + pill', lb.vis && lb.tabs === 4 && lb.rows === 50 && lb.sorted && !lb.overlap, lb);
      await page.click('.lb-tab[data-stat=rebirths]');
      await page.waitForTimeout(300);
      const sw = await page.evaluate(() => ({ stat: TCS.leaderboard.board().stat, title: document.querySelector('.lb-title').textContent, rows: document.querySelectorAll('.lb-card .lb-row').length, saved: localStorage.getItem('tcs_lb_tab') }));
      check('leaderboard tab switch (remembered)', sw.stat === 'rebirths' && /rebirths/i.test(sw.title) && sw.rows === 50 && sw.saved === 'rebirths', sw);
      const p2 = await ctx.newPage();
      await p2.goto(base + '?local&nodaily'); await p2.waitForFunction(() => window.TCS && TCS.ready, null, { timeout: 30000 });
      const tk = await page.evaluate(() => TCS.leaderboard.tick());
      const sig = pg => pg.evaluate(t => JSON.stringify(TCS.leaderboard.at(t)), tk);
      const [s1, s2] = [await sig(page), await sig(p2)];
      const shown2 = await p2.evaluate(() => TCS.leaderboard.board() && TCS.leaderboard.board().stat);
      await p2.close();
      check('bot boards identical in two pages (deterministic)', s1 === s2 && s1.length > 1000 && shown2 === 'rebirths', { len: s1.length, shown2 });
      const mono = await page.evaluate(t => {
        const L = TCS.leaderboard, a = L.at(t), later = [L.at(t + 1), L.at(t + 120), L.at(t + 2880 * 7)];
        let bad = 0, moved = 0;
        // logs = logs held right now (they go up and down); the lifetime stats never decrease
        for (const st of L.STATS.filter(x => x !== 'logs')) for (const r of a[st]) for (const b of later) {
          const x = L._botStats(L.bots[+r.id.slice(1)], ((t + 1) * L.TICK_MS - L.EPOCH) / 3600000); if (!x || x[st] < r.value) bad++;
          const f = b[st].find(q => q.id === r.id); if (f && f.value < r.value) bad++; if (!f) moved++;
        }
        return { bad, moved, logs1: a.logs[0].value, logs50: a.logs[49].value };
      }, tk);
      check('bot wins/rebirths/acorns never decrease over later ticks', mono.bad === 0, mono);
      const held = await page.evaluate(t => { const L = TCS.leaderboard, a = L.at(t).logs, b = L.at(t + 1).logs; return { changed: b.filter(r => { const o = a.find(z => z.id === r.id); return !o || o.value !== r.value; }).length }; }, tk);
      check('bot logs change every 10 s tick', held.changed >= 40, held);
    }

    // ---- create account through the real menu
    const user = 'e2e_' + Date.now().toString(36).slice(-6), pass = 'pine1234';
    await page.click('[data-act=create]');
    await page.fill('#m-user', user);
    await page.fill('#m-pass', pass);
    await page.fill('#m-pass2', pass);
    // Space typed into a menu input must not chop
    await page.press('#m-pass2', 'Space'); await page.fill('#m-pass2', pass);
    await page.click('.menu-form button[type=submit]');
    await page.waitForSelector('[data-act=new]', { timeout: 10000 });
    check('account created via menu', await page.evaluate(u => TCS.accounts.current === u, user));
    const menuHidesUi = await page.evaluate(() => ['shop', 'icon-col', 'outfit-btns', 'frenzy', 'toasts', 'hud'].every(id => { const e = document.getElementById(id); return !e || getComputedStyle(e).display === 'none'; }));
    check('in-game UI hidden while menu is open', menuHidesUi);

    // ---- new profile
    await page.click('.slot[data-slot="0"][data-act=new]');
    await page.waitForFunction(() => TCS.state.loaded && TCS.scene.mode === 'play', null, { timeout: 10000 });
    check('leaderboard hidden in game', await page.evaluate(() => { const c = document.querySelector('.lb-card'); return !c || c.getBoundingClientRect().width === 0; }));
    await page.waitForTimeout(700);
    check('profile created and game started', true);

    // ---- 200 real mouse clicks on the tree
    const pt = await page.evaluate(() => { const p = TCS.scene.worldToScreen(new THREE.Vector3(0, 1.4, 1.0)); return { x: Math.round(p.x), y: Math.round(p.y) }; });
    for (let i = 0; i < 200; i++) { await page.mouse.click(pt.x, pt.y); await page.waitForTimeout(15); }
    await page.waitForTimeout(400);
    const afterClicks = await snapshot(page);
    check('200 canvas clicks registered', afterClicks.stats.clicks === 200, afterClicks.stats.clicks);
    check('height chopped accumulates', afterClicks.stats.height > 0 && /[1-9]/.test(await page.textContent('#hud-height')), await page.textContent('#hud-height'));

    // ---- buy upgrades via shop cards
    const buyCard = async id => {
      const idx = await page.evaluate(id => TCS.data.UPGRADES.findIndex(u => u.id === id), id);
      const card = page.locator('.panel-shop > .up-card').nth(idx);
      // cards pulse (CSS scale animation) so they never count as 'stable': scroll, then a real mouse click
      await card.evaluate(e => e.scrollIntoView({ block: 'center' })); await page.waitForTimeout(80);
      await card.click({ force: true });
    };
    await buyCard('whetstone');
    await page.evaluate(() => TCS.state.addWood(TCS.state.upgradeCost('rookie', 2) + TCS.state.upgradeCost('steelAxe') + 10));
    await page.waitForTimeout(200);
    const affordCls = await page.locator('.panel-shop > .up-card').nth(1).getAttribute('class');
    check('affordable card has .afford', /afford/.test(affordCls) && !/locked/.test(affordCls), affordCls);
    await buyCard('rookie'); await buyCard('steelAxe'); await buyCard('rookie');
    const owned1 = await page.evaluate(() => TCS.state.data.owned);
    check('upgrades bought via cards', owned1.whetstone === 1 && owned1.rookie === 2 && owned1.steelAxe === 1, owned1);

    // ---- max levels: a capped upgrade shows MAX and refuses to buy
    const maxInfo = await page.evaluate(() => {
      const S = TCS.state; S.addWood(1e9); S.data.owned.whetstone = TCS.data.upgradeById.whetstone.max - 1; S.buy('whetstone');
      const n = S.data.owned.whetstone; const again = S.buy('whetstone');
      return { n, max: TCS.data.upgradeById.whetstone.max, again, cost: S.upgradeCost('whetstone') };
    });
    await page.waitForTimeout(300);
    const wCard = page.locator('.panel-shop > .up-card').nth(0);
    const wTxt = (await wCard.textContent()) || '', wCls = await wCard.getAttribute('class');
    check('upgrade caps at max level (MAX shown)', maxInfo.n === maxInfo.max && !maxInfo.again && maxInfo.cost === Infinity && /MAX/.test(wTxt) && wTxt.includes(maxInfo.max + '/' + maxInfo.max) && /maxed/.test(wCls), { maxInfo, wTxt });

    // ---- next stage gate: needs all but REBIRTH_ALLOWED_UNMAXED upgrades maxed
    await page.click('.icon-btn.rebirth');
    await page.waitForTimeout(300);
    check('next-stage button disabled before maxing', /disabled/.test(await page.getAttribute('.rb-btn', 'class')));
    await page.click('.rb-btn', { force: true });
    await page.waitForTimeout(500);
    check('next stage refused with upgrades not maxed', await page.evaluate(() => TCS.state.data.stats.rebirths === 0 && TCS.state.data.speciesIndex === 0));
    const allowed = await page.evaluate(() => TCS.data.REBIRTH_ALLOWED_UNMAXED);
    await page.evaluate(n => TCS.state._maxAll(n + 1), allowed);
    await page.waitForTimeout(400);
    check('still disabled with one too many unmaxed', /disabled/.test(await page.getAttribute('.rb-btn', 'class')) && await page.evaluate(() => !TCS.state.canRebirth()));
    await page.evaluate(n => TCS.state._maxAll(n), allowed);
    await page.waitForTimeout(400);
    const rbCls = await page.getAttribute('.rb-btn', 'class');
    const progTxt = await page.textContent('.rb-prog');
    check('next-stage button enabled when the max rule is met', !/disabled/.test(rbCls) && progTxt.includes('MAXED ' + (25 - allowed) + '/' + (25 - allowed)), { rbCls, progTxt });
    const nextName = await page.textContent('.rb-next');
    check('panel shows next stage name', nextName.trim() === 'Birch Lake' || /birch lake/i.test(nextName), nextName);
    const expected = await page.evaluate(() => TCS.state.acornsOnRebirth());
    const gainTxt = await page.textContent('.rb-gain');
    check('next-stage panel shows acorns gained', gainTxt.includes('+' + expected) && expected >= 1, gainTxt + ' expected ' + expected);
    await page.click('.rb-btn', { force: true });
    await page.waitForFunction(() => TCS.state.data.stats.rebirths === 1 && !window.__fxCine, null, { timeout: 30000 });
    await page.waitForTimeout(800);
    const reb = await snapshot(page);
    check('stage data.species follows speciesIndex', await page.evaluate(() => TCS.state.data.species === 1 && TCS.data.STAGES.length === 8));
    check('world stage follows the rebirth', await page.evaluate(() => TCS.world && TCS.world.stage === 1), await page.evaluate(() => TCS.world && TCS.world.stage));
    check('music switched to the stage track after the cinematic', await page.evaluate(() => TCS.audio.track === 'stage1' || (TCS.audio.track && TCS.audio.track.name === 'stage1')), await page.evaluate(() => String(TCS.audio.track && (TCS.audio.track.name || TCS.audio.track))));
    check('rebirth happened via cinematic', reb.speciesIndex === 1 && reb.acorns === expected && Object.keys(reb.owned).length === 0, { species: reb.speciesIndex, acorns: reb.acorns });

    // buy again after rebirth + equip a cosmetic, so everything has something to persist
    await page.evaluate(() => TCS.state.addWood(TCS.state.upgradeCost('whetstone') + TCS.state.upgradeCost('rookie') + 10));
    await page.click('.back-btn').catch(() => {});
    await page.waitForTimeout(200);
    await buyCard('whetstone'); await buyCard('rookie');
    const equipInfo = await page.evaluate(() => {
      const d = TCS.state.data; const all = [].concat(TCS.data.COSMETICS.hat, TCS.data.COSMETICS.face, TCS.data.COSMETICS.boots);
      const c = all.find(c => d.cosmetics[c.id]);
      if (!c) { const h = TCS.data.COSMETICS.hat[0]; d.cosmetics[h.id] = true; TCS.state.equip('hat', h.id); return 'granted ' + h.id; }
      return 'unlocked ' + c.id;
    });
    // equip through the outfit UI: first unlocked item in the hat list (if any)
    await page.click('.outfit-btn[title=hat]');
    await page.waitForTimeout(200);
    const cardsHat = page.locator('.panel-outfit .outfit-card.afford');
    if (await cardsHat.count() > 1) await cardsHat.nth(1).click({ force: true });
    await page.click('.back-btn').catch(() => {});
    await page.evaluate(() => TCS.state.save());
    const before = await snapshot(page);
    check('cosmetic available + equipped', before.cosmetics.length > 0 && Object.values(before.equipped).some(Boolean), equipInfo + ' ' + JSON.stringify(before.equipped));
    check('achievements earned', before.achievements.length > 0, before.achievements.length);

    await page.reload();
    await page.waitForFunction(() => window.TCS && TCS.ready, null, { timeout: 30000 });
    await page.waitForTimeout(600);
    // ---- log in again through the menu
    if (await page.locator('[data-act=login]').count()) await page.click('[data-act=login]');
    await page.fill('#m-user', user);
    await page.fill('#m-pass', 'wrongpass');
    await page.click('.menu-form button[type=submit]');
    await page.waitForTimeout(500);
    check('wrong password rejected', (await page.textContent('.menu-err-form')).length > 0);
    await page.fill('#m-pass', pass);
    await page.click('.menu-form button[type=submit]');
    await page.waitForSelector('.slot[data-slot="0"] [data-act=play]', { timeout: 10000 });
    await page.click('.slot[data-slot="0"] [data-act=play]');
    await page.waitForFunction(() => TCS.state.loaded && TCS.scene.mode === 'play', null, { timeout: 10000 });
    await page.waitForTimeout(500);
    const after = await snapshot(page);
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    check('wood intact', after.wood >= before.wood - 1 && after.wood <= before.wood + before.perSecond * 120 + 10, { before: before.wood, after: after.wood });
    check('upgrades intact', eq(after.owned, before.owned), after.owned);
    check('acorns intact', after.acorns === before.acorns && after.acornsEarned === before.acornsEarned, after.acorns);
    check('species intact', after.speciesIndex === before.speciesIndex, after.speciesIndex);
    check('achievements intact', before.achievements.every(a => after.achievements.includes(a)), after.achievements.length);
    check('stats intact', eq(after.stats, before.stats), after.stats);
    check('cosmetics intact', eq(after.cosmetics, before.cosmetics) && eq(after.equipped, before.equipped), after.equipped);

    // ---- settings: no gear in the icon column; Esc opens / closes; Esc ignored while typing
    check('no settings gear in the icon column', await page.locator('#icon-col .icon-btn.settings').count() === 0);
    await page.mouse.click(5, 300); // focus the page body
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    check('Esc opens settings', await page.evaluate(() => document.getElementById('shop').dataset.panel === 'settings'));
    await page.focus('.save-box'); await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    check('Esc ignored while typing', await page.evaluate(() => document.getElementById('shop').dataset.panel === 'settings'));
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    check('Esc again closes settings', await page.evaluate(() => document.getElementById('shop').dataset.panel === 'shop'));
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    await page.click('.back-btn'); await page.waitForTimeout(150);
    check('BACK closes settings', await page.evaluate(() => document.getElementById('shop').dataset.panel === 'shop'));

    // ---- old v1 save migrates: owned clamped to max, acorns kept
    const mig = await page.evaluate(() => {
      const S = TCS.state, key = S.key(S.profile.username, 2);
      const old = S._fresh(); old.version = 1; old.owned.whetstone = 180; old.acorns = 7; old.acornsEarned = 9; old.speciesIndex = 3; delete old.species;
      old.achievements = { wood_0: true }; old.cosmetics = { beanie: true };
      TCS.store.setJSON(key, old);
      S.save(); const prof = S.profile;
      S.load(prof.username, 2);
      const r = { v: S.data.version, w: S.data.owned.whetstone, max: TCS.data.ECON.MAX_LEVEL, a: S.data.acorns, ae: S.data.acornsEarned, sp: S.data.species, ach: !!S.data.achievements.wood_0, cos: !!S.data.cosmetics.beanie };
      TCS.store.remove(key);
      S.load(prof.username, prof.slot);
      return r;
    });
    check('v1 save migrates (clamped, acorns kept)', mig.v === 2 && mig.w === mig.max && mig.a === 7 && mig.ae === 9 && mig.sp === 3 && mig.ach && mig.cos, mig);

    // ---- settings: Log Out goes back to the menu
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.click('.b-logout');
    await page.waitForTimeout(400);
    check('Log Out returns to menu', await page.evaluate(() => !TCS.state.loaded && TCS.accounts.current === null && TCS.scene.mode === 'orbit'));

    const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    // ---- distinct models + icons (separate guest context)
    { const page = await ctx3.newPage(); watch(page, errs);
    await page.goto(base + '?local&guest&nodaily');
    await page.waitForFunction(() => window.TCS && TCS.ready, null, { timeout: 30000 });
    await page.waitForTimeout(500);
    await page.evaluate(() => { TCS.state.addWood(1e30); for (const u of TCS.data.UPGRADES) TCS.state.buy(u.id); });
    await page.waitForTimeout(800);
    const distinct = await page.evaluate(() => {
      const sig = {}, icons = {};
      for (const u of TCS.data.UPGRADES) {
        const root = TCS.upgrades3d._build(u.id); const parts = [];
        if (root) root.traverse(o => { if (o.isMesh && !o.userData.isOutline) parts.push((o.geometry.attributes.position ? o.geometry.attributes.position.count : 0) + ':' + (o.material && o.material.color ? o.material.color.getHexString() : '')); });
        sig[u.id] = parts.sort().join('|');
        icons[u.id] = TCS.upgrades3d.icon(u.id);
      }
      const imgs = [...document.querySelectorAll('.panel-shop > .up-card .c-icon img')].map(i => i.src);
      const dupe = o => { const seen = {}, d = []; for (const k in o) { if (!o[k]) { d.push(k + ':empty'); continue; } if (seen[o[k]]) d.push(seen[o[k]] + '=' + k); else seen[o[k]] = k; } return d; };
      const emojis = TCS.data.UPGRADES.map(u => u.icon);
      return { models: dupe(sig), icons: dupe(icons), cardImgs: imgs.length, cardDupes: imgs.length - new Set(imgs).size, emojiDupes: emojis.length - new Set(emojis).size, n: TCS.data.UPGRADES.length };
    });
    check('25 upgrades', distinct.n === 25, distinct.n);
    check('all upgrade models distinct', distinct.models.length === 0, distinct.models);
    check('all upgrade icon data URLs distinct', distinct.icons.length === 0 && distinct.cardDupes === 0 && distinct.cardImgs === 25, distinct);
    check('all emoji fallbacks distinct', distinct.emojiDupes === 0, distinct.emojiDupes);
    }
    await ctx3.close();
    // ---- daily rewards (fresh guest context: the card pops up on entering the game)
    {
    const SHOTS = process.env.TCS_SHOTS || '';
    const ctxD = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctxD.newPage(); watch(page, errs);
    await page.goto(base + '?local&guest');
    await page.waitForFunction(() => window.TCS && TCS.ready && TCS.state.loaded, null, { timeout: 30000 });
    let cardUp = true;
    try { await page.waitForSelector('#daily-card .dr-claim', { timeout: 8000 }); } catch (e) { cardUp = false; }
    const d0 = await page.evaluate(() => ({ st: TCS.daily.status(), r: TCS.daily.reward(1), wood: TCS.state.data.wood, tiles: document.querySelectorAll('#daily-card .dr-tile').length,
      today: !!document.querySelector('#daily-card .dr-tile.today[data-day="1"]'), dot: TCS.daily.btn.classList.contains('dot') }));
    check('daily card appears on first load into a game (7 tiles, day 1 highlighted, HUD dot)', cardUp && d0.tiles === 7 && d0.today && d0.st.available && d0.st.streak === 1 && d0.dot, d0);
    await page.waitForTimeout(500);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'daily_desktop_before.png') });
    await page.click('#daily-card .dr-claim', { force: true });
    await page.waitForTimeout(250);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'daily_desktop_claiming.png') });
    await page.waitForTimeout(800);
    const d1 = await page.evaluate(() => ({ wood: TCS.state.data.wood, daily: TCS.state.data.daily, card: !!document.getElementById('daily-card'), dot: TCS.daily.btn.classList.contains('dot'),
      again: TCS.daily.claim(), stored: TCS.store.getJSON(TCS.state.key('guest', 0)).daily }));
    const gained = d1.wood - d0.wood;
    check('claim gives the right logs (min floor for a new player)', gained >= d0.r.logs && gained < d0.r.logs * 1.02 + 5 && d0.r.logs >= 30, { gained, logs: d0.r.logs });
    check('claim closes the card, clears the dot, saves daily data', !d1.card && !d1.dot && d1.daily.streak === 1 && d1.daily.total === 1 && d1.stored.last === d1.daily.last, d1);
    check('cannot claim twice the same day', d1.again === null);
    await page.click('.daily-btn', { force: true }); await page.waitForTimeout(300);
    const wait = await page.evaluate(() => ({ txt: (document.querySelector('#daily-card .dr-wait') || {}).textContent, cnt: (document.querySelector('#daily-card .dr-count') || {}).textContent, claim: !!document.querySelector('#daily-card .dr-claim') }));
    check('gift button opens "come back tomorrow" + countdown', /tomorrow/i.test(wait.txt || '') && /^\d+:\d\d:\d\d$/.test(wait.cnt || '') && !wait.claim, wait);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'daily_desktop_after.png') });
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    check('Esc closes the daily card (settings stay closed)', await page.evaluate(() => !document.getElementById('daily-card') && document.getElementById('shop').dataset.panel !== 'settings'));
    const day = 864e5;
    const nx = await page.evaluate(day => {
      const D = TCS.daily; D._setNow(Date.now() + day);
      const st = D.status(); const dot = TCS.daily.btn.classList.contains('dot'); const r = D.claim();
      const out = { st, dot, r: r && { day: r.day, streak: r.streak }, daily: Object.assign({}, TCS.state.data.daily) };
      D._setNow(Date.now() + day * 3); out.skip = D.status();
      D._setNow(Date.now() - day * 2); out.back = D.status();
      return out;
    }, day);
    check('next day continues the streak (dot shows again)', nx.st.available && nx.st.streak === 2 && nx.dot && nx.r && nx.r.streak === 2 && nx.daily.streak === 2 && nx.daily.total === 2, nx);
    check('skipping a day resets the streak to 1', nx.skip.available && nx.skip.streak === 1 && nx.skip.reset, nx.skip);
    check('clock set backwards: nothing to claim', !nx.back.available, nx.back);
    const big = await page.evaluate(day => {
      const D = TCS.daily, S = TCS.state, d = S.data; D._setNow(null);
      const y = new Date(Date.now() - day); const p = n => (n < 10 ? '0' : '') + n;
      d.daily = { last: y.getFullYear() + '-' + p(y.getMonth() + 1) + '-' + p(y.getDate()), streak: 6, total: 6 };
      d.frenzy.timeLeft = 0; S.save();
      const exp = D.reward(7), a0 = d.acorns, c0 = Object.keys(d.cosmetics).length, w0 = d.wood;
      const r = D.claim();
      const r6 = D.reward(6), r1 = D.reward(8);
      return { exp, r: r && { day: r.day, acorns: r.acorns, logs: r.logs, cos: r.cosmeticItem && r.cosmeticItem.id }, da: d.acorns - a0, dc: Object.keys(d.cosmetics).length - c0, dw: d.wood - w0,
        frenzy: S.frenzyActive(), streak: d.daily.streak, day6: r6.logs, cycle: r1.day };
    }, day);
    check('day 7 gives the big reward (2h logs, acorns, outfit, frenzy) then the cycle repeats', big.r && big.r.day === 7 && big.da === big.exp.acorns && big.da >= 5 && big.dc === 1 && big.frenzy &&
      big.dw >= big.exp.logs && big.exp.logs > big.day6 && big.streak === 7 && big.cycle === 1, big);
    // offline WELCOME BACK first, then the daily card (never both)
    await page.evaluate(() => { const d = TCS.state.data; d.daily.last = '2000-01-01'; d.daily.streak = 3;
      d.pendingOffline = { amount: 500, seconds: 3600, capped: false, capHours: 8, rate: 0.5, lines: [] }; TCS.state.save(); });
    await page.reload();
    await page.waitForFunction(() => window.TCS && TCS.ready && TCS.state.loaded, null, { timeout: 30000 });
    await page.waitForSelector('#offline-card .oc-collect', { timeout: 8000 }).catch(() => {});
    let both = false;
    for (let i = 0; i < 8; i++) { await page.waitForTimeout(250); if (await page.evaluate(() => !!(document.getElementById('offline-card') && document.getElementById('daily-card')))) both = true; }
    const offUp = await page.evaluate(() => !!document.getElementById('offline-card'));
    await page.click('#offline-card .oc-collect', { force: true }).catch(() => {});
    let after = true;
    try { await page.waitForSelector('#daily-card .dr-claim', { timeout: 5000 }); } catch (e) { after = false; }
    for (let i = 0; i < 4; i++) { await page.waitForTimeout(100); if (await page.evaluate(() => !!(document.getElementById('offline-card') && document.getElementById('daily-card')))) both = true; }
    check('daily card waits for the offline card (never on top of it)', offUp && after && !both, { offUp, after, both });
    check('streak broken after a missed day shows day 1', await page.evaluate(() => TCS.daily.status().streak === 1 && !!document.querySelector('#daily-card .dr-tile.today[data-day="1"]')));
    await ctxD.close();
    // phone layout
    const ctxP = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const pp = await ctxP.newPage(); watch(pp, errs);
    await pp.goto(base + '?local&guest');
    await pp.waitForFunction(() => window.TCS && TCS.ready && TCS.state.loaded, null, { timeout: 30000 });
    let pUp = true; try { await pp.waitForSelector('#daily-card .dr-claim', { timeout: 8000 }); } catch (e) { pUp = false; }
    await pp.waitForTimeout(500);
    const fit = await pp.evaluate(() => { const b = document.querySelector('#daily-card .dr-box').getBoundingClientRect(), row = document.querySelector('#daily-card .dr-row');
      const btn = TCS.daily.btn.getBoundingClientRect();
      return { l: b.left, r: b.right, w: innerWidth, rowOverflow: row.scrollWidth > row.clientWidth + 1, btnVis: btn.width > 0 && btn.top > 0 && btn.bottom < innerHeight }; });
    check('phone: daily card fits the screen, gift button visible', pUp && fit.l >= 0 && fit.r <= fit.w && !fit.rowOverflow && fit.btnVis, fit);
    if (SHOTS) await pp.screenshot({ path: path.join(SHOTS, 'daily_phone_before.png') });
    await pp.tap('#daily-card .dr-claim', { force: true }); await pp.waitForTimeout(250);
    if (SHOTS) await pp.screenshot({ path: path.join(SHOTS, 'daily_phone_claiming.png') });
    await pp.waitForTimeout(900);
    await pp.tap('.daily-btn', { force: true }); await pp.waitForTimeout(400);
    if (SHOTS) await pp.screenshot({ path: path.join(SHOTS, 'daily_phone_after.png') });
    check('phone: claim + reopen shows countdown', await pp.evaluate(() => TCS.state.data.daily.total === 1 && !!document.querySelector('#daily-card .dr-count')));
    await ctxP.close();
    }
    check('no console errors (http)', errs.length === 0, errs.slice(0, 5));
    await ctx.close();

    // ---- file:// load
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const p2 = await ctx2.newPage(); const errs2 = []; watch(p2, errs2);
    await p2.goto('file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/') + '?local&guest');
    let ready = true;
    try { await p2.waitForFunction(() => window.TCS && TCS.ready, null, { timeout: 30000 }); } catch (e) { ready = false; }
    if (ready) { await p2.waitForTimeout(800); await p2.mouse.click(400, 400); await p2.waitForTimeout(500); }
    check('file:// loads without errors', ready && errs2.length === 0, errs2.slice(0, 5));
    await ctx2.close();
  } catch (e) {
    console.error(e); check('test run completed', false, String(e && e.message));
  } finally {
    await browser.close();
    srv.close();
  }
  failed = results.some(r => !r.ok);
  console.log('\n' + results.filter(r => r.ok).length + '/' + results.length + ' checks passed');
  process.exit(failed ? 1 : 0);
})();
