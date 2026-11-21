/* daily.js — daily login reward: a 7-day streak calendar (TCS.daily).
   Save: S.data.daily = { last: 'YYYY-MM-DD' (local date of the last claim), streak (consecutive days, keeps counting past 7), total (claims ever) }.
   Claim once per local calendar day; claiming the day after `last` continues the streak, a missed day resets it to 1,
   a clock set backwards (today <= last) has nothing to claim. Day 7 of each cycle is the big one, then the cycle repeats.
   UI: #daily-card (shown on entering a game when a reward is waiting, after the offline / patch-notes cards) and a gift
   button in #outfit-btns with a red dot while today's reward is unclaimed. ?nodaily = never auto-open (tests).
   API: status(), reward(streak), claim(), open(), close(), today(), _setNow(ms|null) (test clock). */
(function(){
  const TCS = window.TCS, bus = TCS.bus, D = TCS.data, U = TCS.util;
  const S = () => TCS.state;
  const MINUTES = [10, 20, 30, 40, 50, 60, 120];          // logs = N minutes of production, per cycle day
  const ACORNS  = [0, 1, 0, 1, 2, 0, 5];                  // base golden acorns per cycle day (scaled by rebirths)
  const BOOST   = [null, null, 'frenzy', null, null, 'coffee', 'frenzy'];
  const CLICKS_PER_SEC = 3;                               // click-rate estimate added to per-second production
  const NOSHOW = /[?&](nodaily|emu)\b/.test(location.search);   // ?emu = cloud tests

  let nowOverride = null;
  const now = () => new Date(nowOverride === null ? Date.now() : nowOverride);
  const pad = n => (n < 10 ? '0' : '') + n;
  const dstr = t => t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate());
  const today = () => dstr(now());
  const dayNum = s => { const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(s || ''); return m ? Date.UTC(+m[1], m[2] - 1, +m[3]) / 864e5 : NaN; };
  const data = () => { const d = S().data; if (!d.daily || typeof d.daily !== 'object') d.daily = { last: '', streak: 0, total: 0 }; return d.daily; };

  // {available, streak (the streak today's claim gives, or the current one once claimed), day 1..7, reset (streak broke)}
  function status(){
    const dl = data(), t = dayNum(today()), l = dayNum(dl.last), cur = Math.max(0, dl.streak | 0);
    if (!isNaN(l) && t - l <= 0) return { available: false, streak: Math.max(1, cur), day: cycleDay(Math.max(1, cur)), reset: false };
    const cont = !isNaN(l) && t - l === 1 && cur > 0;
    const streak = cont ? cur + 1 : 1;
    return { available: true, streak, day: cycleDay(streak), reset: !cont && cur > 0 };
  }
  const cycleDay = n => ((n - 1) % 7) + 1;

  // production per second without temporary boosts (frenzy / coffee / squirrel burst)
  function baseRate(){
    const s = S(), d = s.data, f = d.frenzy.timeLeft, c = d.coffee.timeLeft, b = d.burst.timeLeft;
    d.frenzy.timeLeft = 0; d.coffee.timeLeft = 0; d.burst.timeLeft = 0;
    let r = 0;
    try { r = s.perSecond() + CLICKS_PER_SEC * s.perClick(); } finally { d.frenzy.timeLeft = f; d.coffee.timeLeft = c; d.burst.timeLeft = b; }
    return r;
  }
  // floor for brand-new players: per 10 minutes, the price of the first two upgrades (at this stage's prices)
  function minPer10(){
    const s = S(), m = s.costMult ? s.costMult() : 1;
    return (D.UPGRADES[0].cost + D.UPGRADES[1].cost) * m;
  }
  // N minutes of production (with the new-player floor): the same estimate the rewards use (also matchmaking stakes)
  const minutesOfLogs = min => Math.ceil(Math.max(baseRate() * 60 * min, minPer10() * min / 10));
  function unowned(){
    const d = S().data, all = [].concat(D.COSMETICS.hat, D.COSMETICS.face, D.COSMETICS.boots);
    return all.filter(c => !d.cosmetics[c.id]);
  }
  function reward(streak){
    const day = cycleDay(streak), min = MINUTES[day - 1];
    const rb = (S().data.stats && S().data.stats.rebirths) || 0, scale = 1 + Math.floor(Math.min(rb, 30) / 10);
    const logs = minutesOfLogs(min);
    let acorns = ACORNS[day - 1] * scale;
    const cosmetic = day === 7 && unowned().length > 0;
    if (day === 7 && !cosmetic) acorns += 5 * scale;   // every outfit owned: extra acorns instead
    return { day, minutes: min, logs, acorns, boost: BOOST[day - 1], cosmetic };
  }

  function claim(){
    const s = S(); if (!s.loaded || !s.profile) return null;
    // another tab may have claimed already: trust the newer stored save
    try {
      const st = TCS.store.getJSON(s.key(s.profile.username, s.profile.slot), null);
      if (st && st.daily && dayNum(st.daily.last) >= dayNum(today())){
        if (!(dayNum(data().last) >= dayNum(st.daily.last))) s.data.daily = Object.assign({}, st.daily);
        if (!status().available) return null;
      }
    } catch(e){}
    const stt = status(); if (!stt.available) return null;
    const r = reward(stt.streak), d = s.data;
    d.daily = { last: today(), streak: stt.streak, total: (data().total | 0) + 1 };
    s.addWood(r.logs);
    if (r.acorns > 0){ d.acorns += r.acorns; d.acornsEarned += r.acorns; }
    if (r.boost === 'frenzy'){
      const dur = D.FRENZY_DURATION + 5 * s.perk('longerFrenzy');
      if (s.frenzyActive()) d.frenzy.timeLeft = Math.max(d.frenzy.timeLeft, dur); else s.startFrenzy();
    } else if (r.boost === 'coffee'){
      if (d.coffee.timeLeft > 0) d.coffee.timeLeft = D.COFFEE_DURATION;
      else { d.coffee.cooldown = 0; s.startCoffee(); }
    }
    if (r.cosmetic){
      const pool = unowned(), c = pool[Math.floor(Math.random() * pool.length)];
      d.cosmetics[c.id] = true; r.cosmeticItem = c;
      bus.emit('cosmeticUnlock', { cosmetic: c });
      if (d.autoselect) s.equip(c.slot, c.id);
    }
    r.streak = stt.streak;
    s.save();
    bus.emit('dailyClaim', r);
    refreshBtn();
    return r;
  }

  /* ---------- UI ---------- */
  const INK = '#1b1b1b';
  const g = p => '<svg viewBox="0 0 40 40"><g stroke="' + INK + '" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">' + p + '</g></svg>';
  const IC = {
    gift: g('<rect x="6" y="17" width="28" height="18" rx="3" fill="#ff5a4f"/><rect x="4" y="11" width="32" height="8" rx="3" fill="#ff7a6f"/><path d="M20 11v24" stroke="#ffc83a" stroke-width="5"/><path d="M20 11v24" fill="none"/><path d="M20 11c-3-7-11-7-10-2 1 3 6 2 10 2zM20 11c3-7 11-7 10-2-1 3-6 2-10 2z" fill="#ffc83a"/>'),
    axe: g('<path d="M23 7l4 4-15 22-4-3z" fill="#a8693a"/><path d="M22 6c6-4 14 1 13 9l-9 2c0-4-2-7-4-11z" fill="#ffc83a"/>'),
    check: '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" fill="#6fd043" stroke="' + INK + '" stroke-width="3"/><path d="M12 20l6 6 11-12" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    mystery: g('<rect x="6" y="17" width="28" height="18" rx="3" fill="#b07cff"/><rect x="4" y="11" width="32" height="8" rx="3" fill="#c79bff"/><path d="M20 11v24" stroke="#fff" stroke-width="4"/><path d="M20 11c-3-7-11-7-10-2 1 3 6 2 10 2zM20 11c3-7 11-7 10-2-1 3-6 2-10 2z" fill="#fff"/>')
  };
  const ui = () => (TCS.ui && TCS.ui.ICONS) || {};
  const logIc = () => ui().log || '', acornIc = () => ui().acorn || '', coffeeIc = () => ui().coffee || '';

  let card = null, btn = null, timer = null, autoTimer = null, autoDone = false;

  function ensureBtn(){
    if (btn && btn.isConnected) return btn;
    const box = document.getElementById('outfit-btns'); if (!box) return null;
    btn = document.createElement('button');
    btn.className = 'outfit-btn daily-btn'; btn.title = 'Daily reward';
    btn.innerHTML = IC.gift + '<i class="dr-dot"></i>';
    btn.addEventListener('pointerdown', e => e.stopPropagation());
    btn.addEventListener('click', e => { e.stopPropagation(); card ? close() : open(); });
    box.appendChild(btn);
    refreshBtn();
    return btn;
  }
  function refreshBtn(){
    if (!btn) return;
    const on = !!(S().loaded && status().available);
    btn.classList.toggle('dot', on);
  }

  function extras(r, big){
    let h = '';
    if (r.acorns) h += '<span class="dr-x"><i class="mini">' + acornIc() + '</i>' + (big ? '+' : '') + r.acorns + '</span>';
    if (r.boost === 'frenzy') h += '<span class="dr-x"><i class="mini">' + IC.axe + '</i>' + (big ? 'FRENZY' : '') + '</span>';
    if (r.boost === 'coffee') h += '<span class="dr-x"><i class="mini">' + coffeeIc() + '</i>' + (big ? 'COFFEE' : '') + '</span>';
    if (r.cosmetic) h += '<span class="dr-x"><i class="mini">' + IC.mystery + '</i>' + (big ? 'OUTFIT' : '') + '</span>';
    return h;
  }
  function untilMidnight(){ const t = now(), m = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1); return Math.max(0, (m - t) / 1000); }
  function clock(sec){ sec = Math.ceil(sec); const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60; return h + ':' + pad(m) + ':' + pad(s); }

  function canShow(){
    const s = S();
    return s && s.loaded && !TCS.duel && !TCS.paused && !window.__fxCine && TCS.scene && TCS.scene.mode === 'play' &&
      (!TCS.menu || !TCS.menu.screen) && !!document.getElementById('hud') && getComputedStyle(document.getElementById('hud')).display !== 'none';
  }

  function open(){
    if (!canShow()) return false;
    if (card) card.remove();
    const st = status(), start = st.streak - st.day + 1;
    const tiles = [];
    for (let i = 0; i < 7; i++){
      const n = start + i, r = reward(n), past = i < st.day - 1 || (i === st.day - 1 && !st.available), today = i === st.day - 1;
      const cls = 'dr-tile' + (past ? ' past' : today ? ' today' : ' future') + (i === 6 ? ' big' : '');
      tiles.push('<div class="' + cls + '" data-day="' + (i + 1) + '"><span class="dr-d outlined outlined-sm">' + (i === 6 ? 'DAY 7' : 'D' + (i + 1)) + '</span>' +
        '<span class="dr-ic">' + (past ? IC.check : i === 6 ? IC.gift : logIc()) + '</span>' +
        '<span class="dr-v outlined outlined-sm">' + U.fmt(r.logs) + '</span><span class="dr-xs">' + extras(r, false) + '</span></div>');
    }
    const r = reward(st.streak);
    const body = st.available
      ? '<div class="dr-get"><span class="dr-amt outlined"><i class="mini">' + logIc() + '</i>+' + U.fmt(r.logs) + '</span>' + extras(r, true) + '</div>' +
        '<button class="btn dr-claim">CLAIM</button>'
      : '<div class="dr-wait outlined outlined-sm">COME BACK TOMORROW</div><div class="dr-count outlined">' + clock(untilMidnight()) + '</div>' +
        '<button class="btn dr-ok">OK</button>';
    card = document.createElement('div'); card.id = 'daily-card';
    card.innerHTML = '<div class="card-panel dr-box" role="dialog" aria-label="Daily reward">' +
      '<div class="dr-title outlined">DAILY REWARD</div>' +
      '<div class="dr-streak outlined outlined-sm">' + (st.reset ? 'STREAK RESET · ' : '') + 'DAY ' + st.streak + '</div>' +
      '<div class="dr-row">' + tiles.join('') + '</div>' + body + '</div>';
    card.addEventListener('pointerdown', e => { e.stopPropagation(); if (e.target === card && !st.available) close(); });
    const c = card.querySelector('.dr-claim'), ok = card.querySelector('.dr-ok');
    if (c) c.addEventListener('click', e => { e.stopPropagation(); doClaim(); });
    if (ok) ok.addEventListener('click', e => { e.stopPropagation(); close(); });
    (document.getElementById('ui-layer') || document.body).appendChild(card);
    return true;
  }
  function close(){
    if (!card) return;
    const e = card; card = null; e.classList.add('out');
    setTimeout(() => e.remove(), 300);
  }
  function doClaim(){
    if (!card) return null;
    const r = claim();
    if (!r){ close(); return null; }
    const tile = card.querySelector('.dr-tile.today');
    if (tile){ tile.classList.remove('today'); tile.classList.add('past', 'claimed'); const ic = tile.querySelector('.dr-ic'); if (ic) ic.innerHTML = IC.check; }
    const b = card.querySelector('.dr-claim'); if (b) b.disabled = true;
    try { TCS.audio.play('achievement'); TCS.audio.play('buy'); } catch(e){}
    const sc = TCS.scene;
    for (let i = 0; i < 12; i++) setTimeout(() => { try { sc.spawnChips(sc.tree.impactPoint(), 3, true); } catch(e){} }, i * 60);
    try {
      let t = '<b>Day ' + r.streak + ' reward</b><br><small>+' + U.fmt(r.logs) + ' logs' + (r.acorns ? ' · +' + r.acorns + ' acorns' : '') +
        (r.boost === 'frenzy' ? ' · Timber Frenzy' : r.boost === 'coffee' ? ' · Coffee Break' : '') + (r.cosmeticItem ? ' · ' + r.cosmeticItem.name : '') + '</small>';
      TCS.ui.toast(t, IC.gift);
    } catch(e){}
    setTimeout(close, 650);
    return r;
  }

  // auto-open once per game entry, after the offline / patch-notes cards are gone
  function schedule(){
    autoDone = false; clearTimeout(autoTimer);
    if (NOSHOW) return;
    let tries = 0;
    const tryShow = () => {
      if (autoDone) return;
      if (++tries > 600) return;                              // give up after ~3 min of waiting
      const busy = document.getElementById('offline-card') || document.getElementById('patch-notes') || document.getElementById('duel-ov');
      if (!S().loaded || !status().available) return;
      if (busy || !canShow()){ autoTimer = setTimeout(tryShow, 300); return; }
      autoDone = true; open();
    };
    autoTimer = setTimeout(tryShow, 800);
  }

  document.addEventListener('keydown', e => {
    if (card && (e.key === 'Escape' || e.code === 'Escape')){ e.preventDefault(); e.stopImmediatePropagation(); close(); }
  }, true);

  bus.on('load', () => { ensureBtn(); refreshBtn(); schedule(); });
  bus.on('gameStart', () => { ensureBtn(); refreshBtn(); schedule(); });
  const drop = () => { autoDone = true; clearTimeout(autoTimer); if (card){ card.remove(); card = null; } };
  bus.on('unload', drop); bus.on('menuOpen', drop); bus.on('logout', drop);
  timer = setInterval(() => {
    ensureBtn(); refreshBtn();
    if (!card) return;
    if (!canShow()) { drop(); return; }
    const cnt = card.querySelector('.dr-count'); if (cnt) cnt.textContent = clock(untilMidnight());
  }, 1000);

  TCS.daily = {
    status, reward, claim, open, close, today, claimUI: doClaim, minutesOfLogs,
    get card(){ return card; }, get btn(){ return ensureBtn(); },
    _setNow(ms){ nowOverride = ms === null || ms === undefined ? null : +ms; refreshBtn(); },
    _dayNum: dayNum
  };
})();
