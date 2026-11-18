/* upgrades3d.js — upgrades-3D phase. One unique toy-style model per upgrade (25), placed in zones around the tree.
   API: TCS.upgrades3d.init(), sync(ownedCounts), onClick(chopEvt), update(dt), icon(id) -> dataURL PNG (cached).
   Layout (world units, tree at origin, camera looks toward -z, shop panel covers screen right ≈ world x > 6):
     near ring: whetstone, rookies (far side), beavers, saw partner, splitter, feller, drill, mech
     left-front: woodpile + hauler, crew · front: mule loop · right: skid steer · back: robots arc, flume, sawmill,
     truck road, helicopter, portal · far back: factory · sky: satellite, storm cloud */
(function(){
  const TCS = window.TCS;
  const THREE = window.THREE;
  const U = TCS.util, M = TCS.model;
  const P = (t, s, c, o) => M.part(t, s, c, o);
  const SC = () => TCS.scene;
  const PI = Math.PI;

  const COL = {
    skin: 0xffc9a0, wood: 0x9a5b2c, woodLt: 0xd9a066, log: 0x8a5a2b, logEnd: 0xf2c27b, steel: 0xc8d3dc, dark: 0x3a3f47,
    red: 0xe53935, yellow: 0xffc928, orange: 0xff8a1c, blue: 0x2f7de1, green: 0x3bb54a, purple: 0x9b4dff, white: 0xf7f7f7,
    jeans: 0x3866c9, boot: 0x5a3418, grey: 0x8c939b
  };
  const fade = (o, s) => o.scale.setScalar(Math.max(0.001, s));
  const faceTo = (obj, x, z) => { obj.rotation.y = Math.atan2(x - obj.position.x, z - obj.position.z); };
  const count = (n, cap, step) => n <= 0 ? 0 : Math.min(cap, 1 + Math.floor((n - 1) / step));

  /* ---------- shared builders ---------- */
  function log(len, r, parent, pos, rot){
    const g = M.group(parent, pos); if (rot) g.rotation.set(rot[0], rot[1], rot[2]);
    P('cyl', [r || 0.22, r || 0.22, len || 1.1, 10], COL.log, { parent: g, rot: [0, 0, PI / 2], abs: 0.035 });
    P('cyl', [(r || 0.22) * 0.8, (r || 0.22) * 0.8, (len || 1.1) + 0.02, 10], COL.logEnd, { parent: g, rot: [0, 0, PI / 2], outline: false });
    return g;
  }
  // chunky little person. opts: shirt, pants, hat ('hard'|'beanie'|null), hatColor, tool ('hatchet'|'axe'|null), vest
  function worker(o){
    o = o || {};
    const g = new THREE.Group();
    const legs = [];
    [-1, 1].forEach(sd => {
      const hip = M.group(g, [sd * 0.16, 0.5, 0]); hip.name = "dyn";
      P('capsule', [0.12, 0.22], o.pants || COL.jeans, { parent: hip, pos: [0, -0.24, 0], abs: 0.035 });
      P('box', [0.22, 0.14, 0.3, 0.05], COL.boot, { parent: hip, pos: [0, -0.44, 0.05], abs: 0.035 });
      legs.push(hip);
    });
    const body = M.group(g, [0, 0.5, 0]); body.name = "dyn";
    P('box', [0.56, 0.62, 0.4, 0.14], o.shirt || COL.red, { parent: body, pos: [0, 0.32, 0], abs: 0.04 });
    if (o.vest) P('box', [0.58, 0.3, 0.42, 0.08], o.vest, { parent: body, pos: [0, 0.38, 0], outline: false });
    const head = P('sphere', [0.3, 14, 10], COL.skin, { parent: body, pos: [0, 0.9, 0], abs: 0.04 });
    P('sphere', [0.05, 6, 5], 0x1b1b1b, { parent: head, pos: [-0.1, 0.03, 0.27], outline: false });
    P('sphere', [0.05, 6, 5], 0x1b1b1b, { parent: head, pos: [0.1, 0.03, 0.27], outline: false });
    if (o.hat === 'hard'){
      P('sphere', [0.32, 14, 8], o.hatColor || COL.yellow, { parent: head, pos: [0, 0.1, 0], scale: [1, 0.75, 1], abs: 0.035 });
      P('cyl', [0.4, 0.4, 0.05, 14], o.hatColor || COL.yellow, { parent: head, pos: [0, 0.08, 0.04], abs: 0.03 });
    } else if (o.hat === 'beanie'){
      P('sphere', [0.31, 14, 8], o.hatColor || COL.green, { parent: head, pos: [0, 0.12, 0], scale: [1, 0.7, 1], abs: 0.035 });
      P('sphere', [0.08, 8, 6], COL.white, { parent: head, pos: [0, 0.36, 0], outline: false });
    }
    const arms = M.group(body, [0, 0.5, 0.02]); arms.name = "dyn";
    [-1, 1].forEach(sd => {
      P('capsule', [0.1, 0.24], o.shirt || COL.red, { parent: arms, pos: [sd * 0.33, 0, 0.18], rot: [PI / 2, 0, 0], abs: 0.03 });
      P('sphere', [0.1, 8, 6], COL.skin, { parent: arms, pos: [sd * 0.22, 0, 0.4], outline: false });
    });
    let tool = null;
    if (o.tool){
      tool = M.group(arms, [0, 0, 0.42]);
      const len = o.tool === 'hatchet' ? 0.6 : 0.85;
      P('cyl', [0.04, 0.045, len, 6], COL.woodLt, { parent: tool, pos: [0, len / 2 - 0.1, 0], abs: 0.025 });
      P('box', [0.08, 0.22, 0.26, 0.03], COL.steel, { parent: tool, pos: [0, len - 0.12, 0.1], abs: 0.03 });
      tool.rotation.x = 0.4;
    }
    g.add(U.blobShadow(0.45, 0.28));
    return { g, legs, body, arms, head, tool };
  }
  function walk(w, t, speed){ const s = Math.sin(t * speed); w.legs[0].rotation.x = s * 0.6; w.legs[1].rotation.x = -s * 0.6; w.body.position.y = 0.5 + Math.abs(s) * 0.05; }
  function chopPose(w, t, speed, ph){ const s = (Math.sin(t * speed + (ph || 0)) + 1) / 2; w.arms.rotation.x = -1.6 + Math.pow(s, 3) * 2.2; w.legs[0].rotation.x = w.legs[1].rotation.x = 0; }
  function wheel(parent, pos, r, w, col){ return P('cyl', [r, r, w, 14], col || 0x2b2b2b, { parent, pos, rot: [0, 0, PI / 2], abs: 0.035 }); }

  /* ---------- particle pools (shared geometry + material, scale fades) ---------- */
  function pool(n, make){
    const items = []; let i = 0;
    return {
      items,
      spawn(init){
        let p = items[i % n];
        if (!p){ p = { m: make(), life: 0 }; items.push(p); SC().addToWorld(p.m); }
        i++; init(p); p.m.visible = true; return p;
      },
      update(dt, step){ for (const p of items){ if (p.life <= 0){ p.m.visible = false; continue; } p.life -= dt; step(p, dt); if (p.life <= 0) p.m.visible = false; } }
    };
  }
  let puffs, sparks, flyLogs;
  function initPools(){
    const puffMat = U.toon(0xeeeeee, { nocache: true });
    puffs = pool(48, () => { const m = new THREE.Mesh(M.geo('sphere', [0.3, 8, 6]), puffMat); m.raycast = () => {}; return m; });
    const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffd23a });
    sparks = pool(36, () => { const m = new THREE.Mesh(M.geo('box', [0.07, 0.07, 0.22]), sparkMat); m.raycast = () => {}; return m; });
    flyLogs = pool(8, () => { const g = log(0.9, 0.2); g.traverse(o => { o.raycast = () => {}; }); return g; });
  }
  // Low graphics: thin out particles (settings.graphics === 'low' / TCS.lowParticles)
  function lowG(){ try { return !!TCS.lowParticles || TCS.state.data.settings.graphics === 'low'; } catch(e){ return false; } }
  let puffSkip = 0;
  function puff(pos, size, life, vel, color){
    if (lowG() && (puffSkip++ % 3) !== 0) return;
    puffs.spawn(p => { p.m.position.copy(pos); p.v = vel ? vel.clone() : new THREE.Vector3(U.rand(-0.2, 0.2), 1, U.rand(-0.2, 0.2)); p.size = size || 1; p.life = p.max = life || 1.4; p.m.scale.setScalar(0.01); });
  }
  function sparkBurst(pos, n){
    n = n || 8; if (lowG()) n = Math.ceil(n / 4);
    for (let k = 0; k < n; k++) sparks.spawn(p => {
      p.m.position.copy(pos); p.v = new THREE.Vector3(U.rand(-3, 3), U.rand(1.5, 4.5), U.rand(0.5, 3.5)); p.life = p.max = U.rand(0.3, 0.55);
      p.m.scale.setScalar(1);
    });
  }

  /* ---------- model definitions ----------
     each: build() -> root (for icon too); place(root) positions; setup(inst) adds anim state; count(n) copies */
  const defs = {};
  const def = (id, d) => { defs[id] = d; };

  // 1 Whetstone: pedal grinding wheel; sparks fly off the axe on impact
  def('whetstone', {
    pos: [-4.5, -1.3], face: [-3, 0.35],
    build(){
      const g = new THREE.Group();
      [-1, 1].forEach(sd => {
        P('box', [0.12, 0.9, 0.12, 0.03], COL.wood, { parent: g, pos: [sd * 0.3, 0.45, 0.25], rot: [0.15, 0, 0], abs: 0.03 });
        P('box', [0.12, 0.9, 0.12, 0.03], COL.wood, { parent: g, pos: [sd * 0.3, 0.45, -0.25], rot: [-0.15, 0, 0], abs: 0.03 });
      });
      P('box', [0.8, 0.12, 0.7, 0.04], COL.woodLt, { parent: g, pos: [0, 0.85, 0], abs: 0.03 });
      const w = M.group(g, [0, 1.25, 0]); w.name = 'wheel';
      P('cyl', [0.5, 0.5, 0.2, 18], 0x7d8fa8, { parent: w, rot: [0, 0, PI / 2], abs: 0.04 });
      P('cyl', [0.12, 0.12, 0.5, 8], COL.dark, { parent: w, rot: [0, 0, PI / 2], abs: 0.03 });
      P('box', [0.06, 0.5, 0.06], COL.red, { parent: w, pos: [0.27, 0.25, 0], abs: 0.025 });
      g.add(U.blobShadow(0.7, 0.25));
      return g;
    },
    update(i, dt){ i.wheel.rotation.x += dt * (2 + i.kick * 14); i.kick = Math.max(0, i.kick - dt * 2); },
    setup(i){ i.wheel = i.root.getObjectByName('wheel'); i.kick = 0; },
    click(i){ i.kick = 1; }
  });

  // 2 Rookie lumberjacks: small helpers with hatchets on the far side of the trunk (up to 3)
  const ROOKIE_SPOTS = [[0, -2.15], [1.25, -1.75], [-1.25, -1.75]];
  def('rookie', {
    pos: [0, 0], cap: 3, step: 8,
    build(){ const w = worker({ shirt: 0x26a65b, hat: 'beanie', hatColor: COL.orange, tool: 'hatchet' }); w.g.scale.setScalar(0.85); w.g.userData.w = w; return w.g; },
    copyPos: k => ROOKIE_SPOTS[k], copyFace: [0, 0],
    update(i, dt, t){ i.copies.forEach((c, k) => chopPose(c.userData.w, t, 5.5, k * 2.1)); }
  });

  // 3 Steel Axe: shiny steel head, red grip
  function steelAxe(){
    const a = new THREE.Group();
    P('cyl', [0.055, 0.065, 1.15, 8], 0x8a4b25, { parent: a, pos: [0, 0, 0.42], rot: [PI / 2, 0, 0], abs: 0.035 });
    P('cyl', [0.075, 0.075, 0.3, 8], COL.red, { parent: a, pos: [0, 0, 0.05], rot: [PI / 2, 0, 0], abs: 0.03 });
    P('box', [0.13, 0.46, 0.34, 0.05], 0xdfe9f2, { parent: a, pos: [0.04, 0, 0.93], abs: 0.04, emissive: 0x55606a, emissiveIntensity: 0.6 });
    P('box', [0.07, 0.56, 0.12, 0.02], 0xffffff, { parent: a, pos: [0.04, 0, 1.1], abs: 0.035, emissive: 0x9fd8ff, emissiveIntensity: 0.5 });
    a.rotation.z = PI / 2; return a;
  }
  // 5 Double-bit axe
  function doubleAxe(){
    const a = new THREE.Group();
    P('cyl', [0.06, 0.07, 1.2, 8], 0x6b3a1c, { parent: a, pos: [0, 0, 0.42], rot: [PI / 2, 0, 0], abs: 0.035 });
P('box', [0.14, 0.8, 0.22, 0.05], 0x5c6670, { parent: a, pos: [0, 0, 0.98], abs: 0.04 });    [-1, 1].forEach(sd => P('box', [0.07, 0.22, 0.55, 0.03], 0xeef4f8, { parent: a, pos: [0, sd * 0.46, 0.98], abs: 0.035, emissive: 0x6a7a88, emissiveIntensity: 0.4 }));    P('cyl', [0.09, 0.09, 0.26, 8], COL.yellow, { parent: a, pos: [0, 0, 0.98], rot: [0, 0, PI / 2], outline: false });
    a.rotation.z = PI / 2; return a;
  }
  // 9 Chainsaw
  function chainsaw(){
    const a = new THREE.Group();
    P('box', [0.34, 0.36, 0.5, 0.08], COL.orange, { parent: a, pos: [0, 0.05, 0.25], abs: 0.04 });
    P('box', [0.36, 0.12, 0.3, 0.04], COL.dark, { parent: a, pos: [0, 0.27, 0.2], abs: 0.03 });
    P('torus', [0.15, 0.035], COL.dark, { parent: a, pos: [0, 0.3, 0.02], rot: [0, PI / 2, 0], abs: 0.02 });
    P('box', [0.06, 0.22, 0.95, 0.05], 0xcfd8de, { parent: a, pos: [0, 0.02, 0.92], abs: 0.03 });
    P('box', [0.08, 0.26, 0.9, 0.05], COL.dark, { parent: a, pos: [0, 0.02, 0.93], outline: false, scale: [1, 1, 1] }).scale.set(0.7, 1.1, 1.02);
    const ex = M.group(a, [0.18, 0.12, 0.1]); ex.name = 'exhaust';
    a.rotation.z = 0; return a;
  }
  ['steelAxe', 'doubleBit', 'chainsaw'].forEach(id => def(id, { axe: true, build: id === 'steelAxe' ? steelAxe : id === 'doubleBit' ? doubleAxe : chainsaw }));

  // 4 Log Hauler: carries logs from the tree to a growing woodpile
  const PILE = [-6.0, 2.5];
  def('hauler', {
    pos: PILE,
    build(){
      const g = new THREE.Group();
      const pile = M.group(g); pile.name = 'pile';
      P('box', [2.0, 0.12, 1.1, 0.04], COL.wood, { parent: g, pos: [0, 0.06, 0], abs: 0.03 });
      g.add(U.blobShadow(1.3, 0.22));
      return g;
    },
    setup(i){
      i.pile = i.root.getObjectByName('pile'); i.logs = 0; i.walkers = [];
      i.setCount = n => {
        const want = Math.min(15, 3 + Math.floor(n / 2));
        while (i.logs < want){
          const k = i.logs++, row = k < 5 ? 0 : k < 9 ? 1 : k < 12 ? 2 : k < 14 ? 3 : 4;
          const inRow = [5, 4, 3, 2, 1][row], start = [0, 5, 9, 12, 14][row], c = k - start;
          const l = log(1.6, 0.17, i.pile, [0, 0.29 + row * 0.3, (c - (inRow - 1) / 2) * 0.36], [0, PI / 2, 0]); l.rotation.y = 0;
          l.rotation.set(0, 0, 0); l.children.forEach(ch => ch.rotation.set(0, 0, PI / 2));
          U.popIn(l, 1, 0.35);
          if (i.logs >= want) U.tween(0.4, () => {}, { done(){ if (i.pile.parent) bake(i.pile); } });
        }
        const wc = count(n, 2, 25);
        while (i.walkers.length < wc){
          const w = worker({ shirt: 0x1e88e5, hat: 'beanie', hatColor: COL.red });
          w.g.scale.setScalar(0.85); SC().addToWorld(w.g);
          w.carry = log(0.8, 0.16, w.arms, [0, 0.12, 0.42]); w.carry.name = "carry"; bake(w.g); w.arms.rotation.x = -0.3;
          w.ph = i.walkers.length * 0.5; i.walkers.push(w); U.popIn(w.g, 0.85);
        }
      };
      i.cleanup = () => i.walkers.forEach(w => { SC().removeFromWorld(w.g); U.forgetOutlines(w.g); });
    },
    update(i, dt, t){
      const A = new THREE.Vector3(-1.9, 0, 1.5), B = new THREE.Vector3(PILE[0] + 1.25, 0, PILE[1] - 0.2);
      i.walkers.forEach(w => {
        const T = 7, u = ((t / T + w.ph) % 1), there = u < 0.5, k = there ? u * 2 : (u - 0.5) * 2;
        const e = k < 0.1 ? 0 : k > 0.9 ? 1 : (k - 0.1) / 0.8;
        const from = there ? A : B, to = there ? B : A;
        w.g.position.lerpVectors(from, to, e);

        faceTo(w.g, to.x, to.z + (there ? 0 : 0));
        if (k > 0.1 && k < 0.9) walk(w, t, 9); else { w.legs[0].rotation.x = w.legs[1].rotation.x = 0; }
        w.carry.visible = there;
      });
    }
  });

  // 6 Beaver Buddy: beavers gnaw at the base (up to 3)
  const BEAVER_SPOTS = [[0.55, 1.45], [1.45, 0.85], [-0.6, 1.5]];
  def('beaver', {
    pos: [0, 0], cap: 3, step: 10, copyPos: k => BEAVER_SPOTS[k], copyFace: [0, 0],
    build(){
      const g = new THREE.Group(); const b = M.group(g); b.name = 'b';
      P('sphere', [0.36, 14, 10], 0x8b5a2b, { parent: b, pos: [0, 0.34, 0], scale: [0.9, 0.85, 1.2], abs: 0.035 });
      P('sphere', [0.24, 12, 10], 0x9c6a38, { parent: b, pos: [0, 0.55, 0.36], abs: 0.035 });
      P('box', [0.32, 0.06, 0.55, 0.03], 0x4a3326, { parent: b, pos: [0, 0.1, -0.55], rot: [0.3, 0, 0], abs: 0.03 });
      P('box', [0.12, 0.1, 0.04, 0.01], COL.white, { parent: b, pos: [0, 0.44, 0.58], outline: false });
      P('sphere', [0.1, 8, 6], 0x3b2416, { parent: b, pos: [0, 0.54, 0.58], outline: false });
      [-1, 1].forEach(sd => { P('sphere', [0.05, 6, 5], 0x111111, { parent: b, pos: [sd * 0.1, 0.65, 0.53], outline: false }); P('sphere', [0.07, 6, 5], 0x6b4423, { parent: b, pos: [sd * 0.16, 0.75, 0.3], outline: false }); });
      g.add(U.blobShadow(0.45, 0.25));
      return g;
    },
    update(i, dt, t){ i.copies.forEach((c, k) => { const b = c.children[0]; b.rotation.x = 0.12 + Math.abs(Math.sin(t * 14 + k)) * 0.15; b.position.y = Math.abs(Math.sin(t * 7 + k)) * 0.04; }); }
  });

  // 7 Crosscut saw: partner on the other side, a two-person saw sweeps across the trunk on each swing
  def('crosscut', {
    pos: [2.35, 1.1], face: [0, 0.7],
    build(){
      const g = new THREE.Group();
      const w = worker({ shirt: 0x8e24aa, hat: 'hard', hatColor: COL.red }); g.add(w.g); g.userData.w = w; w.g.scale.setScalar(0.95);
      const saw = M.group(g, [0, 0.98, 0.55]); saw.name = 'saw';
      P('box', [0.04, 0.3, 3.4, 0.02], 0xdfe6ea, { parent: saw, pos: [0, -0.05, 1.7], abs: 0.03 });
      P('cyl', [0.05, 0.05, 0.4, 6], COL.woodLt, { parent: saw, pos: [0, 0.12, 0], abs: 0.025 });
      P('cyl', [0.05, 0.05, 0.4, 6], COL.woodLt, { parent: saw, pos: [0, 0.12, 3.4], abs: 0.025 });
      return g;
    },
    setup(i){ i.saw = i.root.getObjectByName('saw'); i.w = i.root.userData.w; i.k = 0; i.w.arms.rotation.x = -0.15; },
    update(i, dt){ if (i.k > 0){ i.k = Math.max(0, i.k - dt * 2.5); const s = Math.sin((1 - i.k) * PI * 2) * 0.45; i.saw.position.z = 0.55 + s; i.w.arms.position.z = 0.02 + s * 0.8; } },
    click(i){ i.k = 1; }
  });

  // 8 Mule Cart: a mule pulls a log cart around a loop in front of the tree
  const MULE_C = [0.7, 4.4], MULE_R = [1.6, 0.5];
  def('muleCart', {
    pos: MULE_C,
    build(){
      const g = new THREE.Group();
      const mule = M.group(g); mule.name = 'mule';
      P('capsule', [0.3, 0.6], 0x9e8c7a, { parent: mule, pos: [0, 0.75, 0], rot: [PI / 2, 0, 0], abs: 0.035 });
      P('box', [0.32, 0.36, 0.5, 0.12], 0x9e8c7a, { parent: mule, pos: [0, 1.1, 0.6], rot: [0.5, 0, 0], abs: 0.035 });
      P('box', [0.24, 0.2, 0.2, 0.07], 0xd8c8b4, { parent: mule, pos: [0, 1.0, 0.85], abs: 0.03 });
      [-1, 1].forEach(sd => P('capsule', [0.06, 0.3], 0x9e8c7a, { parent: mule, pos: [sd * 0.12, 1.45, 0.5], rot: [0, 0, sd * 0.3], abs: 0.025 }));
      const legs = [];
      [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(([x, z]) => { const h = M.group(mule, [x * 0.15, 0.55, z * 0.35]); P('capsule', [0.07, 0.3], 0x7a6858, { parent: h, pos: [0, -0.25, 0], abs: 0.025 }); legs.push(h); });
      mule.userData.legs = legs;
      const cart = M.group(g, [0, 0, -1.25]);
      P('box', [0.9, 0.3, 1.1, 0.06], 0xc0392b, { parent: cart, pos: [0, 0.55, 0], abs: 0.035 });
      P('box', [0.06, 0.06, 0.9], COL.wood, { parent: cart, pos: [0, 0.5, 0.85], outline: false });
      wheel(cart, [0.52, 0.32, 0], 0.32, 0.1, 0x6b3a1c); wheel(cart, [-0.52, 0.32, 0], 0.32, 0.1, 0x6b3a1c);
      log(1.0, 0.16, cart, [0.18, 0.84, 0], [0, PI / 2, 0]); log(1.0, 0.16, cart, [-0.18, 0.84, 0], [0, PI / 2, 0]); log(1.0, 0.16, cart, [0, 1.1, 0], [0, PI / 2, 0]);
      const train = M.group(g); train.add(mule, cart); train.name = 'train';
      g.add(U.blobShadow(0.8, 0.22)); g.children[g.children.length - 1].position.z = -0.6;
      return g;
    },
    setup(i){ i.root.position.set(0, 0, 0); i.root.rotation.y = 0; i.root.children.forEach(c => { if (c.name === '__shadow') c.visible = false; }); i.train = i.root.getObjectByName('train'); i.mule = i.root.getObjectByName('mule'); i.sh = U.blobShadow(0.9, 0.22); i.root.add(i.sh); },
    update(i, dt, t){
      const a = t * 0.35, x = MULE_C[0] + Math.cos(a) * MULE_R[0], z = MULE_C[1] + Math.sin(a) * MULE_R[1];
      const dx = -Math.sin(a) * MULE_R[0], dz = Math.cos(a) * MULE_R[1];
      i.train.position.set(x, 0, z); i.train.rotation.y = Math.atan2(dx, dz); i.train.scale.setScalar(0.7);
      i.sh.position.set(x, 0, z);
      i.mule.userData.legs.forEach((l, k) => l.rotation.x = Math.sin(t * 8 + (k % 2 ? PI : 0) + (k > 1 ? PI : 0)) * 0.5);
      i.mule.position.y = Math.abs(Math.sin(t * 8)) * 0.04;
    }
  });

  // 10 Sawmill shack with a spinning blade turning logs into planks
  def('sawmill', {
    pos: [-6.8, -4.6], face: [-4, 10],
    build(){
      const g = new THREE.Group();
      P('box', [2.0, 1.4, 1.6, 0.08], 0xc8442f, { parent: g, pos: [0, 0.7, 0], abs: 0.04 });
      P('cone', [1.55, 0.9, 4], 0x5d4037, { parent: g, pos: [0, 1.85, 0], rot: [0, PI / 4, 0], scale: [1, 1, 0.8], abs: 0.04 });
      P('box', [0.5, 0.8, 0.05], 0x4e342e, { parent: g, pos: [-0.5, 0.4, 0.81], outline: false });
      P('box', [0.4, 0.35, 0.05], 0x9fe3ff, { parent: g, pos: [0.5, 0.9, 0.81], abs: 0.03 });
      P('box', [1.6, 0.5, 0.6, 0.05], COL.woodLt, { parent: g, pos: [1.6, 0.25, 0.3], abs: 0.03 });
      const b = M.group(g, [1.6, 0.62, 0.3]); b.name = 'blade';
      P('cyl', [0.5, 0.5, 0.05, 20], 0xdfe6ea, { parent: b, rot: [PI / 2, 0, 0], abs: 0.025 });
      P('cyl', [0.12, 0.12, 0.08, 8], COL.red, { parent: b, rot: [PI / 2, 0, 0], outline: false });
      const lg = log(0.9, 0.2, g, [2.4, 0.7, 0.3]); lg.name = 'feed';
      for (let k = 0; k < 3; k++) P('box', [0.9, 0.08, 0.3, 0.02], 0xf0c27a, { parent: g, pos: [-0.2, 0.06 + k * 0.09, 1.25], rot: [0, 0.1 * k, 0], abs: 0.025 });
      g.add(U.blobShadow(1.7, 0.25));
      return g;
    },
    setup(i){ i.blade = i.root.getObjectByName('blade'); i.feed = i.root.getObjectByName('feed'); },
    update(i, dt, t){ i.blade.rotation.z -= dt * 12; const u = (t * 0.4) % 1; i.feed.position.x = 2.6 - u * 1.2; i.feed.scale.setScalar(u > 0.85 ? Math.max(0.001, (1 - u) / 0.15) : u < 0.1 ? u / 0.1 + 0.001 : 1); }
  });

  // 11 Timber Crew: up to 5 hard-hat workers chopping stumps on the left
  const CREW_SPOTS = [[3.2, 2.8], [-5.3, 0.6], [-4.7, 3.3], [4.2, 2.0], [-6.2, -1.2]];
  def('crew', {
    pos: [0, 0], cap: 5, step: 5, copyPos: k => CREW_SPOTS[k],
    build(){
      const g = new THREE.Group();
      const w = worker({ shirt: 0x37474f, vest: 0xff7a00, hat: 'hard', hatColor: 0xffd600, tool: 'axe' }); g.add(w.g); w.g.scale.setScalar(0.8); g.userData.w = w;
      w.g.position.set(0, 0, -0.55);
      const st = M.group(g, [0, 0, 0.15]);
      P('cyl', [0.3, 0.34, 0.35, 12], COL.log, { parent: st, pos: [0, 0.17, 0], abs: 0.03 });
      P('cyl', [0.27, 0.27, 0.02, 12], COL.logEnd, { parent: st, pos: [0, 0.36, 0], outline: false });
      return g;
    },
    copyRot: k => [0.7, -0.4, 0.2, 0.9, 0.1][k],
    update(i, dt, t){ i.copies.forEach((c, k) => chopPose(c.userData.w, t, 4.5, k * 1.3)); }
  });

  // 12 Hydraulic Splitter: thumps a round on each click
  def('splitter', {
    pos: [-2.5, 4.6], face: [-2, 9],
    build(){
      const g = new THREE.Group();
      P('box', [1.1, 0.3, 0.9, 0.08], 0xd32f2f, { parent: g, pos: [0, 0.15, 0], abs: 0.035 });
      P('box', [0.18, 1.8, 0.18, 0.04], 0xd32f2f, { parent: g, pos: [-0.42, 1.0, 0], abs: 0.03 });
      P('box', [0.6, 0.16, 0.3, 0.04], 0xd32f2f, { parent: g, pos: [-0.2, 1.85, 0], abs: 0.03 });
      P('cyl', [0.12, 0.12, 0.6, 10], COL.yellow, { parent: g, pos: [0.05, 1.55, 0], abs: 0.03 });
      const ram = M.group(g, [0.05, 1.2, 0]); ram.name = 'ram';
      P('cyl', [0.06, 0.06, 0.5, 8], COL.steel, { parent: ram, pos: [0, 0.05, 0], abs: 0.02 });
      P('cone', [0.2, 0.3, 4], 0x9aa4ad, { parent: ram, pos: [0, -0.3, 0], rot: [PI, PI / 4, 0], abs: 0.03 });
      const rd = M.group(g, [0.05, 0.3, 0]); rd.name = 'round';
      [-1, 1].forEach(sd => { const h = M.group(rd, [0, 0, 0]); h.name = 'half' + sd;
        P('cyl', [0.32, 0.32, 0.5, 12, ], COL.log, { parent: h, pos: [sd * 0.0, 0.25, 0], abs: 0.03 }).scale.set(0.5, 1, 1);
        h.children[0].position.x = sd * 0.16; });
      g.add(U.blobShadow(0.9, 0.25));
      return g;
    },
    setup(i){ i.ram = i.root.getObjectByName('ram'); i.h = [i.root.getObjectByName('half-1'), i.root.getObjectByName('half1')]; i.k = 0; },
    update(i, dt){
      if (i.k <= 0) return;
      i.k = Math.max(0, i.k - dt * 3); const r = 1 - i.k;
      const down = r < 0.2 ? r / 0.2 : r < 0.5 ? 1 : 1 - (r - 0.5) / 0.5;
      i.ram.position.y = 1.2 - down * 0.35;
      const split = r < 0.2 ? 0 : r < 0.75 ? Math.min(1, (r - 0.2) / 0.15) : 1 - (r - 0.75) / 0.25;
      i.h[0].position.x = -split * 0.25; i.h[1].position.x = split * 0.25; i.h[0].rotation.z = split * 0.4; i.h[1].rotation.z = -split * 0.4;
    },
    click(i){ i.k = 1; U.squash(i.root, 0.12, 0.2); }
  });

  // 13 Skid Steer: a little loader shuttling logs between two piles on the right
  const SKID_A = [4.2, -2.8], SKID_B = [5.0, -5.4];
  def('skidSteer', {
    pos: [0, 0],
    build(){
      const g = new THREE.Group(); const v = M.group(g); v.name = 'veh';
      P('box', [0.9, 0.55, 1.1, 0.12], COL.yellow, { parent: v, pos: [0, 0.6, 0], abs: 0.035 });
      P('box', [0.8, 0.6, 0.6, 0.06], 0x9fe3ff, { parent: v, pos: [0, 1.15, -0.05], abs: 0.03, opacity: 0.85 });
      P('box', [0.9, 0.08, 0.7, 0.03], COL.yellow, { parent: v, pos: [0, 1.48, -0.05], abs: 0.025 });
      [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(([x, z]) => wheel(v, [x * 0.5, 0.28, z * 0.35], 0.28, 0.2));
      const arm = M.group(v, [0, 0.9, -0.3]); arm.name = 'arm';
      [-1, 1].forEach(sd => P('box', [0.08, 0.08, 1.2], COL.yellow, { parent: arm, pos: [sd * 0.48, -0.15, 0.55], rot: [0.5, 0, 0], abs: 0.025 }));
      const bucket = M.group(arm, [0, -0.5, 1.15]);
      P('box', [1.05, 0.35, 0.35, 0.05], 0x546e7a, { parent: bucket, abs: 0.03 });
      const lg = log(0.9, 0.15, bucket, [0, 0.25, 0]); lg.name = 'carried';
      v.add(U.blobShadow(0.8, 0.28));
      const pileA = M.group(g); pileA.name = 'pileA'; const pileB = M.group(g); pileB.name = 'pileB';
      return g;
    },
    setup(i){
      i.veh = i.root.getObjectByName('veh'); i.arm = i.root.getObjectByName('arm'); i.carried = i.root.getObjectByName('carried');
      const mk = (p, name) => { const pg = i.root.getObjectByName(name); pg.position.set(p[0] + 0.0, 0, p[1]); for (let k = 0; k < 3; k++) log(0.9, 0.15, pg, [(k - 1) * 0.3 + (k === 2 ? -0.15 : 0), 0.15 + (k === 2 ? 0.27 : 0), 0], [0, 0, 0]).position.x = [-0.16, 0.16, 0][k]; return pg; };
      mk([SKID_A[0] + 0.0, SKID_A[1] + 0.9], 'pileA'); mk([SKID_B[0], SKID_B[1] - 0.9], 'pileB');
    },
    update(i, dt, t){
      const T = 9, u = (t / T) % 1, toB = u < 0.5, k = toB ? u * 2 : (u - 0.5) * 2;
      const e = U.ease.inOutQuad(U.clamp((k - 0.15) / 0.7, 0, 1));
      const z = toB ? U.lerp(SKID_A[1], SKID_B[1], e) : U.lerp(SKID_B[1], SKID_A[1], e);
      i.veh.position.set(U.lerp(SKID_A[0], SKID_B[0], toB ? e : 1 - e), 0, z);
      i.veh.rotation.y = toB ? PI : 0;
      const lift = k < 0.15 ? k / 0.15 : k > 0.85 ? (1 - k) / 0.15 : 1;
      i.arm.rotation.x = -lift * 0.45; i.carried.visible = toB;
      i.veh.position.y = (k > 0.15 && k < 0.85) ? Math.abs(Math.sin(t * 18)) * 0.03 : 0;
    }
  });

  // 14 Feller Buncher: tracked machine whose clawed boom grabs the trunk on each click
  def('feller', {
    pos: [3.8, 0.0], face: [0, 0.3], scale: 0.78,
    build(){
      const g = new THREE.Group();
      [-1, 1].forEach(sd => { P('box', [0.4, 0.5, 1.8, 0.2], COL.dark, { parent: g, pos: [sd * 0.62, 0.25, 0], abs: 0.035 }); });
      P('box', [1.2, 0.7, 1.3, 0.12], 0x2e9e45, { parent: g, pos: [0, 0.85, -0.15], abs: 0.04 });
      P('box', [0.7, 0.7, 0.6, 0.08], 0x9fe3ff, { parent: g, pos: [-0.2, 1.5, -0.25], abs: 0.03 });
      P('cyl', [0.08, 0.08, 0.5, 8], COL.dark, { parent: g, pos: [0.4, 1.5, -0.6], abs: 0.025 });
      const boom = M.group(g, [0.35, 1.2, 0.35]); boom.name = 'boom';
      P('box', [0.2, 0.2, 1.4, 0.05], COL.yellow, { parent: boom, pos: [0, 0, 0.6], abs: 0.03 });
      const head = M.group(boom, [0, -0.1, 1.35]); head.name = 'head';
      P('box', [0.36, 0.6, 0.3, 0.06], 0x2e9e45, { parent: head, pos: [0, -0.2, 0], abs: 0.03 });
      [-1, 1].forEach(sd => { const c = M.group(head, [sd * 0.18, -0.25, 0.1]); c.name = 'claw' + sd;
        P('box', [0.08, 0.1, 0.5], COL.steel, { parent: c, pos: [sd * 0.12, 0, 0.22], rot: [0, -sd * 0.6, 0], abs: 0.025 });
        P('box', [0.08, 0.1, 0.35], COL.steel, { parent: c, pos: [sd * 0.12, 0, 0.55], rot: [0, sd * 0.6, 0], abs: 0.025 }); });
      g.add(U.blobShadow(1.2, 0.28));
      return g;
    },
    setup(i){ i.boom = i.root.getObjectByName('boom'); i.claws = [i.root.getObjectByName('claw-1'), i.root.getObjectByName('claw1')]; i.k = 0; },
    update(i, dt){
      const r = i.k > 0 ? 1 - i.k : 1; i.k = Math.max(0, i.k - dt * 2.2);
      const reach = Math.sin(Math.min(r, 1) * PI);
      i.boom.scale.z = 1 + reach * 0.45; i.boom.rotation.x = 0.05 + reach * 0.1;
      const grip = r > 0.25 && r < 0.75 ? 1 : 0;
      i.claws[0].rotation.y = -0.6 * grip + 0.3; i.claws[1].rotation.y = 0.6 * grip - 0.3;
    },
    click(i){ i.k = 1; }
  });

  // 15 Log Flume: elevated water chute carrying logs off-screen to the left
  const FLUME_A = new THREE.Vector3(-2.4, 1.6, -7.2), FLUME_B = new THREE.Vector3(-13, 0.9, -9.0);
  def('flume', {
    pos: [0, 0],
    build(){
      const g = new THREE.Group(); const ch = M.group(g); ch.name = 'chute';
      const len = 7;
      for (let k = 0; k < len; k++){
        const s = M.group(ch, [-k * 1.5, 0, 0]);
        P('box', [1.55, 0.12, 0.7], COL.woodLt, { parent: s, pos: [0, 0, 0], abs: 0.03 });
        [-1, 1].forEach(sd => P('box', [1.55, 0.3, 0.1], COL.wood, { parent: s, pos: [0, 0.15, sd * 0.35], abs: 0.025 }));
        P('box', [1.55, 0.04, 0.55], 0x3fb7ff, { parent: s, pos: [0, 0.1, 0], outline: false, emissive: 0x1a6cff, emissiveIntensity: 0.25 });
        if (k % 2 === 0) [-1, 1].forEach(sd => P('box', [0.1, 1.6, 0.1], COL.wood, { parent: s, pos: [0, -0.8, sd * 0.3], abs: 0.025 }));
      }
      return g;
    },
    setup(i){
      const ch = i.root.getObjectByName('chute');
      ch.position.copy(FLUME_A); const d = new THREE.Vector3().subVectors(FLUME_B, FLUME_A);
      ch.rotation.y = Math.atan2(d.z, -d.x) * 1; ch.rotation.y = -Math.atan2(-d.z, -d.x); ch.rotation.z = Math.atan2(-d.y, Math.hypot(d.x, d.z)) * -1;
      i.dir = d; i.logs = [0, 1, 2].map(k => { const l = log(0.8, 0.16, i.root); l.userData.ph = k / 3; return l; });
    },
    update(i, dt, t){
      i.logs.forEach(l => { const u = (t * 0.12 + l.userData.ph) % 1; l.position.copy(FLUME_A).addScaledVector(i.dir, u * 0.95); l.position.y += 0.3; l.rotation.y = Math.atan2(-i.dir.z, i.dir.x); l.rotation.z = Math.sin(t * 5 + u * 9) * 0.05; l.scale.setScalar(u < 0.06 ? Math.max(0.001, u / 0.06) : 1); });
    }
  });

  // 16 Harvester Mech: walking mech with a buzzsaw arm
  def('mech', {
    pos: [-4.4, -2.9], face: [0, -0.3], scale: 0.85,
    build(){
      const g = new THREE.Group(); const b = M.group(g); b.name = 'body';
      const legs = [];
      [-1, 1].forEach(sd => { const h = M.group(g, [sd * 0.45, 1.3, 0]);
        P('box', [0.25, 0.8, 0.25, 0.06], COL.dark, { parent: h, pos: [0, -0.4, 0], abs: 0.03 });
        P('box', [0.3, 0.7, 0.3, 0.06], 0xff7043, { parent: h, pos: [0, -0.95, 0.08], abs: 0.03 });
        P('box', [0.45, 0.15, 0.65, 0.05], COL.dark, { parent: h, pos: [0, -1.25, 0.12], abs: 0.03 });
        legs.push(h); });
      g.userData.legs = legs;
      P('box', [1.3, 0.9, 1.0, 0.18], 0xff7043, { parent: b, pos: [0, 1.75, 0], abs: 0.04 });
      P('sphere', [0.38, 14, 10], 0x7fe3ff, { parent: b, pos: [0, 1.95, 0.42], scale: [1, 0.7, 0.6], abs: 0.03, emissive: 0x2a8bbb, emissiveIntensity: 0.3 });
      P('cyl', [0.04, 0.04, 0.5, 6], COL.dark, { parent: b, pos: [-0.4, 2.4, -0.2], abs: 0.02 });
      P('sphere', [0.08, 8, 6], COL.red, { parent: b, pos: [-0.4, 2.65, -0.2], outline: false, emissive: 0xff0000, emissiveIntensity: 0.6 });
      const arm = M.group(b, [0.72, 1.8, 0.1]); arm.name = 'arm';
      P('box', [0.22, 0.22, 1.5, 0.06], COL.dark, { parent: arm, pos: [0, 0, 0.7], abs: 0.03 });
      const saw = M.group(arm, [0, 0, 1.5]); saw.name = 'saw';
      P('cyl', [0.48, 0.48, 0.05, 18], 0xdfe6ea, { parent: saw, rot: [0, 0, PI / 2], abs: 0.025 });
      P('cyl', [0.12, 0.12, 0.1, 8], COL.yellow, { parent: saw, rot: [0, 0, PI / 2], outline: false });
      g.add(U.blobShadow(1.0, 0.28));
      return g;
    },
    setup(i){ i.b = i.root.getObjectByName('body'); i.arm = i.root.getObjectByName('arm'); i.saw = i.root.getObjectByName('saw'); i.k = 0; i.legs = i.root.userData.legs; },
    update(i, dt, t){
      const s = Math.sin(t * 2.2); i.legs[0].rotation.x = s * 0.18; i.legs[1].rotation.x = -s * 0.18; i.b.position.y = Math.abs(s) * 0.06;
      i.k = Math.max(0, i.k - dt * 2.5);
      i.arm.rotation.x = -0.6 + Math.sin(i.k * PI) * 0.75; i.arm.rotation.y = -Math.sin(i.k * PI) * 0.3;
      i.saw.rotation.x += dt * (3 + i.k * 30);
    },
    click(i){ i.k = 1; }
  });

  // 17 Logging truck fleet: trucks drive in and out along the back road (up to 3)
  def('trucks', {
    pos: [0, 0], cap: 3, step: 10, copyPos: () => [-20, -8.6],
    build(){
      const g = new THREE.Group();
      P('box', [1.0, 0.9, 0.9, 0.15], 0x1e88e5, { parent: g, pos: [0, 0.75, 1.3], abs: 0.035 });
      P('box', [0.85, 0.4, 0.3, 0.05], 0x9fe3ff, { parent: g, pos: [0, 0.95, 1.65], abs: 0.025 });
      P('box', [1.0, 0.25, 2.4, 0.06], COL.dark, { parent: g, pos: [0, 0.4, -0.2], abs: 0.03 });
      [1.3, -0.3, -1.0].forEach(z => { wheel(g, [0.5, 0.28, z], 0.28, 0.2); wheel(g, [-0.5, 0.28, z], 0.28, 0.2); });
      [[-0.25, 0.75], [0.25, 0.75], [0, 1.08]].forEach(([x, y]) => log(2.0, 0.2, g, [x, y, -0.4], [0, PI / 2, 0]));
      [-1, 1].forEach(sd => P('box', [0.06, 0.8, 0.06], COL.red, { parent: g, pos: [sd * 0.5, 0.85, 0.65], outline: false }));
      g.add(U.blobShadow(1.4, 0.25));
      return g;
    },
    update(i, dt, t){
      i.copies.forEach((c, k) => {
        const u = (t * 0.07 + k / i.copies.length) % 1, x = -14 + u * 26;
        const z = -10.5;
        c.position.set(x, 0, z); c.rotation.y = PI / 2; c.position.y = Math.abs(Math.sin(t * 10 + k)) * 0.02;
      });
    }
  });

  // 18 Thunder Axe: storm cloud; lightning strikes the trunk on each click
  def('thunderAxe', {
    pos: [-1.6, 2.2],
    build(){
      const g = new THREE.Group(); const c = M.group(g, [0, 6.2, 0]); c.name = 'cloud'; c.scale.setScalar(0.7);
      [[0, 0, 0, 0.9], [0.8, -0.1, 0.1, 0.7], [-0.8, -0.1, 0, 0.7], [0.3, 0.4, -0.1, 0.65], [-0.35, 0.35, 0.2, 0.6]].forEach(([x, y, z, r]) => P('sphere', [r, 14, 10], 0x6d7a8c, { parent: c, pos: [x, y, z], abs: 0.04 }));
      P('cone', [0.2, 0.6, 4], COL.yellow, { parent: c, pos: [0.1, -0.85, 0.4], rot: [PI, 0, 0.2], abs: 0.03, emissive: 0xffd000, emissiveIntensity: 0.6 });
      return g;
    },
    setup(i){
      i.cloud = i.root.getObjectByName('cloud');
      const mat = new THREE.MeshBasicMaterial({ color: 0xfff6a0 });
      i.bolt = new THREE.Group(); i.bolt.visible = false; SC().addToWorld(i.bolt);
      for (let k = 0; k < 6; k++){ const m = new THREE.Mesh(M.geo('box', [0.18, 1, 0.18]), mat); i.bolt.add(m); }
      i.k = 0;
      i.cleanup = () => SC().removeFromWorld(i.bolt);
    },
    update(i, dt, t){
      i.cloud.position.y = 6.2 + Math.sin(t * 1.3) * 0.12;
      if (i.k > 0){ i.k -= dt; i.bolt.visible = i.k > 0 && (i.k > 0.18 || Math.floor(i.k * 40) % 2 === 0); }
    },
    click(i){
      const from = new THREE.Vector3(i.root.position.x, 5.4, i.root.position.z), to = SC().tree.impactPoint();
      const pts = [from]; for (let k = 1; k < 6; k++){ const p = from.clone().lerp(to, k / 6); p.x += U.rand(-0.5, 0.5); p.z += U.rand(-0.3, 0.3); pts.push(p); } pts.push(to);
      i.bolt.children.forEach((m, k) => { const a = pts[k], b = pts[k + 1]; m.position.copy(a).add(b).multiplyScalar(0.5); const d = b.clone().sub(a); m.scale.set(1, d.length(), 1); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); });
      i.bolt.visible = true; i.k = 0.3; sparkBurst(to, 6); SC().shake(0.08, 0.15);
    }
  });

  // 19 Sky Crane helicopter: circles overhead with a log on a cable
  def('skyCrane', {
    pos: [0, 0],
    build(){
      const g = new THREE.Group(); const h = M.group(g); h.name = 'heli';
      P('capsule', [0.5, 1.0], COL.red, { parent: h, rot: [PI / 2, 0, 0], abs: 0.04 });
      P('sphere', [0.42, 12, 10], 0x9fe3ff, { parent: h, pos: [0, 0.08, 0.75], scale: [1, 0.85, 0.8], abs: 0.03 });
      P('box', [0.16, 0.2, 1.6, 0.05], COL.red, { parent: h, pos: [0, 0.15, -1.4], abs: 0.03 });
      P('box', [0.06, 0.5, 0.3], COL.yellow, { parent: h, pos: [0.1, 0.35, -2.15], abs: 0.025 });
      [-1, 1].forEach(sd => P('box', [0.06, 0.06, 1.4], COL.dark, { parent: h, pos: [sd * 0.4, -0.6, 0], abs: 0.02 }));
      const rot = M.group(h, [0, 0.62, 0]); rot.name = 'rotor';
      P('cyl', [0.08, 0.08, 0.2, 6], COL.dark, { parent: rot, outline: false });
      P('box', [3.2, 0.04, 0.22], COL.dark, { parent: rot, pos: [0, 0.1, 0], outline: false });
      P('box', [0.22, 0.04, 3.2], COL.dark, { parent: rot, pos: [0, 0.1, 0], outline: false });
      P('box', [0.03, 1.2, 0.03], COL.dark, { parent: h, pos: [0, -1.2, 0], outline: false });
      log(1.4, 0.22, h, [0, -1.9, 0], [0, PI / 2, 0]);
      return g;
    },
    setup(i){ i.h = i.root.getObjectByName('heli'); i.rotor = i.root.getObjectByName('rotor'); i.sh = U.blobShadow(1.2, 0.18); i.root.add(i.sh); },
    update(i, dt, t){
      const a = t * 0.3, x = -1.0 + Math.cos(a) * 3.6, z = -9.0 + Math.sin(a) * 1.6;
      i.h.position.set(x, 5.6 + Math.sin(t * 1.7) * 0.2, z); i.h.rotation.y = Math.atan2(-Math.sin(a) * 3.6, Math.cos(a) * 1.6); i.h.rotation.z = 0.12;
      i.h.scale.setScalar(0.85); i.rotor.rotation.y += dt * 22; i.sh.position.set(x, 0, z);
    }
  });

  // 20 Robot Lumberjack Army: an arc of robots behind the tree that grows (up to 7)
  const ROBOT_ANG = [270, 288, 252, 276, 282, 296, 262].map(d => d * PI / 180), ROBOT_R = [5.4, 5.6, 5.6, 8.6, 7.2, 7.6, 7.2];
  def('robots', {
    pos: [0, 0], cap: 7, step: 6, copyPos: k => [Math.cos(ROBOT_ANG[k]) * ROBOT_R[k], Math.sin(ROBOT_ANG[k]) * ROBOT_R[k]], copyFace: [0, 0],
    build(){
      const g = new THREE.Group(); const b = M.group(g); b.name = 'b';
      [-1, 1].forEach(sd => P('box', [0.22, 0.5, 0.26, 0.05], COL.dark, { parent: g, pos: [sd * 0.2, 0.25, 0], abs: 0.03 }));
      P('box', [0.75, 0.7, 0.5, 0.12], 0xb0bec5, { parent: b, pos: [0, 0.85, 0], abs: 0.035 });
      P('box', [0.5, 0.38, 0.42, 0.1], 0xcfd8dc, { parent: b, pos: [0, 1.45, 0], abs: 0.035 });
      [-1, 1].forEach(sd => P('sphere', [0.07, 8, 6], 0x00e5ff, { parent: b, pos: [sd * 0.12, 1.48, 0.21], outline: false, emissive: 0x00e5ff, emissiveIntensity: 0.9 }));
      P('cyl', [0.025, 0.025, 0.3, 5], COL.dark, { parent: b, pos: [0, 1.78, 0], outline: false });
      P('sphere', [0.07, 8, 6], COL.red, { parent: b, pos: [0, 1.95, 0], outline: false, emissive: 0xff2200, emissiveIntensity: 0.6 });
      P('box', [0.5, 0.2, 0.05], 0x00e5ff, { parent: b, pos: [0, 0.9, 0.26], outline: false, emissive: 0x00a0c0, emissiveIntensity: 0.5 });
      const arm = M.group(b, [0.48, 1.05, 0]); arm.name = 'arm';
      P('box', [0.16, 0.16, 0.6, 0.04], 0x90a4ae, { parent: arm, pos: [0, 0, 0.3], abs: 0.025 });
      P('box', [0.06, 0.4, 0.45, 0.02], 0xffc928, { parent: arm, pos: [0, 0.1, 0.65], abs: 0.025 });
      g.add(U.blobShadow(0.5, 0.28));
      g.scale.setScalar(0.85);
      return g;
    },
    update(i, dt, t){ i.copies.forEach((c, k) => { const a = c.getObjectByName('arm'); const s = (Math.sin(t * 6 + k * 0.9) + 1) / 2; a.rotation.x = -0.9 + s * s * 1.4; c.getObjectByName('b').rotation.y = Math.sin(t * 6 + k) * 0.06; }); }
  });

  // 21 Tree Tunnel Drill: giant drill that bores into the trunk on each click
  def('drill', {
    pos: [2.95, -2.1], face: [0, -0.3], scale: 0.85,
    build(){
      const g = new THREE.Group();
      [-1, 1].forEach(sd => P('box', [0.35, 0.4, 1.6, 0.15], COL.dark, { parent: g, pos: [sd * 0.5, 0.2, -0.2], abs: 0.03 }));
      const body = M.group(g, [0, 0.95, 0]); body.name = 'body';
      P('cyl', [0.55, 0.55, 1.4, 16], 0x8e24aa, { parent: body, rot: [PI / 2, 0, 0], abs: 0.04 });
      P('cyl', [0.6, 0.6, 0.2, 16], COL.yellow, { parent: body, pos: [0, 0, 0.6], rot: [PI / 2, 0, 0], abs: 0.03 });
      const bit = M.group(body, [0, 0, 0.75]); bit.name = 'bit';
      P('cone', [0.52, 1.3, 12], 0xdfe6ea, { parent: bit, pos: [0, 0, 0.65], rot: [PI / 2, 0, 0], abs: 0.03 });
      for (let k = 0; k < 4; k++) P('torus', [0.42 - k * 0.1, 0.05], 0x9aa4ad, { parent: bit, pos: [0, 0, 0.2 + k * 0.28], outline: false }).rotation.y = 0.25;
      g.add(U.blobShadow(1.0, 0.28));
      return g;
    },
    setup(i){ i.bit = i.root.getObjectByName('bit'); i.body = i.root.getObjectByName('body'); i.k = 0; },
    update(i, dt){ i.k = Math.max(0, i.k - dt * 2); const r = Math.sin(i.k * PI); i.body.position.z = r * 0.55; i.bit.rotation.z += dt * (1.5 + i.k * 30); },
    click(i){ i.k = 1; }
  });

  // 22 Lumber Megafactory: big factory far back with three puffing smokestacks
  def('megafactory', {
    pos: [-0.8, -14.0],
    build(){
      const g = new THREE.Group();
      P('box', [5.2, 2.6, 3.0, 0.12], 0x607d8b, { parent: g, pos: [0, 1.3, 0], abs: 0.06 });
      for (let k = 0; k < 4; k++) P('cone', [0.9, 0.9, 3], 0xb0bec5, { parent: g, pos: [-1.95 + k * 1.3, 3.0, 0], rot: [PI / 2, 0, PI / 2], scale: [1, 2.8, 1], abs: 0.04 });
      for (let k = 0; k < 4; k++) P('box', [0.7, 0.6, 0.05], 0xffe082, { parent: g, pos: [-1.95 + k * 1.3, 1.5, 1.51], outline: false, emissive: 0xffb300, emissiveIntensity: 0.4 });
      P('box', [1.2, 1.2, 0.05], 0x37474f, { parent: g, pos: [1.9, 0.6, 1.51], outline: false });
      const st = M.group(g); st.name = 'stacks';
      [[-1.6, -0.6], [0, -0.8], [1.6, -0.6]].forEach(([x, z], k) => { const s = M.group(st, [x, 0, z]);
        P('cyl', [0.35, 0.45, 5.2, 12], 0xc0392b, { parent: s, pos: [0, 2.6, 0], abs: 0.04 });
        P('cyl', [0.47, 0.47, 0.3, 12], COL.white, { parent: s, pos: [0, 4.2, 0], outline: false });
        P('cyl', [0.4, 0.4, 0.2, 12], 0x37474f, { parent: s, pos: [0, 5.25, 0], abs: 0.03 }); });
      P('box', [1.3, 0.7, 0.3, 0.05], COL.yellow, { parent: g, pos: [-1.0, 2.0, 1.6], abs: 0.03 });
      g.add(U.blobShadow(3.6, 0.25));
      return g;
    },
    setup(i){ i.stacks = i.root.getObjectByName('stacks').children; i.t = 0; },
    update(i, dt){ i.t -= dt; if (i.t <= 0){ i.t = 0.35; i.stacks.forEach(s => { if (Math.random() < 0.6){ const p = new THREE.Vector3(); s.localToWorld(p.set(0, 5.4, 0)); puff(p, 1.6, 2.2, new THREE.Vector3(U.rand(0.2, 0.6), 1.4, U.rand(-0.1, 0.1))); } }); } }
  });

  // 23 Orbital Saw Satellite: hovers in the sky and fires a pulsing beam onto the trunk
  def('satellite', {
    pos: [2.7, -4.0],
    build(){
      const g = new THREE.Group(); const s = M.group(g, [0, 5.0, 0]); s.name = 'sat';
      P('box', [0.8, 0.8, 1.0, 0.1], 0xffd54f, { parent: s, abs: 0.035 });
      [-1, 1].forEach(sd => { P('box', [1.4, 0.05, 0.7, 0.02], 0x1565c0, { parent: s, pos: [sd * 1.15, 0, 0], abs: 0.025, emissive: 0x0d47a1, emissiveIntensity: 0.3 }); P('box', [0.3, 0.05, 0.06], COL.grey, { parent: s, pos: [sd * 0.5, 0, 0], outline: false }); });
      P('cone', [0.32, 0.35, 12], COL.steel, { parent: s, pos: [0, -0.55, 0], abs: 0.025 });
      P('cyl', [0.34, 0.34, 0.08, 18], 0xdfe6ea, { parent: s, pos: [0, -0.4, 0], outline: false });
      P('cyl', [0.1, 0.1, 0.2, 10], 0xff4081, { parent: s, pos: [0, -0.78, 0], outline: false, emissive: 0xff4081, emissiveIntensity: 1 });
      return g;
    },
    setup(i){
      i.sat = i.root.getObjectByName('sat');
      i.beamMat = new THREE.MeshBasicMaterial({ color: 0xff5fa2, transparent: true, opacity: 0.55, depthWrite: false });
      i.beam = new THREE.Mesh(M.geo('cyl', [1, 1, 1, 14]), i.beamMat); i.beam.raycast = () => {}; SC().addToWorld(i.beam);
      i.cleanup = () => SC().removeFromWorld(i.beam);
    },
    update(i, dt, t){
      i.sat.position.y = 5.0 + Math.sin(t * 1.1) * 0.2; i.sat.rotation.y = Math.sin(t * 0.5) * 0.4;
      const from = new THREE.Vector3(); i.sat.localToWorld(from.set(0, -0.8, 0));
      const to = new THREE.Vector3(1.0, 4.6, -0.6); // upper trunk, far side (away from the lumberjack)
      const d = to.clone().sub(from), L = d.length(), pulse = 0.5 + 0.5 * Math.sin(t * 6);
      i.beam.position.copy(from).addScaledVector(d, 0.5); i.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      const on = (t % 4) < 2.6; const w = on ? 0.09 + pulse * 0.05 : 0.001;
      i.beam.scale.set(w, L, w); i.beamMat.opacity = 0.45 + pulse * 0.3;
      if (on && Math.random() < dt * 8) sparkBurst(to, 2);
    }
  });

  // 24 Legendary Giant's Axe: huge glowing axe swings in from off-screen on each click
  function giantAxeModel(){
    const g = new THREE.Group();
    P('cyl', [0.25, 0.3, 7, 10], 0x6d3b1f, { parent: g, pos: [0, 3.5, 0], abs: 0.05 });
    P('torus', [0.3, 0.08], COL.yellow, { parent: g, pos: [0, 1.0, 0], rot: [PI / 2, 0, 0], outline: false, emissive: 0xffc400, emissiveIntensity: 0.8 });
    P('box', [0.5, 1.6, 1.4, 0.12], 0xffe066, { parent: g, pos: [0, 6.6, 0.7], abs: 0.06, emissive: 0xffb300, emissiveIntensity: 0.9 });
    P('box', [0.25, 2.1, 0.4, 0.05], 0xfffbe0, { parent: g, pos: [0, 6.6, 1.5], abs: 0.05, emissive: 0xfff2a0, emissiveIntensity: 1 });
    P('ico', [0.35, 0], 0x4dd0ff, { parent: g, pos: [0, 6.6, 0.2], abs: 0.04, emissive: 0x00b0ff, emissiveIntensity: 0.9 });
    return g;
  }
  def('giantAxe', {
    pos: [0, 0], build: giantAxeModel, hidden: true,
    setup(i){
      i.pivot = M.group(null, [-1.8, 0, -3.5]); SC().addToWorld(i.pivot);
      i.root.position.set(0, 0, 0); i.root.removeFromParent(); i.pivot.add(i.root); i.root.scale.setScalar(1);
      i.root.visible = false; i.k = 0; i.cool = 0;
      i.cleanup = () => { SC().removeFromWorld(i.pivot); U.forgetOutlines(i.pivot); };
    },
    update(i, dt){
      i.cool -= dt;
      if (i.k <= 0) return;
      i.k = Math.max(0, i.k - dt * 1.4); const r = 1 - i.k;
      // swing: from far left (off-screen) down onto the trunk, then retreat
      const a = r < 0.35 ? U.ease.inQuad(r / 0.35) : r < 0.6 ? 1 : 1 - U.ease.inOutQuad((r - 0.6) / 0.4);
      i.pivot.rotation.set(0, 0.55, 1.25 - a * 1.25 + 0.05);
      i.root.visible = i.k > 0;
      if (r >= 0.35 && !i.hit){ i.hit = true; SC().shake(0.25, 0.25); sparkBurst(SC().tree.impactPoint(), 12); }
    },
    click(i){ if (i.k > 0.15 || i.cool > 0) return; i.k = 1; i.hit = false; i.cool = 0.5; }
  });

  // 25 Wood Dimension Portal: swirling portal far back right pulling logs in
  let swirlTex = null;
  function swirl(){
    if (swirlTex) return swirlTex;
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
    const gr = x.createRadialGradient(64, 64, 4, 64, 64, 64); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.25, '#e07bff'); gr.addColorStop(0.7, '#6a1bd6'); gr.addColorStop(1, '#2a0a66');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    x.strokeStyle = 'rgba(255,255,255,0.55)'; x.lineWidth = 5;
    for (let a = 0; a < 4; a++){ x.beginPath(); for (let k = 0; k < 60; k++){ const t = k / 60, ang = a * PI / 2 + t * 5, r = 6 + t * 58; x.lineTo(64 + Math.cos(ang) * r, 64 + Math.sin(ang) * r); } x.stroke(); }
    swirlTex = new THREE.CanvasTexture(c); swirlTex.colorSpace = THREE.SRGBColorSpace; return swirlTex;
  }
  const PORTAL_POS = [3.4, -9.4];
  def('portal', {
    pos: PORTAL_POS, face: [0, 0],
    build(){
      const g = new THREE.Group();
      P('box', [3.6, 0.4, 1.2, 0.1], 0x7e57c2, { parent: g, pos: [0, 0.2, 0], abs: 0.04 });
      P('torus', [1.5, 0.25], 0x9b4dff, { parent: g, pos: [0, 2.0, 0], abs: 0.05, emissive: 0x7c2bff, emissiveIntensity: 0.5 });
      const d = new THREE.Mesh(new THREE.CircleGeometry(1.42, 32), new THREE.MeshBasicMaterial({ map: swirl(), side: THREE.DoubleSide }));
      d.position.set(0, 2.0, 0); d.name = 'disc'; g.add(d);
      [-1, 1].forEach(sd => P('ico', [0.25, 0], 0x4dd0ff, { parent: g, pos: [sd * 1.5, 3.4, 0], abs: 0.03, emissive: 0x00b0ff, emissiveIntensity: 0.8 }));
      g.add(U.blobShadow(2.2, 0.25));
      return g;
    },
    setup(i){ i.disc = i.root.getObjectByName('disc'); i.t = 0; },
    update(i, dt, t){
      i.disc.rotation.z -= dt * 2.5; const s = 1 + Math.sin(t * 3) * 0.04; i.disc.scale.set(s, s, 1);
      i.t -= dt; if (i.t <= 0){ i.t = 1.6;
        flyLogs.spawn(p => { p.from = new THREE.Vector3(U.rand(0.6, 1.4), 0.4, U.rand(-1.6, -1.2)); p.to = new THREE.Vector3(PORTAL_POS[0], 2.0, PORTAL_POS[1]); p.life = p.max = 2.2; p.spin = U.rand(3, 6); p.kind = 'portal'; p.m.position.copy(p.from); }); }
    }
  });

  /* ---------- bake: merge static (unnamed-chain) meshes per material to cut draw calls.
     Named groups/meshes are kept (they animate) and baked recursively on their own. ---------- */
  const _inv = new THREE.Matrix4(), _m = new THREE.Matrix4();
  function bake(node){
    node.updateMatrixWorld(true);
    _inv.copy(node.matrixWorld).invert();
    const byMat = new Map(), named = [], victims = [];
    (function walk(o){
      for (const c of o.children){
        if (c.name && c.name !== '__outline'){ named.push(c); continue; }
        if (c.isMesh){
          const mat = c.material;
          if (!byMat.has(mat)) byMat.set(mat, []);
          _m.multiplyMatrices(_inv, c.matrixWorld);
          byMat.get(mat).push({ geo: c.geometry, m: _m.clone(), outline: !!c.userData.isOutline, vis: c.visible });
          victims.push(c);
        }
        walk(c);
      }
    })(node);
    if (victims.length > 2){
      victims.forEach(v => { v.removeFromParent(); });
      U.forgetOutlines({ traverse: fn => victims.forEach(v => v.traverse(fn)) });
      for (const [mat, list] of byMat){
        const parts = list.filter(e => e.vis || e.outline).map(e => { const g = e.geo.index ? e.geo.toNonIndexed() : e.geo.clone(); g.applyMatrix4(e.m); return g; });
        if (!parts.length) continue;
        let n = 0; parts.forEach(g => n += g.attributes.position.count);
        const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3); let o = 0;
        parts.forEach(g => { pos.set(g.attributes.position.array, o * 3); if (g.attributes.normal) nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; g.dispose(); });
        const mg = new THREE.BufferGeometry();
        mg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); mg.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        mg.computeBoundingSphere();
        const mesh = new THREE.Mesh(mg, mat); mesh.name = '__baked'; mesh.raycast = () => {};
        if (list[0].outline){ mesh.userData.isOutline = true; U.trackOutlines(mesh); }
        node.add(mesh);
      }
    }
    named.forEach(c => { if (c.name !== '__baked' && c.name !== '__shadow' && !c.isMesh) bake(c); });
    return node;
  }

  /* ---------- placement table: positions face toward `face` (default tree) ---------- */
  const inst = {};
  const ORDER = TCS.data.UPGRADES.map(u => u.id);
  let axeOwner = null;

  function create(id){
    const d = defs[id]; if (!d) return null;
    const i = { id, def: d, copies: [], n: 0 };
    if (d.axe){ inst[id] = i; return i; }
    if (d.cap){
      i.root = new THREE.Group(); SC().addToWorld(i.root);
    } else {
      i.root = bake(d.build()); i.root.position.set(d.pos[0], 0, d.pos[1]);
      const f = d.face || [0, 0]; if (d.face !== undefined || (d.pos[0] || d.pos[1])) faceTo(i.root, f[0], f[1]);
      if (d.pos[0] === 0 && d.pos[1] === 0) i.root.rotation.y = 0;
      SC().addToWorld(i.root); if (!d.hidden) U.popIn(i.root, d.scale || 1);
    }
    if (d.setup) d.setup(i);
    if (i.root) bake(i.root);
    inst[id] = i; return i;
  }
  function setCount(i, n){
    const d = i.def; i.n = n;
    if (d.cap){
      const want = count(n, d.cap, d.step);
      while (i.copies.length < want){
        const k = i.copies.length, c = bake(d.build()), p = d.copyPos(k), s = c.scale.x;
        c.position.set(p[0], 0, p[1]);
        if (d.copyFace) faceTo(c, d.copyFace[0], d.copyFace[1]); else if (d.copyRot) c.rotation.y = d.copyRot(k);
        i.root.add(c); i.copies.push(c); U.popIn(c, s);
      }
    }
    if (i.setCount) i.setCount(n);
  }
  function destroy(i){
    if (i.cleanup) i.cleanup();
    if (i.root){ SC().removeFromWorld(i.root); U.forgetOutlines(i.root); }
    delete inst[i.id];
  }
  function refreshAxe(){
    const want = inst.chainsaw ? 'chainsaw' : inst.doubleBit ? 'doubleBit' : inst.steelAxe ? 'steelAxe' : null;
    if (want === axeOwner) return;
    axeOwner = want;
    const lj = SC().lumberjack; if (!lj || !lj.setAxe) return;
    if (!want){ lj.setAxe(null); chainsawGroup = null; return; }
    const g = defs[want].build();
    lj.setAxe(g); U.trackOutlines(g);
    chainsawGroup = want === 'chainsaw' ? g : null;
  }
  let chainsawGroup = null;

  /* ---------- icons: offscreen render, cached ---------- */
  const iconCache = {};
  let iconR = null, iconScene = null, iconCam = null;
  function icon(id){
    if (iconCache[id]) return iconCache[id];
    const d = defs[id]; if (!d) return null;
    try {
      if (!iconR){
        const cv = document.createElement('canvas'); cv.width = cv.height = 96;
        iconR = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, preserveDrawingBuffer: true });
        iconR.setPixelRatio(1); iconR.setSize(96, 96, false); iconR.outputColorSpace = THREE.SRGBColorSpace;
        iconScene = new THREE.Scene();
        iconScene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
        const sun = new THREE.DirectionalLight(0xffffff, 1.8); sun.position.set(3, 5, 4); iconScene.add(sun);
        iconCam = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
      }
      let obj = d.build();
      if (d.cap && obj.userData.w === undefined && id === 'robots'){ /* single robot */ }
      if (d.axe){ obj.rotation.set(-PI / 2, 0, 0); const mid = new THREE.Group(); mid.rotation.y = PI / 2; mid.add(obj); const w = new THREE.Group(); w.rotation.z = -0.65; w.add(mid); obj = w; }
      obj.traverse(o => { if (o.name === '__shadow') o.visible = false; });
      if (id === 'flume'){ obj.getObjectByName('chute').children.slice(2).forEach(c => c.visible = false); log(0.8, 0.16, obj, [0, 0.4, 0]); }
      if (id === 'hauler'){ for (let k = 0; k < 6; k++) log(1.6, 0.17, obj, [0, 0.29 + (k < 3 ? 0 : 0.3), ((k < 3 ? k : k - 3.5) - 1) * 0.36]).children.forEach(ch => ch.rotation.set(0, 0, PI / 2)); }
      if (id === 'skidSteer'){ obj.getObjectByName('veh').rotation.y = 0; }
      if (id === 'mech') obj.getObjectByName('arm').rotation.x = -0.4;
      obj.rotation.y += d.axe ? 0 : ({ muleCart: 1.3, trucks: 1.2, skidSteer: 0.9, sawmill: 0.2, megafactory: 0.1, satellite: 0.2, portal: 0 }[id] ?? 0.5);
      if (id === 'crosscut') obj.getObjectByName('saw').scale.z = 0.3;
      if (id === 'giantAxe') obj.rotation.z = -0.8;
      iconScene.add(obj); obj.updateMatrixWorld(true);
      const box = new THREE.Box3();
      obj.traverse(o => { let vis = true; for (let q = o; q; q = q.parent) if (!q.visible) vis = false; if (o.isMesh && vis && !o.userData.isOutline && o.name !== '__shadow'){ o.geometry.computeBoundingBox && !o.geometry.boundingBox && o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld); box.union(b); } });
      const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3()), r = Math.max(sz.x, sz.y, sz.z) * 0.62;
      const dist = r / Math.sin(THREE.MathUtils.degToRad(15)) * 0.95;
      iconCam.position.set(c.x + dist * 0.45, c.y + dist * 0.45, c.z + dist * 0.77).sub(c).normalize().multiplyScalar(dist).add(c);
      iconCam.lookAt(c); iconCam.updateProjectionMatrix();
      iconR.setClearColor(0x000000, 0); iconR.render(iconScene, iconCam);
      const url = iconR.domElement.toDataURL('image/png');
      iconScene.remove(obj); U.forgetOutlines(obj);
      return iconCache[id] = url;
    } catch(e){ console.error(e); return null; }
  }

  /* ---------- public API ---------- */
  let T = 0;
  TCS.upgrades3d = {
    init(){
      initPools();
      TCS.bus.on('chopImpact', e => { if (inst.whetstone) sparkBurst(e.point, 9); });
    },
    sync(owned){
      owned = owned || {};
      for (const id of ORDER){
        const n = owned[id] || 0; let i = inst[id];
        if (n > 0){ if (!i) i = create(id); if (i && n !== i.n) setCount(i, n); }
        else if (i){ if (i.def.axe) delete inst[id]; else destroy(i); }
      }
      refreshAxe();
    },
    onClick(evt){
      for (const id in inst){ const i = inst[id]; if (i.def.click) try { i.def.click(i, evt); } catch(e){ console.error(e); } }
      if (chainsawGroup){
        const p = new THREE.Vector3(); chainsawGroup.updateMatrixWorld(true); chainsawGroup.localToWorld(p.set(0.18, 0.3, 0.1));
        for (let k = 0; k < 2; k++) puff(p, 0.7, 0.9, new THREE.Vector3(U.rand(-0.4, 0.4), U.rand(0.8, 1.4), U.rand(-0.4, 0.4)));
      }
    },
    update(dt){
      if (!puffs) return;
      T += dt;
      for (const id in inst){ const i = inst[id]; if (i.def.update) try { i.def.update(i, dt, T); } catch(e){ console.error(e); } }
      puffs.update(dt, (p, dt) => { const k = 1 - p.life / p.max; p.m.position.addScaledVector(p.v, dt); fade(p.m, p.size * (k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8 * 0.9) * (0.6 + k * 0.6)); });
      sparks.update(dt, (p, dt) => { p.v.y -= 12 * dt; p.m.position.addScaledVector(p.v, dt); p.m.lookAt(p.m.position.x + p.v.x, p.m.position.y + p.v.y, p.m.position.z + p.v.z); fade(p.m, p.life / p.max); });
      flyLogs.update(dt, (p, dt) => { const k = 1 - p.life / p.max; p.m.position.lerpVectors(p.from, p.to, U.ease.inQuad(k)); p.m.position.y += Math.sin(k * PI) * 2.5; p.m.rotation.y += dt * p.spin; p.m.rotation.x += dt * p.spin * 0.5; fade(p.m, k > 0.8 ? (1 - k) / 0.2 : k < 0.1 ? k / 0.1 : 1); });
    },
    icon,
    _inst: inst,
    // test hook: a fresh, un-placed copy of an upgrade's model (not added to the scene)
    _build(id){ const d = defs[id]; return d && d.build ? d.build() : null; }
  };
})();
