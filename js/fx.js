/* fx.js — FX phase. Golden squirrel / bird bonus, Timber Frenzy visuals, Coffee Break visuals,
   the rebirth "TIMBER!" cinematic, cosmetic meshes (+ cached icon PNGs). Classic IIFE on window.TCS. */
(function(){
  const TCS = window.TCS;
  const THREE = window.THREE;
  const U = TCS.util, M = TCS.model, bus = TCS.bus;
  const S = () => TCS.state, SC = () => TCS.scene;
  const low = () => { try { return TCS.state.data.settings.graphics === 'low'; } catch(e){ return false; } };
  const GOLD = 0xffc928, GOLD_DARK = 0xd99a12;

  /* ---------------- generic particles ---------------- */
  const parts = []; // {m, v, t, life, grav, spin, s0, ground}
  let sparkGeo, chipGeo, puffGeo;
  function geos(){
    if (sparkGeo) return;
    sparkGeo = new THREE.OctahedronGeometry(0.14, 0);
    chipGeo = new THREE.BoxGeometry(0.22, 0.08, 0.16);
    puffGeo = new THREE.IcosahedronGeometry(0.4, 1);
  }
  function particle(geo, mat, pos, v, o){
    o = o || {};
    if (parts.length > 220){ const p = parts.shift(); p.m.parent && p.m.parent.remove(p.m); }
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(pos); m.rotation.set(Math.random() * 6, Math.random() * 6, 0);
    const s0 = o.scale || 1; m.scale.setScalar(s0);
    SC().world.add(m);
    parts.push({ m, v: v.clone(), t: 0, life: o.life || 0.8, grav: o.grav == null ? 0 : o.grav, spin: o.spin == null ? 8 : o.spin,
      s0, grow: o.grow || 0, ground: !!o.ground, drag: o.drag || 0 });
    return m;
  }
  function updateParticles(dt){
    for (let i = parts.length - 1; i >= 0; i--){
      const p = parts[i]; p.t += dt;
      const k = p.t / p.life;
      if (k >= 1){ p.m.parent && p.m.parent.remove(p.m); parts.splice(i, 1); continue; }
      p.v.y -= p.grav * dt;
      if (p.drag) p.v.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.m.position.addScaledVector(p.v, dt);
      if (p.ground && p.m.position.y < 0.08){ p.m.position.y = 0.08; p.v.y = Math.abs(p.v.y) * 0.35; p.v.x *= 0.6; p.v.z *= 0.6; }
      p.m.rotation.x += p.spin * dt; p.m.rotation.y += p.spin * 0.7 * dt;
      const sc = p.s0 * (1 + p.grow * k) * (k > 0.6 ? 1 - (k - 0.6) / 0.4 : Math.min(1, k * 8 + 0.3));
      p.m.scale.setScalar(Math.max(0.001, sc));
    }
  }
  let sparkMat, sparkWhite, goldChipMat, goldChipMat2;
  function mats(){
    if (sparkMat) return;
    sparkMat = U.toon(0xffe066, { emissive: 0xffb300, emissiveIntensity: 0.9 });
    sparkWhite = U.toon(0xffffff, { emissive: 0xfff3b0, emissiveIntensity: 0.9 });
    goldChipMat = U.toon(0xffd23a, { emissive: 0xb07000, emissiveIntensity: 0.5 });
    goldChipMat2 = U.toon(0xffef9a, { emissive: 0xb07000, emissiveIntensity: 0.4 });
  }
  function sparkleBurst(pos, n, speed){
    geos(); mats();
    if (low()) n = Math.ceil(n * 0.25);
    for (let i = 0; i < n; i++){
      const dir = new THREE.Vector3(U.rand(-1, 1), U.rand(-0.2, 1), U.rand(-1, 1)).normalize().multiplyScalar(U.rand(0.5, 1) * (speed || 6));
      particle(sparkGeo, i % 3 ? sparkMat : sparkWhite, pos, dir, { life: U.rand(0.5, 0.9), grav: 6, drag: 2.5, scale: U.rand(0.8, 1.6), spin: 10 });
    }
  }

  /* ---------------- overlay helpers (DOM) ---------------- */
  function layer(){ return document.getElementById('ui-layer'); }
  let glowEl = null;
  function ensureGlow(){
    if (glowEl || !layer()) return glowEl;
    glowEl = document.createElement('div');
    glowEl.className = 'passthrough fx-frenzy-glow';
    glowEl.style.cssText = 'position:absolute;inset:0;pointer-events:none;opacity:0;transition:none;' +
      'background:radial-gradient(ellipse at 35% 55%, rgba(255,200,80,0) 45%, rgba(255,150,30,0.4) 75%, rgba(255,110,0,0.6) 100%);' +
      'mix-blend-mode:normal;z-index:0';
    layer().insertBefore(glowEl, layer().firstChild);
    return glowEl;
  }

  /* ================= GOLDEN SQUIRREL / BIRD ================= */
  const gold = () => ({ emissive: 0x8a5a00, emissiveIntensity: 0.35 });
  function buildSquirrel(){
    const g = new THREE.Group(); g.name = 'goldenSquirrel';
    const body = M.group(g); body.name = 'body';
    const E = gold();
    M.part('sphere', [0.42, 18, 14], GOLD, Object.assign({ parent: body, pos: [0, 0.48, 0], scale: [1.25, 0.9, 0.85] }, E));
    M.part('sphere', [0.3, 16, 12], 0xffe9a8, Object.assign({ parent: body, pos: [0.2, 0.42, 0], scale: [0.9, 0.9, 0.7], outline: false }, E)); // belly
    const head = M.group(body, [0.5, 0.82, 0]);
    M.part('sphere', [0.3, 18, 14], GOLD, Object.assign({ parent: head }, E));
    M.part('sphere', [0.14, 10, 8], 0xffe9a8, Object.assign({ parent: head, pos: [0.22, -0.07, 0], scale: [1, 0.8, 1] }, E));
    M.part('sphere', [0.05, 8, 6], 0x3b2514, { parent: head, pos: [0.34, -0.03, 0], outline: false }); // nose
    [-1, 1].forEach(sd => {
      M.part('sphere', [0.06, 10, 8], 0x1b1b1b, { parent: head, pos: [0.18, 0.08, sd * 0.17], scale: [0.8, 1.2, 0.8], outline: false });
      M.part('sphere', [0.022, 6, 6], 0xffffff, { parent: head, pos: [0.22, 0.11, sd * 0.19], outline: false });
      M.part('cone', [0.09, 0.22, 8], GOLD, Object.assign({ parent: head, pos: [-0.05, 0.3, sd * 0.13], rot: [sd * 0.25, 0, 0] }, E));
      M.part('capsule', [0.07, 0.14], GOLD_DARK, Object.assign({ parent: body, pos: [0.3, 0.12, sd * 0.2], rot: [0, 0, 1.3], outline: 0.08 }, E));
      M.part('capsule', [0.09, 0.16], GOLD_DARK, Object.assign({ parent: body, pos: [-0.3, 0.12, sd * 0.22], rot: [0, 0, 1.4], outline: 0.08 }, E));
    });
    // big bushy tail (curl of spheres)
    const tail = M.group(body, [-0.45, 0.45, 0]); tail.name = 'tail';
    const tp = [[-0.12, 0.1, 0.26], [-0.28, 0.42, 0.32], [-0.26, 0.8, 0.34], [-0.06, 1.05, 0.3], [0.14, 1.02, 0.22]];
    tp.forEach((p, i) => M.part('sphere', [p[2], 14, 10], i % 2 ? 0xffd75a : GOLD, Object.assign({ parent: tail, pos: [p[0], p[1], 0] }, E)));
    const hit = new THREE.Mesh(new THREE.SphereGeometry(1.1, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 0.7; g.add(hit);
    g.userData.tail = tail; g.userData.body = body;
    g.add(U.blobShadow(0.6, 0.25));
    return g;
  }
  function buildBird(){
    const g = new THREE.Group(); g.name = 'goldenBird';
    const body = M.group(g); const E = gold();
    M.part('sphere', [0.4, 18, 14], GOLD, Object.assign({ parent: body, scale: [1.3, 0.9, 0.9] }, E));
    M.part('sphere', [0.28, 16, 12], GOLD, Object.assign({ parent: body, pos: [0.48, 0.25, 0] }, E));
    M.part('cone', [0.1, 0.28, 8], 0xff8a00, { parent: body, pos: [0.82, 0.22, 0], rot: [0, 0, -Math.PI / 2] });
    [-1, 1].forEach(sd => {
      M.part('sphere', [0.055, 8, 6], 0x1b1b1b, { parent: body, pos: [0.62, 0.34, sd * 0.19], outline: false });
    });
    M.part('box', [0.4, 0.06, 0.4, 0.03], GOLD_DARK, Object.assign({ parent: body, pos: [-0.62, 0.08, 0], rot: [0, 0, 0.3] }, E));
    const wings = [];
    [-1, 1].forEach(sd => {
      const piv = M.group(body, [0, 0.12, sd * 0.25]);
      M.part('box', [0.55, 0.06, 0.75, 0.03], 0xffdf6a, Object.assign({ parent: piv, pos: [0, 0, sd * 0.38] }, E));
      wings.push({ piv, sd });
    });
    const hit = new THREE.Mesh(new THREE.SphereGeometry(1.2, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
    g.add(hit);
    g.userData.wings = wings; g.userData.body = body;
    return g;
  }

  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const ray = new THREE.Raycaster();
  function screenToPlane(fx, fy, h){
    const cam = SC().camera; cam.updateMatrixWorld();
    ray.setFromCamera(new THREE.Vector2(fx * 2 - 1, -(fy * 2 - 1)), cam);
    plane.constant = -h;
    const out = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, out) ? out : null;
  }

  let critter = null; // {g, kind, from, to, t, dur, remove, sparkT}
  let squirrelTimer = U.rand(60, 120);
  function nextInterval(){ let r = 1; try { r = TCS.state.squirrelRate(); } catch(e){} return U.rand(60, 120) / r; }
  function spawnSquirrel(kind){
    if (critter) despawn();
    kind = kind || (Math.random() < 0.25 ? 'bird' : 'squirrel');
    const bird = kind === 'bird';
    const dirRight = Math.random() < 0.5;
    const fy = bird ? U.rand(0.16, 0.3) : U.rand(0.7, 0.84);
    const h = bird ? 6.5 : 0;
    const a = screenToPlane(dirRight ? -0.06 : 0.58, fy, h), b = screenToPlane(dirRight ? 0.58 : -0.06, fy + (bird ? U.rand(-0.06, 0.06) : 0), h);
    if (!a || !b) return null;
    const g = bird ? buildBird() : buildSquirrel();
    g.scale.setScalar(bird ? 0.75 : 1.15);
    g.position.copy(a);
    g.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
    SC().addToWorld(g);
    const remove = SC().addClickable(g, (hit, e) => catchCritter(e), 50);
    critter = { g, kind, from: a, to: b, t: 0, dur: bird ? 6.5 : 6, remove, sparkT: 0, caught: false };
    try { TCS.audio.play('squirrel'); } catch(err){}
    return g;
  }
  function despawn(){
    if (!critter) return;
    critter.remove(); SC().removeFromWorld(critter.g); U.forgetOutlines(critter.g);
    critter = null;
  }
  function catchCritter(e){
    if (!critter || critter.caught) return;
    critter.caught = true;
    const c = critter;
    const pos = c.g.position.clone(); pos.y += c.kind === 'bird' ? 0 : 0.7;
    const kind = Math.random() < 0.3 ? 'burst' : 'wood';
    let amount = 0;
    try { amount = TCS.state.squirrelReward(kind); } catch(err){ console.error(err); }
    sparkleBurst(pos, 34, 7);
    SC().shake(0.12, 0.2);
    const scr = e && e.clientX != null ? { x: e.clientX, y: e.clientY - 30 } : pos;
    SC().floatText(kind === 'burst' ? '77x CLICKS! 10s' : '+' + U.fmt(amount), scr, { cls: 'crit', rise: 130, dur: 1.6, force: true });
    SC().floatText(c.kind === 'bird' ? 'GOLDEN BIRD!' : 'GOLDEN SQUIRREL!', { x: scr.x, y: scr.y - 46 }, { rise: 110, dur: 1.4, force: true });
    c.remove();
    // poof: spin up and shrink
    const s0 = c.g.scale.x;
    U.tween(0.35, k => { c.g.scale.setScalar(s0 * (1 + k * 0.4) * (1 - k)); c.g.rotation.y += 0.4; c.g.position.y += 0.06; },
      { ease: 'inQuad', done(){ if (critter === c){ SC().removeFromWorld(c.g); U.forgetOutlines(c.g); critter = null; } } });
  }
  function updateCritter(dt){
    if (!critter || critter.caught) return;
    const c = critter; c.t += dt;
    const k = c.t / c.dur;
    if (k >= 1){ despawn(); return; }
    c.g.position.lerpVectors(c.from, c.to, k);
    const body = c.g.userData.body;
    if (c.kind === 'bird'){
      c.g.position.y += Math.sin(c.t * 3) * 0.4;
      c.g.userData.wings.forEach(w => { w.piv.rotation.x = w.sd * Math.sin(c.t * 16) * 0.7; });
      body.rotation.z = Math.sin(c.t * 3) * 0.08;
    } else {
      const hop = Math.abs(Math.sin(c.t * 11));
      body.position.y = hop * 0.35;
      body.rotation.z = Math.cos(c.t * 11) * 0.15;
      c.g.userData.tail.rotation.z = Math.sin(c.t * 11) * 0.2;
    }
    c.sparkT -= dt;
    if (c.sparkT <= 0 && !low()){
      c.sparkT = 0.09;
      geos(); mats();
      const p = c.g.position.clone().add(new THREE.Vector3(U.rand(-0.5, 0.5), U.rand(0.3, 1.3), U.rand(-0.5, 0.5)));
      particle(sparkGeo, Math.random() < 0.5 ? sparkMat : sparkWhite, p, new THREE.Vector3(0, U.rand(0.3, 1), 0), { life: 0.7, scale: U.rand(0.6, 1.1), spin: 6 });
    }
  }

  /* ================= TIMBER FRENZY ================= */
  let frenzyGlow = 0;
  function onImpact(e){
    let fr = false; try { fr = TCS.state.frenzyActive(); } catch(err){}
    if (!fr || !e || !e.point) return;
    geos(); mats();
    const n = low() ? 2 : 6;
    for (let i = 0; i < n; i++){
      const v = new THREE.Vector3(U.rand(-3, 1), U.rand(4, 7), U.rand(-1, 3));
      particle(chipGeo, i % 2 ? goldChipMat : goldChipMat2, e.point, v, { life: 1.1, grav: 18, ground: true, scale: U.rand(1, 1.5), spin: 12 });
    }
    if (!low()) for (let i = 0; i < 3; i++) particle(sparkGeo, sparkMat, e.point, new THREE.Vector3(U.rand(-2, 2), U.rand(1, 3), U.rand(-2, 2)), { life: 0.5, drag: 2, scale: 0.9 });
  }
  function updateFrenzy(dt){
    let fr = false; try { fr = TCS.state.loaded && TCS.state.frenzyActive(); } catch(e){}
    frenzyGlow = U.clamp(frenzyGlow + (fr ? dt * 2.5 : -dt * 1.5), 0, 1);
    const el = ensureGlow(); if (!el) return;
    const pulse = 0.85 + Math.sin(performance.now() / 180) * 0.15;
    el.style.opacity = frenzyGlow > 0 ? String(frenzyGlow * pulse) : '0';
    // warm the light a touch
    const L = SC().lights;
    if (L && L.hemi){
      if (L.hemi.userData.fxBase == null) L.hemi.userData.fxBase = L.hemi.intensity;
      L.hemi.intensity = L.hemi.userData.fxBase * (1 + 0.25 * frenzyGlow);
    }
  }

  /* ================= COFFEE BREAK ================= */
  let coffee = null, steamT = 0, coffeeVis = 0;
  function buildCoffee(){
    const g = new THREE.Group(); g.name = 'coffeeMug';
    M.part('cyl', [0.42, 0.48, 0.5, 14], 0x8a5a33, { parent: g, pos: [0, 0.25, 0] });       // little stump
    M.part('cyl', [0.38, 0.38, 0.06, 14], 0xe2b57a, { parent: g, pos: [0, 0.51, 0], outline: false });
    const mug = M.group(g, [0, 0.54, 0]);
    M.part('cyl', [0.2, 0.18, 0.38, 16], 0xffffff, { parent: mug, pos: [0, 0.19, 0] });
    M.part('cyl', [0.205, 0.205, 0.1, 16], 0xe53935, { parent: mug, pos: [0, 0.2, 0], outline: false });
    M.part('cyl', [0.17, 0.17, 0.02, 16], 0x4a2a14, { parent: mug, pos: [0, 0.385, 0], outline: false });
    M.part('torus', [0.11, 0.035], 0xffffff, { parent: mug, pos: [0.21, 0.2, 0], rot: [0, 0, 0] });
    g.userData.mug = mug;
    g.position.set(-4.35, 0, 1.55);
    g.add(U.blobShadow(0.55, 0.25));
    return g;
  }
  let steamMat;
  function updateCoffee(dt){
    let on = false; try { on = TCS.state.loaded && TCS.state.coffeeActive() && SC().mode === 'play'; } catch(e){}
    if (on && !coffee){ coffee = buildCoffee(); SC().addToWorld(coffee); U.popIn(coffee, 1, 0.5); }
    if (!on && coffee){
      const c = coffee; coffee = null;
      U.tween(0.3, k => c.scale.setScalar(Math.max(0.001, 1 - k)), { done(){ SC().removeFromWorld(c); U.forgetOutlines(c); } });
    }
    if (!coffee) return;
    const mug = coffee.userData.mug;
    mug.rotation.z = Math.sin(performance.now() / 400) * 0.04;
    steamT -= dt;
    if (steamT <= 0 && !low()){
      steamT = 0.22;
      geos();
      if (!steamMat) steamMat = U.toon(0xffffff, { opacity: 0.75 });
      const p = mug.getWorldPosition(new THREE.Vector3()); p.x += U.rand(-0.08, 0.08); p.y += 0.5;
      particle(puffGeo, steamMat, p, new THREE.Vector3(U.rand(-0.15, 0.15), U.rand(0.8, 1.1), U.rand(-0.1, 0.1)), { life: 1.6, scale: 0.18, grow: 1.6, spin: 1 });
    }
  }

  /* ================= REBIRTH CINEMATIC ================= */
  let cine = null;
  function bigText(text){
    const L = layer(); if (!L) return null;
    const el = document.createElement('div');
    el.className = 'outlined passthrough fx-timber';
    el.textContent = text;
    el.style.cssText = 'position:absolute;left:30%;top:30%;transform:translate(-50%,-50%) scale(0);font-size:min(16vw,140px);' +
      '--stroke:8px;color:#ffd23a;pointer-events:none;white-space:nowrap;z-index:40;letter-spacing:4px;';
    L.appendChild(el);
    return el;
  }
  function dustPuff(center, n){
    geos();
    const m1 = U.toon(0xd9c4a0, { opacity: 0.85 }), m2 = U.toon(0xbfa47c, { opacity: 0.85 });
    if (low()) n = Math.ceil(n / 3);
    for (let i = 0; i < n; i++){
      const a = Math.random() * Math.PI * 2;
      const p = center.clone().add(new THREE.Vector3(Math.cos(a) * U.rand(0, 1), 0.3, Math.sin(a) * U.rand(0, 1)));
      particle(puffGeo, i % 2 ? m1 : m2, p, new THREE.Vector3(Math.cos(a) * U.rand(2, 5), U.rand(0.5, 2), Math.sin(a) * U.rand(2, 5)),
        { life: U.rand(0.9, 1.4), drag: 2.5, scale: U.rand(0.6, 1.2), grow: 1.5, spin: 1 });
    }
  }
  function buildSapling(sp){
    const g = new THREE.Group();
    M.part('cyl', [0.06, 0.09, 0.7, 8], sp ? sp.bark : 0x7a4a24, { parent: g, pos: [0, 0.35, 0] });
    [-1, 1].forEach(sd => M.part('sphere', [0.22, 12, 8], sp ? sp.leaf : 0x5cc84a, { parent: g, pos: [sd * 0.2, 0.72, 0], scale: [1.2, 0.55, 0.8], rot: [0, 0, sd * 0.4] }));
    M.part('sphere', [0.18, 12, 8], sp ? (sp.leaf2 || sp.leaf) : 0x5cc84a, { parent: g, pos: [0, 0.82, 0], scale: [0.8, 1, 0.8] });
    M.part('sphere', [0.5, 12, 8], 0x6b4424, { parent: g, pos: [0, 0, 0], scale: [1, 0.25, 1], outline: 0.05 }); // dirt mound
    return g;
  }
  // rebirthCinematic(done): fall -> done() (caller does state.rebirth there) -> sapling -> grow.
  function rebirthCinematic(done, opts){
    opts = opts || {};
    if (cine){ if (done) done(); return; }
    const sc = SC(), tree = sc.tree.group;
    const prevPaused = TCS.paused;
    TCS.paused = true;
    cine = { done };
    const blocker = document.createElement('div');
    blocker.className = 'fx-cine-block';
    blocker.style.cssText = 'position:absolute;inset:0;z-index:39;pointer-events:auto;background:transparent;';
    blocker.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); }, true);
    const L = layer(); if (L) L.appendChild(blocker);
    window.__fxCine = true;
    const keyBlock = e => { if (e.code === 'Space'){ e.stopImmediatePropagation(); e.preventDefault(); } };
    window.addEventListener('keydown', keyBlock, true);

    const startRot = tree.rotation.z;
    const timber = bigText('TIMBER!');
    // 0.0-0.35 creak wobble, 0.35-1.6 fall
    U.tween(0.35, (k, r) => { tree.rotation.z = Math.sin(r * Math.PI * 4) * 0.03; tree.rotation.x = 0; });
    if (timber) U.tween(0.5, (k, r) => { timber.style.transform = 'translate(-50%,-50%) rotate(' + (-8 + 8 * k) + 'deg) scale(' + (k * 1.15) + ')'; }, { ease: 'outBack', delay: 0.15 });
    try { TCS.audio.play('timber'); } catch(e){}
    U.tween(1.25, k => { tree.rotation.z = startRot - k * (Math.PI / 2 - 0.02); tree.rotation.x = k * 0.18; }, { ease: 'inQuad', delay: 0.35, done(){
      // impact
      sc.shake(0.5, 0.45);
      const fallDir = new THREE.Vector3(1, 0, 0);
      dustPuff(new THREE.Vector3(0, 0, 0), 18);
      dustPuff(fallDir.clone().multiplyScalar(5), 14);
      dustPuff(fallDir.clone().multiplyScalar(9), 10);
      try { TCS.audio.play('log'); } catch(e){}
      // hide the fallen tree (sink + shrink)
      U.tween(0.4, k => { tree.scale.set(1, 1, 1).multiplyScalar(Math.max(0.001, 1 - k)); }, { ease: 'inQuad', delay: 0.25, done(){
        tree.visible = false; tree.rotation.set(0, 0, 0); tree.scale.set(1, 0.001, 1);
        if (timber) U.tween(0.3, k => { timber.style.opacity = String(1 - k); }, { done(){ timber.remove(); } });
        // apply the rebirth now (species swaps while hidden)
        try { if (done) done(); } catch(e){ console.error(e); }
        let sp = null; try { sp = TCS.state.species(); } catch(e){}
        const sap = buildSapling(sp);
        sc.addToWorld(sap);
        if (!low()) sparkleBurst(new THREE.Vector3(0, 0.5, 0), 14, 4);
        U.popIn(sap, 1.6, 0.5);
        const sub = bigText('REPLANTED!');
        if (sub){ sub.style.fontSize = 'min(9vw,72px)'; sub.style.color = '#8fe36b'; sub.style.top = '24%';
          U.tween(0.4, k => { sub.style.transform = 'translate(-50%,-50%) scale(' + k + ')'; }, { ease: 'outBack', delay: 0.3 });  // after TIMBER! has faded
          U.tween(0.35, k => { sub.style.opacity = String(1 - k); }, { delay: 1.55, done(){ sub.remove(); } }); }  // gone before the world banner (cinematic end)
        // grow the new tree
        U.tween(1.5, (k) => {
          tree.visible = true;
          tree.scale.set(0.3 + 0.7 * Math.min(1, k * 1.4), Math.max(0.001, k), 0.3 + 0.7 * Math.min(1, k * 1.4));
          sap.scale.setScalar(1.6 * Math.max(0.001, 1 - k * 2.5));
        }, { ease: 'outElastic', delay: 0.75, done(){
          tree.scale.set(1, 1, 1); tree.rotation.set(0, 0, 0); tree.visible = true;
          sc.removeFromWorld(sap); U.forgetOutlines(sap);
          sc.shake(0.15, 0.2);
          if (!low()) sparkleBurst(new THREE.Vector3(0, 3, 0), 20, 6);
          blocker.remove(); window.removeEventListener('keydown', keyBlock, true);
          window.__fxCine = false;
          TCS.paused = prevPaused;
          cine = null;
          bus.emit('rebirthCinematicEnd');
        } });
      } });
    } });
  }

  /* ================= COSMETICS ================= */
  function cdef(id){ return (TCS.data.cosmeticById && TCS.data.cosmeticById[id]) || null; }
  function dome(r, h, y0){ // open lathe dome, base radius r at y0, height h
    const pts = [];
    for (let i = 0; i <= 8; i++){ const a = i / 8 * Math.PI / 2; pts.push([Math.max(0.001, Math.cos(a) * r), y0 + Math.sin(a) * h]); }
    return pts;
  }
  function makeCosmetic(id){
    const d = cdef(id); if (!d) return null;
    const g = new THREE.Group(); g.name = 'cos_' + id;
    const col = d.color;
    const P = (t, s, c, o) => M.part(t, s, c, Object.assign({ parent: g }, o || {}));
    switch (id){
      /* ---- hats (origin: top of head, head centre is y = -0.36, r 0.46) ---- */
      case 'beanie':
        P('lathe', dome(0.5, 0.46, -0.16), col);
        P('torus', [0.47, 0.09], 0xb72f27, { pos: [0, -0.13, 0], rot: [Math.PI / 2, 0, 0] });
        P('sphere', [0.14, 12, 10], 0xffffff, { pos: [0, 0.34, 0] });
        break;
      case 'hardhat':
        P('lathe', dome(0.5, 0.42, -0.1), col);
        P('cyl', [0.62, 0.62, 0.05, 24], col, { pos: [0, -0.1, 0.06], scale: [1, 1, 1.1] });
        P('box', [0.12, 0.08, 0.7, 0.04], 0xf0b400, { pos: [0, 0.3, 0], rot: [0.0, 0, 0] });
        P('box', [0.3, 0.14, 0.04, 0.03], 0xffffff, { pos: [0, 0.1, 0.48], rot: [-0.35, 0, 0], outline: false });
        break;
      case 'cowboy':
        // sized like the other hats: brim just wider than the head (r 0.46), sits on top, face stays clear
        P('cyl', [0.58, 0.58, 0.045, 28], col, { pos: [0, -0.04, 0], scale: [1, 1, 0.85] });
        P('torus', [0.56, 0.045], col, { pos: [0, -0.005, 0], rot: [Math.PI / 2, 0, 0], scale: [1, 0.85, 1] });
        P('cyl', [0.3, 0.38, 0.36, 20], col, { pos: [0, 0.15, 0] });
        P('cyl', [0.385, 0.39, 0.08, 20], 0x3b2514, { pos: [0, 0.02, 0], outline: false });
        P('box', [0.05, 0.05, 0.42], 0x7a4a24, { pos: [0, 0.33, 0], outline: false });
        break;
      case 'viking':
        P('lathe', dome(0.5, 0.48, -0.14), col);
        P('torus', [0.49, 0.06], 0x8a6a3a, { pos: [0, -0.12, 0], rot: [Math.PI / 2, 0, 0] });
        [-1, 1].forEach(sd => {
          const h = M.group(g, [sd * 0.44, 0.02, 0]);
          M.part('cone', [0.11, 0.5, 10], 0xfff1d0, { parent: h, pos: [sd * 0.18, 0.18, 0], rot: [0, 0, -sd * 0.9] });
          M.part('cyl', [0.12, 0.13, 0.1, 10], 0x8a6a3a, { parent: h, pos: [sd * 0.02, 0, 0], rot: [0, 0, -sd * 0.9], outline: 0.08 });
        });
        break;
      case 'propeller': {
        
        P('lathe', dome(0.49, 0.42, -0.12), col);
        P('cyl', [0.3, 0.3, 0.04, 20], col, { pos: [0, -0.12, 0.38], scale: [1, 1, 0.7] }); // bill
        P('torus', [0.47, 0.05], 0xffd23a, { pos: [0, -0.1, 0], rot: [Math.PI / 2, 0, 0] });
        P('cyl', [0.04, 0.04, 0.2, 8], 0xffd23a, { pos: [0, 0.38, 0] });
        const prop = M.group(g, [0, 0.49, 0]); prop.userData.fxSpin = 14;
        M.part('box', [0.62, 0.03, 0.13, 0.03], 0xe53935, { parent: prop, pos: [0.3, 0, 0], rot: [0.3, 0, 0] });
        M.part('box', [0.62, 0.03, 0.13, 0.03], 0x2fb84a, { parent: prop, pos: [-0.3, 0, 0], rot: [-0.3, 0, 0] });
        M.part('sphere', [0.06, 10, 8], 0xffd23a, { parent: prop });

        break;
      }
      case 'crown': {
        const E = { emissive: 0x8a5a00, emissiveIntensity: 0.3 };
        P('cyl', [0.38, 0.34, 0.24, 24, true], col, Object.assign({ pos: [0, 0.04, 0] }, E));
        for (let i = 0; i < 6; i++){
          const a = i / 6 * Math.PI * 2;
          P('cone', [0.08, 0.2, 6], col, Object.assign({ pos: [Math.sin(a) * 0.35, 0.25, Math.cos(a) * 0.35] }, E));
          P('sphere', [0.05, 8, 6], i % 2 ? 0xe53935 : 0x3a8cff, { pos: [Math.sin(a) * 0.37, 0.02, Math.cos(a) * 0.37], outline: false });
        }
        P('sphere', [0.07, 10, 8], 0xe53935, { pos: [0, 0.03, 0.38], outline: false });
        break;
      }
      /* ---- face (origin: front of face; head centre at z = -0.40; eyes y 0.06; nose y -0.04 z 0.05) ---- */
      case 'beard':
        P('sphere', [0.42, 20, 14], col, { pos: [0, -0.3, -0.3], scale: [1.08, 0.78, 1.0] });
        P('sphere', [0.24, 16, 12], col, { pos: [0, -0.46, -0.04], scale: [1.2, 1.1, 0.8] });
        [-1, 1].forEach(sd => P('capsule', [0.07, 0.12], 0x5e2f14, { pos: [sd * 0.1, -0.15, 0.06], rot: [0, 0, sd * 1.25], outline: 0.08 }));
        P('box', [0.16, 0.04, 0.04, 0.02], 0xb5524a, { pos: [0, -0.24, 0.12], outline: false }); // mouth
        break;
      case 'braid':
        P('sphere', [0.4, 20, 14], col, { pos: [0, -0.3, -0.32], scale: [1.06, 0.72, 0.98] });
        [-1, 1].forEach(sd => P('capsule', [0.07, 0.12], 0xb3621c, { pos: [sd * 0.1, -0.15, 0.06], rot: [0, 0, sd * 1.25], outline: 0.08 }));
        for (let i = 0; i < 3; i++) P('sphere', [0.13 - i * 0.02, 12, 10], i % 2 ? 0xb3621c : col, { pos: [0, -0.5 - i * 0.17, -0.02 + i * 0.02], scale: [1, 1.15, 0.9] });
        P('torus', [0.06, 0.03], 0x3a8cff, { pos: [0, -0.92, 0.02], rot: [Math.PI / 2, 0, 0] });
        P('sphere', [0.08, 10, 8], col, { pos: [0, -1.02, 0.02] });
        break;
      case 'goggles':
        P('torus', [0.465, 0.035], 0x333a40, { pos: [0, 0.07, -0.4], rot: [Math.PI / 2, 0, 0], outline: false });
        [-1, 1].forEach(sd => {
          P('torus', [0.13, 0.04], 0xff8a00, { pos: [sd * 0.16, 0.07, 0.02] });
          P('cyl', [0.13, 0.13, 0.04, 18], col, { pos: [sd * 0.16, 0.07, 0.02], rot: [Math.PI / 2, 0, 0], opacity: 0.45, outline: false });
        });
        P('box', [0.1, 0.05, 0.05], 0xff8a00, { pos: [0, 0.07, 0.03], outline: false });
        break;
      case 'shades':
        [-1, 1].forEach(sd => {
          P('box', [0.25, 0.15, 0.04, 0.05], col, { pos: [sd * 0.155, 0.06, 0.05], rot: [0, sd * 0.18, 0] });
          P('box', [0.06, 0.025, 0.01], 0xffffff, { pos: [sd * 0.155 - 0.05, 0.1, 0.075], rot: [0, sd * 0.18, 0.4], outline: false });
          P('box', [0.03, 0.03, 0.42], col, { pos: [sd * 0.37, 0.08, -0.17], rot: [0, sd * -0.35, 0], outline: false });
        });
        P('box', [0.1, 0.03, 0.03], col, { pos: [0, 0.09, 0.07], outline: false });
        break;
      case 'mustache':
        [-1, 1].forEach(sd => {
          P('capsule', [0.07, 0.16], col, { pos: [sd * 0.12, -0.15, 0.04], rot: [0, -sd * 0.35, sd * 1.2], outline: 0.08 });
          P('sphere', [0.06, 10, 8], col, { pos: [sd * 0.25, -0.1, -0.01], outline: 0.08 });
        });
        break;
      /* ---- boots (origin: foot centre; default boot spans y -0.1..0.1, z -0.17..0.25) ---- */
      case 'workboots':
        P('box', [0.36, 0.26, 0.46, 0.08], col, { pos: [0, 0.02, 0.05] });
        P('box', [0.38, 0.07, 0.5, 0.03], 0x2b1a0e, { pos: [0, -0.1, 0.05], outline: 0.04 });
        P('box', [0.34, 0.14, 0.2, 0.06], 0xe2b57a, { pos: [0, 0.18, -0.06] }); // cuff
        for (let i = 0; i < 3; i++) P('box', [0.2, 0.025, 0.03], 0xf5e3b0, { pos: [0, 0.07 + i * 0.05, 0.22 - i * 0.04], outline: false });
        break;
      case 'rainboots':
        P('cyl', [0.21, 0.19, 0.4, 16], col, { pos: [0, 0.2, -0.03] });
        P('box', [0.36, 0.2, 0.48, 0.09], col, { pos: [0, -0.02, 0.06] });
        P('box', [0.38, 0.06, 0.5, 0.03], 0x3a8cff, { pos: [0, -0.1, 0.06], outline: 0.04 });
        P('torus', [0.2, 0.04], 0x3a8cff, { pos: [0, 0.4, -0.03], rot: [Math.PI / 2, 0, 0], outline: false });
        break;
      case 'rocketboots': {
        P('box', [0.36, 0.26, 0.46, 0.09], col, { pos: [0, 0.02, 0.05] });
        P('box', [0.38, 0.07, 0.5, 0.03], 0xe53935, { pos: [0, -0.1, 0.05], outline: 0.04 });
        P('box', [0.37, 0.06, 0.3, 0.02], 0xe53935, { pos: [0, 0.1, 0.06], outline: false });
        P('cyl', [0.09, 0.12, 0.16, 12], 0x555b62, { pos: [0, 0.0, -0.24], rot: [Math.PI / 2, 0, 0] });
        const fl = M.group(g, [0, -0.02, -0.33]); fl.userData.fxFlame = true;
        M.part('cone', [0.09, 0.26, 10], 0xff8a00, { parent: fl, pos: [0, 0, -0.1], rot: [-Math.PI / 2, 0, 0], emissive: 0xff5500, emissiveIntensity: 0.6, outline: false });
        M.part('cone', [0.05, 0.16, 8], 0xffe066, { parent: fl, pos: [0, 0, -0.06], rot: [-Math.PI / 2, 0, 0], emissive: 0xffaa00, emissiveIntensity: 0.8, outline: false });
        break;
      }
      case 'goldboots': {
        const E = { emissive: 0x8a5a00, emissiveIntensity: 0.35 };
        P('box', [0.36, 0.26, 0.46, 0.09], col, Object.assign({ pos: [0, 0.02, 0.05] }, E));
        P('box', [0.38, 0.07, 0.5, 0.03], 0xb07a10, Object.assign({ pos: [0, -0.1, 0.05], outline: 0.04 }, E));
        P('torus', [0.17, 0.05], 0xfff0a0, Object.assign({ pos: [0, 0.16, -0.04], rot: [Math.PI / 2, 0, 0] }, E));
        P('sphere', [0.05, 8, 6], 0x3a8cff, { pos: [0, 0.08, 0.28], outline: false });
        g.userData.fxGold = true;
        break;
      }
      default: return null;
    }
    g.traverse(o => { if (o.isMesh) o.userData.clickTarget = 'lumberjack'; });
    return g;
  }

  let animated = []; // {o, kind}
  function collectAnimated(){
    animated = [];
    const root = SC().lumberjack.root;
    root.traverse(o => {
      if (o.userData.fxSpin) animated.push({ o, kind: 'spin' });
      if (o.userData.fxFlame) animated.push({ o, kind: 'flame' });
      if (o.userData.fxGold) animated.push({ o, kind: 'gold', t: Math.random() });
    });
  }
  const _wp = new THREE.Vector3();
  let flameMats;
  function updateCosmetics(dt){
    const t = performance.now() / 1000;
    for (const a of animated){
      if (!a.o.parent) continue;
      if (a.kind === 'spin') a.o.rotation.y += a.o.userData.fxSpin * dt;
      else if (a.kind === 'flame'){
        const s = 0.8 + Math.sin(t * 40 + a.o.id) * 0.2 + Math.random() * 0.15;
        a.o.scale.set(1, 1, s);
        if (!low() && Math.random() < dt * 9){
          geos();
          if (!flameMats) flameMats = [U.toon(0xff8a00, { emissive: 0xff5500, emissiveIntensity: 0.6 }), U.toon(0xffe066, { emissive: 0xffaa00, emissiveIntensity: 0.6 })];
          a.o.getWorldPosition(_wp);
          particle(puffGeo, flameMats[Math.random() < 0.5 ? 0 : 1], _wp, new THREE.Vector3(U.rand(-0.3, 0.3), U.rand(-0.2, 0.4), U.rand(-0.3, 0.3)), { life: 0.45, scale: 0.12, grow: 0.8, spin: 3 });
        }
      } else if (a.kind === 'gold'){
        a.t -= dt;
        if (a.t <= 0 && !low()){
          a.t = U.rand(0.5, 1.2); geos(); mats();
          a.o.getWorldPosition(_wp); _wp.y += 0.2; _wp.x += U.rand(-0.25, 0.25);
          particle(sparkGeo, sparkMat, _wp, new THREE.Vector3(0, 0.6, 0), { life: 0.6, scale: 0.6, spin: 6 });
        }
      }
    }
  }

  function applyEquipped(){
    const eq = (TCS.state.data && TCS.state.data.equipped) || {}, L = SC().lumberjack;
    ['hat', 'face', 'boots'].forEach(slot => {
      const m = eq[slot] ? makeCosmetic(eq[slot]) : null;
      L.attach(slot, m, { pop: !!lastEquipSlot && lastEquipSlot === slot });
    });
    lastEquipSlot = null;
    collectAnimated();
  }
  let lastEquipSlot = null;

  /* ---- cosmetic icons (offscreen renderer, cached data URLs) ---- */
  const iconCache = {};
  let iconR = null, iconScene, iconCam;
  function cosmeticIcon(id){
    if (iconCache[id]) return iconCache[id];
    const mesh = makeCosmetic(id); if (!mesh) return null;
    try {
      if (!iconR){
        const cv = document.createElement('canvas'); cv.width = cv.height = 128;
        iconR = new THREE.WebGLRenderer({ canvas: cv, alpha: true, antialias: true, preserveDrawingBuffer: true });
        iconR.setSize(128, 128, false);
        if (THREE.SRGBColorSpace) iconR.outputColorSpace = THREE.SRGBColorSpace;
        iconScene = new THREE.Scene();
        iconScene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a6a, 1.6));
        const dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(2, 4, 3); iconScene.add(dl);
        iconCam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
      }
      iconScene.add(mesh);
      const box = new THREE.Box3().setFromObject(mesh);
      const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
      const r = Math.max(sz.x, sz.y, sz.z) * 0.62;
      const slot = (cdef(id) || {}).slot;
      const dir = slot === 'boots' ? new THREE.Vector3(1.2, 0.7, 1.4) : new THREE.Vector3(0.6, 0.55, 1.6);
      iconCam.position.copy(c).add(dir.normalize().multiplyScalar(r / Math.tan(THREE.MathUtils.degToRad(15)) * 1.05));
      iconCam.lookAt(c);
      iconR.setClearColor(0x000000, 0);
      iconR.render(iconScene, iconCam);
      iconCache[id] = iconR.domElement.toDataURL('image/png');
      iconScene.remove(mesh);
    } catch(e){ console.error('cosmeticIcon', e); return null; }
    return iconCache[id];
  }

  /* ================= wiring ================= */
  function init(){
    bus.on('chopImpact', onImpact);
    bus.on('equip', e => { lastEquipSlot = e && e.slot; });
    bus.on('frenzyStart', () => { SC().shake(0.25, 0.3); if (!low()) sparkleBurst(SC().tree.impactPoint().clone().setY(3), 24, 8); });
    bus.on('coffeeStart', () => { squirrelTimer = squirrelTimer; });
    bus.on('rebirth', () => { if (!cine) rebirthCinematic(null); });
    bus.on('unload', () => { despawn(); });
    bus.on('sceneMode', m => { if (m !== 'play') despawn(); });
    squirrelTimer = nextInterval();
  }
  function update(dt){
    updateParticles(dt);
    updateCritter(dt);
    updateFrenzy(dt);
    updateCoffee(dt);
    updateCosmetics(dt);
    let canSpawn = false;
    try { canSpawn = TCS.state.loaded && SC().mode === 'play' && !TCS.paused && !document.hidden; } catch(e){}
    if (!canSpawn && critter && !critter.caught && !window.__fxCine) despawn(); // menu opened: clear it
    if (canSpawn && !critter){
      squirrelTimer -= dt;
      if (squirrelTimer <= 0){ squirrelTimer = nextInterval(); spawnSquirrel(); }
    }
  }

  TCS.fx = {
    init, update, rebirthCinematic, makeCosmetic, applyEquipped, cosmeticIcon,
    spawnSquirrel, // test hook: TCS.fx.spawnSquirrel('squirrel'|'bird')
    get critter(){ return critter ? critter.g : null; },
    get cinematicActive(){ return !!cine; },
    sparkleBurst
  };
})();
