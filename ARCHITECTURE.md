# Tree Chopping Simulator — Architecture

Spec: `PROMPT.md`. No build step. Runs from `file://` and any static server.

## Loading model
- `index.html` has an import map pinning `three@0.160.0`, and ONE inline module that does `window.THREE = THREE` and then appends the classic scripts in this order, each after the previous `onload`:
  `util, data, state, scene, world, upgrades3d, audio, fx, ui, accounts, menu, main` (check `index.html` for the exact list)
- Every file is a classic script wrapped in an IIFE that registers on `window.TCS`. **Do not use `import`/`export`.** Use `window.THREE`.
- To add a new file, add its name to the `files` array in `index.html` (before `main`). Files that load later can use anything from earlier files at load time; anything from later files only inside functions (`init()` etc).
- CSS: `css/style.css` (phase 1, base), `css/ui.css` (UI phase), `css/menu.css` (menu phase). Both extra files already exist (empty) and are linked. Edit only your own file.
- Must stay valid on `file://`: no `fetch()` of local files, no local ES modules. Audio files (if any) via `new Audio('audio/x.mp3')` work on file://.

## Files and owners
| File | Owner | Status |
|---|---|---|
| index.html, css/style.css, js/util.js, js/data.js, js/state.js, js/scene.js, js/main.js | Phase 1 (foundation) | done |
| js/ui.js, css/ui.css | UI phase (shop, icon column, outfits, frenzy meter, toasts, settings, offline card) | stub with working HUD |
| js/upgrades3d.js | Upgrades-3D phase (25 unique scene models) | stub (coloured crates) |
| js/fx.js | FX phase (golden squirrel, frenzy/coffee visuals, rebirth cinematic, cosmetic meshes) | stub |
| js/audio.js | Audio phase | stub (silent) |
| js/accounts.js, js/menu.js, css/menu.css | Menu phase (title, accounts, profiles) | stub: auto-starts guest slot 0; `?menu` shows orbit camera |

## Style rules (shared)
- UI text: class `outlined` (white, 3px `#1b1b1b` stroke, all caps, Patrick Hand SC). `outlined-sm` = 2px stroke.
- White card panel: class `card-panel`; button: class `btn`.
- `#ui-layer` (above canvas) has `pointer-events:none`; its direct children get `auto` — add class `passthrough` to opt out.
- 3D: always build with `TCS.model.part` (toon + outline). Never mutate a cached material from `TCS.util.toon()` (shared); pass `{nocache:true}` for a private one. Use `U.blobShadow` under characters/vehicles. Pop new things in with `U.popIn`.

---

## js/util.js
`TCS.bus`
- `on(event, fn) -> unsubscribeFn`, `off(event, fn)`, `emit(event, data)` (handler errors are caught/logged)

`TCS.util` (`U`)
- `fmt(n, {decimals?, sci?}) -> string` — `999`, `1,234`, `12.3K`, `4.56M`, B T Qa Qi Sx Sp Oc No Dc UDc … Vg, then `aa, ab…`. Scientific when `state.data.settings.numberFormat === 'scientific'` (`1.23e15`).
- `fmtTime(sec) -> '1h 5m' | '3m 2s' | '9s'`
- `toon(color, {emissive, emissiveIntensity, opacity, map, nocache}) -> MeshToonMaterial` (cached, shared 3-step `gradientMap`)
- `outline(mesh, thickness=0.06, {abs}?) -> hull` — inverted hull child (black BackSide, scale 1+thickness; `abs` = absolute thickness for thin parts)
- `setOutlines(bool)` (Low graphics), `outlinesOn`, `trackOutlines(root)` (register hulls of a `.clone()`), `forgetOutlines(root)` (call when discarding)
- `blobShadow(radius, opacity=0.3) -> Mesh` (flat, y=0.03)
- `tween(dur, fn(easedK, rawT), {ease, delay, done}) -> {cancel()}` — eases: linear, outQuad, inQuad, inOutQuad, outBack, outElastic, or a function. Ticked by the scene update.
- `popIn(obj, targetScale=1, dur=0.5)`, `squash(obj, amount=0.15, dur=0.2)` (uses `obj.userData.baseScale`)
- `rand(a,b)`, `clamp(v,a,b)`, `lerp(a,b,t)`, `ease`

`TCS.model`
- `part(type, size[], color|material, opts) -> Mesh` (outlined toon). Types/size: `box [w,h,d,radius?]`, `cyl [rTop,rBot,h,seg?]`, `sphere [r,wSeg?,hSeg?]`, `capsule [r,len]`, `cone [r,h,seg?]`, `torus [r,tube]`, `lathe [[x,y],...]`, `dodeca [r,detail]`, `ico [r,detail]`. opts: `pos, rot, scale (n|[x,y,z]), outline (number|false), abs, parent, name, emissive, emissiveIntensity, opacity, nocache`.
- `group(parent?, pos?) -> Group`, `geo(type,size)` (cached geometry), `roundedBox(w,h,d,r)`

## js/data.js — `TCS.data` (pure data)
- `UPGRADES[25]`: `{id, index, name, type:'click'|'worker'|'machine', value, cost, icon(emoji placeholder), perSecond}`; `upgradeById`
  ids: whetstone, rookie, steelAxe, hauler, doubleBit, beaver, crosscut, muleCart, chainsaw, sawmill, crew, splitter, skidSteer, feller, flume, mech, trucks, thunderAxe, skyCrane, robots, drill, megafactory, satellite, giantAxe, portal
- `TECH[79]`: `{id, name, desc, req:{upgrade,count}, cost, effect:{target: upgradeId|'click'|'worker'|'machine'|'all', mult}, tier:1|2|3, icon}`; 3 per upgrade (own 10/25/50 → x2) + 4 group techs; `techById`. Gold-border cards in the shop.
- `SPECIES[8]`: `{id, name, mult, bark, barkDark, leaf, leaf2, inner, conifer?, crystal?, emissive?}`; `SPECIES_TIER_MULT=34` (after Golden the cycle repeats with tier II, III…)
- `PERKS[8]`: `{id, name, desc, costs[] (acorns per level), values?}`; `perkById`. ids: strongArms, earlyBird, luckySquirrel, autoSwing, unionContract, longerFrenzy, nightShift, seedBank
- `COSMETICS = {hat:[6], face:[5], boots:[4]}`: `{id, name, color, slot, unlock (achievement id), unlockText}`; `cosmeticById`
  hats: beanie, hardhat, cowboy, viking, propeller, crown · face: beard, braid, goggles, shades, mustache · boots: workboots, rainboots, rocketboots, goldboots
- `ACHIEVEMENTS[85]`: `{id, name, desc, stat, n, cosmetic|null}`; `achById`. stat = `lifetimeWood | clicks | squirrels | frenzies | rebirths | height | coffees | own:<upgradeId>`
- Tunables: `PRICE_GROWTH 1.15, REBIRTH_MIN_WOOD 1e6, ACORN_BONUS 0.1, OFFLINE_RATE 0.5, OFFLINE_CAP_H 8, FRENZY_DURATION 20, FRENZY_MULT 2, COFFEE_DURATION 120, COFFEE_COOLDOWN 600, COFFEE_MULT 2, CHOPS_PER_SEGMENT 6, SEGMENT_METRES 1, SAVE_VERSION 1`

## js/state.js — `TCS.state` (`S`), `TCS.store`
`S.data` (the save object): `version, profileName, wood, runWood, lifetimeWood, owned{id:n}, tech{id:true}, acorns (spendable), acornsEarned (total, drives the bonus), perks{id:level}, speciesIndex, achievements{id:true}, cosmetics{id:true}, equipped{hat,face,boots}, autoselect, stats{clicks, chops, height, squirrels, frenzies, rebirths, coffees, playTime, bestPerSecond}, settings{music, sfx, graphics:'high'|'low', numberFormat:'short'|'scientific'}, frenzy{meter 0..1, timeLeft}, coffee{timeLeft, cooldown}, burst{timeLeft, mult}, createdAt, lastSaved`
`S.profile = {username, slot} | null`, `S.loaded`

Economy
- `perClick()`, `perSecond()`, `perClickBase()`, `perSecondBase()`, `upgradeOutput(id)` (before global mult)
- `multiplier()` = acorns(1+0.1·acornsEarned) × species × frenzy × coffee × tech 'all' (shop footer). `acornMult()`, `techMult(target)`, `species() -> {...SPECIES[i], tier, index, totalMult, displayName}`, `perk(id) -> level`
- `upgradeCost(id, count=1)` (×1.15 per owned, Union Contract discount on workers), `canAfford(id)`, `buy(id, count=1) -> bool`
- `availableTech() -> TECH[]` (unlocked, unbought), `buyTech(id) -> bool`
- `perkCost(id)` (Infinity at max), `buyPerk(id) -> bool`
- `chop(source='click'|'space'|'auto') -> amount` — adds wood, stats, frenzy meter (+2.5% per chop, drains 3%/s), emits `chop` and every 6 chops `segment`
- `startFrenzy()`, `frenzyActive()`, `canCoffee()`, `startCoffee() -> bool`, `coffeeActive()`
- `squirrelReward('wood'|'burst') -> amount` (60s of production / 77× click for 10s), `squirrelRate()` (Lucky Squirrel factor: divide spawn interval by it)
- `tick(dt)` (main calls it every frame: income, timers, auto-swing, achievement check every 0.5s)
- `addWood(n)` (test hook too)

Rebirth
- `canRebirth()` (runWood ≥ 1M), `acornsOnRebirth()` = `floor(sqrt(lifetimeWood/1e6)) − acornsEarned`, ×(1+5%·Seed Bank)
- `rebirth(force?) -> acornsGained|false` — resets wood/upgrades/tech/frenzy, keeps the rest, `speciesIndex++`, applies Early Bird, emits `rebirth`, saves. The fx/ui phase should play the cinematic and then call it (or call it and react to `rebirth`).
- `forceRebirth()` (test hook: rebirth regardless, ≥1 acorn)

Achievements / cosmetics
- `checkAchievements()`, `achievementCount()`, `statValue(stat)`, `equip(slot, id|null) -> bool` (only unlocked ids). Unlocking a cosmetic auto-equips when `data.autoselect`.

Save / load (keys `tcs_save_<username lowercased>_<slot>`, slot 0..2; accounts phase owns `tcs_accounts`)
- `load(username, slot) -> existed` (new game if empty; applies offline earnings; emits `load`, `owned`)
- `newGame(username, slot, profileName?)`, `save() -> bool`, `unload()` (save + clear profile, emits `unload`)
- `slotInfo(username, slot) -> {profileName, lifetimeWood, wood, rebirths, species, playTime, lastSaved} | null`, `deleteSlot(u,s)`, `renameSlot(u,s,name)`
- `applyOffline()` (50% rate, 8h cap; Night Shift +4h/+10% per level; emits `offline`)
- `exportSave() -> base64`, `importSave(base64) -> bool`
- `setSetting(key, value)` (applies outlines + audio volumes, emits `settings`), `applySettings()`
- `startAutosave()` (10s interval, visibilitychange, beforeunload, pagehide) — main calls it
- `TCS.store.get/set/remove/getJSON/setJSON` — every localStorage access is try/catch'ed. Use it.

## js/scene.js — `TCS.scene` (`SC`)
- `THREE, renderer, scene, camera, world (Group), lights {hemi, sun}`
- `addToWorld(obj) -> obj`, `removeFromWorld(obj)`
- `onUpdate(fn(dt)) -> unsubscribe` (runs every frame after tweens), `onChop(fn)` (= `bus.on('chop')`)
- `update(dt)`, `render()`, `resize()` — main drives these
- `tree`: `{group, trunk, segments, SEG_H 2, SEG_R 1.15, radius, base (Vector3, the tree is at the world origin), species, setSpecies(sp), dropSegment(), setNotch(0..1), impactPoint() -> Vector3}`
- `lumberjack`: `{root, body, head, armPivot, axe (default axe Group), axeHead, blade, handle, slots, swing(), attach(slot, mesh|null, {pop}), detach(slot), setAxe(group|null), swinging}`
  - slots: `hat` (top of head), `face` (front of head, origin on face surface; hides default stubble), `boots` (mesh → left foot, auto clone → right; hides default boots), `bootL`, `bootR`, `hand` (axe grip; +z = along handle), `head`, `body`.
  - Lumberjack is at (-3, 0, 0.35), scale 1.35, facing the tree. Axe variants: build a Group shaped like the default (handle along +z, head at z≈0.9) and `setAxe(group)`; `setAxe(null)` restores.
- `chopFx({amount?, frenzy?, toHud=true, notch?})` — swing + chips + notch + float number (already fired on every `chop` event in play mode)
- `spawnChips(pos, n, toHud)`, `floatText(text, Vector3|{x,y}, {cls, rise, dur, force})`, `worldToScreen(v) -> {x,y}`
- `shake(amount=0.15, dur=0.2)`
- `setMode('play'|'orbit')`, `mode`, `cam` (tunables: `pitch, yaw, dist, screenShift, orbitSpeed`). Orbit = constant-speed title orbit with a self-chopping lumberjack (no wood).
- `addClickable(obj, fn(hit, event), priority=10) -> remove` — higher priority wins over the tree/lumberjack (priority 0). Use for the golden squirrel etc. `pick(clientX, clientY)`.
- Chips fly to the element `#hud-wood-icon` and add class `bounce` on landing (UI phase: keep that id on the wood icon).

## Stub contracts for other phases
- `TCS.ui`: `init()`, `update(dt)` (per frame), `show(bool)`, `toast(text)`, `ICONS`. Must keep `#hud`, `#hud-wood-icon`. Shop/panels go in the right column.
- `TCS.upgrades3d`: `init()`, `sync(ownedCounts)` (on every `owned` event, including after load/rebirth when counts drop to 0 — remove models then), `onClick(chopEvt)`, `update(dt)`.
- `TCS.fx`: `init()`, `update(dt)`, `rebirthCinematic(done)`, `makeCosmetic(id) -> Object3D|null`, `applyEquipped()` (main calls it on `load`/`equip`).
- `TCS.audio`: `play(name, opts?)`, `setMusicVolume(v)`, `setSfxVolume(v)`, `startMusic()`, `unlock()` (main calls on first pointer/key). Names main already plays: `chop`, `buy`, `log`, `achievement`.
- `TCS.accounts`: `current`, `list()`, `create(u, p) -> Promise<{ok,error}>`, `login(u, p) -> Promise<{ok,error}>`, `logout()`.
- `TCS.menu`: `init()` (main calls last), `open()`, `startGame(username, slot)`.
- `TCS.paused` (bool): when true, no chopping and no `tick`.

## Bus events
| Event | Payload | Emitted by |
|---|---|---|
| `ready` | – | main, after boot |
| `load` | `{existed, imported?, profile}` | state.load / newGame / importSave |
| `unload` | – | state.unload |
| `save` | `{ok}` | state.save |
| `offline` | `{amount, seconds}` | state.applyOffline (UI shows "While you were away") |
| `chop` | `{amount, source, frenzy}` | state.chop |
| `chopImpact` | `{point: Vector3}` | scene (moment the axe hits) |
| `segment` | `{height}` | state.chop every 6 chops (scene drops a log) |
| `trunkLanded` | – | scene after trunk slides down |
| `chipLanded` | – | scene, a chip reached the HUD |
| `treeClick` | `{x, y, target:'tree'|'lumberjack'}` | scene picking (main turns it into `state.chop`) |
| `buy` | `{id, count, first, cost}` | state.buy |
| `owned` | `{upgradeId: count}` | buy / load / rebirth |
| `buyTech` | `{id}` | state.buyTech |
| `buyPerk` | `{id, level}` | state.buyPerk |
| `frenzyStart` / `frenzyEnd` | `{duration}` / – | state |
| `coffeeStart` / `coffeeEnd` | `{duration}` / – | state |
| `burstEnd` | – | state (77× squirrel burst over) |
| `squirrel` | `{kind, amount}` | state.squirrelReward |
| `rebirth` | `{acorns, species}` | state.rebirth |
| `achievement` | `{ach}` | state.checkAchievements |
| `cosmeticUnlock` | `{cosmetic}` | state |
| `equip` | `{slot, id}` | state.equip |
| `settings` | settings object | state.setSetting |
| `sceneMode` | `'play'|'orbit'` | scene.setMode |
| `gameStart` / `menuOpen` / `logout` | | menu / accounts |

## Testing hooks
`TCS.state.addWood(n)`, `TCS.state.forceRebirth()`, `TCS.state.buy(id)`, `TCS.state.chop()`, `TCS.state.save()`, `TCS.ready`.
Wait ~0.5 s after `TCS.ready` before projecting screen points (the camera updates on the first frame). Headless Chromium needs `--use-angle=swiftshader --enable-unsafe-swiftshader`.

## scene additions
- `lumberjack.aim(strikeAngle, back=1.2)` — sets the armPivot yaw at the moment of impact (local to the lumberjack) and the rest pose (`strike + back`). scene calls it from the notch direction; you rarely need it.
- `floatText(...)` now returns `{el, restart()}` (or `undefined` when skipped) and accepts `opts.spread` (random offset multiplier, default 1). At most 7 float numbers exist at once (oldest removed). Chop numbers that land within ~0.26 s merge into one growing number (`.float-num.big` once it has merged 4+ hits).
- `cam.screenLift` (desktop: fraction of view height the lumberjack+tree group sits below centre; tall side-shop windows sit a little lower) and `cam.phoneLift` (<600px bottom-sheet layout: fraction above centre). Non-phone framing centres the group in the play area left of the icon column + shop and zooms out to fit it (mirrors ui.css `--shop-w`/`--ib`). Framing uses `camera.setViewOffset`, so `worldToScreen`/`pick` already account for it.

---

## Stages, economy v2, world, audio, Esc (integration pass)

### Stage index — one source of truth
`state.data.speciesIndex` (unbounded, +1 per rebirth) with `state.data.species` kept as an alias (always equal). Stage/place = `speciesIndex % 8`; tier = `floor(speciesIndex / 8)`.
World (`stateStage()`), audio (`dataStage()`), ui (`state.stage(i)`), menu (`slotInfo().stage`/`.species`) all derive from it.

### data.js additions
- `STAGES[8]`: `{name, species}` — Oak Meadow, Birch Lake, Pine Mountains, Redwood Valley, Cherry Blossom Garden, Ice Spruce Tundra, Crystal Caverns, Golden Temple.
- `ECON {C0, R, V0, Q, MAX_LEVEL:25}`; every upgrade has `max` (25).
- `REBIRTH_ALLOWED_UNMAXED 2`, `STAGE_HARDNESS 3.4`, `ACORNS_BASE 8`, `ACORNS_PER_STAGE 4`, `ACORNS_EXTRA_MAXED 3`, `SAVE_VERSION 2` (v1 saves migrate: counts clamped to max, acorns kept).

### state.js additions
- `costMult()` = species totalMult × `STAGE_HARDNESS^speciesIndex` (applied to upgrade + tech costs), `techCost(id)`.
- `stage(i = speciesIndex) -> {name (with tier numeral), species, index, tier}`.
- `maxLevel(id)`, `isMaxed(id)`, `maxedCount()`, `unmaxedCount()`; `buy()` refuses past max.
- `canRebirth()` = `unmaxedCount() <= REBIRTH_ALLOWED_UNMAXED` ("Next stage"/replant panel). `acornsOnRebirth()` = `BASE + PER_STAGE·n + EXTRA·(maxed beyond the rule)`, ×Seed Bank.
- `slotInfo()` also returns `stage` (place name).
- `tests/sim.js` — headless economy pacing simulation (`node tests/sim.js`).

### js/world.js — `TCS.world`
Per-stage place: ground checker colours, sky/fog/light tint, merged decor (one draw call per material, vertex-shader pop-in), ambient particles, title-only idle workers/animals, and a few small low accent props inside the visible play area (`ACCENT_SPOTS`, clear of the tree, lumberjack, rolling-log arc and every maxed upgrades3d footprint). Crystal Caverns uses crisp checker-aligned floor tiles instead of blob patches.
- `setStage(i, {fade=true, banner=false, species=false, force=false})` — white fade (`#world-fade`, z 45) → swap → fade out; `stage` (getter), `STAGES`, `NAMES`, `stageName(i)`, `clear(x, z, r)` (decor keep-out test incl. all upgrades3d zones), `life`, `drawCalls()`.
- Title: tours all stages every 16 s while in orbit with no save loaded.
- Banner (`.world-banner`, 40% from top, centred over the play area left of the shop, auto-sized) shows the place name once, on `rebirthCinematicEnd`.

### Rebirth sequence (order)
1. ui GO → `fx.rebirthCinematic(done)`: TIMBER! (30%) + `audio.play('timber')`, tree falls, hides.
2. `done()` → `state.rebirth()` → `rebirth` event → scene species swap, world `setStage` (white fade, under the hidden tree), audio queues fanfare + `sprout` (no timber here).
3. REPLANTED! (24%) pops 0.3 s after TIMBER fades, gone ~1.9 s later; sapling grows.
4. `rebirthCinematicEnd` → audio `setStage(i, true)` (stage track + one fanfare), world banner. Fallback: audio plays them 9 s after `rebirth` if no cinematic end arrives.

### audio.js additions
- 9 procedural tracks: `title`, `stage0`…`stage7`; `playTrack(name)`, `stopMusic()`, `setStage(i)` (track only), getters `stage`, `track` (current track name), `tracks`, `muted`, `musicVolume`, `sfxVolume`, `ctx`; `setMuted`, `toggleMute` (persisted `tcs_mute`, emits `mute`).
- Stage-flavoured SFX: `chop`, `chip`, `log`, `fanfare` (`opts.stage`), plus `timber`, `sprout`, `frenzy`, `coffee`, `caught`, `click`, `toast`, `denied`.
- `renderOffline(name, secs, sfxList?) -> {peak, rms}` (testing).
- Bus: `menuOpen` → title track; `load` → stage track; `stage` event `(i | {index})` → stage track + fanfare.

### Keys
- Esc toggles Settings (ui.js). Ignored while typing in inputs, in the title menu (scene mode ≠ play / not loaded), and during the rebirth cinematic (`window.__fxCine`). Space is blocked during the cinematic.

### Camera (title)
`cam.phoneTitlePitch`, `cam.phoneTitleLift`, `cam.phoneTitleShift` — at ≤820 px wide the title orbit puts the trunk on the right third and menu.css puts the logo top-left so they don't overlap.

### Tests
`node tests/e2e.js` (Playwright; set `NODE_PATH` to a node_modules with playwright) — 41 checks incl. world stage + stage track after rebirth, Esc, v1 migration, file:// load.

## Friends + duels (js/friends.js, css/friends.css) — cloud accounts only
Hidden unless `TCS.cloud.active`, the SDK loaded and the loaded slot belongs to the signed-in cloud user. Starts on `load`, stops on `unload`/`logout`.
- UI: a people button appended to `#outfit-btns` (red dot = pending requests/challenges) + key F → `#friends-panel` (username input, Enter sends; requests with ✓/✕; friends with online dot + ⚔; hover/long-press shows a tiny × to remove). ⚔ swaps the row into an amount input (k/M/B…) + logs/acorn toggle, Enter sends. Incoming challenges: `#duel-cards` (top centre). Duel: `#duel-ov` overlay (3-2-1, click/tap/Space chops, HP bar + both players' bars), then one result line that closes after 3.5 s or a click. While `TCS.duel` is true a capture keydown handler eats Space/Esc/F, so the idle game gets no input (income keeps ticking).
- Firestore: `friendReqs/{from}_{to}`, `friends/{uid}/list/{other}`, `presence/{uid}` (lastSeen + wood/acorns, every 60 s), `duels/{id}` — see the header of friends.js and `firestore.rules`.
- Duel rules: funds checked against both players' presence at create and accept; each player writes only `pa/ta` or `pb/tb` (≤4/s, 3 s heartbeat); ≤20 chops/s since GO (client and rules); winner set once in a transaction (100 chops, or forfeit when the opponent sent nothing for 15 s); pending challenges expire after 2 min. Payout: loser −wager (clamped at 0), winner +wager (wood, not lifetimeWood), saved + flushed, then `paidA/paidB`; `S.data.duelsPaid` keeps it once per save across reloads. Doc deleted when both paid.
- Tunables in data.js: `DUEL_HP 100, DUEL_MAX_CPS 20, DUEL_COUNTDOWN 3, DUEL_EXPIRE 120, DUEL_FORFEIT 15` (the rules hard-code the same numbers).
- API `TCS.friends`: `request(name)`, `accept/decline(uid)`, `remove(uid)`, `challenge(uid, 'logs'|'acorns', amount|'2.5k')`, `acceptDuel/declineDuel(id)`, `chop()`, `toggle()`; bus `duelResult {id, won, kind, amount}`.
- `?local` URL flag forces local accounts (no Firebase); tests/e2e.js uses it.
