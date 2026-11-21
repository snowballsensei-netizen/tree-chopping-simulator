/* data.js — phase 1. Pure game data. No logic besides generating repetitive tables. */
(function(){
  const TCS = window.TCS = window.TCS || {};

  // type: 'click' adds to per-click; 'worker' / 'machine' add to per-second. icon = emoji placeholder (UI phase may draw real icons).
  const UPGRADES = [
    { id: 'whetstone',   name: 'Whetstone',             type: 'click',   value: 1,     cost: 100,    icon: '\u{1FAA8}' },
    { id: 'rookie',      name: 'Rookie Lumberjack',     type: 'worker',  value: 1,     cost: 200,    icon: '\u{1F9D1}' },
    { id: 'steelAxe',    name: 'Steel Axe',             type: 'click',   value: 5,     cost: 600,    icon: '\u{1FA93}' },
    { id: 'hauler',      name: 'Log Hauler',            type: 'worker',  value: 5,     cost: 1200,   icon: '\u{1FAB5}' },
    { id: 'doubleBit',   name: 'Double-Bit Axe',        type: 'click',   value: 15,    cost: 4000,   icon: '⚔' },
    { id: 'beaver',      name: 'Beaver Buddy',          type: 'worker',  value: 12,    cost: 8000,   icon: '\u{1F9AB}' },
    { id: 'crosscut',    name: 'Crosscut Saw',          type: 'click',   value: 40,    cost: 25000,  icon: '\u{1FA9A}' },
    { id: 'muleCart',    name: 'Mule Cart',             type: 'machine', value: 40,    cost: 60000,  icon: '\u{1FACF}' },
    { id: 'chainsaw',    name: 'Gas Chainsaw',          type: 'click',   value: 120,   cost: 150e3,  icon: '⛽' },
    { id: 'sawmill',     name: 'Sawmill Shack',         type: 'machine', value: 150,   cost: 400e3,  icon: '\u{1F6D6}' },
    { id: 'crew',        name: 'Timber Crew',           type: 'worker',  value: 500,   cost: 1.2e6,  icon: '\u{1F477}' },
    { id: 'splitter',    name: 'Hydraulic Splitter',    type: 'click',   value: 600,   cost: 3e6,    icon: '\u{1F529}' },
    { id: 'skidSteer',   name: 'Skid Steer',            type: 'machine', value: 2000,  cost: 9e6,    icon: '\u{1F69C}' },
    { id: 'feller',      name: 'Feller Buncher',        type: 'click',   value: 3000,  cost: 25e6,   icon: '\u{1F980}' },
    { id: 'flume',       name: 'Log Flume',             type: 'machine', value: 8000,  cost: 70e6,   icon: '\u{1F30A}' },
    { id: 'mech',        name: 'Harvester Mech',        type: 'click',   value: 12000, cost: 200e6,  icon: '\u{1F916}' },
    { id: 'trucks',      name: 'Logging Truck Fleet',   type: 'machine', value: 35000, cost: 600e6,  icon: '\u{1F69B}' },
    { id: 'thunderAxe',  name: 'Thunder Axe',           type: 'click',   value: 150e3, cost: 2e9,    icon: '⚡' },
    { id: 'skyCrane',    name: 'Sky Crane Helicopter',  type: 'machine', value: 200e3, cost: 6e9,    icon: '\u{1F681}' },
    { id: 'robots',      name: 'Robot Lumberjack Army', type: 'worker',  value: 700e3, cost: 20e9,   icon: '\u{1F9BE}' },
    { id: 'drill',       name: 'Tree Tunnel Drill',     type: 'click',   value: 1e6,   cost: 60e9,   icon: '\u{1F573}' },
    { id: 'megafactory', name: 'Lumber Megafactory',    type: 'machine', value: 3e6,   cost: 200e9,  icon: '\u{1F3ED}' },
    { id: 'satellite',   name: 'Orbital Saw Satellite', type: 'machine', value: 10e6,  cost: 700e9,  icon: '\u{1F6F0}' },
    { id: 'giantAxe',    name: "Legendary Giant's Axe", type: 'click',   value: 40e6,  cost: 3e12,   icon: '\u{1F31F}' },
    { id: 'portal',      name: 'Wood Dimension Portal', type: 'machine', value: 200e6, cost: 15e12,  icon: '\u{1F300}' }
  ];
  /* Economy curve (tuned with tests/sim.js): base cost / value follow a geometric ladder per tier so every
     tier is a step up; max level per upgrade = MAX_LEVEL (cheapest tiers a little higher). */
  const ECON = { C0: 50, R: 2.79, V0: 1, Q: 2.45, MAX_LEVEL: 15 };
  const nice = n => { const p = Math.pow(10, Math.floor(Math.log10(n)) - 1); return Math.round(n / p) * p; };
  UPGRADES.forEach((u, i) => {
    u.index = i; u.perSecond = u.type !== 'click';
    u.cost = nice(ECON.C0 * Math.pow(ECON.R, i));
    // click upgrades hit a bit harder per level (they need a human), per-second ones a bit softer
    u.value = nice(ECON.V0 * Math.pow(ECON.Q, i) * (u.type === 'click' ? 1.0 : 0.6));
    u.max = ECON.MAX_LEVEL;
  });

  /* Tech upgrades: one-time. Each upgrade gets three (own 10 / 25 / 50) that double it, plus group techs.
     effect: { target: '<upgradeId>' | 'click' | 'worker' | 'machine' | 'all', mult } */
  const TECH_NAMES = {
    whetstone: ['Fine Grit', 'Diamond Grit', 'Laser Honing'],
    rookie: ['Hearty Breakfast', 'Training Camp', 'Lumber Academy'],
    steelAxe: ['Sharper Blades', 'Tempered Steel', 'Damascus Edge'],
    hauler: ['Padded Shoulders', 'Wheelbarrows', 'Hauling Harness'],
    doubleBit: ['Balanced Heads', 'Twin Strike', 'Mirror Polish'],
    beaver: ['Extra Teeth', 'Dam Engineers', 'Beaver Union'],
    crosscut: ['Rhythm Lessons', 'Waxed Teeth', 'Saw Duet'],
    muleCart: ['Fresh Carrots', 'Bigger Wheels', 'Mule Express'],
    chainsaw: ['Premium Fuel', 'Turbo Chain', 'Twin Engine'],
    sawmill: ['Sharper Blade', 'Conveyor Belt', 'Steam Power'],
    crew: ['Hard Hat Pride', 'Shift Rotation', 'Crew Chant'],
    splitter: ['High Pressure', 'Quick Valves', 'Mega Ram'],
    skidSteer: ['Big Bucket', 'Nimble Tracks', 'Skid Pro'],
    feller: ['Grippy Claws', 'Fast Cut Head', 'Claw Mastery'],
    flume: ['Smoother Chute', 'Waterfall Boost', 'Rapids Mode'],
    mech: ['Servo Upgrade', 'Saw Arm Mk II', 'Mech Overdrive'],
    trucks: ['Diesel Engines', 'Night Routes', 'Convoy Lanes'],
    thunderAxe: ['Storm Clouds', 'Chain Lightning', 'Thunder God'],
    skyCrane: ['Stronger Cables', 'Twin Rotors', 'Sky Highway'],
    robots: ['Firmware Patch', 'Swarm Logic', 'Robot Overtime'],
    drill: ['Carbide Bits', 'Spiral Flutes', 'Core Breaker'],
    megafactory: ['Assembly Lines', 'Smokeless Stacks', 'Mega Shifts'],
    satellite: ['Focused Beam', 'Second Orbit', 'Death Star Saw'],
    giantAxe: ["Giant's Grip", 'Titan Swing', 'Mythic Edge'],
    portal: ['Stable Rift', 'Wider Vortex', 'Infinite Forest']
  };
  const TIERS = [5, 15, 25];          // own N (max level is 25)
  const TIER_COST = [15, 150, 1500];   // x base cost
  const TECH = [];
  UPGRADES.forEach(u => {
    TIERS.forEach((need, t) => {
      TECH.push({ id: u.id + '_t' + (t + 1), name: TECH_NAMES[u.id][t], desc: u.name + ' x2',
        req: { upgrade: u.id, count: need }, cost: u.cost * TIER_COST[t], effect: { target: u.id, mult: 2 }, tier: t + 1, icon: u.icon });
    });
  });
  // group techs
  function D_COST(id, k){ return UPGRADES.find(u => u.id === id).cost * k; }
  TECH.push({ id: 'g_union', name: 'Union Lunch Breaks', desc: 'All workers x2', req: { upgrade: 'crew', count: 10 }, cost: D_COST('crew', 400), effect: { target: 'worker', mult: 2 }, tier: 2, icon: '\u{1F96A}' });
  TECH.push({ id: 'g_diesel', name: 'Diesel Generators', desc: 'All machines x2', req: { upgrade: 'skidSteer', count: 10 }, cost: D_COST('skidSteer', 400), effect: { target: 'machine', mult: 2 }, tier: 2, icon: '\u{1F6E2}' });
  TECH.push({ id: 'g_grip', name: 'Iron Grip Gloves', desc: 'All click upgrades x2', req: { upgrade: 'chainsaw', count: 20 }, cost: D_COST('chainsaw', 2000), effect: { target: 'click', mult: 2 }, tier: 3, icon: '\u{1F9E4}' });
  TECH.push({ id: 'g_forest', name: 'Forest Harmony', desc: 'Everything x2', req: { upgrade: 'robots', count: 20 }, cost: D_COST('robots', 2000), effect: { target: 'all', mult: 2 }, tier: 3, icon: '\u{1F333}' });

  /* Species: index = rebirth count % 8; tier = floor(rebirths/8). mult applies to all production; tier multiplies by 34^tier. */
  const SPECIES = [
    { id: 'oak',     name: 'Oak',            mult: 1,   bark: 0x8a5a33, barkDark: 0x6b4226, leaf: 0x4fb83a, leaf2: 0x3e9a2c, inner: 0xf2cf8c },
    { id: 'birch',   name: 'Birch',          mult: 1.5, bark: 0xf1ede2, barkDark: 0x3a3a3a, leaf: 0x9ad94a, leaf2: 0x7cc23a, inner: 0xf6e3b5 },
    { id: 'pine',    name: 'Pine',           mult: 2,   bark: 0x7a4b2a, barkDark: 0x5a361d, leaf: 0x2f8f4e, leaf2: 0x23703c, inner: 0xeac98a, conifer: true },
    { id: 'redwood', name: 'Redwood',        mult: 3,   bark: 0xa8452a, barkDark: 0x7d311d, leaf: 0x3f9b3a, leaf2: 0x2f7d2d, inner: 0xe7a77a },
    { id: 'cherry',  name: 'Cherry Blossom', mult: 5,   bark: 0x5e3a35, barkDark: 0x45292a, leaf: 0xffb3d1, leaf2: 0xff8fbd, inner: 0xf3c9a6 },
    { id: 'ice',     name: 'Ice Spruce',     mult: 8,   bark: 0x9fd7ef, barkDark: 0x6fb4d6, leaf: 0xe6f8ff, leaf2: 0xb8e6fb, inner: 0xeafaff, conifer: true },
    { id: 'crystal', name: 'Crystal Tree',   mult: 13,  bark: 0xb48cff, barkDark: 0x8a5ee8, leaf: 0x7ef0ff, leaf2: 0xff8ff3, inner: 0xf0e0ff, crystal: true },
    { id: 'golden',  name: 'Golden Tree',    mult: 21,  bark: 0xf5c033, barkDark: 0xd99a14, leaf: 0xfff07a, leaf2: 0xffd84a, inner: 0xfff3c0, emissive: 0x332200 }
  ];
  const SPECIES_TIER_MULT = 34;
  /* Stages: one per species (index = speciesIndex % 8; after 8 the cycle repeats with tier II, III ...). */
  const STAGES = [
    { name: 'Oak Meadow', species: 0 }, { name: 'Birch Lake', species: 1 }, { name: 'Pine Mountains', species: 2 },
    { name: 'Redwood Valley', species: 3 }, { name: 'Cherry Blossom Garden', species: 4 }, { name: 'Ice Spruce Tundra', species: 5 },
    { name: 'Crystal Caverns', species: 6 }, { name: 'Golden Temple', species: 7 }
  ];

  /* Acorn perks. cost(level) = costs[level]; maxLevel = costs.length. */
  const PERKS = [
    { id: 'strongArms',   name: 'Strong Arms',    desc: 'Click x2 per level',              costs: [4, 10, 25, 50, 100, 200, 400, 800] },
    { id: 'earlyBird',    name: 'Early Bird',     desc: 'Start stages with some wood',     costs: [6, 25, 70], values: [1e3, 1e5, 1e7] },
    { id: 'luckySquirrel',name: 'Lucky Squirrel', desc: 'Squirrel +25% more often',        costs: [4, 10, 25, 60] },
    { id: 'autoSwing',    name: 'Auto-Swing',     desc: 'Auto chop once per second',       costs: [10] },
    { id: 'unionContract',name: 'Union Contract', desc: 'Workers -10% cost',               costs: [6, 18, 50] },
    { id: 'longerFrenzy', name: 'Longer Frenzy',  desc: 'Frenzy +5s',                      costs: [4, 10, 25, 60] },
    { id: 'nightShift',   name: 'Night Shift',    desc: 'Offline +4h, +10% rate',          costs: [5, 15, 45] },
    { id: 'seedBank',     name: 'Seed Bank',      desc: '+10% acorns per stage',           costs: [8, 20, 45, 100, 220] }
  ];

  /* Cosmetics. unlock = achievement id. slot: hat | face | boots */
  const COSMETICS = {
    hat: [
      { id: 'beanie',   name: 'Beanie',        color: 0xe8443a },
      { id: 'hardhat',  name: 'Hard Hat',      color: 0xffc928 },
      { id: 'cowboy',   name: 'Cowboy Hat',    color: 0x9a6233 },
      { id: 'viking',   name: 'Viking Helmet', color: 0xb8c0c8 },
      { id: 'propeller',name: 'Propeller Cap', color: 0x3a8cff },
      { id: 'crown',    name: 'Crown',         color: 0xffd23a }
    ],
    face: [
      { id: 'beard',    name: 'Full Beard',    color: 0x7a3f1d },
      { id: 'braid',    name: 'Braided Beard', color: 0xd9822b },
      { id: 'goggles',  name: 'Safety Goggles',color: 0x7fd8ff },
      { id: 'shades',   name: 'Sunglasses',    color: 0x222222 },
      { id: 'mustache', name: 'Moustache',     color: 0x4a2a14 }
    ],
    boots: [
      { id: 'workboots',  name: 'Work Boots',   color: 0x7a4a24 },
      { id: 'rainboots',  name: 'Rain Boots',   color: 0xffd400 },
      { id: 'rocketboots',name: 'Rocket Boots', color: 0xd0d6dc },
      { id: 'goldboots',  name: 'Golden Boots', color: 0xffcc22 }
    ]
  };

  /* Achievements. stat keys refer to TCS.state.data.stats / derived values (see state.js checkAchievements). */
  const ACH = [];
  const add = (id, name, desc, stat, n, cosmetic) => ACH.push({ id, name, desc, stat, n, cosmetic: cosmetic || null });
  const F = n => TCS.util ? TCS.util.fmt(n) : String(n);
  // lifetime wood (16)
  [[1e2,'Splinter'],[1e3,'Kindling'],[1e4,'Firewood'],[1e5,'Woodpile'],[1e6,'Lumber Yard'],[1e7,'Timber Baron'],[1e8,'Plank Tycoon'],
   [1e9,'Billion Board Feet'],[1e10,'Forest Mogul'],[1e11,'Wood Wizard'],[1e12,'Trillion Twigs'],[1e13,'Log Legend'],
   [1e14,'Sawdust Sultan'],[1e15,'Wood Emperor'],[1e17,'Cosmic Carpenter'],[1e20,'Wood Singularity']]
    .forEach(([n, name], i) => add('wood_' + i, name, 'Chop ' + F(n) + ' wood total', 'lifetimeWood', n));
  // clicks (10)
  [[10,'First Swing'],[100,'Warmed Up'],[500,'Blistered'],[1000,'Thousand Chops'],[2500,'Arm Day'],[5000,'Iron Wrist'],
   [10000,'Chop Machine'],[25000,'Relentless'],[50000,'Unstoppable'],[100000,'Chop God']]
    .forEach(([n, name], i) => add('click_' + i, name, 'Chop ' + F(n) + ' times', 'clicks', n));
  // owning upgrades: 1 and 25 of each = 50... keep to 1 & 10 for the first 12, 1 for the rest -> 37
  UPGRADES.forEach((u, i) => {
    add('own_' + u.id + '_1', u.name, 'Own 1 ' + u.name, 'own:' + u.id, 1);
    if (i < 12) add('own_' + u.id + '_10', u.name + ' x10', 'Own 10 ' + u.name, 'own:' + u.id, 10);
  });
  // squirrels (5)
  [[1,'Shiny!'],[5,'Squirrel Spotter'],[15,'Nut Collector'],[40,'Squirrel Whisperer'],[100,'Golden Hoard']]
    .forEach(([n, name], i) => add('squirrel_' + i, name, 'Catch ' + n + ' golden squirrels', 'squirrels', n));
  // frenzies (4)
  [[1,'Timber!'],[10,'Frenzied'],[50,'Berserker'],[200,'Eternal Frenzy']]
    .forEach(([n, name], i) => add('frenzy_' + i, name, 'Trigger ' + n + ' frenzies', 'frenzies', n));
  // rebirths (5)
  [[1,'Replanted'],[3,'Green Thumb'],[8,'Full Cycle'],[16,'Second Forest'],[40,'Eternal Grove']]
    .forEach(([n, name], i) => add('rebirth_' + i, name, 'Rebirth ' + n + ' times', 'rebirths', n));
  // height (6) in metres
  [[10,'Knee High'],[100,'Treetop'],[1000,'Cloud Cutter'],[10000,'Stratosphere'],[100000,'Space Bark'],[1e6,'Moon Timber']]
    .forEach(([n, name], i) => add('height_' + i, name, 'Chop ' + F(n) + ' m of tree', 'height', n));
  // misc (coffee)
  add('coffee_0', 'Coffee Break', 'Take a coffee break', 'coffees', 1);
  add('coffee_1', 'Caffeinated', 'Take 25 coffee breaks', 'coffees', 25);

  // cosmetic unlocks (15 + filler = about half get one; extras reuse nothing — each cosmetic has exactly one source)
  const COS_UNLOCK = {
    click_1: 'beanie', wood_4: 'hardhat', own_muleCart_1: 'cowboy', rebirth_1: 'viking', squirrel_2: 'propeller', wood_12: 'crown',
    click_3: 'beard', frenzy_1: 'braid', own_splitter_1: 'goggles', coffee_0: 'shades', wood_2: 'mustache',
    height_1: 'workboots', own_flume_1: 'rainboots', own_satellite_1: 'rocketboots', rebirth_3: 'goldboots'
  };
  ACH.forEach(a => { if (COS_UNLOCK[a.id]) a.cosmetic = COS_UNLOCK[a.id]; });
  // describe each cosmetic's unlock condition
  Object.keys(COSMETICS).forEach(slot => COSMETICS[slot].forEach(c => {
    c.slot = slot;
    const a = ACH.find(x => x.cosmetic === c.id);
    c.unlock = a ? a.id : null;
    c.unlockText = a ? a.desc : '';
  }));

  TCS.data = {
    UPGRADES, TECH, SPECIES, SPECIES_TIER_MULT, STAGES, ECON, PERKS, COSMETICS, ACHIEVEMENTS: ACH,
    upgradeById: Object.fromEntries(UPGRADES.map(u => [u.id, u])),
    techById: Object.fromEntries(TECH.map(t => [t.id, t])),
    perkById: Object.fromEntries(PERKS.map(p => [p.id, p])),
    achById: Object.fromEntries(ACH.map(a => [a.id, a])),
    cosmeticById: Object.fromEntries([].concat(COSMETICS.hat, COSMETICS.face, COSMETICS.boots).map(c => [c.id, c])),
    // tunables
    PRICE_GROWTH: 1.2,
    REBIRTH_ALLOWED_UNMAXED: 8,   // move to the next stage when at most this many upgrades are not maxed
    STAGE_HARDNESS: 3.0,            // stage n costs x species mult x STAGE_HARDNESS^n (so later stages take longer)
    STAGE_TAPER_FROM: 2,          // after this many stages, each further stage only costs x STAGE_TAPER more (eases late rebirths)
    STAGE_TAPER: 1.6,
    STAGE_PROD_FROM: 8,           // late-game catch-up: total income mult = max(acornMult, STAGE_PROD_GROWTH^m / (1 + STAGE_PROD_EASE*m)), m = stage - FROM;
    STAGE_PROD_GROWTH: 1.6,       // matches STAGE_TAPER so late stages stop getting exponentially longer (linear acorns can't keep up with 1.6^n)
    STAGE_PROD_EASE: 0.08,        // keeps a gentle upward trend in late stage times
    ACORNS_BASE: 8,               // acorns for clearing a stage: BASE + PER_STAGE*n + EXTRA per maxed upgrade beyond the rule
    ACORNS_PER_STAGE: 4,
    ACORNS_EXTRA_MAXED: 3,
    ACORN_BONUS: 0.10,
    OFFLINE_RATE: 1,   // workers and machines keep full speed while you're away (capped by OFFLINE_CAP_H)
    OFFLINE_CAP_H: 8,
    FRENZY_DURATION: 20,
    FRENZY_MULT: 2,
    COFFEE_DURATION: 120,
    COFFEE_COOLDOWN: 600,
    COFFEE_MULT: 2,
    CHOPS_PER_SEGMENT: 6,
    SEGMENT_METRES: 2,
    // friend duels (cloud only). DUEL_HP / DUEL_MAX_CPS / DUEL_COUNTDOWN / DUEL_EXPIRE / DUEL_FORFEIT are mirrored in firestore.rules.
    // DUEL_COUNTDOWN = startAt -> GO in seconds: the DUEL_INTRO VS animation, then 3-2-1 (rules: GO = startAt + 4.5 s, forfeit after GO + 15 s)
    DUEL_HP: 250, DUEL_MAX_CPS: 20, DUEL_COUNTDOWN: 4.5, DUEL_INTRO: 1.5, DUEL_EXPIRE: 120, DUEL_FORFEIT: 15,
    SAVE_VERSION: 2
  };
})();
