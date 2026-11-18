/* scene.js â€” phase 1. Renderer, camera, ground, lights, the infinite tree, the lumberjack, chop juice, picking. */
(function(){
  const THREE = window.THREE;
  const TCS = window.TCS;
  const U = TCS.util, M = TCS.model, bus = TCS.bus;

  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x9fe3ff);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fe3ff);
  scene.fog = new THREE.Fog(0x9fe3ff, 45, 110);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 300);
  const world = new THREE.Group(); scene.add(world);

  /* ---------- lights ---------- */
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8fcf6a, 1.1); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.9); sun.position.set(-6, 12, 8); scene.add(sun);

  /* ---------- ground ---------- */
  (function(){
    const c = document.createElement('canvas'); c.width = c.height = 2;
    const x = c.getContext('2d');
    x.fillStyle = '#8EE05C'; x.fillRect(0, 0, 2, 2);
    x.fillStyle = '#6FD043'; x.fillRect(0, 0, 1, 1); x.fillRect(1, 1, 1, 1);
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
    const size = 240; tex.repeat.set(size / 4, size / 4); // 2x2 texels per 4 units => 2-unit tiles
    const g = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ map: tex }));
    g.rotation.x = -Math.PI / 2; g.name = 'ground';
    g.position.set(1, 0, 1); // align tile edges with the tree so it sits on a tile centre
    scene.add(g);
  })();

  /* ---------- the infinite tree ---------- */
  const SEG_H = 2.0, SEG_R = 1.15, SEG_COUNT = 16;
  const tree = new THREE.Group(); tree.name = 'tree'; world.add(tree);
  const trunk = new THREE.Group(); tree.add(trunk);          // slides down when a log pops out
  const segments = [];
  let species = TCS.data.SPECIES[0];
  let barkTex = null;

  function makeBarkTexture(sp){
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const x = c.getContext('2d');
    const base = '#' + new THREE.Color(sp.bark).getHexString();
    const dark = '#' + new THREE.Color(sp.barkDark).getHexString();
    x.fillStyle = base; x.fillRect(0, 0, 128, 128);
    x.strokeStyle = dark; x.lineCap = 'round';
    if (sp.id === 'birch'){
      for (let i = 0; i < 14; i++){ x.lineWidth = 3 + Math.random() * 4; const y = Math.random() * 128, x0 = Math.random() * 128;
        x.beginPath(); x.moveTo(x0, y); x.lineTo(x0 + 12 + Math.random() * 18, y + (Math.random() - .5) * 3); x.stroke(); }
    } else if (sp.crystal){
      x.lineWidth = 3; for (let i = 0; i < 8; i++){ x.beginPath(); x.moveTo(i * 16, 0); x.lineTo(i * 16 + 30, 128); x.stroke(); }
    } else {
      x.lineWidth = 5;
      for (let i = 0; i < 9; i++){
        const x0 = i * 14.2 + Math.random() * 4; x.beginPath(); x.moveTo(x0, -4);
        for (let y = 0; y <= 132; y += 16) x.lineTo(x0 + Math.sin(y * 0.08 + i) * 3.5, y);
        x.stroke();
      }
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
    t.repeat.set(2, 1); t.magFilter = THREE.LinearFilter;
    return t;
  }
  function barkMaterial(){ return U.toon(0xffffff, { map: barkTex, emissive: species.emissive || 0x000000, emissiveIntensity: 1 }); }

  // wobbly cylinder geometry, matched top/bottom radius so segments stack seamlessly
  function wobbleGeo(seed){
    const g = new THREE.CylinderGeometry(SEG_R, SEG_R, SEG_H, 20, 4, true);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++){
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const a = Math.atan2(z, x), v = (y + SEG_H / 2) / SEG_H;
      const edge = Math.sin(v * Math.PI); // 0 at ends -> seamless joins
      const r = 1 + edge * (0.05 * Math.sin(a * 3 + seed) + 0.035 * Math.sin(a * 5 + seed * 2.1 + v * 4));
      p.setXYZ(i, x * r, y, z * r);
    }
    g.computeVertexNormals();
    return g;
  }
  const wobbleGeos = [0, 1.7, 3.1, 4.4, 5.9].map(wobbleGeo);
  const leafGeoRound = new THREE.IcosahedronGeometry(0.75, 1);
  const leafGeoCone = new THREE.ConeGeometry(0.85, 1.3, 7);
  const leafGeoCrystal = new THREE.OctahedronGeometry(0.7, 0);

  function buildDeco(seg){
    if (seg.deco){ U.forgetOutlines(seg.deco); seg.group.remove(seg.deco); }
    const deco = new THREE.Group(); seg.deco = deco; seg.group.add(deco);
    const nArms = Math.random() < 0.75 ? (Math.random() < 0.45 ? 2 : 1) : 0;
    const ang0 = Math.random() * Math.PI * 2;
    for (let ai = 0; ai < nArms; ai++){
      const ang = ang0 + ai * (Math.PI * (0.8 + Math.random() * 0.4));
      const arm = new THREE.Group(); arm.rotation.y = ang; arm.position.y = (Math.random() - .5) * 0.8; deco.add(arm);
      const len = 0.9 + Math.random() * 0.6;
      M.part('cyl', [0.16, 0.26, len, 8], species.barkDark, { pos: [SEG_R + len / 2 - 0.15, 0.15, 0], rot: [0, 0, -Math.PI / 2 + 0.45], parent: arm, abs: 0.05 });
      const leafMat = U.toon(Math.random() < .5 ? species.leaf : species.leaf2, { emissive: species.crystal ? species.leaf : null, emissiveIntensity: species.crystal ? .25 : 0 });
      const lg = species.crystal ? leafGeoCrystal : species.conifer ? leafGeoCone : leafGeoRound;
      const n = 3 + (Math.random() * 3 | 0);
      for (let i = 0; i < n; i++){
        const m = new THREE.Mesh(lg, leafMat);
        m.position.set(SEG_R + len - 0.1 + (Math.random() - .5) * .7, 0.55 + Math.random() * 0.45 + (species.conifer ? i * .3 : 0), (Math.random() - .5) * 0.9);
        m.scale.setScalar((0.75 + Math.random() * 0.55) * (species.conifer ? 1 - i * 0.08 : 1));
        m.rotation.set(Math.random(), Math.random() * 6, 0);
        if (species.conifer) m.rotation.set(0, Math.random() * 6, 0);
        U.outline(m, 0.08); arm.add(m);
      }
    }
    if (Math.random() < 0.35){ // knot
      const k = M.part('sphere', [0.18, 10, 8], species.barkDark, { pos: [0, (Math.random() - .5) * 1.2, 0], scale: [1, 1.3, 0.5], parent: deco, outline: 0.1 });
      const a = Math.random() * Math.PI * 2; k.position.x = Math.cos(a) * (SEG_R + 0.02); k.position.z = Math.sin(a) * (SEG_R + 0.02); k.lookAt(k.position.x * 2, k.position.y, k.position.z * 2);
    }
  }
  function makeSegment(i){
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(wobbleGeos[i % wobbleGeos.length], barkMaterial());
    mesh.rotation.y = Math.random() * Math.PI * 2;
    mesh.userData.clickTarget = 'tree';
    U.outline(mesh, 0.045);
    group.add(mesh);
    const seg = { group, mesh, deco: null };
    trunk.add(group);
    buildDeco(seg);
    return seg;
  }
  for (let i = 0; i < SEG_COUNT; i++){ const s = makeSegment(i); s.group.position.y = SEG_H / 2 + i * SEG_H; segments.push(s); }

  // generous invisible hitbox so clicks/taps near the trunk edge still count
  const hitbox = new THREE.Mesh(new THREE.CylinderGeometry(SEG_R + 0.55, SEG_R + 0.55, 14, 12), new THREE.MeshBasicMaterial({ visible: false }));
  hitbox.position.y = 7; hitbox.name = 'treeHitbox'; tree.add(hitbox);

  // root flare at the base (static)
  const roots = new THREE.Group(); tree.add(roots);
  function buildRoots(){
    while (roots.children.length){ U.forgetOutlines(roots.children[0]); roots.remove(roots.children[0]); }
    const flare = new THREE.Mesh(new THREE.CylinderGeometry(SEG_R * 1.02, SEG_R * 1.35, 0.45, 20, 1, true), barkMaterial());
    flare.position.y = 0.22; flare.userData.clickTarget = 'tree'; U.outline(flare, 0.04); roots.add(flare);
    for (let i = 0; i < 5; i++){
      const a = i / 5 * Math.PI * 2 + 0.4;
      const r = M.part('capsule', [0.22, 0.6], species.bark, { parent: roots, outline: 0.09 });
      r.material = barkMaterial();
      r.position.set(Math.cos(a) * (SEG_R + 0.2), 0.12, Math.sin(a) * (SEG_R + 0.2));
      r.rotation.set(0, -a, Math.PI / 2 - 0.35); r.rotation.order = 'YXZ';
      r.userData.clickTarget = 'tree';
    }
  }

  // the notch cut on the chopping side (faces the lumberjack)
  const notch = new THREE.Group(); tree.add(notch);
  const NOTCH_Y = 1.05;
  let notchInner, notchDark;
  function buildNotch(){
    while (notch.children.length){ U.forgetOutlines(notch.children[0]); notch.remove(notch.children[0]); }
    // a curved patch hugging the trunk: pale inner-wood cut faces around a dark wedge gap
    notchInner = new THREE.Group(); notch.add(notchInner);
    const R0 = SEG_R * 1.1, W = 0.85;
    const patch = (r, h, mat, y) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 12, 1, true, -W / 2, W), mat); m.position.y = y || 0; notchInner.add(m); return m; };
    const inner = U.toon(species.inner, { nocache: true }); inner.side = THREE.DoubleSide;
    const edge = new THREE.MeshBasicMaterial({ color: 0x1b1b1b, side: THREE.DoubleSide });
    patch(R0 - 0.005, 0.76, edge);
    patch(R0, 0.66, inner);
    const darkM = U.toon(0x3b2514, { nocache: true }); darkM.side = THREE.DoubleSide;
    notchDark = patch(R0 + 0.006, 0.36, darkM, -0.02);

    notch.position.y = NOTCH_Y;
  }
  let notchDepth = 0;
  function setNotch(depth){
    notchDepth = depth;
    notchInner.visible = depth > 0.01;
    notchInner.scale.set(1, 0.35 + depth * 0.65, 1);
    if (notchDark) notchDark.scale.y = 0.5 + depth * 0.8;
  }
  function aimNotch(){ // face toward the lumberjack
    const a = Math.atan2(lumber.root.position.x - tree.position.x, lumber.root.position.z - tree.position.z);
    notch.rotation.y = a + NOTCH_TURN;
    aimLumber();
  }

  let barkMat = null;
  function setSpecies(sp){
    species = sp || TCS.data.SPECIES[0];
    if (barkTex) barkTex.dispose();
    barkTex = makeBarkTexture(species);
    barkMat = barkMaterial();
    segments.forEach(s => { s.mesh.material = barkMat; buildDeco(s); });
    buildRoots(); buildNotch(); aimNotch(); setNotch(0);
    logMats = null;
  }

  /* logs that pop out and roll away */
  const logs = [];
  const LOG_R = 0.36;
  let logMats = null;
  function dropSegment(){
    // the bottom segment pops out as a log; trunk slides down one segment; segment is recycled to the top
    const bottom = segments.shift();
    const topY = segments[segments.length - 1].group.position.y + SEG_H;
    bottom.group.position.y = topY;
    bottom.mesh.rotation.y = Math.random() * Math.PI * 2;
    buildDeco(bottom);
    segments.push(bottom);
    segments.forEach(s => s.group.position.y -= SEG_H);
    trunk.position.y = SEG_H;
    U.tween(0.32, k => { trunk.position.y = SEG_H * (1 - k); }, { ease: 'inQuad', done(){ trunk.position.y = 0; U.squash(tree, 0.08, 0.25); bus.emit('trunkLanded'); } });
    spawnLog();
    setNotch(0);
  }
  const MAX_LOGS = 2; let lastLogAt = 0;
  function spawnLog(){
    // fast chopping: don't spawn a conveyor of logs - at most one every 0.35 s and MAX_LOGS rolling at once
    const now = performance.now();
    if (now - lastLogAt < 350) return;
    lastLogAt = now;
    while (logs.length >= MAX_LOGS){ const o = logs.shift(); world.remove(o.g); world.remove(o.sh); U.forgetOutlines(o.g); }
    if (!logMats) logMats = { bark: barkMat, inner: U.toon(species.inner), ring: U.toon(species.barkDark) };
    const g = new THREE.Group(), roller = new THREE.Group(); g.add(roller);
    const body = new THREE.Group(); body.rotation.z = Math.PI / 2; roller.add(body); // cylinder axis -> local x
    const bm = new THREE.Mesh(M.geo('cyl', [LOG_R, LOG_R, 1.0, 14]), logMats.bark); U.outline(bm, 0.07); body.add(bm);
    [-1, 1].forEach(sd => {
      const cap = new THREE.Mesh(M.geo('cyl', [LOG_R * 0.92, LOG_R * 0.92, 0.04, 14]), logMats.inner); cap.position.y = sd * 0.5; body.add(cap);
      const ring = new THREE.Mesh(M.geo('torus', [LOG_R * 0.45, 0.03]), logMats.ring); ring.rotation.x = Math.PI / 2; ring.position.y = sd * 0.52; body.add(ring);
    });
    // roll away behind the tree on the far side from the camera and the shop (back-left), never across the lumberjack
    const dir = new THREE.Vector3(-0.35 + U.rand(-0.3, 0.3), 0, -1).normalize();
    const start = new THREE.Vector3(tree.position.x, 1.0, tree.position.z).addScaledVector(dir, SEG_R + 0.2);
    g.position.copy(start); g.rotation.y = Math.atan2(dir.x, dir.z);
    world.add(g);
    const sh = U.blobShadow(0.7, 0.25); world.add(sh);
    logs.push({ g, roller, sh, dir, t: 0, vy: 3.5, pos: start.clone(), roll: 0 });
    U.popIn(g, 1, 0.25);
  }
  function updateLogs(dt){
    for (let i = logs.length - 1; i >= 0; i--){
      const L = logs[i]; L.t += dt;
      L.vy -= 18 * dt; L.pos.y += L.vy * dt;
      if (L.pos.y < LOG_R){ L.pos.y = LOG_R; L.vy = Math.abs(L.vy) > 2 ? -L.vy * 0.35 : 0; }
      const speed = 5.2 * Math.max(0.5, 1 - L.t / 3);
      L.pos.addScaledVector(L.dir, speed * dt);
      L.roll += speed * dt / LOG_R;
      L.g.position.copy(L.pos); L.roller.rotation.x = L.roll;
      L.sh.position.set(L.pos.x, 0.03, L.pos.z);
      if (L.t > 1.4){
        const k = Math.max(0.001, 1 - (L.t - 1.4) / 0.3);
        L.g.scale.setScalar(k); L.sh.scale.setScalar(k);
        if (L.t > 1.7){ world.remove(L.g); world.remove(L.sh); U.forgetOutlines(L.g); logs.splice(i, 1); }
      }
    }
  }

  /* ---------- the lumberjack ---------- */
  function makePlaidTexture(){
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    x.fillStyle = '#e53935'; x.fillRect(0, 0, 64, 64);
    x.fillStyle = 'rgba(110,14,14,0.55)';
    for (let i = 0; i < 64; i += 16){ x.fillRect(i, 0, 7, 64); x.fillRect(0, i, 64, 7); }
    x.fillStyle = 'rgba(30,8,8,0.55)';
    for (let i = 0; i < 64; i += 16){ x.fillRect(i + 11, 0, 2, 64); x.fillRect(0, i + 11, 64, 2); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = THREE.NearestFilter; t.repeat.set(3, 2);
    return t;
  }
  const lumber = (function(){
    const root = new THREE.Group(); root.name = 'lumberjack';
    const body = new THREE.Group(); root.add(body);              // squash target
    const C = { skin: 0xffc9a0, jeans: 0x3866c9, boot: 0x5a3418, hair: 0x7a4320, beard: 0x8a4b22, axeHandle: 0xb07a43, axeHead: 0x9aa4ad };
    const plaid = U.toon(0xffffff, { map: makePlaidTexture() });
    const P = (t, s, c, o) => M.part(t, s, c, Object.assign({ parent: body }, o));
    // stubby legs + chunky boots
    const legs = {};
    [-1, 1].forEach(sd => {
      P('capsule', [0.17, 0.16], C.jeans, { pos: [sd * 0.19, 0.32, 0] });
      const bootSlot = new THREE.Group(); bootSlot.position.set(sd * 0.19, 0.1, 0.04); body.add(bootSlot);
      const boot = M.part('box', [0.34, 0.22, 0.46, 0.1], C.boot, { parent: bootSlot, pos: [0, 0, 0.05] });
      legs[sd < 0 ? 'L' : 'R'] = { slot: bootSlot, boot };
    });
    // soft round plaid body + jeans bottom + belt
    P('sphere', [0.42, 20, 14], C.jeans, { pos: [0, 0.5, 0], scale: [1, 0.55, 0.9] });
    P('sphere', [0.47, 24, 18], plaid, { pos: [0, 0.8, 0], scale: [1, 0.92, 0.88] });
    P('torus', [0.4, 0.05], 0x3b2a1a, { pos: [0, 0.56, 0], rot: [Math.PI / 2, 0, 0], scale: [1.08, 0.92, 1], outline: 0.08 });
    P('box', [0.16, 0.12, 0.05, 0.02], 0xffcf3a, { pos: [0, 0.56, 0.38], outline: 0.15 }); // buckle
    // big head
    const HR = 0.5;
    const headG = new THREE.Group(); headG.position.set(0, 1.42, 0.03); body.add(headG);
    M.part('sphere', [HR, 28, 20], C.skin, { parent: headG, outline: 0.045 });
    M.part('sphere', [HR * 1.03, 24, 14], C.hair, { parent: headG, pos: [0, 0.1, -0.1], scale: [1, 0.85, 0.92], outline: false }); // hair cap
    // eyes, brows, cheeks, nose (front = +z)
    [-1, 1].forEach(sd => {
      M.part('sphere', [0.075, 12, 10], 0x1b1b1b, { parent: headG, pos: [sd * 0.18, 0.08, HR - 0.04], scale: [1, 1.35, 0.6], outline: false });
      M.part('sphere', [0.026, 6, 6], 0xffffff, { parent: headG, pos: [sd * 0.18 + 0.025, 0.125, HR - 0.005], outline: false });
      M.part('box', [0.19, 0.055, 0.05, 0.02], C.hair, { parent: headG, pos: [sd * 0.18, 0.25, HR - 0.04], rot: [-0.2, 0, -sd * 0.2], outline: false });
      M.part('sphere', [0.075, 8, 6], 0xff8f8f, { parent: headG, pos: [sd * 0.33, -0.04, HR - 0.14], scale: [1, 0.6, 0.4], outline: false });
    });
    M.part('sphere', [0.1, 12, 10], 0xf2a27b, { parent: headG, pos: [0, -0.02, HR + 0.02], outline: 0.1 });
    // big bushy beard (default look; hidden when a face cosmetic is equipped)
    const stubble = new THREE.Group(); headG.add(stubble);
    M.part('sphere', [0.46, 20, 14], C.beard, { parent: stubble, pos: [0, -0.3, 0.18], scale: [1.05, 0.62, 0.78], outline: 0.05 });
    M.part('sphere', [0.18, 12, 10], C.beard, { parent: stubble, pos: [0, -0.5, 0.36], scale: [1.2, 1, 0.8], outline: 0.08 });
    M.part('box', [0.36, 0.08, 0.06, 0.03], C.beard, { parent: stubble, pos: [0, -0.12, HR - 0.02], outline: false }); // moustache
    // slots
    const hatSlot = new THREE.Group(); hatSlot.position.set(0, HR - 0.08, 0); headG.add(hatSlot);
    const faceSlot = new THREE.Group(); faceSlot.position.set(0, 0, HR - 0.02); headG.add(faceSlot);
    // arms: one pivot at chest holds both arms + axe for a sweeping swing
    const armPivot = new THREE.Group(); armPivot.position.set(0, 0.92, 0.05); armPivot.rotation.order = 'YXZ'; body.add(armPivot);
    [-1, 1].forEach(sd => {
      const sh = new THREE.Group(); sh.position.set(sd * 0.36, 0, 0); armPivot.add(sh);
      M.part('capsule', [0.13, 0.28], plaid, { parent: sh, pos: [-sd * 0.12, 0, 0.26], rot: [Math.PI / 2, 0, 0], outline: 0.09 }).rotation.order = 'YXZ';
      sh.children[sh.children.length - 1].rotation.y = -sd * 0.45;
      M.part('sphere', [0.15, 12, 10], C.skin, { parent: sh, pos: [-sd * 0.3, 0, 0.5], outline: 0.1 });
    });
    const handSlot = new THREE.Group(); handSlot.position.set(0, 0, 0.52); armPivot.add(handSlot);
    // default axe: handle along +z from hands, head at the tip pointing sideways
    const axe = new THREE.Group(); handSlot.add(axe);
    const handle = M.part('cyl', [0.06, 0.07, 1.15, 8], C.axeHandle, { parent: axe, pos: [0, 0, 0.42], rot: [Math.PI / 2, 0, 0], abs: 0.035 });
    const axeHead = M.part('box', [0.14, 0.46, 0.32, 0.04], C.axeHead, { parent: axe, pos: [0.04, 0.0, 0.92], abs: 0.04 });
    const blade = M.part('box', [0.07, 0.56, 0.13, 0.02], 0xdfe6ea, { parent: axe, pos: [0.04, 0, 1.09], abs: 0.035 });
    axe.rotation.z = Math.PI / 2; // blade edge faces the swing direction

    const shadow = U.blobShadow(0.8, 0.3); root.add(shadow);

    let swingT = 1, swingDur = 0.3, idleT = 0;
    let STRIKE = 0.7, REST = 1.9; // armPivot.rotation.y (set by aim())
    armPivot.rotation.y = REST;
    function aim(strike, back){ STRIKE = strike; REST = strike + (back == null ? 1.2 : back); }
    function swing(){ swingT = 0; U.squash(body, 0.14, 0.22); }
    function update(dt){
      idleT += dt;
      let r, lift;
      if (swingT < 1){
        swingT = Math.min(1, swingT + dt / swingDur);
        const s = swingT;
        // wind up (lift + pull back), whip through, hold, recover
        if (s < 0.14){ const k = U.ease.outQuad(s / 0.14); r = U.lerp(REST, REST + 0.3, k); lift = U.lerp(-0.2, -0.8, k); }
        else if (s < 0.34){ const k = U.ease.inQuad((s - 0.14) / 0.2); r = U.lerp(REST + 0.3, STRIKE, k); lift = U.lerp(-0.8, 0.1, k); }
        else if (s < 0.46){ r = STRIKE; lift = 0.1; }
        else { const k = U.ease.outQuad((s - 0.46) / 0.54); r = U.lerp(STRIKE, REST, k); lift = U.lerp(0.1, -0.2, k); }
        body.rotation.y = (r - REST) * 0.3;
      } else {
        r = REST + Math.sin(idleT * 2) * 0.04; lift = -0.2 + Math.sin(idleT * 2) * 0.03;
        body.rotation.y = 0;
      }
      armPivot.rotation.y = r; armPivot.rotation.x = lift;
      if (!body.userData._sq) body.position.y = Math.abs(Math.sin(idleT * 2)) * 0.025;
      headG.rotation.z = Math.sin(idleT * 1.6) * 0.04;
    }
    const slots = { hat: hatSlot, face: faceSlot, bootL: legs.L.slot, bootR: legs.R.slot, hand: handSlot, head: headG, body };
    const attached = {};
    function clearSlot(slot){
      (attached[slot] || []).forEach(o => { o.parent && o.parent.remove(o); U.forgetOutlines(o); });
      attached[slot] = [];
    }
    // attach(slot, mesh): slot = 'hat' | 'face' | 'boots' (mesh is used for left, a clone for right) | 'bootL' | 'bootR' | 'hand' | 'head' | 'body'
    function attach(slot, mesh, opts){
      if (slot === 'boots'){
        clearSlot('boots');
        legs.L.boot.visible = legs.R.boot.visible = !mesh;
        if (!mesh) return;
        const r = U.trackOutlines(mesh.clone(true));
        legs.L.slot.add(mesh); legs.R.slot.add(r); attached.boots = [mesh, r];
        if (!opts || opts.pop !== false){ U.popIn(mesh); U.popIn(r); }
        return;
      }
      if (!slots[slot]) throw new Error('lumberjack.attach: unknown slot ' + slot);
      if (slot === 'face') stubble.visible = !mesh;
      clearSlot(slot);
      if (!mesh) return;
      slots[slot].add(mesh); attached[slot] = [mesh];
      if (!opts || opts.pop !== false) U.popIn(mesh, mesh.scale.x || 1);
    }
    function detach(slot){ attach(slot, null); }
    // replace the default axe with a custom group (null restores the default)
    function setAxe(group){
      clearSlot('axe');
      axe.visible = !group;
      if (group){ handSlot.add(group); attached.axe = [group]; U.popIn(group); }
    }
    root.userData.clickTarget = 'lumberjack';
    body.traverse(o => { if (o.isMesh) o.userData.clickTarget = 'lumberjack'; });
    return { root, body, head: headG, armPivot, axe, axeHead, blade, handle, slots, swing, update, attach, detach, setAxe, aim,
      get swinging(){ return swingT < 1; } };
  })();
  world.add(lumber.root);
  lumber.root.position.set(-3.0, 0, 0.35); lumber.root.scale.setScalar(1.35);
  const NOTCH_TURN = 0.95, FACE_TURN = 0.4; // notch turned toward the camera; lumberjack turned so his face reads
  function aimLumber(){
    const np = new THREE.Vector3(tree.position.x + Math.sin(notch.rotation.y) * SEG_R, 0, tree.position.z + Math.cos(notch.rotation.y) * SEG_R);
    const lp = lumber.root.position;
    lumber.root.rotation.y = Math.atan2(np.x - lp.x, np.z - lp.z) - FACE_TURN;
    lumber.root.updateMatrixWorld(true);
    const loc = lumber.root.worldToLocal(np.setY(1.3));
    lumber.aim(Math.atan2(loc.x, loc.z) + 0.12, -1.25);
  }

  /* ---------- wood chips ---------- */
  const chips = [];
  const chipGeo = new THREE.BoxGeometry(0.16, 0.09, 0.22);
  const hudTarget = new THREE.Vector3();
  function hudWorldPoint(out){
    const el = document.getElementById('hud-wood-icon');
    let sx = 40, sy = 40;
    if (el){ const r = el.getBoundingClientRect(); sx = r.left + r.width / 2; sy = r.top + r.height / 2; }
    const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
    out.set(sx / w * 2 - 1, -(sy / h) * 2 + 1, 0.5).unproject(camera);
    const dir = out.sub(camera.position).normalize();
    return out.copy(camera.position).addScaledVector(dir, camera.position.distanceTo(cam.target) * 0.7);
  }
  function spawnChips(origin, n, toHud){
    const matA = U.toon(species.inner), matB = barkMat || U.toon(species.bark);
    for (let i = 0; i < n; i++){
      if (chips.length > 70){ const o = chips.shift(); world.remove(o.m); }
      const m = new THREE.Mesh(chipGeo, i % 2 ? matA : matB);
      U.outline(m, 0.18);
      m.position.copy(origin);
      m.rotation.set(Math.random() * 6, Math.random() * 6, 0);
      const out = new THREE.Vector3(origin.x - tree.position.x, 0, origin.z - tree.position.z).normalize();
      const v = out.multiplyScalar(U.rand(2, 4)).add(new THREE.Vector3(U.rand(-1.6, 1.6), U.rand(4, 7), U.rand(-1.6, 1.6)));
      world.add(m);
      chips.push({ m, v, t: 0, arc: U.rand(0.28, 0.42), toHud, from: null, spin: new THREE.Vector3(U.rand(-12, 12), U.rand(-12, 12), 0) });
    }
  }
  function updateChips(dt){
    for (let i = chips.length - 1; i >= 0; i--){
      const c = chips[i]; c.t += dt;
      c.m.rotation.x += c.spin.x * dt; c.m.rotation.y += c.spin.y * dt;
      if (c.t < c.arc || !c.toHud){
        c.v.y -= 22 * dt; c.m.position.addScaledVector(c.v, dt);
        if (!c.toHud){
          if (c.m.position.y < 0.08){ c.m.position.y = 0.08; c.v.multiplyScalar(0.4); c.v.y = Math.abs(c.v.y) * 0.3; }
          if (c.t > 1.4){ c.m.scale.setScalar(Math.max(0.001, 1 - (c.t - 1.4) * 4)); if (c.t > 1.65){ world.remove(c.m); chips.splice(i, 1); } }
        }
      } else {
        if (!c.from){ c.from = c.m.position.clone(); c.mid = c.from.clone().add(new THREE.Vector3(0, 1.5, 0)); c.ft = 0; c.dur = U.rand(0.35, 0.5); }
        c.ft += dt / c.dur;
        hudWorldPoint(hudTarget);
        const k = U.ease.inQuad(Math.min(1, c.ft)), a = 1 - k;
        c.m.position.set(a * a * c.from.x + 2 * a * k * c.mid.x + k * k * hudTarget.x,
                         a * a * c.from.y + 2 * a * k * c.mid.y + k * k * hudTarget.y,
                         a * a * c.from.z + 2 * a * k * c.mid.z + k * k * hudTarget.z);
        c.m.scale.setScalar(1 - k * 0.75);
        if (c.ft >= 1){
          world.remove(c.m); chips.splice(i, 1);
          bus.emit('chipLanded');
          const el = document.getElementById('hud-wood-icon');
          if (el){ el.classList.remove('bounce'); void el.offsetWidth; el.classList.add('bounce'); }
        }
      }
    }
  }

  /* ---------- floating +N numbers ---------- */
  const tmpV = new THREE.Vector3();
  function worldToScreen(v, out){
    tmpV.copy(v).project(camera);
    const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
    out = out || {}; out.x = (tmpV.x + 1) / 2 * w; out.y = (1 - tmpV.y) / 2 * h; return out;
  }
  // floatText(text, at: Vector3 (world) | {x,y} (screen px), opts {cls, rise=90, dur=0.9})
  function floatText(text, at, opts){
    opts = opts || {};
    if (TCS.state && TCS.state.data.settings.graphics === 'low' && !opts.force && Math.random() < 0.5) return;
    const layer = document.getElementById('ui-layer'); if (!layer) return;
    const p = at && at.isVector3 ? worldToScreen(at) : at;
    const el = document.createElement('div');
    el.className = 'float-num outlined ' + (opts.cls || '');
    el.textContent = text;
    const spread = opts.spread == null ? 1 : opts.spread;
    const x = p.x + U.rand(-55, 55) * spread, y = p.y + U.rand(-28, 12) * spread;
    el.style.left = x + 'px'; el.style.top = y + 'px';
    layer.appendChild(el);
    const rec = { el, tw: null, pop: 0 };
    floats.push(rec);
    while (floats.length > MAX_FLOATS){ const o = floats.shift(); o.tw && o.tw.cancel(); o.el.remove(); }
    const rise = opts.rise || 110, tilt = U.rand(-8, 8);
    const run = () => {
      rec.tw && rec.tw.cancel();
      rec.tw = U.tween(opts.dur || 1.0, (k, r) => {
        const sc = r < 0.12 ? 0.5 + r / 0.12 * 0.75 : 1.25 - Math.min(1, (r - 0.12) * 4) * 0.25;
        el.style.transform = 'translate(-50%,-50%) translateY(' + (-rise * k) + 'px) rotate(' + tilt * (1 - k) + 'deg) scale(' + sc + ')';
        el.style.opacity = r > 0.65 ? String(1 - (r - 0.65) / 0.35) : '1';
      }, { ease: 'outQuad', done(){ el.remove(); const i = floats.indexOf(rec); if (i >= 0) floats.splice(i, 1); } });
    };
    rec.restart = run; run();
    return rec;
  }
  const floats = [], MAX_FLOATS = 7;
  // chop numbers: hits landing in quick succession merge into one growing number instead of a clump
  let comboFloat = null;
  function chopNumber(amount, at, crit){
    const now = performance.now();
    if (comboFloat && now - comboFloat.t < 260 && comboFloat.crit === crit && comboFloat.rec.el.isConnected){
      comboFloat.amount += amount; comboFloat.t = now; comboFloat.hits++;
      const el = comboFloat.rec.el;
      el.textContent = '+' + U.fmt(comboFloat.amount);
      el.classList.toggle('big', comboFloat.hits >= 4);
      if (comboFloat.hits % 3 === 0){ comboFloat = null; } // start a fresh number every few hits so they keep flowing
      else { comboFloat.rec.restart(); return; }
      return;
    }
    const rec = floatText('+' + U.fmt(amount), at, { cls: crit ? 'crit' : '' });
    if (rec) comboFloat = { rec, amount, t: now, crit, hits: 1 };
  }

  /* ---------- camera ---------- */
  const cam = {
    mode: 'play', pitch: THREE.MathUtils.degToRad(38), yaw: THREE.MathUtils.degToRad(-6), dist: 18.5,
    target: new THREE.Vector3(), shakeAmp: 0, shakeT: 0, swayT: 0, orbitAngle: 0, orbitSpeed: 0.12,
    screenShift: 0.2,   // fraction of view width the lumberjack+tree group sits left of screen centre (play area = left ~64%)
    screenLift: -0.1,   // fraction of view height the group sits below centre (negative = lower)
    phoneLift: 0.22,    // bottom-sheet layout (<600px): group sits this far above centre
    titleDist: 22,      // title orbit distance
    phoneTitlePitch: 20, phoneTitleLift: 0.02, phoneTitleShift: -0.33,  // narrow title (<=820px): tree on the right third, logo top-left (menu.css)
    titleShift: -0.17   // title orbit: tree sits this fraction of view width right of centre (menu column on the left)
  };
  function shake(amount, dur){ cam.shakeAmp = Math.max(cam.shakeAmp, amount == null ? 0.15 : amount); cam.shakeT = Math.max(cam.shakeT, dur || 0.2); cam.shakeDur = Math.max(cam.shakeT, dur || 0.2); }
  function setMode(m){ cam.mode = m; if (m === 'orbit') cam.orbitAngle = cam.yaw; bus.emit('sceneMode', m); }
  const _off = new THREE.Vector3(), _focus = new THREE.Vector3();
  function isPhone(w, h){ return w < 600; } // matches the ui.css bottom-sheet breakpoint
  function updateCamera(dt){
    cam.swayT += dt;
    const w = renderer.domElement.clientWidth || 1, h = renderer.domElement.clientHeight || 1;
    const aspect = w / h, phone = isPhone(w, h);
    let yaw = cam.yaw, pitch = cam.pitch, dist = cam.dist, sx, sy;
    // focus between the lumberjack and the tree base so both read as one group
    _focus.set((tree.position.x + lumber.root.position.x) / 2 + 0.2, 1.1, (tree.position.z + lumber.root.position.z) / 2 + 0.1);
    if (cam.mode === 'orbit'){
      cam.orbitAngle += cam.orbitSpeed * dt; // constant speed, no easing
      // title orbit: tree stays centred in the right part of the screen (menu column on the left), low and close
      yaw = cam.orbitAngle; pitch = THREE.MathUtils.degToRad(phone ? cam.phoneTitlePitch : 17);
      dist = phone ? Math.max(cam.titleDist, 6.2 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect)) : cam.titleDist;
      _focus.set(tree.position.x, phone ? 3.0 : 3.4, tree.position.z);
      sx = w <= 820 ? cam.phoneTitleShift : cam.titleShift; sy = phone ? cam.phoneTitleLift : 0;   // phone: trunk on the right so it clears the top-left logo
    } else {
      // slow, gentle constant sway
      yaw += Math.sin(cam.swayT * 0.35) * 0.02 + Math.sin(cam.swayT * 0.13) * 0.012;
      pitch += Math.sin(cam.swayT * 0.27) * 0.008;
      if (phone){
        // fit the ~7-unit-wide group across the narrow width
        dist = Math.max(cam.dist, 5.4 / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect));
        sx = 0.02; sy = cam.phoneLift;
      } else {
        // keep the group a similar on-screen size on wide/tall desktop windows
        // centre the group in the play area left of the icon column + shop (mirrors ui.css --shop-w / --ib)
        const shopW = U.clamp(w * 0.36, 290, 540), ib = U.clamp(h * 0.064, 50, 64);
        const playW = Math.max(200, w - shopW - ib - 48), f = playW / w;
        const halfW = U.lerp(4.6, 5.8, U.clamp((aspect - 0.75) / 1.03, 0, 1));
        dist = Math.max(cam.dist, halfW / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect * f));
        sx = 0.5 - playW / 2 / w; sy = cam.screenLift - U.clamp(1 - aspect, 0, 0.5) * 0.2; // tall windows: sit lower
      }
    }
    _off.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist);
    cam.target.copy(_focus);
    camera.position.copy(cam.target).add(_off);
    if (cam.shakeT > 0){
      cam.shakeT -= dt;
      const a = cam.shakeAmp * Math.max(0, cam.shakeT / (cam.shakeDur || 0.2));
      camera.position.x += U.rand(-a, a); camera.position.y += U.rand(-a, a); camera.position.z += U.rand(-a, a);
      if (cam.shakeT <= 0) cam.shakeAmp = 0;
    }
    camera.lookAt(cam.target);
    // frame off-centre with a view offset (keeps the perspective, just slides the image)
    camera.setViewOffset(w, h, sx * w, sy * h, w, h);
  }

  /* ---------- resize ---------- */
  function resize(){
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize); resize();

  /* ---------- picking ---------- */
  const raycaster = new THREE.Raycaster();
  const clickables = []; // {obj, fn, priority}
  // addClickable(obj, fn(hit, event), priority=10): higher priority wins. Tree/lumberjack have priority 0.
  function addClickable(obj, fn, priority){ const c = { obj, fn, priority: priority == null ? 10 : priority }; clickables.push(c); clickables.sort((a, b) => b.priority - a.priority); return () => { const i = clickables.indexOf(c); if (i >= 0) clickables.splice(i, 1); }; }
  function pick(clientX, clientY){
    const r = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2((clientX - r.left) / r.width * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    for (const c of clickables){
      if (!c.obj.visible || !c.obj.parent) continue;
      const hits = raycaster.intersectObject(c.obj, true).filter(h => !h.object.userData.isOutline && h.object.visible);
      if (hits.length) return { clickable: c, hit: hits[0] };
    }
    return null;
  }
  addClickable(tree, null, 0); addClickable(lumber.root, null, 0);
  tree.userData.clickTarget = 'tree';
  canvas.addEventListener('pointerdown', e => {
    if (e.button != null && e.button > 0) return;
    const p = pick(e.clientX, e.clientY);
    if (!p) return;
    if (p.clickable.fn) p.clickable.fn(p.hit, e);
    else { S_lastClick = { x: e.clientX, y: e.clientY, t: performance.now() }; bus.emit('treeClick', { x: e.clientX, y: e.clientY, target: p.clickable.obj === tree ? 'tree' : 'lumberjack' }); }
  });
  let S_lastClick = null;

  /* ---------- chop fx ---------- */
  const impact = new THREE.Vector3();
  function impactPoint(){
    const a = notch.rotation.y;
    return impact.set(tree.position.x + Math.sin(a) * (SEG_R + 0.15), NOTCH_Y + 0.1, tree.position.z + Math.cos(a) * (SEG_R + 0.15));
  }
  let localChops = 0;
  // chopFx({amount, frenzy, toHud=true, notchStep}) - pure visuals; driven by the 'chop' event in play mode
  function chopFx(o){
    o = o || {};
    lumber.swing();
    const low = TCS.state && TCS.state.data.settings.graphics === 'low';
    U.tween(0.075, () => {}, { done(){
      U.squash(tree, 0.05, 0.18);
      const p = impactPoint().clone();
      spawnChips(p, low ? 2 : (o.frenzy ? 6 : 4), o.toHud !== false);
      if (o.notch != null) setNotch(o.notch);
      if (o.frenzy) shake(0.1, 0.15);
      if (o.amount != null){
        const recent = S_lastClick && performance.now() - S_lastClick.t < 150;
        chopNumber(o.amount, recent ? { x: S_lastClick.x, y: S_lastClick.y - 30 } : p, !!o.frenzy);
      }
      bus.emit('chopImpact', { point: p });
    } });
  }
  bus.on('chop', e => {
    if (cam.mode !== 'play') return;
    const N = TCS.data.CHOPS_PER_SEGMENT, c = TCS.state.data.stats.chops % N;
    chopFx({ amount: e.amount, frenzy: e.frenzy, notch: c === 0 ? 1 : c / N });
  });
  bus.on('segment', () => { U.tween(0.12, () => {}, { done: dropSegment }); });
  bus.on('load', () => { setSpecies(TCS.state.species()); setNotch((TCS.state.data.stats.chops % TCS.data.CHOPS_PER_SEGMENT) / TCS.data.CHOPS_PER_SEGMENT); });
  bus.on('rebirth', e => setSpecies(e.species));

  /* ---------- update loop hooks ---------- */
  const updaters = [];
  function onUpdate(fn){ updaters.push(fn); return () => { const i = updaters.indexOf(fn); if (i >= 0) updaters.splice(i, 1); }; }
  let orbitChopT = 0;
  function update(dt){
    U.updateTweens(dt);
    lumber.update(dt);
    updateChips(dt);
    updateLogs(dt);
    // decorations only grow further up the trunk
    for (const s of segments){
      const y = s.group.position.y + trunk.position.y;
      const k = U.clamp((y - 4.5) / 2.5, 0, 1);
      if (s.deco) { s.deco.scale.setScalar(Math.max(0.001, k)); s.deco.visible = k > 0.01; }
    }
    if (cam.mode === 'orbit'){
      orbitChopT += dt;
      if (orbitChopT > 0.75){
        orbitChopT = 0; localChops++;
        const N = TCS.data.CHOPS_PER_SEGMENT, c = localChops % N;
        chopFx({ toHud: false, notch: c === 0 ? 1 : c / N });
        if (c === 0) U.tween(0.12, () => {}, { done: dropSegment });
      }
    }
    for (const fn of updaters){ try { fn(dt); } catch(e){ console.error('scene updater', e); } }
    updateCamera(dt);
  }
  function render(){ renderer.render(scene, camera); }

  // init species visuals
  setSpecies(species);

  TCS.scene = {
    THREE, renderer, scene, camera, world,
    lights: { hemi, sun },
    addToWorld(obj){ world.add(obj); return obj; },
    removeFromWorld(obj){ world.remove(obj); U.forgetOutlines(obj); },
    onUpdate, update, render, resize,
    onChop(fn){ return bus.on('chop', fn); },
    tree: {
      group: tree, trunk, segments, SEG_H, SEG_R,
      get base(){ return new THREE.Vector3(tree.position.x, 0, tree.position.z); },
      radius: SEG_R, setSpecies, dropSegment, setNotch, impactPoint: () => impactPoint().clone(),
      get species(){ return species; }
    },
    lumberjack: lumber,
    spawnChips: (pos, n, toHud) => spawnChips(pos, n, toHud),
    floatText, worldToScreen, shake, chopFx,
    setMode, get mode(){ return cam.mode; }, cam,
    addClickable, pick
  };
})();
