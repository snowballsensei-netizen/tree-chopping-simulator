/* matchmaking.js — "Find match": queue up and duel one of 300 bot lumberjacks in the friend-duel race (every mode, no friends needed).
   Flow: crossed-swords button in #outfit-btns or M -> searching card (spinner, elapsed time, ×, stakes, record) for 3-9 s -> "Match found!"
   -> the shared duel overlay (TCS.duelView in js/friends.js: VS intro, READY/SET/GO, both 3D vignettes, battle music, DUEL_HP race, outro).
   Nothing touches Firestore. Bot speed follows the player's matchmaking streak (cpsFor), with ±1.5 CPS per-match jitter and a bursty rhythm.
   Stakes: win = 45 min of production (TCS.daily.minutesOfLogs, with its new-player floor) + duelWins++ + 'duelResult' {won:true};
           lose = 15 min of production, capped at 50% of the logs held. Save: data.mm = {wins, losses, streak, best, live}; live is the
           in-progress marker (closing the tab mid-match = a loss on the next load). Esc / × cancels a search for free.
   Bot names: their own 300 (distinct from the leaderboard bots, js/leaderboard.js isBot names are skipped); TCS.mmBots.isBot(name) makes them
   "taken" for sign-up (accounts.js) and friend requests to them look sent (friends.js).
   API (TCS.mm): bots, cpsFor(streak), stakes(), available(), find(opts), cancel(), toggle(), chop(), state, live, _test {searchMs, cps} */
(function(){
  const TCS = window.TCS, bus = TCS.bus, D = TCS.data, U = TCS.util;
  const HP = D.DUEL_HP || 250, CD = (D.DUEL_COUNTDOWN || 4.5) * 1000;
  // bots click EASE x slower than the streak bands below (user: ease by 1.5x): 10-18 -> 6.7-12, 19-26 -> 12.7-17.3, 27-40 -> 18-26.7
  const EASE = 1.5, MAX_BOT = 40 / EASE;
  const S = () => TCS.state;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const sfx = n => { try { TCS.audio.play(n); } catch(e){} };

  /* ---------- the 300 bots (deterministic) ---------- */
  function rng(seed){ let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const ADJ = ['Sneaky','Lazy','Silent','Rapid','Frosty','Mighty','Crispy','Fuzzy','Wild','Lucky','Salty','Sleepy','Turbo','Hyper','Cosmic','Pixel','Rusty',
    'Shadow','Golden','Tiny','Swift','Grumpy','Happy','Spicy','Chill','Noble','Brave','Clever','Dizzy','Epic','Jolly','Mystic','Neon','Quick','Royal','Sunny',
    'Stormy','Bouncy','Sly','Zesty','Mellow','Feral','Dapper','Snowy','Misty','Rowdy','Sassy','Witty','Giga','Mega','Ultra','Retro','Lunar','Solar'];
  const NOUN = ['Badger','Fox','Otter','Moose','Beaver','Raccoon','Owl','Falcon','Wolf','Bear','Panda','Lynx','Ferret','Squirrel','Acorn','Pine','Maple',
    'Cedar','Birch','Oak','Axe','Timber','Log','Stump','Sawdust','Chopper','Ranger','Nomad','Knight','Wizard','Ninja','Pirate','Goblin','Toast','Waffle',
    'Pickle','Noodle','Taco','Muffin','Biscuit','Nugget','Potato','Comet','Rocket','Blaze','Storm','Thunder','Frost','Ember','Spark','Yeti','Gecko','Hawk',
    'Bison','Elk','Walrus','Turtle','Pancake','Pretzel','Lumber','Splinter','Hatchet','Woody','Bark','Twig','Sprout','Mossy','Cobra','Raptor','Golem'];
  const SLOTS = ['hat', 'face', 'boots'];
  const BOTS = [], BYLOW = {};
  (function build(){
    const r = rng(0x7c5e11), pick = a => a[Math.floor(r() * a.length)], num = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
    const LB = TCS.leaderboard, cos = SLOTS.map(s => ((D.COSMETICS && D.COSMETICS[s]) || []).map(c => c.id));
    const forms = [
      () => pick(ADJ) + pick(NOUN),
      () => pick(NOUN) + '_' + num(1, 99),
      () => pick(ADJ) + pick(NOUN) + num(1, 999),
      () => pick(ADJ) + '_' + pick(NOUN),
      () => 'x' + pick(NOUN) + 'x',
      () => pick(NOUN).toLowerCase() + num(10, 9999),
      () => 'itz' + pick(NOUN),
      () => pick(NOUN) + pick(NOUN),
      () => 'The' + pick(ADJ) + pick(NOUN),
      () => pick(ADJ).toLowerCase() + '_' + pick(NOUN).toLowerCase(),
      () => pick(NOUN) + 'Main' + num(1, 9),
      () => 'Mr' + pick(NOUN) + num(1, 99),
      () => pick(ADJ) + pick(NOUN) + '_',
      () => pick(NOUN) + 'Gamer' + num(1, 99)
    ];
    let guard = 0;
    while (BOTS.length < 300 && guard++ < 20000){
      const name = forms[Math.floor(r() * forms.length)]();
      const low = name.toLowerCase();
      if (!/^[A-Za-z0-9_]{4,16}$/.test(name) || BYLOW[low] || (LB && LB.isBot && LB.isBot(low))) continue;
      const look = SLOTS.map((s, k) => cos[k].length && r() < 0.6 ? pick(cos[k]) : '').join('|');
      const bot = { name, stage: Math.min(7, Math.floor(Math.pow(r(), 0.8) * 8)), cos: look, skill: r() * 2 - 1 };   // skill -> ±1.5 CPS jitter
      BOTS.push(bot); BYLOW[low] = bot;
    }
  })();
  TCS.mmBots = {
    list: BOTS,
    isBot: name => Object.prototype.hasOwnProperty.call(BYLOW, String(name || '').trim().toLowerCase()),
    byName: name => BYLOW[String(name || '').trim().toLowerCase()] || null
  };

  const MM = TCS.mm = { bots: BOTS, state: 'idle', live: null, _test: { searchMs: null, cps: null } };

  /* ---------- bot speed ---------- */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // streak: + consecutive wins / − consecutive losses. Losing big -> 10-18, default/winning some -> 19-26, massive win streak -> 27-40
  function cpsFor(streak){
    streak = Math.round(+streak || 0);
    let band;
    if (streak <= -2) band = clamp(18 - 2 * (-streak - 2), 10, 18);
    else if (streak <= 5) band = clamp(19 + (streak + 1) * 1.2, 19, 26);
    else band = clamp(27 + (streak - 6) * 2, 27, 40);
    return band / EASE;
  }
  MM.cpsFor = cpsFor;

  /* ---------- save record + stakes ---------- */
  function rec(){
    const d = S().data; let m = d.mm;
    if (!m || typeof m !== 'object') m = d.mm = {};
    ['wins', 'losses', 'streak', 'best'].forEach(k => { if (!(typeof m[k] === 'number' && isFinite(m[k]))) m[k] = 0; });
    if (m.live === undefined) m.live = null;
    return m;
  }
  MM.record = () => rec();
  function minutes(n){
    if (TCS.daily && TCS.daily.minutesOfLogs) return TCS.daily.minutesOfLogs(n);
    const s = S(); return Math.ceil(Math.max((s.perSecond() + 3 * s.perClick()) * 60 * n, 0));
  }
  function stakes(){
    const wood = Math.max(0, Math.floor(S().data.wood || 0));
    return { win: minutes(45), lose: Math.max(0, Math.min(minutes(15), Math.floor(wood * 0.5))) };
  }
  MM.stakes = stakes;
  const streakTxt = s => s > 0 ? 'W' + s : s < 0 ? 'L' + (-s) : '—';

  function applyResult(won, loseCap){
    const s = S(), d = s.data, m = rec();
    let amount;
    if (won){
      amount = minutes(45);
      d.wood += amount;
      d.duelWins = (d.duelWins || 0) + 1;   // inside the once-per-match guard (leaderboard)
      m.wins++; m.streak = m.streak > 0 ? m.streak + 1 : 1; m.best = Math.max(m.best, m.streak);
    } else {
      amount = Math.max(0, Math.min(loseCap != null ? loseCap : minutes(15), Math.floor(Math.max(0, d.wood) * 0.5)));
      d.wood = Math.max(0, d.wood - amount);
      m.losses++; m.streak = m.streak < 0 ? m.streak - 1 : -1;
    }
    m.live = null;
    s.save();
    bus.emit('duelResult', { id: 'mm', won, kind: 'logs', amount, bot: true });
    if (TCS.cloud && TCS.cloud.flush) try { TCS.cloud.flush(); } catch(e){}
    return amount;
  }
  // left mid-match last time (tab closed): counts as a loss now
  bus.on('load', () => {
    const s = S(); if (!s.loaded) return;
    const m = rec();
    if (m.live && typeof m.live === 'object'){
      const amt = applyResult(false, m.live.lose);
      setTimeout(() => toast('Left a match: counted as a loss <b>−' + U.fmt(amt) + '</b> logs'), 1200);
    } else if (m.live) m.live = null;
  });

  /* ---------- availability ---------- */
  MM.available = function(){
    const s = S();
    return !!(s && s.loaded && !TCS.duel && !(TCS.friends && TCS.friends.live) && !window.__fxCine && TCS.scene && TCS.scene.mode === 'play' &&
      !(TCS.menu && TCS.menu.screen));
  };

  /* ---------- UI ---------- */
  const SWORDS = '<svg viewBox="0 0 40 40"><g stroke="#1b1b1b" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">' +
    '<path d="M7 5l3 0 17 17-3 3L7 8z" fill="#dfe6ee"/><path d="M33 5l-3 0-17 17 3 3 17-17z" fill="#dfe6ee"/>' +
    '<path d="M22 24l6-6M18 24l-6-6" fill="none"/><path d="M27 27l6 6M13 27l-6 6" stroke-width="5"/>' +
    '<path d="M27 27l6 6M13 27l-6 6" stroke="#a8693a" stroke-width="2.4"/></g></svg>';
  let btn = null, card = null, tick = null;
  function toast(html){ try { TCS.ui.toast(html, SWORDS); } catch(e){} }
  function layer(){ return document.getElementById('ui-layer'); }
  function ensureBtn(){
    if (btn && btn.isConnected) return btn;
    const box = document.getElementById('outfit-btns'); if (!box) return null;
    btn = document.createElement('button');
    btn.className = 'outfit-btn mm-btn'; btn.title = 'Find match (M)'; btn.innerHTML = SWORDS;
    btn.addEventListener('click', e => { e.stopPropagation(); MM.toggle(); });
    btn.addEventListener('pointerdown', e => e.stopPropagation());
    box.appendChild(btn);
    return btn;
  }
  function drawCard(){
    if (!card) return;
    const el = card.querySelector('.mm-time');
    if (MM.state !== 'searching' || !el) return;
    const sec = Math.floor((performance.now() - MM.t0) / 1000);
    el.textContent = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  }
  function showCard(){
    const L = layer(); if (!L) return;
    if (!card){ card = document.createElement('div'); card.id = 'mm-card'; card.className = 'card-panel'; card.addEventListener('pointerdown', e => e.stopPropagation()); L.appendChild(card); }
    const m = rec(), st = MM.stakes_;
    card.classList.remove('found');
    card.innerHTML = '<div class="mm-top"><i class="mm-spin"></i><span class="mm-t outlined outlined-sm">Searching for opponent…</span>' +
      '<span class="mm-time outlined outlined-sm">0:00</span><button class="mm-x" title="Cancel (Esc)">×</button></div>' +
      '<div class="mm-stakes outlined outlined-sm">Win <b class="gain">+' + U.fmt(st.win) + '</b> · Lose <b class="loss">−' + U.fmt(st.lose) + '</b></div>' +
      '<div class="mm-rec outlined outlined-sm">Record ' + m.wins + '–' + m.losses + ' · Streak ' + streakTxt(m.streak) + '</div>';
    card.querySelector('.mm-x').addEventListener('click', e => { e.stopPropagation(); MM.cancel(); });
  }
  function hideCard(){ if (card){ card.remove(); card = null; } clearInterval(tick); tick = null; }

  /* ---------- queue ---------- */
  let searchT = 0, foundT = 0;
  MM.find = function(opts){
    opts = opts || {};
    if (MM.state !== 'idle' || !MM.available()) return false;
    MM.state = 'searching'; MM.t0 = performance.now(); MM.stakes_ = stakes();
    const wait = opts.searchMs != null ? opts.searchMs : MM._test.searchMs != null ? MM._test.searchMs : 3000 + Math.random() * 6000;
    showCard(); sfx('click');
    tick = setInterval(drawCard, 250);
    searchT = setTimeout(found, wait);
    return true;
  };
  MM.cancel = function(){
    if (MM.state !== 'searching' && MM.state !== 'found') return false;
    clearTimeout(searchT); clearTimeout(foundT); MM.state = 'idle'; MM.stakes_ = null; hideCard(); sfx('click');
    return true;
  };
  MM.toggle = () => (MM.state === 'idle' ? MM.find() : MM.cancel());
  function found(){
    if (MM.state !== 'searching') return;
    if (!MM.available()){ MM.cancel(); return; }
    clearInterval(tick); tick = null;
    const bot = BOTS[Math.floor(Math.random() * BOTS.length)];
    MM.state = 'found'; MM.opponent = bot;
    if (card){
      card.classList.add('found');
      card.querySelector('.mm-top').innerHTML = '<span class="mm-t outlined outlined-sm">Match found!</span><span class="mm-vs outlined outlined-sm">vs <b>' + esc(bot.name) + '</b></span>';
    }
    sfx('toast');
    foundT = setTimeout(() => start(bot), 1300);
  }

  /* ---------- the match ---------- */
  function start(bot){
    if (MM.state !== 'found') return;
    hideCard();
    if (!MM.available()){ MM.state = 'idle'; return; }
    const m = rec(), st = MM.stakes_ || stakes();
    const target = MM._test.cps != null ? MM._test.cps : Math.min(MAX_BOT, cpsFor(m.streak) + 1.5 * bot.skill / EASE);
    const cps = Math.max(0.1, Math.min(MAX_BOT, target));
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    m.live = { id, bot: bot.name, at: Date.now(), lose: st.lose };   // closing the tab from here on = a loss next load
    S().save();
    const now = performance.now();
    const L = MM.live = { id, bot, cps, stakes: st, mine: 0, opp: 0, goAt: now + CD, introAge: 0, done: false, paid: false,
      meName: (() => { const u = (S().profile && S().profile.username) || ''; return u && !/^guest$/i.test(u) ? u : 'You'; })(),
      opName: bot.name, wagerHtml: '+' + U.fmt(st.win) + ' / −' + U.fmt(st.lose) + ' <i class="dc-ic">' + ((TCS.ui && TCS.ui.ICONS && TCS.ui.ICONS.log) || '') + '</i>',
      me: TCS.duelView.look(), op: { stage: bot.stage, cos: bot.cos },
      // rhythm: chops follow cps*t + a slow burst wave + small random wobble, so the average is exactly cps; never above MAX_BOT/s
      ph: Math.random() * 6.28, per: 1.6 + Math.random() * 1.2, amp: 0, recent: [],
      onChop: () => MM.chop(), onClose: () => closed(L) };
    L.amp = Math.min(0.3 * cps, Math.max(0, MAX_BOT - cps)) * L.per / (2 * Math.PI);   // wave rate amplitude (chops) without passing MAX_BOT
    MM.state = 'live';
    if (!TCS.duelView.open(L)){ MM.state = 'idle'; MM.live = null; m.live = null; S().save(); return; }
    L.timer = setInterval(() => botTick(L), 40);
  }
  function botTick(L){
    if (MM.live !== L || L.done) return;
    const now = performance.now();
    if (now >= L.goAt){
      const t = (now - L.goAt) / 1000;
      const wobble = Math.sin(t * 7.3 + L.ph * 2) * 0.6 + Math.sin(t * 13.1 + L.ph) * 0.4;
      const want = Math.floor(L.cps * t + L.amp * Math.sin(2 * Math.PI * t / L.per + L.ph) - L.amp * Math.sin(L.ph) + wobble - 0.4);
      L.recent = L.recent.filter(x => now - x < 1000);
      let add = 0;
      while (L.opp + add < Math.min(want, HP) && L.recent.length < MAX_BOT){ L.recent.push(now); add++; }
      if (add > 0){
        L.opp += add; TCS.duelView.opChop(add);
        if (L.opp >= HP){ TCS.duelView.fall('op'); finish(L, false); }
      }
    }
    TCS.duelView.draw();
  }
  MM.chop = function(){
    const L = MM.live; if (!L || L.done || TCS.duelView.L !== L) return false;
    if (!TCS.duelView.tryChop()) return false;
    if (L.mine >= HP) finish(L, true);
    return true;
  };
  function finish(L, won){
    if (L.paid || L.done) return;
    L.paid = true; clearInterval(L.timer);
    const m = rec();
    if (!m.live || m.live.id !== L.id) return;   // already settled (exactly once)
    const amt = applyResult(won, L.stakes.lose);
    L.result = { won, amount: amt };
    const line = (won ? '+' : '−') + U.fmt(amt) + ' logs';
    TCS.duelView.result({ won, line, msg: (won ? 'You won ' : 'You lost ') + line });
  }
  function closed(L){
    clearInterval(L.timer);
    if (MM.live === L){ MM.live = null; MM.state = 'idle'; MM.stakes_ = null; }
  }
  bus.on('unload', () => { MM.cancel(); if (MM.live && TCS.duelView.L === MM.live) TCS.duelView.close(); });   // marker stays: loss next load
  bus.on('menuOpen', () => MM.cancel());

  /* ---------- keys: M finds / cancels; Esc cancels a search ---------- */
  window.addEventListener('keydown', e => {
    if ((MM.state === 'searching' || MM.state === 'found') && e.key === 'Escape'){ e.preventDefault(); e.stopImmediatePropagation(); MM.cancel(); }
  }, true);
  window.addEventListener('keydown', e => {
    if (e.code !== 'KeyM' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (MM.state === 'idle' && !MM.available()) return;
    e.preventDefault(); MM.toggle();
  });
  bus.on('ready', ensureBtn);
  bus.on('load', () => setTimeout(ensureBtn, 0));
  setInterval(() => { if (MM.state === 'searching' && !MM.available()) MM.cancel(); }, 500);
})();
