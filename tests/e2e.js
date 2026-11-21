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
    // ---- quests (3 daily + 2 weekly, progress, claim, rollovers, panel)
    {
    const SHOTS = process.env.TCS_SHOTS || '';
    const ctxQ = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctxQ.newPage(); watch(page, errs);
    const MON = new Date(2026, 10, 23, 12, 0, 0).getTime(), DAY = 864e5;   // a future Monday noon, local time (dates only move forward)
    await page.goto(base + '?local&guest&nodaily');
    await page.waitForFunction(() => window.TCS && TCS.ready && TCS.state.loaded && TCS.quests, null, { timeout: 30000 });
    await page.waitForTimeout(500);
    const q0 = await page.evaluate(MON => { TCS.quests._setNow(MON); const q = TCS.quests.list(); TCS.state.save();
      return { day: q.day, week: q.week, d: q.daily.map(x => x.id), w: q.weekly.map(x => x.id), btn: !!document.querySelector('#outfit-btns .quests-btn') }; }, MON);
    const ids = q0.d.concat(q0.w);
    check('quests generated: 3 daily + 2 weekly, no duplicates, HUD button', q0.d.length === 3 && q0.w.length === 2 &&
      new Set(ids).size === 5 && q0.week === '2026-W48' && q0.day === '2026-11-23' && q0.btn, q0);
    // force a known chop quest so the rest of the test is deterministic
    await page.evaluate(() => { const q = TCS.quests.list(); q.daily[0] = { id: 'chop', target: 20, progress: 0, claimed: false, done: false };
      if (q.daily[1].id === 'chop') q.daily[1] = { id: 'play', target: 15, progress: 0, claimed: false, done: false };
      q.weekly[0] = { id: 'coffee', target: 12, progress: 3, claimed: false, done: false }; TCS.state.save(); });
    await page.reload();
    await page.waitForFunction(() => window.TCS && TCS.ready && TCS.state.loaded && TCS.quests, null, { timeout: 30000 });
    const q1 = await page.evaluate(MON => { TCS.quests._setNow(MON); const q = TCS.quests.list(); return { d: q.daily.map(x => x.id), w: q.weekly.map(x => x.id), wp: q.weekly[0].progress }; }, MON);
    check('same quests after reload', q1.d[0] === 'chop' && q1.d.slice(1).join() !== '' && q1.w[0] === 'coffee' && q1.wp === 3 && q1.w[1] === q0.w[1], q1);
    await page.keyboard.press('KeyQ'); await page.waitForTimeout(200);
    const opened = await page.evaluate(() => ({ p: !!document.getElementById('quests-panel'), rows: document.querySelectorAll('#quests-panel .qs-row').length }));
    check('Q opens the quest panel (3 daily + chest + 2 weekly rows)', opened.p && opened.rows === 6, opened);
    for (let i = 0; i < 12; i++) await page.evaluate(() => TCS.state.chop('click'));
    await page.waitForTimeout(1100);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'quests_desktop_progress.png') });
    const mid = await page.evaluate(() => ({ p: TCS.quests.list().daily[0].progress, dot: TCS.quests.btn.classList.contains('dot'), toasts: document.querySelectorAll('#toasts .toast').length }));
    check('chopping advances the chop quest', mid.p === 12 && !mid.dot, mid);
    for (let i = 0; i < 10; i++) await page.evaluate(() => TCS.state.chop('click'));
    await page.waitForTimeout(400);
    const comp = await page.evaluate(() => ({ q: TCS.quests.list().daily[0], dot: TCS.quests.btn.classList.contains('dot'),
      toast: [...document.querySelectorAll('#toasts .toast')].some(t => /Quest complete/.test(t.textContent)), ready: !!document.querySelector('#quests-panel .qs-row.ready[data-kind=daily][data-i="0"] .qs-claim') }));
    check('completing a quest: toast + red dot + CLAIM row', comp.q.progress === 20 && comp.q.done && comp.dot && comp.toast && comp.ready, comp);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'quests_desktop_complete.png') });
    const before = await page.evaluate(() => { const d = TCS.state.data; return { a: d.acorns, ae: d.acornsEarned, w: d.wood, exp: TCS.quests.reward('daily', TCS.quests.list().daily[0]) }; });
    await page.click('#quests-panel .qs-row.ready[data-kind=daily][data-i="0"]');
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => { const d = TCS.state.data; return { a: d.acorns, ae: d.acornsEarned, w: d.wood, claimed: TCS.quests.list().daily[0].claimed,
      again: TCS.quests.claim('daily', 0), dot: TCS.quests.btn.classList.contains('dot'), row: !!document.querySelector('#quests-panel .qs-row.claimed[data-kind=daily][data-i="0"]'),
      stored: TCS.store.getJSON(TCS.state.key('guest', 0)).quests.daily[0].claimed }; });
    check('claim grants acorns (+acornsEarned) and logs once', after.claimed && after.a - before.a === before.exp.acorns && after.ae - before.ae === before.exp.acorns &&
      before.exp.acorns >= 1 && after.w - before.w >= before.exp.logs * 0.999 && after.stored, { before, after });
    check('cannot claim twice; row checked, dot cleared', after.again === null && after.row && !after.dot, after);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'quests_desktop_claimed.png') });
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    check('Esc closes the quest panel (settings stay closed)', await page.evaluate(() => !document.getElementById('quests-panel') && document.getElementById('shop').dataset.panel !== 'settings'));
    const roll = await page.evaluate(([MON, DAY]) => { const Q = TCS.quests;
      Q._setNow(MON - DAY); const back = Q.list(); const backDay = back.day, backClaimed = back.daily[0].claimed;
      Q._setNow(MON + DAY); const q = Q.list();
      const r = { backDay, backClaimed, day: q.day, d: q.daily.map(x => x.id + ':' + x.progress + ':' + x.claimed), w: q.weekly.map(x => x.id + ':' + x.progress), week: q.week };
      Q._setNow(MON + 7 * DAY); const q2 = Q.list(); r.week2 = q2.week; r.w2 = q2.weekly.map(x => x.id + ':' + x.progress); r.day2 = q2.day; return r; }, [MON, DAY]);
    check('clock set backwards keeps the claimed set', roll.backDay === '2026-11-23' && roll.backClaimed, roll);
    check('day rollover: new dailies, weekly progress kept', roll.day === '2026-11-24' && roll.d.every(s => /:0:false$/.test(s) || /^hoard:\d+:false$/.test(s)) && roll.w[0] === 'coffee:3' && roll.week === '2026-W48', roll);
    check('week rollover (Monday) resets weeklies', roll.week2 === '2026-W49' && roll.day2 === '2026-11-30' && roll.w2.every(s => /:0$/.test(s)), roll);
    await page.evaluate(() => TCS.quests._setNow(null));
    await ctxQ.close();
    // phone layout
    const ctxP = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const pp = await ctxP.newPage(); watch(pp, errs);
    await pp.goto(base + '?local&guest&nodaily');
    await pp.waitForFunction(() => window.TCS && TCS.ready && TCS.state.loaded && TCS.quests, null, { timeout: 30000 });
    await pp.waitForTimeout(500);
    await pp.evaluate(() => { const q = TCS.quests.list(); q.daily[0] = { id: 'chop', target: 20, progress: 20, claimed: false, done: true };
      q.daily[1].progress = Math.floor(q.daily[1].target / 2); TCS.quests.tick(); });
    await pp.tap('.quests-btn', { force: true }); await pp.waitForTimeout(400);
    const pf = await pp.evaluate(() => { const r = document.getElementById('quests-panel').getBoundingClientRect(), b = document.getElementById('outfit-btns').getBoundingClientRect();
      const sh = document.getElementById('shop').getBoundingClientRect(), btns = [...document.querySelectorAll('#outfit-btns .outfit-btn')].map(e => e.getBoundingClientRect());
      return { l: r.left, r: r.right, t: r.top, bot: r.bottom, w: innerWidth, btnTop: b.top, shopTop: sh.top, btnsIn: btns.every(x => x.right <= innerWidth && x.left >= 0),
        rowsOverflow: [...document.querySelectorAll('#quests-panel .qs-row')].some(e => e.scrollWidth > e.clientWidth + 1) }; });
    check('phone: quest panel fits above the buttons + shop sheet, buttons on screen', pf.l >= 0 && pf.r <= pf.w && pf.t >= 0 && pf.bot <= pf.btnTop && pf.bot <= pf.shopTop && pf.btnsIn && !pf.rowsOverflow, pf);
    if (SHOTS) await pp.screenshot({ path: path.join(SHOTS, 'quests_phone_complete.png') });
    await pp.tap('#quests-panel .qs-row.ready[data-kind=daily]', { force: true }); await pp.waitForTimeout(400);
    if (SHOTS) await pp.screenshot({ path: path.join(SHOTS, 'quests_phone_claimed.png') });
    check('phone: tap claims', await pp.evaluate(() => TCS.quests.list().daily[0].claimed));
    await ctxP.close();
    }
    // ---- matchmaking: queue -> searching card -> match found -> duel vs a bot (no Firestore), stakes, streak CPS, cancel, leave = loss
    {
    const SHOTS = process.env.TCS_SHOTS || '';
    const ctxM = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const mp = await ctxM.newPage(); watch(mp, errs);
    await mp.goto(base + '?local&nodaily');   // title menu: no matchmaking
    await mp.waitForFunction(() => window.TCS && TCS.ready && TCS.mm, null, { timeout: 30000 });
    await mp.waitForTimeout(400);
    await mp.keyboard.press('KeyM'); await mp.waitForTimeout(200);
    check('matchmaking unavailable on the title menu', await mp.evaluate(() => !TCS.mm.available() && TCS.mm.find() === false && TCS.mm.state === 'idle' && !document.getElementById('mm-card')));
    await mp.goto(base + '?local&guest&nodaily');
    await mp.waitForFunction(() => window.TCS && TCS.ready && TCS.state.loaded && TCS.mm, null, { timeout: 30000 });
    await mp.waitForTimeout(600);
    const pool = await mp.evaluate(() => { const b = TCS.mm.bots, low = b.map(x => x.name.toLowerCase()), ids = TCS.data.cosmeticById;
      return { n: b.length, uniq: new Set(low).size, re: b.every(x => /^[A-Za-z0-9_]{4,16}$/.test(x.name)), lb: b.filter(x => TCS.leaderboard.isBot(x.name)).length,
        looks: b.every(x => x.stage >= 0 && x.stage <= 7 && x.cos.split('|').length === 3 && x.cos.split('|').every(c => !c || ids[c])), stages: new Set(b.map(x => x.stage)).size,
        isBot: TCS.mmBots.isBot(b[7].name.toUpperCase()) && !TCS.mmBots.isBot('nobody_here_x'), taken: TCS.accounts.validateUsername(b[3].name), btn: !!document.querySelector('#outfit-btns .mm-btn') }; });
    check('300 matchmaking bots: unique, valid names, distinct from leaderboard bots, real cosmetics, names taken for sign-up, button in #outfit-btns',
      pool.n === 300 && pool.uniq === 300 && pool.re && pool.lb === 0 && pool.looks && pool.stages === 8 && pool.isBot && pool.taken === 'Username taken' && pool.btn, pool);
    const cps = await mp.evaluate(() => ({ m5: TCS.mm.cpsFor(-5), z: TCS.mm.cpsFor(0), p8: TCS.mm.cpsFor(8), lo: TCS.mm.cpsFor(-99), hi: TCS.mm.cpsFor(99), m2: TCS.mm.cpsFor(-2), p5: TCS.mm.cpsFor(5), p6: TCS.mm.cpsFor(6) }));
    check('bot CPS tiers: streak -5 in 10-18, 0 in 19-26, +8 in 27-40 (clamped 10..40)', cps.m5 >= 10 && cps.m5 <= 18 && cps.z >= 19 && cps.z <= 26 && cps.p8 >= 27 && cps.p8 <= 40 &&
      cps.lo === 10 && cps.hi === 40 && cps.m2 === 18 && cps.p5 === 26 && cps.p6 === 27, cps);
    // real queue (3-9 s) via the M key
    await mp.evaluate(() => { TCS.state.data.wood = 1e6; window.__mmEv = 0; TCS.bus.on('duelResult', () => window.__mmEv++); });
    await mp.keyboard.press('KeyM'); await mp.waitForTimeout(1300);
    const sc = await mp.evaluate(() => { const c = document.getElementById('mm-card'); return { st: TCS.mm.state, txt: c && c.textContent, spin: !!(c && c.querySelector('.mm-spin')), x: !!(c && c.querySelector('.mm-x')) }; });
    check('M opens the searching card (spinner, timer, ×, stakes, record)', sc.st === 'searching' && /Searching for opponent/.test(sc.txt) && /0:01/.test(sc.txt) && /Win \+.*Lose −/.test(sc.txt) && /Record 0–0 · Streak/.test(sc.txt) && sc.spin && sc.x, sc);
    if (SHOTS) await mp.screenshot({ path: path.join(SHOTS, 'mm_desktop_searching.png') });
    const t0 = Date.now();
    await mp.waitForFunction(() => TCS.mm.state === 'found' || TCS.mm.state === 'live', null, { timeout: 10000 }).catch(() => {});
    const fnd = await mp.evaluate(() => TCS.mm.state);
    check('match found within 10 s', fnd === 'found' || fnd === 'live', { fnd, ms: Date.now() - t0 + 1300 });
    await mp.waitForFunction(() => TCS.mm.state === 'live', null, { timeout: 5000 }).catch(() => {});
    await mp.waitForTimeout(500);
    const vs = await mp.evaluate(() => ({ a: (document.querySelector('#duel-ov .vs-a') || {}).textContent, b: (document.querySelector('#duel-ov .vs-b') || {}).textContent, bot: TCS.mm.live && TCS.mm.live.bot.name,
      cps: TCS.mm.live && TCS.mm.live.cps, d3: TCS.duel3d.active, duel: TCS.duel, marker: !!TCS.state.data.mm.live, intro: document.getElementById('duel-ov').classList.contains('intro') }));
    check('VS intro shows both names, both vignettes, in-progress marker, bot CPS from streak 0 (+-1.5)', vs.a === 'You' && vs.b === vs.bot && !!vs.bot && vs.d3 && vs.duel && vs.marker && vs.cps >= 18.7 && vs.cps <= 21.7, vs);
    if (SHOTS) await mp.screenshot({ path: path.join(SHOTS, 'mm_desktop_vs.png') });
    // Esc does nothing mid-match; this natural-speed bot wins (player idle) -> lose 15 min (cap 50%)
    await mp.keyboard.press('Escape');
    await mp.waitForTimeout(5500);
    const mid = await mp.evaluate(() => ({ live: TCS.mm.state === 'live', opp: TCS.mm.live && TCS.mm.live.opp, panel: document.getElementById('shop').dataset.panel }));
    check('Esc ignored mid-match; bot chopping at its pace', mid.live && mid.opp > 10 && mid.panel !== 'settings', mid);
    if (SHOTS) await mp.screenshot({ path: path.join(SHOTS, 'mm_desktop_mid.png') });
    const exp1 = await mp.evaluate(() => ({ w: TCS.state.data.wood, lose: Math.min(TCS.daily.minutesOfLogs(15), Math.floor(TCS.state.data.wood * 0.5)) }));
    await mp.waitForFunction(() => TCS.mm.live && TCS.mm.live.result, null, { timeout: 20000 }).catch(() => {});
    const r1 = await mp.evaluate(() => { const L = TCS.mm.live; return { res: L && L.result, opp: L && L.opp, el: performance.now() - (L ? L.goAt : 0), wood: TCS.state.data.wood, mm: Object.assign({}, TCS.state.data.mm), ev: window.__mmEv }; });
    check('bot at ~20 CPS finishes 250 chops in ~10-15 s; loss = 15 min of production, streak -1', r1.res && !r1.res.won && r1.res.amount === exp1.lose && r1.opp === 250 && r1.el > 9500 && r1.el < 16000 &&
      Math.abs(exp1.w - r1.wood - exp1.lose) < 1e-6 * exp1.w + 1 && r1.mm.losses === 1 && r1.mm.streak === -1 && !r1.mm.live && r1.ev === 1, { exp1, r1 });
    await mp.waitForTimeout(2000);
    if (SHOTS) await mp.screenshot({ path: path.join(SHOTS, 'mm_desktop_lose.png') });
    await mp.waitForFunction(() => TCS.mm.state === 'idle' && !TCS.duel, null, { timeout: 6000 }).catch(() => {});
    // cancel during search costs nothing (Esc, the × and M again)
    const c0 = await mp.evaluate(() => ({ w: TCS.state.data.wood, mm: JSON.stringify(TCS.state.data.mm), dw: TCS.state.data.duelWins }));
    await mp.keyboard.press('KeyM'); await mp.waitForTimeout(400); await mp.keyboard.press('Escape'); await mp.waitForTimeout(300);
    const c1 = await mp.evaluate(() => ({ st: TCS.mm.state, card: !!document.getElementById('mm-card'), panel: document.getElementById('shop').dataset.panel }));
    await mp.click('#outfit-btns .mm-btn'); await mp.waitForTimeout(300);
    const c2 = await mp.evaluate(() => TCS.mm.state);
    await mp.click('#mm-card .mm-x'); await mp.waitForTimeout(300);
    await mp.keyboard.press('KeyM'); await mp.waitForTimeout(300); const c3 = await mp.evaluate(() => TCS.mm.state);
    await mp.keyboard.press('KeyM'); await mp.waitForTimeout(9500);
    const c4 = await mp.evaluate(() => ({ st: TCS.mm.state, w: TCS.state.data.wood, mm: JSON.stringify(TCS.state.data.mm), dw: TCS.state.data.duelWins, ev: window.__mmEv }));
    check('cancel during search (Esc, ×, M again) costs nothing; button + M open it', c1.st === 'idle' && !c1.card && c1.panel !== 'settings' && c2 === 'searching' && c3 === 'searching' &&
      c4.st === 'idle' && c4.w >= c0.w && c4.mm === c0.mm && c4.dw === c0.dw && c4.ev === 1, { c0, c1, c2, c3, c4 });
    // a won match (slow test bot, auto-clicking player at the DUEL_MAX_CPS cap): +45 min, duelWins+1, streak +1, exactly once
    await mp.evaluate(() => { TCS.mm._test.cps = 1; TCS.mm._test.searchMs = 300; TCS.state.data.wood = 10; });
    const w0 = await mp.evaluate(() => ({ w: TCS.state.data.wood, win: TCS.daily.minutesOfLogs(45), dw: TCS.state.data.duelWins }));
    await mp.evaluate(() => { TCS.mm.find(); window.__mmClick = setInterval(() => TCS.mm.chop(), 25); });
    await mp.waitForFunction(() => TCS.mm.live && TCS.mm.live.result, null, { timeout: 30000 }).catch(() => {});
    await mp.evaluate(() => clearInterval(window.__mmClick));
    const w1 = await mp.evaluate(() => { const L = TCS.mm.live; return { res: L && L.result, mine: L && L.mine, el: performance.now() - (L ? L.goAt : 0), wood: TCS.state.data.wood, dw: TCS.state.data.duelWins, mm: Object.assign({}, TCS.state.data.mm), ev: window.__mmEv }; });
    await mp.waitForTimeout(2000);
    const out = await mp.evaluate(() => { const w = document.querySelector('#duel-ov .dv-win-w'); return { t: w && w.textContent, gain: !!(w && w.classList.contains('gain')), n: (document.querySelector('#duel-ov .dv-win-n') || {}).textContent }; });
    if (SHOTS) await mp.screenshot({ path: path.join(SHOTS, 'mm_desktop_win.png') });
    await mp.waitForFunction(() => TCS.mm.state === 'idle', null, { timeout: 6000 }).catch(() => {});
    const w2 = await mp.evaluate(() => ({ dw: TCS.state.data.duelWins, mm: TCS.state.data.mm, ev: window.__mmEv, stored: TCS.store.getJSON(TCS.state.key('guest', 0)).mm }));
    const winTxt = await mp.evaluate(n => '+' + TCS.util.fmt(n) + ' logs', w0.win);
    check('won match: +45 min of logs (gold +X on the outro), duelWins+1, streak +1, duelResult once', !!w1.res && w1.res.won && w1.res.amount === w0.win && w1.mine === 250 && w1.el >= 12000 &&
      Math.abs(w1.wood - w0.w - w0.win) < 1e-6 * w0.win + 1 && w1.dw === w0.dw + 1 && w1.mm.streak === 1 && w1.mm.wins === 1 && w1.ev === 2 &&
      out.gain && out.t === winTxt && out.n === 'You' &&
      w2.dw === w0.dw + 1 && w2.ev === 2 && w2.mm.wins === 1 && w2.stored.wins === 1 && w2.stored.losses === 1 && w2.stored.streak === 1 && !w2.stored.live, { w0, w1, out, w2 });
    // lost match capped at 50% of held logs (fast test bot)
    await mp.evaluate(() => { TCS.mm._test.cps = 40; TCS.state.data.wood = 9; TCS.mm.find(); });
    await mp.waitForFunction(() => TCS.mm.live && TCS.mm.live.result, null, { timeout: 20000 }).catch(() => {});
    const l1 = await mp.evaluate(() => ({ res: TCS.mm.live && TCS.mm.live.result, wood: TCS.state.data.wood, mm: Object.assign({}, TCS.state.data.mm) }));
    check('lost match: loss capped at 50% of held logs, never below 0, streak resets to -1', !!l1.res && !l1.res.won && l1.res.amount === 4 && l1.wood >= 5 && l1.wood < 6 && l1.mm.streak === -1 && l1.mm.losses === 2, l1);
    await mp.waitForFunction(() => TCS.mm.state === 'idle', null, { timeout: 8000 }).catch(() => {});
    // closing the tab mid-match = a loss on the next load
    await mp.evaluate(() => { TCS.mm._test.cps = 1; TCS.state.data.wood = 1000; TCS.mm.find(); });
    await mp.waitForFunction(() => TCS.mm.state === 'live', null, { timeout: 5000 }).catch(() => {});
    const lv = await mp.evaluate(() => ({ marker: !!TCS.store.getJSON(TCS.state.key('guest', 0)).mm.live }));
    await mp.reload();
    await mp.waitForFunction(() => window.TCS && TCS.ready && TCS.state.loaded && TCS.mm, null, { timeout: 30000 });
    await mp.waitForTimeout(1600);
    const lv2 = await mp.evaluate(() => ({ mm: TCS.state.data.mm, toast: [...document.querySelectorAll('#toasts .toast')].some(t => /Left a match/.test(t.textContent)), duel: !!TCS.duel }));
    check('leaving mid-match counts as a loss next load (once)', lv.marker && lv2.mm.losses === 3 && lv2.mm.streak === -2 && !lv2.mm.live && lv2.toast && !lv2.duel, { lv, lv2 });
    await ctxM.close();
    if (SHOTS) {   // phone screenshots: searching, VS, mid-match, win + lose outros
      const ctxP = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      const pp = await ctxP.newPage(); watch(pp, errs);
      await pp.goto(base + '?local&guest&nodaily');
      await pp.waitForFunction(() => window.TCS && TCS.ready && TCS.state.loaded && TCS.mm, null, { timeout: 30000 });
      await pp.waitForTimeout(600);
      await pp.evaluate(() => { TCS.state.data.wood = 5e5; TCS.mm._test.searchMs = 2500; TCS.mm._test.cps = 1; TCS.mm.find(); });
      await pp.waitForTimeout(1200); await pp.screenshot({ path: path.join(SHOTS, 'mm_phone_searching.png') });
      await pp.waitForFunction(() => TCS.mm.state === 'live', null, { timeout: 8000 }); await pp.waitForTimeout(500);
      await pp.screenshot({ path: path.join(SHOTS, 'mm_phone_vs.png') });
      await pp.evaluate(() => { window.__c = setInterval(() => TCS.mm.chop(), 25); });
      await pp.waitForTimeout(9000); await pp.screenshot({ path: path.join(SHOTS, 'mm_phone_mid.png') });
      await pp.waitForFunction(() => TCS.mm.live && TCS.mm.live.result, null, { timeout: 20000 }); await pp.waitForTimeout(2000);
      await pp.screenshot({ path: path.join(SHOTS, 'mm_phone_win.png') });
      await pp.evaluate(() => clearInterval(window.__c));
      await pp.waitForFunction(() => TCS.mm.state === 'idle', null, { timeout: 8000 });
      await pp.evaluate(() => { TCS.mm._test.searchMs = 200; TCS.mm._test.cps = 40; TCS.mm.find(); });
      await pp.waitForFunction(() => TCS.mm.live && TCS.mm.live.result, null, { timeout: 20000 }); await pp.waitForTimeout(2000);
      await pp.screenshot({ path: path.join(SHOTS, 'mm_phone_lose.png') });
      await ctxP.close();
    }
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
