/* leaderboard.js — title-screen leaderboards (top 50) for 4 stats: duel wins, logs, rebirths, acorns.
   Boards = deterministic bot players merged with real cloud players (leaderboard/{uid}) that beat the 50th entry.
   Bots: a fixed pool of BOT_N names (hand-written parts + seeded RNG). Each bot's stats are a pure function of
   (bot id, tick = floor(Date.now()/30000)), so every client shows the same values at the same moment and values never
   decrease: a bot joins on some day, plays one session a day (random start hour + length, slowly fading as it "quits"),
   and its played hours turn into rebirths -> acorns / logs / duel wins with per-bot skill factors.
   Real players (cloud accounts only): leaderboard/{uid} = {username, wins, logs, rebirths, acorns, at}, written by the owner
   (on load, every 60 s of saves, after a duel win). Values = max over this account's slots known to this client.
   API: TCS.leaderboard = { init(), at(tick) -> {wins,logs,rebirths,acorns: [{id,name,value}] (bots only, sorted, 50)},
        board(stat) (merged rows on screen), tick(), refresh(), open(), close(), select(stat), push(), STATS, bots } */
(function(){
  const TCS = window.TCS = window.TCS || {};
  const bus = TCS.bus;
  const TICK_MS = 10000, TOP = 50, BOT_N = 190;
  const STATS = ['wins', 'logs', 'rebirths', 'acorns'];
  const TITLES = { wins: 'Duel Wins', logs: 'Logs', rebirths: 'Rebirths', acorns: 'Acorns' };
  const EPOCH = Date.UTC(2026, 9, 1);   // day 0 of the bot timeline (2026-10-01)
  const DAY_H = 24;

  /* ---------- seeded PRNG ---------- */
  function hash(a, b){   // two ints -> uint32
    let h = (Math.imul(a | 0, 0x9E3779B1) ^ Math.imul((b | 0) + 0x7F4A7C15, 0x85EBCA77)) >>> 0;
    h ^= h >>> 16; h = Math.imul(h, 0x7FEB352D) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x846CA68B) >>> 0; h ^= h >>> 16;
    return h >>> 0;
  }
  const h01 = (a, b) => hash(a, b) / 4294967296;
  function mulberry(seed){ return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  /* ---------- names: hand-written parts, fixed by seed ---------- */
  const FIRST = ['Jake','Noah','Liam','Mason','Ethan','Owen','Lucas','Leo','Max','Sam','Ben','Eli','Finn','Kai','Ryan','Tyler','Logan','Caleb','Dylan','Jack',
    'Emma','Mia','Ava','Lily','Zoe','Ella','Maddie','Chloe','Ruby','Nora','Grace','Ivy','Hailey','Sophie','Abby','Luna','Jess','Kayla','Mila','Rosie',
    'Marco','Diego','Mateo','Luca','Jonas','Felix','Arjun','Ravi','Kenji','Hugo','Theo','Oscar','Milo','Nico','Omar','Yusuf','Ana','Sofia','Elena','Freya'];
  const WORD = ['Timber','Lumber','Oak','Pine','Maple','Birch','Cedar','Spruce','Willow','Acorn','Sawdust','Splinter','Stump','Bark','Log','Axe','Chop','Forest','Woody','Twig',
    'Shadow','Pixel','Frost','Storm','Blaze','Turbo','Ninja','Ghost','Rocket','Thunder','Cosmic','Lucky','Sneaky','Mega','Ultra','Hyper','Lazy','Crazy','Happy','Silent',
    'Wolf','Bear','Fox','Hawk','Tiger','Panda','Otter','Beaver','Moose','Raven','Falcon','Badger','Dragon','Shark','Goose','Llama','Squirrel','Owl','Lynx','Bison'];
  const SUFFIX = ['Lord','King','Queen','Master','Pro','God','Boss','Hunter','Slayer','Jack','Chopper','Smith','Man','Girl','Boy','Beast','Legend','Main','Gamer','Plays',
    'TTV','YT','HD','XD','Fan','Bot','Guy','Kid','Dude','Wizard'];
  const SOLO = ['kaii','zyro','vexx','nyx','jinx','ozzy','echo','bloop','miko','tofu','yuki','pip','juno','koda','remy','sage','zeke','nova','rio','fizz',
    'mochi','pogo','jojo','loki','taco','bean','waffle','pickle','noodle','biscuit','sprocket','gizmo','bonk','zap','ziggy','dino','nugget','cosmo','benny','peaches'];
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  function makeNames(){
    const r = mulberry(20261120), pick = a => a[Math.floor(r() * a.length)], num = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
    const styles = [
      () => pick(FIRST) + '_' + String.fromCharCode(65 + num(0, 25)),                 // Jake_M
      () => 'xX' + pick(WORD) + pick(SUFFIX) + 'Xx',                                   // xXShadowSlayerXx
      () => pick(WORD).toLowerCase() + pick(['wolf','bear','fox','hawk','jack','guy','kid','man']) + num(1, 99),  // timberwolf22
      () => pick(FIRST).toLowerCase() + '_plays',                                      // maddie_plays
      () => pick(WORD) + pick(SUFFIX),                                                 // LumberLord
      () => pick(SOLO),                                                                // kaii
      () => pick(FIRST) + 'The' + pick(['Great','Brave','Chopper','Mighty','Bold','Quick','Strong','Wise']),  // NoahTheGreat
      () => pick(WORD) + pick(['Suey','Chop','Stack','Pile','Swing','Snap']) + num(10, 99),               // ChopSuey88
      () => pick(FIRST).toLowerCase() + num(1990, 2014),                               // ella2009
      () => pick(SOLO) + '_' + pick(WORD).toLowerCase(),                               // tofu_pine
      () => pick(FIRST) + pick(WORD),                                                  // MiaFrost
      () => pick(WORD).toUpperCase().slice(0, 5) + num(1, 999),                        // TIMBE77 style shout names
      () => 'its' + pick(FIRST) + pick(['', '', 'x', 'yy', '_']),                      // itsLeo
      () => 'Not' + pick(FIRST),                                                       // NotJess
      () => pick(SOLO) + num(1, 999),                                                  // pickle42
      () => cap(pick(SOLO)) + pick(SUFFIX)                                             // WaffleKing
    ];
    const out = [], seen = {};
    while (out.length < BOT_N){
      const n = pick(styles)();
      if (!/^[A-Za-z0-9_]{4,16}$/.test(n) || seen[n.toLowerCase()]) continue;
      seen[n.toLowerCase()] = 1; out.push(n);
    }
    return out;
  }

  /* ---------- bot model ----------
     Calibrated on tests/sim.js (greedy player, 4 clicks/s, STAGE_TAPER 1.6), per completed rebirth R:
     SIM_H[R] = hours played, SIM_LG[R] = log10(lifetime logs). Past R=29 the sim's stages take 6 h+ each,
     so the table is extended with stages growing 1.25x longer and logs x2.4 per rebirth. Acorns earned
     follow the sim too (~2.9 R^2 + 3 R). */
  const SIM_H  = [0, 0.7, 1.2, 2.1, 3.0, 3.6, 4.0, 4.6, 5.2, 5.6, 6.0, 6.5, 7.2, 7.7, 8.4, 9.3, 10.5, 11.3, 12.4, 14.0,
                  15.1, 16.7, 19.0, 22.4, 27.2, 30.8, 43.9, 55.3, 72.3, 90];
  const SIM_LG = [6, 12.91, 13.39, 13.96, 14.39, 14.86, 15.29, 15.71, 16.13, 16.21, 16.37, 16.58, 16.87, 17.22, 17.60, 18.00,
                  18.41, 18.81, 19.20, 19.56, 19.93, 20.33, 20.74, 21.15, 21.56, 21.97, 22.37, 22.72, 23.09, 23.49, 23.90];
  (function extend(){ let stage = 18; for (let R = SIM_H.length; R <= 80; R++){ stage *= 1.25; SIM_H.push(SIM_H[R - 1] + stage); } for (let R = SIM_LG.length; R <= 81; R++) SIM_LG.push(SIM_LG[R - 1] + 0.38); })();
  // effective hours -> rebirths (fractional: progress through the current stage)
  function rebirthsOf(T){
    if (T <= 0) return 0;
    for (let R = 1; R < SIM_H.length; R++) if (T < SIM_H[R]) return R - 1 + (T - SIM_H[R - 1]) / (SIM_H[R] - SIM_H[R - 1]);
    return SIM_H.length - 1;
  }
  // lifetime logs after Rf rebirths: log-interpolated between table points (logs climb steadily through a stage)
  function log10LogsAt(Rf){ const R = Math.min(Math.floor(Rf), SIM_LG.length - 2), k = Rf - R; return SIM_LG[R] + (SIM_LG[R + 1] - SIM_LG[R]) * k; }
  function makeBots(){
    return makeNames().map((name, i) => {
      const r = mulberry(hash(i, 7) || 1);
      const lo = r(), r2 = r(), r3 = r(), r4 = r(), r5 = r(), r6 = r();
      return {
        id: 'b' + i, i, name,
        join: Math.floor(-110 + Math.pow(r2, 1.4) * 520),   // join day (most already joined; a trickle keeps arriving)
        hpd: 0.15 + 1.7 * Math.pow(lo, 2.4),                 // hours a day at the start (few grinders, many casuals)
        life: 8 + 45 * r3,                                // days until the habit fades (e-folding)
        floor: 0.02 + 0.08 * r6,                            // fraction of play that never fades
        skill: 0.35 + 0.6 * r4,                             // efficiency vs the sim's optimal player (0.35..0.95)
        logK: Math.pow(10, (r5 - 0.5) * 0.8),               // logs factor (x0.4 .. x2.5)
        acK: 0.85 + 0.3 * r(),                              // acorns (Seed Bank etc.)
        duel: 0.6 + 16 * Math.pow(r(), 2.6)               // duel wins per played hour (few duel addicts)
      };
    });
  }
  const BOTS = makeBots();
  // cumulative played hours at the start of day d (d days since join): integral of hpd*(floor + (1-floor) e^{-x/life})
  function cumDays(b, d){ return d <= 0 ? 0 : b.hpd * (b.floor * d + (1 - b.floor) * b.life * (1 - Math.exp(-d / b.life))); }
  function hoursAt(b, tHours){
    const dayAbs = Math.floor(tHours / DAY_H), d = dayAbs - b.join;
    if (d < 0) return 0;
    const base = cumDays(b, d), inc = cumDays(b, d + 1) - base;
    // today's play happens in one session: random start hour, 1..4 h long (spread over the session)
    const start = 8 + 15 * h01(b.i * 7919, dayAbs), len = 1 + 3 * h01(b.i * 104729 + 3, dayAbs);
    const k = Math.min(1, Math.max(0, (tHours - dayAbs * DAY_H - start) / len));
    return base + inc * k;
  }
  // smooth per-bot noise in [0,1): random points every ~3 min, eased between (so values drift, not jump)
  function drift(seed, tHours){
    const x = tHours * 20, i = Math.floor(x), f = x - i, e = f * f * (3 - 2 * f);
    return h01(seed, i) * (1 - e) + h01(seed, i + 1) * e;
  }
  // logs a bot HOLDS right now (the logs board shows current logs, like real players): a share of what it has
  // earned this stage. It climbs while chopping, drops when it buys upgrades, and starts near 0 after a rebirth.
  function heldLogs(b, Rf, tHours){
    const R = Math.min(Math.floor(Rf), SIM_LG.length - 2), k = Rf - R;
    const slope = SIM_LG[R + 1] - SIM_LG[R];
    const earnedThisStage = Math.pow(10, log10LogsAt(Rf)) * (1 - Math.pow(10, -slope * k));
    const share = 0.04 + 0.56 * drift(b.i * 31 + 11, tHours) * (0.97 + 0.06 * h01(b.i * 977 + 5, Math.floor(tHours * 360)));
    return b.logK * earnedThisStage * share;
  }
  function botStats(b, tHours){
    const H = hoursAt(b, tHours);
    if (H <= 0) return null;
    const Rf = rebirthsOf(H * b.skill), R = Math.floor(Rf);
    return {
      wins: Math.floor(H * b.duel),
      logs: Math.floor(heldLogs(b, Rf, tHours)),
      rebirths: R,
      acorns: Math.floor((2.9 * R * R + 3 * R) * b.acK)
    };
  }
  function at(tick){
    const t = (tick * TICK_MS - EPOCH) / 3600000, out = {};
    const all = BOTS.map(b => ({ b, s: botStats(b, t) })).filter(x => x.s);
    STATS.forEach(st => {
      out[st] = all.filter(x => x.s[st] > 0).map(x => ({ id: x.b.id, name: x.b.name, value: x.s[st] }))
        .sort((a, b) => b.value - a.value || (a.id < b.id ? -1 : 1)).slice(0, TOP);
    });
    return out;
  }
  const nowTick = () => Math.floor(Date.now() / TICK_MS);

  const LB = TCS.leaderboard = { STATS, TICK_MS, TOP, bots: BOTS, at, tick: nowTick, _botStats: botStats, _hoursAt: hoursAt, _rebirthsOf: rebirthsOf, _log10LogsAt: log10LogsAt, EPOCH };
  // every bot name (lower-case), so nobody can sign up as one and friend requests to them look normal
  const BOT_NAMES = {}; BOTS.forEach(b => { BOT_NAMES[b.name.toLowerCase()] = b.name; });
  LB.isBot = name => Object.prototype.hasOwnProperty.call(BOT_NAMES, String(name || '').trim().toLowerCase());
  LB.botName = name => BOT_NAMES[String(name || '').trim().toLowerCase()] || null;
  if (typeof document === 'undefined' || !bus) return;   // node (tuning / tests): model only

  /* ---------- real players (cloud) ---------- */
  const C = () => (TCS.cloud && TCS.cloud.active && TCS.fb) ? TCS.cloud : null;
  const fb = () => TCS.fb;
  let dbRef = null;
  function db(){ if (!dbRef && fb()) { try { dbRef = fb().F.getFirestore(fb().app); } catch(e){ dbRef = null; } } return dbRef; }
  const n0 = v => (typeof v === 'number' && isFinite(v) && v > 0) ? v : 0;
  // logs = logs held right now (goes down when spent or taken); rebirths / acorns / wins are lifetime totals
  function statsOf(d){ return d ? { wins: Math.floor(n0(d.duelWins)), logs: n0(d.wood), rebirths: Math.floor(n0(d.stats && d.stats.rebirths)), acorns: Math.floor(n0(d.acornsEarned)) } : null; }
  // per account: max over the slots this client knows (the cached cloud slots + the live one)
  function myStats(){
    const cl = C(); if (!cl || !cl.uid) return null;
    const S = TCS.state, best = { wins: 0, logs: 0, rebirths: 0, acorns: 0 };
    const add = s => { if (s) STATS.forEach(k => { if (s[k] > best[k]) best[k] = s[k]; }); };
    const live = S.loaded && S.profile && S.profile.username === cl.username ? S.profile.slot : -1;
    for (let s = 0; s < 3; s++) if (s !== live) add(statsOf(TCS.store.getJSON('tcs_csave_' + cl.uid + '_' + s, null)));
    if (live >= 0) add(statsOf(S.data));   // the live slot's current values, not its (older) cached copy
    return best;
  }
  // rules caps: whole numbers, rebirths <= 1000, acorns <= 1e8, wins <= 1e6
  function clampStats(s){
    return { wins: Math.min(1e6, Math.floor(s.wins)), logs: s.logs, rebirths: Math.min(1000, Math.floor(s.rebirths)), acorns: Math.min(1e8, Math.floor(s.acorns)) };
  }
  let lastPush = 0, lastSent = null, pushing = null, retry = null;
  LB.push = function(force){
    const cl = C(), d = db(); if (!cl || !cl.uid || !cl.username || !d) return Promise.resolve(false);
    let s = myStats(); if (!s) return Promise.resolve(false);
    s = clampStats(s);
    const key = JSON.stringify(s) + cl.uid;
    if (!force && key === lastSent) return Promise.resolve(true);
    lastPush = Date.now();
    const F = fb().F;
    pushing = F.setDoc(F.doc(d, 'leaderboard', cl.uid), Object.assign({ username: cl.username }, s, { at: F.serverTimestamp() }))
      .then(() => { lastSent = key; clearTimeout(retry); retry = null; return true; }, e => {
        console.warn('leaderboard write', e && e.code);
        if (!retry) retry = setTimeout(() => { retry = null; LB.push(true); }, 20000);   // e.g. offline: try again
        return false;
      });
    return pushing;
  };
  // while playing: upload at most every 20 s (only when something changed), so the board stays close to live
  bus.on('save', () => { if (Date.now() - lastPush >= 20000) LB.push(); });
  setInterval(() => { if (TCS.state && TCS.state.loaded && Date.now() - lastPush >= 20000) LB.push(); }, 5000);
  bus.on('load', () => setTimeout(() => LB.push(), 0));
  bus.on('adminGrant', () => setTimeout(() => LB.push(true), 0));    // admin gave/took: show it right away
  bus.on('rebirth', () => setTimeout(() => LB.push(true), 0));
  // logging in (even without opening a save) uploads the stats of the cached slots, so the board knows you
  bus.on('cloudUser', () => setTimeout(() => LB.push(), 1500));
  bus.on('menuOpen', () => setTimeout(() => LB.push(), 500));
  bus.on('duelResult', e => { if (e && e.won) setTimeout(() => LB.push(true), 0); });
  bus.on('logout', () => { lastSent = null; });

  /* admin backfill: Shiv can read every save, so while Shiv is on the menu, every player's entry is brought in line
     with their cloud saves (e.g. players who haven't played since leaderboards came out). Logs are set to what the
     save holds now (can go down); lifetime stats are never lowered. */
  let lastFill = 0;
  async function adminBackfill(){
    const cl = C(), d = db(); if (!cl || !cl.admin || !d || Date.now() - lastFill < 2 * 60000) return 0;
    lastFill = Date.now();
    const F = fb().F, best = {};
    try {
      (await F.getDocs(F.query(F.collectionGroup(d, 'slots'), F.limit(500)))).forEach(doc => {
        const v = doc.data(); if (!v || !v.uid || !v.username) return;
        let data = null; try { data = JSON.parse(v.data); } catch(e){}
        const s = statsOf(data) || { wins: 0, logs: n0(v.wood), rebirths: Math.floor(n0(v.rebirths)), acorns: 0 };
        const b = best[v.uid] || (best[v.uid] = { username: v.username, wins: 0, logs: 0, rebirths: 0, acorns: 0 });
        STATS.forEach(k => { if (s[k] > b[k]) b[k] = s[k]; });
      });
      const have = {};
      (await F.getDocs(F.query(F.collection(d, 'leaderboard'), F.limit(1000)))).forEach(doc => { have[doc.id] = doc.data(); });
      let n = 0;
      for (const uid of Object.keys(best)){
        if (uid === cl.uid) continue;                 // own entry comes from push()
        const b = clampStats(best[uid]), h = have[uid] || {};
        const next = {}; let raise = !have[uid];
        STATS.forEach(k => {
          const cur = typeof h[k] === 'number' ? h[k] : 0;
          next[k] = k === 'logs' ? b[k] : Math.max(cur, b[k]);
          if (next[k] !== cur) raise = true;
        });
        if (!raise) continue;
        if (have[uid]) next.wins = Math.min(next.wins, (h.wins || 0) + 20);   // rules cap per write
        try { await F.setDoc(F.doc(d, 'leaderboard', uid), Object.assign({ username: best[uid].username }, next, { at: F.serverTimestamp() })); n++; }
        catch(e){ console.warn('leaderboard backfill', uid, e && e.code); }
      }
      return n;
    } catch(e){ console.warn('leaderboard backfill', e && e.code); return 0; }
  }
  LB.adminBackfill = (force) => { if (force) lastFill = 0; return adminBackfill(); };
  // admin gave/took logs or acorns from another player: update their entry now, even if they're offline
  // (their own game re-uploads exact numbers once it applies the grant)
  LB.adminAdjusted = async function(uid, kind, n){
    const cl = C(), d = db(); if (!cl || !cl.admin || !d || !uid || uid === cl.uid) return false;
    const F = fb().F, ref = F.doc(d, 'leaderboard', uid);
    try {
      const snap = await F.getDoc(ref); if (!snap.exists()) { LB.adminBackfill(true); return false; }
      const h = snap.data(), next = { wins: h.wins || 0, logs: h.logs || 0, rebirths: h.rebirths || 0, acorns: h.acorns || 0 };
      if (kind === 'acorns') next.acorns = Math.max(0, Math.floor(next.acorns + n)); else next.logs = Math.max(0, next.logs + n);
      await F.setDoc(ref, Object.assign({ username: h.username }, clampStats(next), { at: F.serverTimestamp() }));
      return true;
    } catch(e){ console.warn('leaderboard adjust', e && e.code); return false; }
  };
  bus.on('menuOpen', () => setTimeout(adminBackfill, 2000));
  bus.on('cloudStatus', e => { if (e && e.online) setTimeout(adminBackfill, 2000); });

  // real players: a live Firestore listener on the shown board (top 50 by that stat) while the menu is visible.
  // After the first read it only receives the entries that change, so a 10 s refresh stays cheap.
  const realCache = {};   // stat -> {t, rows} (last known rows, also used while the listener warms up)
  let live = null;        // {stat, unsub, ready: Promise}
  function rowsOf(qs, stat){
    const rows = [];
    qs.forEach(doc => { const v = doc.data(); if (typeof v[stat] === 'number' && v[stat] > 0) rows.push({ id: 'u_' + doc.id, uid: doc.id, name: String(v.username || '?').slice(0, 16), value: v[stat] }); });
    return rows;
  }
  function stopLive(){ if (live){ try { live.unsub(); } catch(e){} live = null; } }
  LB._stopLive = stopLive;
  async function fetchReal(stat){
    const cl = C(), d = db(); if (!cl || !d) return [];
    if (!live || live.stat !== stat){
      stopLive();
      const F = fb().F; let first;
      const ready = new Promise(r => first = r);
      const unsub = F.onSnapshot(F.query(F.collection(d, 'leaderboard'), F.orderBy(stat, 'desc'), F.limit(TOP)),
        qs => { realCache[stat] = { t: Date.now(), rows: rowsOf(qs, stat) }; first(); },
        e => { console.warn('leaderboard listen', e && e.code); first(); stopLive(); });
      live = { stat, unsub, ready };
      await Promise.race([ready, new Promise(r => setTimeout(r, 4000))]);
    }
    return (realCache[stat] && realCache[stat].rows) || [];
  }
  function merge(bots, real, stat){
    const cl = C(), meUid = cl && cl.uid;
    const names = {}; real.forEach(r => names[r.name.toLowerCase()] = 1);
    let rows = bots.filter(b => !names[b.name.toLowerCase()]).concat(real);
    // my own value: use the live one (fresher than the doc)
    const mine = meUid ? myStats() : null;
    if (mine){
      rows = rows.filter(r => r.uid !== meUid);
      if (mine[stat] > 0) rows.push({ id: 'u_' + meUid, uid: meUid, name: cl.username, value: mine[stat], me: true });
    }
    rows.sort((a, b) => b.value - a.value || (a.id < b.id ? -1 : 1));
    const top = rows.slice(0, TOP);
    const meIdx = rows.findIndex(r => r.me);
    return { rows: top, me: mine ? { rank: meIdx >= 0 && meIdx < TOP ? meIdx + 1 : 0, value: mine[stat] } : null };
  }

  /* ---------- UI ---------- */
  const INK = '#1b1b1b';
  const g = inner => '<svg viewBox="0 0 40 40"><g stroke="' + INK + '" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">' + inner + '</g></svg>';
  const SWORDS = g('<path d="M8 6l18 18M32 6L14 24" fill="none" stroke-width="5"/><path d="M8 6l18 18M32 6L14 24" fill="none" stroke="#dfe7ee" stroke-width="2.4"/><path d="M22 26l6-6M18 26l-6-6" fill="none"/><path d="M27 28l5 5M13 28l-5 5" fill="none" stroke="#a8693a" stroke-width="4"/>');
  const ICON = st => {
    const I = (TCS.ui && TCS.ui.ICONS) || {};
    return { wins: SWORDS, logs: I.log, rebirths: I.sprout, acorns: I.acorn }[st] || '';
  };
  const TROPHY = () => ((TCS.ui && TCS.ui.ICONS) || {}).trophy || '🏆';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const fmt = v => (TCS.util && TCS.util.fmt) ? TCS.util.fmt(v) : String(Math.floor(v));

  let card, listEl, titleEl, meEl, btn, tab = 'logs', shown = {}, timer = null, lastScroll = 0, pending = false, curTick = null, rowEls = {};
  try { const t = localStorage.getItem('tcs_lb_tab'); if (STATS.indexOf(t) >= 0) tab = t; } catch(e){}

  function menuVisible(){ const m = document.getElementById('menu-root'); return !!(m && m.style.display !== 'none' && card && card.isConnected); }
  const isPhone = () => window.matchMedia('(max-width:820px)').matches;

  function build(){
    const root = document.getElementById('menu-root'); if (!root) return false;
    if (card && card.isConnected) return true;
    btn = document.createElement('button');
    btn.className = 'lb-btn btn card-panel'; btn.title = 'Leaderboards'; btn.setAttribute('aria-label', 'Leaderboards');
    btn.innerHTML = TROPHY();
    card = document.createElement('div');
    card.className = 'lb-card card-panel'; card.setAttribute('role', 'region'); card.setAttribute('aria-label', 'Leaderboards');
    card.innerHTML = '<div class="lb-head"><div class="lb-tabs" role="tablist">' +
      STATS.map(s => '<button class="lb-tab" role="tab" data-stat="' + s + '" title="' + TITLES[s] + '" aria-label="' + TITLES[s] + '">' + ICON(s) + '</button>').join('') +
      '</div><button class="lb-x" aria-label="Close">×</button></div><div class="lb-title outlined"></div><ol class="lb-list"></ol><div class="lb-me" hidden></div>';
    root.appendChild(btn); root.appendChild(card);
    listEl = card.querySelector('.lb-list'); titleEl = card.querySelector('.lb-title'); meEl = card.querySelector('.lb-me');
    card.addEventListener('pointerdown', e => e.stopPropagation());
    btn.addEventListener('pointerdown', e => e.stopPropagation());
    card.querySelectorAll('.lb-tab').forEach(b => b.onclick = () => { click(); LB.select(b.dataset.stat); });
    card.querySelector('.lb-x').onclick = () => { click(); LB.close(); };
    btn.onclick = () => { click(); LB.open(); };
    listEl.addEventListener('scroll', () => { lastScroll = performance.now(); }, { passive: true });
    listEl.addEventListener('pointerdown', () => { lastScroll = performance.now(); });
    return true;
  }
  const click = () => { try { TCS.audio.play('click'); } catch(e){} };

  LB.select = function(stat){
    if (STATS.indexOf(stat) < 0) return;
    tab = stat;
    try { localStorage.setItem('tcs_lb_tab', stat); } catch(e){}
    rowEls = {}; listEl.innerHTML = ''; listEl.scrollTop = 0;
    LB.refresh(true);
  };
  LB.open = function(){ if (!build()) return; card.classList.add('open'); document.body.classList.add('lb-open'); LB.refresh(); };
  LB.close = function(){ if (card) card.classList.remove('open'); document.body.classList.remove('lb-open'); };
  Object.defineProperty(LB, 'stat', { get: () => tab });

  // count a number up from its shown value
  function countTo(el, from, to){
    if (from === to || !(from > 0)){ el.textContent = fmt(to); el._v = to; return; }
    const t0 = performance.now(), D = 1200; el._v = to;
    const step = now => {
      if (el._v !== to) return;
      const k = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  let gen = 0, current = null;
  LB.board = () => current;
  LB.refresh = async function(force){
    if (!build()) return;
    const my = ++gen;
    const tk = nowTick() + (LB._offset || 0);
    const stat = tab;
    const bots = at(tk)[stat];
    const real = await fetchReal(stat);
    if (my !== gen) return;
    const m = merge(bots, real, stat);
    // don't move rows under a scrolling finger: retry shortly
    if (!force && performance.now() - lastScroll < 1500 && listEl.children.length){ if (!pending){ pending = true; setTimeout(() => { pending = false; LB.refresh(); }, 1600); } return; }
    curTick = tk; current = { stat, tick: tk, rows: m.rows, me: m.me };
    render(m, stat);
  };

  function render(m, stat){
    card.dataset.stat = stat;
    card.querySelectorAll('.lb-tab').forEach(b => { const on = b.dataset.stat === stat; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    titleEl.innerHTML = '<i>' + ICON(stat) + '</i>Top 50 · ' + TITLES[stat];
    // FLIP: remember old positions
    const before = {}; Object.keys(rowEls).forEach(id => { before[id] = rowEls[id].offsetTop; });
    const oldRank = {}; Object.keys(rowEls).forEach(id => oldRank[id] = +rowEls[id].dataset.rank);
    const scroll = listEl.scrollTop;
    const keep = {};
    m.rows.forEach((r, i) => {
      let el = rowEls[r.id];
      if (!el){
        el = document.createElement('li');
        el.className = 'lb-row';
        el.innerHTML = '<span class="lb-rank"></span><span class="lb-name"></span><span class="lb-val"></span>';
        el.querySelector('.lb-name').textContent = r.name;
        rowEls[r.id] = el;
      }
      el.dataset.id = r.id; el.dataset.rank = i + 1;
      el.classList.toggle('me', !!r.me);
      el.classList.remove('g1', 'g2', 'g3'); if (i < 3) el.classList.add('g' + (i + 1));
      el.querySelector('.lb-rank').textContent = i + 1;
      const v = el.querySelector('.lb-val');
      countTo(v, v._v, r.value);
      keep[r.id] = 1;
      listEl.appendChild(el);   // moves into order
    });
    Object.keys(rowEls).forEach(id => { if (!keep[id]){ rowEls[id].remove(); delete rowEls[id]; } });
    listEl.scrollTop = scroll;
    // animate moves + flash climbers
    m.rows.forEach(r => {
      const el = rowEls[r.id], was = before[r.id];
      if (was === undefined){ if (Object.keys(before).length){ el.classList.remove('new'); void el.offsetWidth; el.classList.add('new'); } return; }
      const dy = was - el.offsetTop;
      if (dy){
        el.style.transition = 'none'; el.style.transform = 'translateY(' + dy + 'px)';
        requestAnimationFrame(() => { el.style.transition = ''; el.style.transform = ''; });
      }
      if (oldRank[r.id] > +el.dataset.rank){ el.classList.remove('up'); void el.offsetWidth; el.classList.add('up'); }
    });
    if (m.me && !m.me.rank && m.me.value > 0){
      const v = m.me.value, one = v === 1, unit = { wins: one ? 'duel win' : 'duel wins', logs: one ? 'log' : 'logs', rebirths: one ? 'rebirth' : 'rebirths', acorns: one ? 'acorn' : 'acorns' }[stat] || '';
      meEl.hidden = false; meEl.textContent = 'You · ' + fmt(v) + ' ' + unit + ' · not in top 50 yet';
    }
    else meEl.hidden = true;
  }

  function loop(){
    if (timer) return;
    let last = null;
    timer = setInterval(() => {
      if (!menuVisible()){ last = null; stopLive(); return; }
      const tk = nowTick();
      if (tk !== last){ last = tk; if (tk !== curTick) LB.refresh(); }
    }, 1000);
  }

  LB.init = function(){
    if (!build()) return;
    LB.refresh(true);
    loop();
    bus.on('menuOpen', () => { build(); LB.close(); LB.refresh(true); });
    bus.on('gameStart', () => LB.close());
    bus.on('cloudUser', () => LB.refresh(true));
    bus.on('logout', () => LB.refresh(true));
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && card && card.classList.contains('open')) LB.close(); });
  };
})();
