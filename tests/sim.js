/* Economy simulation: runs the real data.js + state.js headless with a greedy player.
   Player: clicks CPS times a second, keeps frenzy/coffee going, buys the best value (production gained / cost)
   upgrade or tech it can see, waiting for it if not affordable; moves to the next stage as soon as allowed.
   Usage: node tests/sim.js [stages=3] [cps=5] */
const fs = require('fs'), path = require('path'), vm = require('vm');
const STAGES = +process.argv[2] || 3, CPS = +process.argv[3] || 5;

const ctx = { console, Math, Date, JSON, Object, Array, Number, String, Infinity, isFinite };
ctx.window = ctx; ctx.TCS = { bus: { on() {}, off() {}, emit() {} } };
vm.createContext(ctx);
for (const f of ['data.js', 'state.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx);
const { state: S, data: D } = ctx.TCS;
S.loaded = false; S.data = S._fresh();

const DT = 1 / CPS;
const gain = () => S.perSecond() + CPS * S.perClick();
function option(fn) { // production gain of an action, measured by applying and reverting it
  const before = gain(); const undo = fn(); const after = gain(); undo(); return after - before;
}
function bestOption() {
  const d = S.data; let best = null;
  for (const u of D.UPGRADES) {
    if (S.isMaxed(u.id)) continue;
    const idx = u.index, visible = idx === 0 || (d.owned[D.UPGRADES[idx - 1].id] || 0) > 0 || d.owned[u.id] > 0;
    if (!visible) continue;
    const cost = S.upgradeCost(u.id);
    const g = option(() => { d.owned[u.id]++; return () => d.owned[u.id]--; });
    // once production stops mattering, still finish maxing: tiny bonus so everything gets bought
    const score = (g + gain() * 1e-4) / cost;
    if (!best || score > best.score) best = { kind: 'up', id: u.id, cost, score };
  }
  for (const t of S.availableTech()) {
    const cost = S.techCost(t.id);
    const g = option(() => { d.tech[t.id] = true; return () => delete d.tech[t.id]; });
    const score = g / cost;
    if (!best || score > best.score) best = { kind: 'tech', id: t.id, cost, score };
  }
  return best;
}
function runStage() {
  let t = 0, target = null, buys = 0;
  while (!S.canRebirth()) {
    if (S.canCoffee()) S.startCoffee();
    S.chop('click'); S.tick(DT); t += DT;
    if (!target) target = bestOption();
    while (target && S.data.wood >= target.cost) {
      if (target.kind === 'up') S.buy(target.id); else S.buyTech(target.id);
      buys++; target = bestOption();
    }
    if (t > 6 * 3600) return { t, timeout: true, buys };
  }
  return { t, buys };
}
const res = []; let tmin = 0;
for (let s = 0; s < STAGES; s++) {
  const name = S.stage().name;
  const r = runStage();
  const acorns = S.acornsOnRebirth(); tmin += r.t / 60;
  console.log(`stage ${s + 1} ${name.padEnd(22)} ${(r.t / 60).toFixed(1).padStart(6)} min${r.timeout ? ' (TIMEOUT)' : ''}  buys ${r.buys}  maxed ${S.maxedCount()}/25  acorns +${acorns}  perSec ${S.perSecond().toExponential(2)}  life ${S.data.lifetimeWood.toExponential(3)}  tmin ${tmin.toFixed(1)}  acornsE ${S.data.acornsEarned + acorns}`);
  res.push(r.t / 60);
  S.rebirth();
  // spend acorns: cheapest perk first (a reasonable player)
  for (;;) {
    let c = null; for (const p of D.PERKS) { const k = S.perkCost(p.id); if (isFinite(k) && k <= S.data.acorns && (!c || k < c.k)) c = { id: p.id, k }; }
    if (!c) break; S.buyPerk(c.id);
  }
}
console.log('perks:', JSON.stringify(S.data.perks), 'acorns left', S.data.acorns);
