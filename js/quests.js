/* quests.js — daily + weekly quests (TCS.quests).
   Save: S.data.quests = { day: 'YYYY-MM-DD', week: 'YYYY-Www' (ISO week, Monday start), daily: [{id, target, progress, claimed, done}],
     weekly: [...], chests: { day: 'YYYY-MM-DD' of the last all-dailies chest claimed } }.
   3 dailies (reset at local midnight) + 2 weeklies (reset Monday 00:00 local), picked from POOL with a seed of date + profile,
   skipping duplicates and quests the player can't do right now (no duels without friends, no rebirth when far from it...).
   Sets only regenerate when the date moves FORWARD (a clock set backwards keeps the current, already-claimed set).
   Progress comes from bus events (chop / buy / frenzyStart / coffeeStart / squirrel / rebirth / duelResult / dailyClaim) and a 1 s tick
   (logs earned = lifetimeWood delta, play time). Rewards are claimed one tap per row in #quests-panel (button in #outfit-btns, key Q).
   API: list(), claim(kind, i), claimChest(), reward(kind, q), chestReward(), open(), close(), toggle(), _setNow(ms|null), _gen() */
(function(){
  const TCS = window.TCS, bus = TCS.bus, D = TCS.data, U = TCS.util;
  const S = () => TCS.state;
  const CLICKS_PER_SEC = 3;

  let nowOverride = null;
  const now = () => new Date(nowOverride === null ? Date.now() : nowOverride);
  const pad = n => (n < 10 ? '0' : '') + n;
  const dstr = t => t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
  const today = () => dstr(now());
  function weekKey(t){                                       // ISO week 'YYYY-Www' of the local date t
    const d = new Date(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate()));
    const wd = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - wd + 3);   // Thursday of this week
    const y = d.getUTCFullYear(), w = Math.ceil(((d - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
    return y + '-W' + pad(w);
  }
  const thisWeek = () => weekKey(now());

  /* ---------- helpers ---------- */
  function baseRate(){                                        // production/s without temporary boosts (same as daily.js)
    const s = S(), d = s.data, f = d.frenzy.timeLeft, c = d.coffee.timeLeft, b = d.burst.timeLeft;
    d.frenzy.timeLeft = 0; d.coffee.timeLeft = 0; d.burst.timeLeft = 0;
    let r = 0;
    try { r = s.perSecond() + CLICKS_PER_SEC * s.perClick(); } finally { d.frenzy.timeLeft = f; d.coffee.timeLeft = c; d.burst.timeLeft = b; }
    return r;
  }
  function minutesOfLogs(min){
    const s = S(), m = s.costMult ? s.costMult() : 1;
    return Math.max(baseRate() * 60 * min, (D.UPGRADES[0].cost + D.UPGRADES[1].cost) * m * min / 10);
  }
  const nice = n => { if (n < 100) return Math.max(1, Math.ceil(n)); const p = Math.pow(10, Math.floor(Math.log10(n)) - 1); return Math.ceil(n / p) * p; };
  const rebirths = () => (S().data.stats && S().data.stats.rebirths) || 0;
  const levelsLeft = () => D.UPGRADES.reduce((a, u) => a + Math.max(0, u.max - (S().data.owned[u.id] || 0)), 0);
  const unmaxed = () => D.UPGRADES.filter(u => (S().data.owned[u.id] || 0) < u.max).length;
  const levelShare = () => { let o = 0, m = 0; D.UPGRADES.forEach(u => { o += Math.min(u.max, S().data.owned[u.id] || 0); m += u.max; }); return m ? o / m : 0; };
  const hasFriends = () => !!(TCS.friends && TCS.friends.active && Object.keys(TCS.friends.friends || {}).length);
  const dailyOpen = () => { try { return !!(TCS.daily && TCS.daily.status().available); } catch(e){ return false; } };

  /* ---------- pool ----------
     t(weekly) -> target; ok(weekly) -> can the player do it now; ac = base acorns (daily 1..3 / weekly 5..8) */
  const POOL = [
    { id: 'chop',     ic: 'axe',     ac: [1, 5], txt: n => 'Chop ' + U.fmt(n) + ' times', t: w => w ? 6000 : 500 + 50 * Math.min(rebirths(), 10) },
    { id: 'earn',     ic: 'log',     ac: [1, 6], txt: n => 'Earn ' + U.fmt(n) + ' logs',  t: w => nice(minutesOfLogs(w ? 150 : 15)) },
    { id: 'buy',      ic: 'buy',     ac: [1, 5], txt: n => 'Buy ' + n + ' upgrade levels', t: w => Math.min(w ? 150 : 20, Math.max(5, Math.floor(levelsLeft() * 0.8))),
      ok: w => levelsLeft() >= (w ? 40 : 8) },
    { id: 'max',      ic: 'star',    ac: [2, 7], txt: n => 'Max out ' + (n > 1 ? n + ' upgrades' : 'an upgrade'), t: w => w ? 3 : 1, ok: w => unmaxed() >= (w ? 4 : 2) },
    { id: 'frenzy',   ic: 'frenzy',  ac: [1, 5], txt: n => 'Start Timber Frenzy ' + n + ' times', t: w => w ? 25 : 3 },
    { id: 'coffee',   ic: 'coffee',  ac: [1, 5], txt: n => 'Take ' + n + ' Coffee Breaks', t: w => w ? 12 : 2 },
    { id: 'squirrel', ic: 'squirrel',ac: [2, 6], txt: n => 'Catch ' + (n > 1 ? n + ' golden squirrels' : 'the golden squirrel'), t: w => w ? 8 : 1 },
    { id: 'hoard',    ic: 'log',     ac: [2, 0], txt: n => 'Have ' + U.fmt(n) + ' logs at once', t: () => nice(S().data.wood + minutesOfLogs(20)), daily: true },
    { id: 'rebirth',  ic: 'rebirth', ac: [0, 8], txt: () => 'Rebirth once', t: () => 1, weekly: true, ok: () => S().canRebirth() || levelShare() >= 0.5 },
    { id: 'duel',     ic: 'duel',    ac: [3, 8], txt: n => 'Win ' + (n > 1 ? n + ' duels' : 'a duel'), t: w => w ? 3 : 1, ok: () => hasFriends() || !!TCS.mm },   // matchmaking: anyone can duel bots
    { id: 'login',    ic: 'gift',    ac: [1, 6], txt: n => n > 1 ? 'Claim the daily reward on ' + n + ' days' : 'Claim the daily reward', t: w => w ? 4 : 1,
      ok: w => w || dailyOpen() },
    { id: 'play',     ic: 'clock',   ac: [1, 6], txt: n => 'Play for ' + n + ' minutes', t: w => w ? 120 : 15 }
  ];
  const byId = {}; POOL.forEach(p => byId[p.id] = p);

  function hash(str){ let h = 2166136261; for (let i = 0; i < str.length; i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed){ let a = seed || 1; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function pick(weekly, key, n, avoid){
    const p = S().profile || { username: 'guest', slot: 0 };
    const r = rng(hash(key + '|' + p.username + '|' + p.slot + (weekly ? '|w' : '|d')));
    const cand = POOL.filter(q => !(weekly ? q.daily : q.weekly) && avoid.indexOf(q.id) < 0 && (!q.ok || q.ok(weekly)));
    const out = [];
    while (out.length < n && cand.length){
      const q = cand.splice(Math.floor(r() * cand.length), 1)[0];
      out.push({ id: q.id, target: Math.max(1, Math.round(q.t(weekly))), progress: 0, claimed: false, done: false });
    }
    return out;
  }

  function data(){
    const d = S().data;
    if (!d.quests || typeof d.quests !== 'object') d.quests = { day: '', week: '', daily: [], weekly: [], chests: {} };
    const q = d.quests;
    if (!Array.isArray(q.daily)) q.daily = []; if (!Array.isArray(q.weekly)) q.weekly = [];
    if (!q.chests || typeof q.chests !== 'object') q.chests = {};
    q.daily = q.daily.filter(x => x && byId[x.id]); q.weekly = q.weekly.filter(x => x && byId[x.id]);
    return q;
  }
  // regenerate only when the date moved forward ('' < any date; strings compare in date order)
  function ensure(){
    const s = S(); if (!s.loaded) return null;
    const q = data(), t = today(), w = thisWeek();
    let changed = false;
    if (w > (q.week || '') || !q.weekly.length && w >= (q.week || '')){ q.week = w; q.weekly = pick(true, w, 2, []); changed = true; }
    if (t > (q.day || '') || !q.daily.length && t >= (q.day || '')){ q.day = t; q.daily = pick(false, t, 3, q.weekly.map(x => x.id)); changed = true; }
    if (changed){ lastLW = s.data.lifetimeWood; lastSum = ownedSum(); progress('hoard', s.data.wood, true); refresh(true); }
    return q;
  }

  /* ---------- progress ---------- */
  function progress(id, amt, absolute){
    if (!S().loaded) return;
    const q = data(); let hit = false;
    [q.daily, q.weekly].forEach(list => list.forEach(x => {
      if (x.id !== id || x.claimed) return;
      const v = absolute ? Math.max(x.progress, amt) : x.progress + amt;
      x.progress = Math.min(x.target, v);
      if (x.progress >= x.target && !x.done){ x.done = true; hit = true; completed(x); }
    }));
    if (hit) refresh(true); else dirty = true;
  }
  function completed(x){
    try { TCS.ui.toast('<b>Quest complete!</b><br><small>' + byId[x.id].txt(x.target) + '</small>', IC.scroll); } catch(e){}
    try { TCS.audio.play('achievement'); } catch(e){}
  }
  const ownedSum = () => D.UPGRADES.reduce((a, u) => a + (S().data.owned[u.id] || 0), 0);
  let lastLW = 0, lastSum = 0, playAcc = 0;

  bus.on('chop', e => { if (e && e.source !== 'auto' && e.source !== 'squirrel') progress('chop', 1); });
  bus.on('buy', e => {
    const s = ownedSum(), dlt = s - lastSum; lastSum = s;
    if (dlt > 0) progress('buy', dlt);
    const u = e && D.upgradeById[e.id]; if (u && e.count >= u.max && e.count - dlt < u.max) progress('max', 1);
  });
  bus.on('owned', () => { lastSum = ownedSum(); });
  bus.on('frenzyStart', () => progress('frenzy', 1));
  bus.on('coffeeStart', () => progress('coffee', 1));
  bus.on('squirrel', () => progress('squirrel', 1));
  bus.on('rebirth', () => { progress('rebirth', 1); lastLW = S().data.lifetimeWood; });
  bus.on('duelResult', e => { if (e && e.won) progress('duel', 1); });
  bus.on('dailyClaim', () => progress('login', 1));

  function tick(){
    const s = S(); if (!s.loaded) return;
    ensure();
    const lw = s.data.lifetimeWood, dl = lw - lastLW; lastLW = lw;
    if (dl > 0) progress('earn', dl);
    progress('hoard', s.data.wood, true);
    if (!document.hidden && TCS.scene && TCS.scene.mode === 'play' && !TCS.paused){
      playAcc++; if (playAcc >= 60){ playAcc = 0; progress('play', 1); }
    }
  }

  /* ---------- rewards ---------- */
  function reward(kind, x){
    const p = byId[x.id], rb = Math.min(rebirths(), 30), w = kind === 'weekly';
    const acorns = w ? Math.min(15, p.ac[1] + 2 * Math.floor(rb / 10)) : Math.min(5, Math.max(1, p.ac[0]) + Math.floor(rb / 10));
    return { acorns, logs: Math.ceil(minutesOfLogs(w ? 60 : 10)) };
  }
  function chestReward(){ return { acorns: 4 + 2 * Math.floor(Math.min(rebirths(), 30) / 10), logs: Math.ceil(minutesOfLogs(20)) }; }
  function grant(r){
    const s = S(), d = s.data;
    s.addWood(r.logs); lastLW = d.lifetimeWood;
    if (r.acorns > 0){ d.acorns += r.acorns; d.acornsEarned += r.acorns; }
    s.save();
  }
  function claim(kind, i){
    const q = ensure(); if (!q) return null;
    const x = (kind === 'weekly' ? q.weekly : q.daily)[i];
    if (!x || x.claimed || x.progress < x.target) return null;
    const r = reward(kind, x); x.claimed = true; grant(r);
    bus.emit('questClaim', { kind, id: x.id, reward: r });
    refresh(true); return r;
  }
  const chestReady = () => { const q = data(); return q.daily.length === 3 && q.daily.every(x => x.claimed) && (q.chests.day || '') < q.day; };
  function claimChest(){
    const q = ensure(); if (!q || !chestReady()) return null;
    const r = chestReward(); q.chests.day = q.day; grant(r);
    bus.emit('questClaim', { kind: 'chest', reward: r });
    refresh(true); return r;
  }
  const pending = () => { const q = data(); return q.daily.concat(q.weekly).some(x => !x.claimed && x.progress >= x.target) || chestReady(); };

  /* ---------- UI ---------- */
  const INK = '#1b1b1b';
  const g = p => '<svg viewBox="0 0 40 40"><g stroke="' + INK + '" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">' + p + '</g></svg>';
  const IC = {
    scroll: g('<path d="M10 7h20a4 4 0 0 1 4 4v20a4 4 0 0 1-4 4H12" fill="#fff3c4"/><path d="M10 7a4 4 0 0 0-4 4v3h8v-3a4 4 0 0 0-4-4z" fill="#f2cf8c"/><path d="M14 11v20a4 4 0 0 1-4 4 4 4 0 0 0 4-4" fill="#fff3c4"/><path d="M18 15l2 2 4-4M18 24l2 2 4-4M27 16h3M27 25h3" fill="none" stroke-width="2.5"/>'),
    axe: g('<path d="M23 7l4 4-15 22-4-3z" fill="#a8693a"/><path d="M22 6c6-4 14 1 13 9l-9 2c0-4-2-7-4-11z" fill="#ffc83a"/>'),
    buy: g('<circle cx="20" cy="20" r="14" fill="#6fd043"/><path d="M20 12v16M12 20h16" fill="none" stroke="#fff" stroke-width="5"/>'),
    star: g('<path d="M20 5l4.5 9.5 10.5 1.3-7.7 7.2 2 10.4L20 28.3l-9.3 5.1 2-10.4L5 15.8l10.5-1.3z" fill="#ffc83a"/>'),
    frenzy: g('<path d="M23 4L9 22h9l-3 14 16-20h-9z" fill="#ff7a3a"/>'),
    squirrel: g('<path d="M27 33c8-2 9-14 2-20-4-3-9-1-9 4 0 4 5 5 7 8-3 3-7 4-10 4" fill="#ffc83a"/><circle cx="14" cy="22" r="7" fill="#ffd75a"/><circle cx="12" cy="20" r="1.2" fill="' + INK + '"/>'),
    rebirth: g('<path d="M20 34V18" fill="none" stroke="#a8693a" stroke-width="4"/><path d="M20 20c-9 0-12-6-12-12 7 0 12 4 12 12zM20 18c0-8 5-12 12-12 0 7-4 12-12 12z" fill="#6fd043"/>'),
    duel: g('<path d="M8 8l18 18M32 8L14 26" fill="none" stroke-width="4"/><path d="M24 28l4-4 4 4-4 4zM16 28l-4-4-4 4 4 4z" fill="#a8693a"/>'),
    gift: g('<rect x="6" y="17" width="28" height="18" rx="3" fill="#ff5a4f"/><rect x="4" y="11" width="32" height="8" rx="3" fill="#ff7a6f"/><path d="M20 11v24" stroke="#ffc83a" stroke-width="5"/>'),
    clock: g('<circle cx="20" cy="20" r="14" fill="#8fd3ff"/><path d="M20 11v9l6 4" fill="none"/>'),
    chest: g('<rect x="6" y="18" width="28" height="16" rx="3" fill="#a8693a"/><path d="M6 18a14 9 0 0 1 28 0z" fill="#c98a52"/><rect x="17" y="16" width="6" height="8" rx="2" fill="#ffc83a"/>'),
    check: '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" fill="#6fd043" stroke="' + INK + '" stroke-width="3"/><path d="M12 20l6 6 11-12" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };
  const uiIc = k => (TCS.ui && TCS.ui.ICONS && TCS.ui.ICONS[k]) || '';
  const icon = k => k === 'log' || k === 'coffee' ? (uiIc(k) || IC.clock) : IC[k] || IC.scroll;

  let btn = null, panel = null, dirty = false;
  function ensureBtn(){
    if (btn && btn.isConnected) return btn;
    const box = document.getElementById('outfit-btns'); if (!box) return null;
    btn = document.createElement('button');
    btn.className = 'outfit-btn quests-btn'; btn.title = 'Quests (Q)';
    btn.innerHTML = IC.scroll + '<i class="qs-dot"></i>';
    btn.addEventListener('pointerdown', e => e.stopPropagation());
    btn.addEventListener('click', e => { e.stopPropagation(); toggle(); });
    const db = box.querySelector('.daily-btn');
    if (db && db.nextSibling) box.insertBefore(btn, db.nextSibling); else box.appendChild(btn);
    return btn;
  }
  function untilMidnight(){ const t = now(); return (new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1) - t) / 1000; }
  function untilMonday(){ const t = now(), wd = (t.getDay() + 6) % 7; return (new Date(t.getFullYear(), t.getMonth(), t.getDate() + 7 - wd) - t) / 1000; }
  function left(sec){ sec = Math.max(0, Math.ceil(sec / 60)); const d = Math.floor(sec / 1440), h = Math.floor(sec / 60) % 24, m = sec % 60; return d ? d + 'd ' + h + 'h' : h + 'h ' + m + 'm'; }
  const chips = r => '<span class="qs-chip"><i>' + uiIc('acorn') + '</i>' + r.acorns + '</span><span class="qs-chip"><i>' + uiIc('log') + '</i>' + U.fmt(r.logs) + '</span>';
  function row(kind, x, i){
    const p = byId[x.id], full = x.progress >= x.target, cls = x.claimed ? ' claimed' : full ? ' ready' : '';
    const pct = Math.min(100, 100 * x.progress / x.target);
    return '<div class="qs-row' + cls + '" data-kind="' + kind + '" data-i="' + i + '" data-id="' + x.id + '">' +
      '<span class="qs-ic">' + (x.claimed ? IC.check : icon(p.ic)) + '</span><span class="qs-mid"><span class="qs-txt">' + p.txt(x.target) + '</span>' +
      '<span class="qs-bar"><b style="width:' + pct.toFixed(1) + '%"></b><em>' + U.fmt(Math.floor(x.progress)) + ' / ' + U.fmt(x.target) + '</em></span></span>' +
      '<span class="qs-end">' + (full && !x.claimed ? '<button class="qs-claim">CLAIM</button>' : '') + '<span class="qs-chips">' + chips(reward(kind, x)) + '</span></span></div>';
  }
  function render(){
    if (!panel) return;
    const q = ensure(); if (!q) return;
    const done = q.daily.filter(x => x.claimed).length, chestGot = (q.chests.day || '') >= q.day && q.day;
    panel.innerHTML =
      '<div class="qs-head"><span class="qs-h outlined outlined-sm">DAILY</span><span class="qs-reset">resets in ' + left(untilMidnight()) + '</span></div>' +
      q.daily.map((x, i) => row('daily', x, i)).join('') +
      '<div class="qs-row chest' + (chestGot ? ' claimed' : chestReady() ? ' ready' : '') + '" data-kind="chest"><span class="qs-ic">' + (chestGot ? IC.check : IC.chest) + '</span>' +
      '<span class="qs-mid"><span class="qs-txt">All 3 dailies: bonus chest</span><span class="qs-bar"><b style="width:' + (100 * done / 3).toFixed(1) + '%"></b><em>' + done + ' / 3</em></span></span>' +
      '<span class="qs-end">' + (chestReady() ? '<button class="qs-claim">CLAIM</button>' : '') + '<span class="qs-chips">' + chips(chestReward()) + '</span></span></div>' +
      '<div class="qs-head"><span class="qs-h outlined outlined-sm">WEEKLY</span><span class="qs-reset">resets in ' + left(untilMonday()) + '</span></div>' +
      q.weekly.map((x, i) => row('weekly', x, i)).join('');
    dirty = false;
  }
  function onTap(e){
    e.stopPropagation();
    const r = e.target.closest('.qs-row.ready'); if (!r) return;
    const k = r.dataset.kind, res = k === 'chest' ? claimChest() : claim(k, +r.dataset.i);
    if (!res) return;
    try { TCS.audio.play('buy'); } catch(err){}
    try { TCS.ui.toast('<b>Quest reward</b><br><small>+' + U.fmt(res.logs) + ' logs · +' + res.acorns + ' acorns</small>', k === 'chest' ? IC.chest : IC.scroll); } catch(err){}
  }
  function canShow(){
    const s = S();
    return s && s.loaded && !TCS.duel && !(TCS.friends && TCS.friends.live) && !window.__fxCine && TCS.scene && TCS.scene.mode === 'play' &&
      (!TCS.menu || !TCS.menu.screen) && !!document.getElementById('hud') && getComputedStyle(document.getElementById('hud')).display !== 'none';
  }
  function open(){
    if (!canShow()) return false;
    try { if (TCS.friends && TCS.friends.close) TCS.friends.close(); } catch(e){}
    if (!panel){
      panel = document.createElement('div'); panel.id = 'quests-panel'; panel.className = 'card-panel';
      panel.addEventListener('pointerdown', e => e.stopPropagation());
      panel.addEventListener('click', onTap);
      (document.getElementById('ui-layer') || document.body).appendChild(panel);
    }
    render(); return true;
  }
  function close(){ if (panel){ panel.remove(); panel = null; } }
  function toggle(){ return panel ? (close(), false) : open(); }
  function refresh(force){
    ensureBtn();
    if (btn) btn.classList.toggle('dot', !!(S().loaded && pending()));
    if (panel && (force || dirty)) render();
  }

  document.addEventListener('keydown', e => {
    if (panel && (e.key === 'Escape' || e.code === 'Escape')){ e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
    if (e.code !== 'KeyQ' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (!panel && !canShow()) return;
    e.preventDefault(); toggle();
  }, true);
  // friends panel opening closes ours (they share the bottom-left spot)
  document.addEventListener('click', e => { if (panel && e.target.closest && e.target.closest('.friends-btn')) close(); }, true);

  const start = () => { const s = S(); lastLW = s.data.lifetimeWood; lastSum = ownedSum(); playAcc = 0; ensure(); refresh(true); };
  bus.on('load', start); bus.on('gameStart', () => refresh(true));
  bus.on('unload', close); bus.on('menuOpen', close); bus.on('logout', close);
  setInterval(() => {
    tick();
    if (panel && !canShow()) close();
    if (++secs % 30 === 0) dirty = true;               // keep the "resets in" lines fresh
    refresh(false);
  }, 1000);
  let secs = 0;

  TCS.quests = {
    POOL, list: () => ensure(), claim, claimChest, reward, chestReward, open, close, toggle, today, week: thisWeek, tick,
    get panel(){ return panel; }, get btn(){ return ensureBtn(); },
    _setNow(ms){ nowOverride = ms === null || ms === undefined ? null : +ms; ensure(); refresh(true); },
    _weekKey: weekKey
  };
})();
