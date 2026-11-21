/* state.js — phase 1. Game state, economy math, rebirth, achievements, save/load. No rendering here. */
(function(){
  const TCS = window.TCS = window.TCS || {};
  const D = TCS.data;
  const bus = TCS.bus;

  /* ---------- safe storage ---------- */
  const store = {
    get(k){ try { return localStorage.getItem(k); } catch(e){ return null; } },
    set(k, v){ try { localStorage.setItem(k, v); return true; } catch(e){ return false; } },
    remove(k){ try { localStorage.removeItem(k); } catch(e){} },
    getJSON(k, def){ try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch(e){ return def; } },
    setJSON(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch(e){ return false; } }
  };
  TCS.store = store;

  function fresh(){
    const owned = {}; D.UPGRADES.forEach(u => owned[u.id] = 0);
    return {
      version: D.SAVE_VERSION,
      profileName: 'Lumberjack',
      wood: 0, runWood: 0, lifetimeWood: 0,
      owned, tech: {},
      acorns: 0, acornsEarned: 0, perks: {},
      duelWins: 0,                   // duels won (friends.js payout, once per duel; leaderboard)
      speciesIndex: 0, species: 0,   // species = stage index (alias kept in sync with speciesIndex)
      achievements: {}, cosmetics: {}, equipped: { hat: null, face: null, boots: null }, autoselect: true,
      stats: { clicks: 0, chops: 0, height: 0, squirrels: 0, frenzies: 0, rebirths: 0, coffees: 0, playTime: 0, bestPerSecond: 0 },
      settings: { music: 0.5, sfx: 0.8, graphics: 'high', numberFormat: 'short' },
      frenzy: { meter: 0, timeLeft: 0 },
      coffee: { timeLeft: 0, cooldown: 0 },
      burst: { timeLeft: 0, mult: 1 },
      createdAt: Date.now(), lastSaved: Date.now()
    };
  }
  // fill missing fields from fresh() so older saves keep working (migration hook)
  function migrate(d){
    const f = fresh();
    (function merge(dst, src){
      for (const k in src){
        if (dst[k] === undefined || dst[k] === null && src[k] !== null) dst[k] = src[k];
        else if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k]) && typeof dst[k] === 'object') merge(dst[k], src[k]);
      }
    })(d, f);
    // v1 -> v2: upgrades now have max levels. Clamp owned, keep acorns/achievements/cosmetics.
    D.UPGRADES.forEach(u => { d.owned[u.id] = Math.max(0, Math.min(u.max, Math.floor(d.owned[u.id] || 0))); });
    for (const id in d.tech) if (!D.techById[id]) delete d.tech[id];
    if (!(d.speciesIndex >= 0)) d.speciesIndex = 0;
    d.species = d.speciesIndex;
    d.version = D.SAVE_VERSION;
    return d;
  }

  const S = TCS.state = {
    data: fresh(),
    profile: null,           // {username, slot}
    store,
    loaded: false,

    /* ---------- derived values ---------- */
    perk(id){ return S.data.perks[id] || 0; },
    species(){
      const i = S.data.speciesIndex;
      const sp = D.SPECIES[i % D.SPECIES.length];
      const tier = Math.floor(i / D.SPECIES.length);
      return Object.assign({}, sp, { tier, index: i, totalMult: sp.mult * Math.pow(D.SPECIES_TIER_MULT, tier),
        displayName: sp.name + (tier ? ' ' + roman(tier + 1) : '') });
    },
    acornMult(){ return 1 + D.ACORN_BONUS * S.data.acornsEarned; },
    frenzyActive(){ return S.data.frenzy.timeLeft > 0; },
    coffeeActive(){ return S.data.coffee.timeLeft > 0; },
    // combined global multiplier shown in shop footer
    multiplier(){
      return S.acornMult() * S.species().totalMult * (S.frenzyActive() ? D.FRENZY_MULT : 1) *
        (S.coffeeActive() ? D.COFFEE_MULT : 1) * S.techMult('all');
    },
    techMult(target){
      let m = 1;
      for (const id in S.data.tech){ if (!S.data.tech[id]) continue; const t = D.techById[id]; if (t && t.effect.target === target) m *= t.effect.mult; }
      return m;
    },
    // production of one upgrade line (base value x owned x techs), before global multiplier
    upgradeOutput(id){
      const u = D.upgradeById[id];
      return u.value * (S.data.owned[id] || 0) * S.techMult(id) * S.techMult(u.type);
    },
    perClickBase(){
      let v = 1;
      D.UPGRADES.forEach(u => { if (u.type === 'click') v += S.upgradeOutput(u.id); });
      return v * Math.pow(2, S.perk('strongArms'));
    },
    perClick(){ return S.perClickBase() * S.multiplier() * (S.data.burst.timeLeft > 0 ? S.data.burst.mult : 1); },
    perSecondBase(){
      let v = 0;
      D.UPGRADES.forEach(u => { if (u.type !== 'click') v += S.upgradeOutput(u.id); });
      return v;
    },
    perSecond(){ return S.perSecondBase() * S.multiplier(); },

    /* ---------- shop ---------- */
    // stage cost scaling: species mult x hardness^stage, so bonuses never make a later stage faster
    costMult(){ const n = S.data.speciesIndex, k = D.STAGE_TAPER_FROM; return S.species().totalMult * Math.pow(D.STAGE_HARDNESS, Math.min(n, k)) * Math.pow(D.STAGE_TAPER, Math.max(0, n - k)); },
    stage(i){
      if (i === undefined) i = S.data.speciesIndex;
      const st = D.STAGES[i % D.STAGES.length], tier = Math.floor(i / D.STAGES.length);
      return { name: st.name + (tier ? ' ' + roman(tier + 1) : ''), species: st.species, index: i, tier };
    },
    maxLevel(id){ return D.upgradeById[id].max; },
    isMaxed(id){ return (S.data.owned[id] || 0) >= D.upgradeById[id].max; },
    maxedCount(){ return D.UPGRADES.filter(u => S.isMaxed(u.id)).length; },
    unmaxedCount(){ return D.UPGRADES.length - S.maxedCount(); },
    techCost(id){ return Math.ceil(D.techById[id].cost * S.costMult()); },
    upgradeCost(id, count){
      const u = D.upgradeById[id]; const n = S.data.owned[id] || 0; count = count || 1;
      if (n + count > u.max) return Infinity;
      let disc = S.costMult(); if (u.type === 'worker') disc *= Math.pow(0.9, S.perk('unionContract'));
      // geometric sum of count copies
      const g = D.PRICE_GROWTH;
      return Math.ceil(u.cost * disc * Math.pow(g, n) * (Math.pow(g, count) - 1) / (g - 1));
    },
    canAfford(id){ return S.data.wood >= S.upgradeCost(id); },
    buy(id, count){
      count = count || 1;
      const cost = S.upgradeCost(id, count);
      if (!D.upgradeById[id] || !isFinite(cost) || S.data.wood < cost) return false;
      S.data.wood -= cost;
      const before = S.data.owned[id] || 0;
      S.data.owned[id] = before + count;
      bus.emit('buy', { id, count: S.data.owned[id], first: before === 0, cost });
      bus.emit('owned', S.data.owned);
      S.checkAchievements();
      return true;
    },
    // tech that is unlocked (req met) and not yet bought
    availableTech(){
      return D.TECH.filter(t => !S.data.tech[t.id] && (S.data.owned[t.req.upgrade] || 0) >= t.req.count);
    },
    buyTech(id){
      const t = D.techById[id];
      if (!t || S.data.tech[id] || (S.data.owned[t.req.upgrade] || 0) < t.req.count || S.data.wood < S.techCost(id)) return false;
      S.data.wood -= S.techCost(id); S.data.tech[id] = true;
      bus.emit('buyTech', { id });
      return true;
    },
    perkCost(id){ const p = D.perkById[id]; const l = S.perk(id); return l < p.costs.length ? p.costs[l] : Infinity; },
    buyPerk(id){
      const c = S.perkCost(id);
      if (!isFinite(c) || S.data.acorns < c) return false;
      S.data.acorns -= c; S.data.perks[id] = S.perk(id) + 1;
      bus.emit('buyPerk', { id, level: S.data.perks[id] });
      return true;
    },

    /* ---------- earning ---------- */
    addWood(n){
      if (!(n > 0)) return;
      S.data.wood += n; S.data.runWood += n; S.data.lifetimeWood += n;
    },
    // chop(source='click'|'space'|'auto'|'squirrel') -> wood gained. Scene/fx react to the 'chop' event.
    chop(source){
      const amt = S.perClick();
      S.addWood(amt);
      const st = S.data.stats;
      if (source !== 'auto') st.clicks++;
      st.chops++;
      // frenzy meter
      if (!S.frenzyActive()){
        S.data.frenzy.meter = Math.min(1, S.data.frenzy.meter + 0.025);
        if (S.data.frenzy.meter >= 1) S.startFrenzy();
      }
      let segment = false;
      // height chopped: each chop cuts a share of a segment, so the counter climbs on every swing
      st.height = Math.round((st.height + D.SEGMENT_METRES / D.CHOPS_PER_SEGMENT) * 1000) / 1000;
      if (st.chops % D.CHOPS_PER_SEGMENT === 0) segment = true;
      bus.emit('chop', { amount: amt, source: source || 'click', frenzy: S.frenzyActive() });
      if (segment) bus.emit('segment', { height: st.height });
      return amt;
    },
    startFrenzy(){
      S.data.frenzy.timeLeft = D.FRENZY_DURATION + 5 * S.perk('longerFrenzy');
      S.data.frenzy.meter = 1;
      S.data.stats.frenzies++;
      bus.emit('frenzyStart', { duration: S.data.frenzy.timeLeft });
    },
    canCoffee(){ return S.data.coffee.timeLeft <= 0 && S.data.coffee.cooldown <= 0; },
    startCoffee(){
      if (!S.canCoffee()) return false;
      S.data.coffee.timeLeft = D.COFFEE_DURATION; S.data.coffee.cooldown = 0;
      S.data.stats.coffees++;
      bus.emit('coffeeStart', { duration: D.COFFEE_DURATION });
      return true;
    },
    // golden squirrel reward. kind 'wood' => 60s of production, 'burst' => 77x click for 10s
    squirrelReward(kind){
      S.data.stats.squirrels++;
      let amount = 0;
      if (kind === 'burst'){ S.data.burst.timeLeft = 10; S.data.burst.mult = 77; }
      else { amount = Math.max(S.perSecond() * 60, S.perClick() * 30); S.addWood(amount); }
      bus.emit('squirrel', { kind, amount });
      S.checkAchievements();
      return amount;
    },
    // squirrel spawn interval multiplier (fx uses it)
    squirrelRate(){ return 1 + 0.25 * S.perk('luckySquirrel'); },

    tick(dt){
      const d = S.data;
      const ps = S.perSecond();
      if (ps > 0) S.addWood(ps * dt);
      if (ps > d.stats.bestPerSecond) d.stats.bestPerSecond = ps;
      d.stats.playTime += dt;
      if (d.frenzy.timeLeft > 0){
        d.frenzy.timeLeft -= dt; d.frenzy.meter = Math.max(0, d.frenzy.timeLeft / (D.FRENZY_DURATION + 5 * S.perk('longerFrenzy')));
        if (d.frenzy.timeLeft <= 0){ d.frenzy.timeLeft = 0; d.frenzy.meter = 0; bus.emit('frenzyEnd'); }
      } else d.frenzy.meter = Math.max(0, d.frenzy.meter - dt * 0.03);
      if (d.coffee.timeLeft > 0){
        d.coffee.timeLeft -= dt;
        if (d.coffee.timeLeft <= 0){ d.coffee.timeLeft = 0; d.coffee.cooldown = D.COFFEE_COOLDOWN; bus.emit('coffeeEnd'); }
      } else if (d.coffee.cooldown > 0) d.coffee.cooldown = Math.max(0, d.coffee.cooldown - dt);
      if (d.burst.timeLeft > 0){ d.burst.timeLeft -= dt; if (d.burst.timeLeft <= 0){ d.burst.timeLeft = 0; d.burst.mult = 1; bus.emit('burstEnd'); } }
      if (S.perk('autoSwing')){ S._auto = (S._auto || 0) + dt; if (S._auto >= 1){ S._auto -= 1; S.chop('auto'); } }
      S._achT = (S._achT || 0) + dt; if (S._achT > 0.5){ S._achT = 0; S.checkAchievements(); }
    },

    /* ---------- rebirth ---------- */
    // Moving to the next stage needs (nearly) every upgrade maxed: at most REBIRTH_ALLOWED_UNMAXED not maxed.
    canRebirth(){ return S.unmaxedCount() <= D.REBIRTH_ALLOWED_UNMAXED; },
    // Acorns: fixed per stage cleared (grows with the stage) + a bonus per upgrade maxed beyond the rule, x Seed Bank.
    acornsOnRebirth(){
      const extra = Math.max(0, D.REBIRTH_ALLOWED_UNMAXED - S.unmaxedCount());
      const base = D.ACORNS_BASE + D.ACORNS_PER_STAGE * S.data.speciesIndex + D.ACORNS_EXTRA_MAXED * extra;
      return Math.floor(base * (1 + 0.1 * S.perk('seedBank')));
    },
    rebirth(force){
      if (!force && !S.canRebirth()) return false;
      const gain = Math.max(force ? 1 : 0, S.acornsOnRebirth());
      const d = S.data;
      d.acorns += gain; d.acornsEarned += gain;
      d.wood = 0; d.runWood = 0;
      D.UPGRADES.forEach(u => d.owned[u.id] = 0);
      d.tech = {};
      d.frenzy = { meter: 0, timeLeft: 0 }; d.burst = { timeLeft: 0, mult: 1 };
      d.speciesIndex++; d.species = d.speciesIndex; d.stats.rebirths++;
      const eb = S.perk('earlyBird');
      if (eb) S.addWood(D.perkById.earlyBird.values[eb - 1] * S.costMult());
      bus.emit('rebirth', { acorns: gain, species: S.species() });
      bus.emit('owned', d.owned);
      S.checkAchievements();
      S.save();
      return gain;
    },
    forceRebirth(){ return S.rebirth(true); },
    // test hook: max every upgrade except the last `leave` ones
    _maxAll(leave){
      leave = leave || 0;
      D.UPGRADES.forEach((u, i) => { if (i < D.UPGRADES.length - leave) S.data.owned[u.id] = u.max; });
      bus.emit('owned', S.data.owned); S.checkAchievements();
    },

    /* ---------- achievements & cosmetics ---------- */
    statValue(stat){
      if (stat.startsWith('own:')) return S.data.owned[stat.slice(4)] || 0;
      if (stat === 'lifetimeWood') return S.data.lifetimeWood;
      return S.data.stats[stat] || 0;
    },
    checkAchievements(){
      const d = S.data;
      for (const a of D.ACHIEVEMENTS){
        if (d.achievements[a.id]) continue;
        if (S.statValue(a.stat) >= a.n){
          d.achievements[a.id] = true;
          bus.emit('achievement', { ach: a });
          if (a.cosmetic && !d.cosmetics[a.cosmetic]){
            d.cosmetics[a.cosmetic] = true;
            const c = D.cosmeticById[a.cosmetic];
            bus.emit('cosmeticUnlock', { cosmetic: c });
            if (d.autoselect) S.equip(c.slot, c.id);
          }
        }
      }
    },
    achievementCount(){ return Object.keys(S.data.achievements).filter(k => S.data.achievements[k]).length; },
    equip(slot, id){
      if (id && !S.data.cosmetics[id]) return false;
      S.data.equipped[slot] = id || null;
      bus.emit('equip', { slot, id: id || null });
      return true;
    },

    /* ---------- save / load ---------- */
    // cloud mode caches each cloud slot locally under the signed-in uid (js/cloud.js keeps it in sync)
    key(username, slot){
      const C = TCS.cloud;
      if (C && C.uid && String(username).toLowerCase() === String(C.username || '').toLowerCase()) return 'tcs_csave_' + C.uid + '_' + slot;
      return 'tcs_save_' + String(username).toLowerCase() + '_' + slot;
    },
    // set the active profile (call before load/newGame). accounts/menu phase owns the flow.
    setProfile(username, slot){ S.profile = { username, slot }; },
    save(){
      if (!S.profile || !S.loaded) return false;
      S.data.lastSaved = Date.now();
      const ok = store.setJSON(S.key(S.profile.username, S.profile.slot), S.data);
      bus.emit('save', { ok });
      return ok;
    },
    // load(username, slot) -> true if an existing save was loaded, false if a new game was started
    load(username, slot){
      S.setProfile(username, slot);
      const raw = store.getJSON(S.key(username, slot), null);
      let existed = false;
      if (raw && typeof raw === 'object'){ S.data = migrate(raw); existed = true; }
      else S.data = fresh();
      S.loaded = true;
      if (existed) S.applyOffline();
      S.applySettings();
      bus.emit('load', { existed, profile: S.profile });
      bus.emit('owned', S.data.owned);
      S.checkAchievements();
      if (!existed) S.save();
      return existed;
    },
    newGame(username, slot, profileName){
      S.setProfile(username, slot);
      S.data = fresh(); if (profileName) S.data.profileName = profileName;
      S.loaded = true;
      S.applySettings();
      S.save();
      bus.emit('load', { existed: false, profile: S.profile });
      bus.emit('owned', S.data.owned);
    },
    unload(){ S.save(); S.loaded = false; S.profile = null; bus.emit('unload'); },
    // slot summary for profile select: null if empty
    slotInfo(username, slot){
      const d = store.getJSON(S.key(username, slot), null);
      if (!d) return null;
      const sp = D.SPECIES[(d.speciesIndex || 0) % D.SPECIES.length];
      return { profileName: d.profileName, lifetimeWood: d.lifetimeWood || 0, wood: d.wood || 0, rebirths: (d.stats && d.stats.rebirths) || 0,
        species: sp.name, stage: D.STAGES[(d.speciesIndex || 0) % D.STAGES.length].name, playTime: (d.stats && d.stats.playTime) || 0, lastSaved: d.lastSaved };
    },
    deleteSlot(username, slot){ store.remove(S.key(username, slot)); if (TCS.cloud && TCS.cloud.uid) TCS.cloud.onDelete(slot); },
    renameSlot(username, slot, name){
      const d = store.getJSON(S.key(username, slot), null); if (!d) return false;
      d.profileName = String(name).slice(0, 20); store.setJSON(S.key(username, slot), d);
      if (TCS.cloud && TCS.cloud.uid) TCS.cloud.onRename(slot, d);
      if (S.profile && S.profile.username === username && S.profile.slot === slot) S.data.profileName = d.profileName;
      return true;
    },
    applyOffline(){
      const d = S.data;
      const secs = Math.max(0, (Date.now() - (d.lastSaved || Date.now())) / 1000);
      const ns = S.perk('nightShift');
      const cap = (D.OFFLINE_CAP_H + 4 * ns) * 3600;
      const rate = D.OFFLINE_RATE + 0.1 * ns;
      // offline uses production without temporary boosts
      d.frenzy.timeLeft = 0; d.burst.timeLeft = 0; d.burst.mult = 1;
      if (d.coffee.timeLeft > 0){ d.coffee.timeLeft = 0; d.coffee.cooldown = D.COFFEE_COOLDOWN; }
      d.coffee.cooldown = Math.max(0, d.coffee.cooldown - secs);
      const t = Math.min(secs, cap);
      const mult = S.multiplier() * rate * t;
      // per-worker/machine breakdown: every per-second upgrade kept working while away
      const lines = [];
      D.UPGRADES.forEach(u => {
        if (u.type === 'click' || !(d.owned[u.id] > 0)) return;
        const amt = S.upgradeOutput(u.id) * mult;
        if (amt > 0) lines.push({ id: u.id, name: u.name, owned: d.owned[u.id], amount: amt });
      });
      const amount = lines.reduce((a, l) => a + l.amount, 0);
      if (amount > 0 && secs > 5){
        // held until the player presses COLLECT on the welcome-back screen (kept in the save if they leave first)
        const p = d.pendingOffline;
        if (p && p.amount > 0){
          p.amount += amount; p.seconds += secs; p.capped = p.capped || secs > cap;
          lines.forEach(l => { const o = p.lines.find(x => x.id === l.id); if (o){ o.amount += l.amount; o.owned = l.owned; } else p.lines.push(l); });
        } else d.pendingOffline = { amount, seconds: secs, capped: secs > cap, capHours: cap / 3600, rate, lines };
        d.pendingOffline.lines.sort((a, b) => b.amount - a.amount);
      }
      return amount;
    },
    /* ---------- admin (only the "Shiv" account) ----------
       Local-only like the accounts themselves: saves live in this browser's localStorage, so this
       gates the UI, not real security. Only works while Shiv is the logged-in account. */
    ADMIN_NAME: 'shiv',
    isAdmin(){
      if (TCS.cloud && TCS.cloud.active) return !!(TCS.cloud.uid && TCS.cloud.admin);
      const cur = TCS.accounts && TCS.accounts.current;
      return !!cur && String(cur).toLowerCase() === S.ADMIN_NAME && !!TCS.accounts.find(cur);
    },
    // every saved profile on this device: [{username, slot, name, wood, self}]
    adminTargets(query){
      if (!S.isAdmin()) return [];
      if (TCS.cloud && TCS.cloud.active) return TCS.cloud.adminTargets(query); // Promise of rows (key = uid)
      const out = [];
      TCS.accounts.list().forEach(a => {
        for (let slot = 0; slot < 3; slot++){
          const self = S.profile && S.profile.username.toLowerCase() === a.username.toLowerCase() && S.profile.slot === slot;
          const d = self ? S.data : store.getJSON(S.key(a.username, slot), null);
          if (d) out.push({ username: a.username, slot, name: d.profileName || ('Profile ' + (slot + 1)), wood: d.wood || 0, self });
        }
      });
      return out;
    },
    // give n logs to a profile (the live one directly, others by editing their stored save)
    adminGiveWood(username, slot, n){ return S.adminAdjust(username, slot, 'logs', n); },
    // apply an admin change to save data d: kind 'logs' | 'acorns', delta > 0 gives, < 0 takes (never below 0)
    applyAdmin(d, kind, delta){
      if (kind === 'acorns'){
        delta = Math.round(delta);
        if (delta < 0) delta = -Math.min(-delta, d.acorns || 0);
        d.acorns = (d.acorns || 0) + delta; d.acornsEarned = Math.max(0, (d.acornsEarned || 0) + delta);
      } else if (delta > 0){
        d.wood = (d.wood || 0) + delta; d.runWood = (d.runWood || 0) + delta; d.lifetimeWood = (d.lifetimeWood || 0) + delta;
      } else {
        delta = -Math.min(-delta, d.wood || 0); d.wood = (d.wood || 0) + delta;
      }
      return delta;
    },
    // admin: give (n > 0) or take (n < 0) logs or acorns from a profile
    adminAdjust(username, slot, kind, n){
      if (!S.isAdmin() || !n || !isFinite(n)) return false;
      kind = kind === 'acorns' ? 'acorns' : 'logs';
      if (kind === 'acorns'){ n = Math.round(n); if (!n) return false; }
      const live = TCS.cloud && TCS.cloud.active
        ? (S.profile && username === TCS.cloud.uid && S.profile.slot === slot)
        : (S.profile && S.profile.username.toLowerCase() === String(username).toLowerCase() && S.profile.slot === slot);
      if (live){
        if (kind === 'logs' && n > 0) S.addWood(n); else S.applyAdmin(S.data, kind, n);
        S.save(); bus.emit('adminGrant', { amount: n, kind }); return true;
      }
      // cloud: username is the target's uid; other players get it through a grant doc their client applies
      if (TCS.cloud && TCS.cloud.active) return TCS.cloud.grant(username, slot, n, kind);
      const k = S.key(username, slot), d = store.getJSON(k, null);
      if (!d) return false;
      S.applyAdmin(d, kind, n);
      return store.setJSON(k, d);
    },
    // adds the held idle earnings to the wood counter; returns the amount
    collectOffline(){
      const p = S.data && S.data.pendingOffline;
      if (!p || !(p.amount > 0)) return 0;
      S.data.pendingOffline = null;
      S.addWood(p.amount);
      bus.emit('offlineCollected', { amount: p.amount });
      S.save();
      return p.amount;
    },
    exportSave(){ try { return btoa(unescape(encodeURIComponent(JSON.stringify(S.data)))); } catch(e){ return ''; } },
    importSave(b64){
      try {
        const d = JSON.parse(decodeURIComponent(escape(atob(String(b64).trim()))));
        if (!d || typeof d !== 'object' || typeof d.wood !== 'number') return false;
        S.data = migrate(d); S.loaded = true; S.applySettings(); S.save();
        bus.emit('load', { existed: true, imported: true, profile: S.profile });
        bus.emit('owned', S.data.owned);
        return true;
      } catch(e){ return false; }
    },
    setSetting(k, v){ S.data.settings[k] = v; S.applySettings(); bus.emit('settings', S.data.settings); },
    applySettings(){
      const s = S.data.settings;
      if (TCS.util) TCS.util.setOutlines(s.graphics !== 'low');
      TCS.lowParticles = s.graphics === 'low';
      if (TCS.audio){ TCS.audio.setMusicVolume(s.music); TCS.audio.setSfxVolume(s.sfx); }
    },
    startAutosave(){
      if (S._autosave) return;
      S._autosave = setInterval(S.save, 10000);
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') S.save(); });
      window.addEventListener('beforeunload', S.save);
      window.addEventListener('pagehide', S.save);
    },

    _fresh: fresh
  };

  function roman(n){ const m = [[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']]; let s = ''; for (const [v, r] of m) while (n >= v){ s += r; n -= v; } return s; }
})();
