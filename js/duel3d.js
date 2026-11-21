/* duel3d.js — the two 3D duel vignettes (js/friends.js drives it). Each side = that player's lumberjack (their equipped
   cosmetics) chopping a trunk of their stage on a small copy of the stage's ground + accent props (TCS.world.vignette).
   Rendering: the ONE main renderer draws both THREE.Scenes into the screen rects of two HTML slots (setViewport + scissor)
   via TCS.scene.setRenderOverride, so the world render is paused for the duel and no extra WebGL context is made.
   API (TCS.duel3d): start({me:{el, stage, cos}, op:{el, stage, cos}}), chop(side, n=1), fall(side), outro(winnerSide), stop(), active
     outro: the winner's camera pushes in, his lumberjack turns to the camera, raises the axe, hops + spins, confetti in his
     stage colours; the loser's view darkens and his lumberjack slumps (head + arms down).
     side = 'me' | 'op'; cos = 'hat|face|boots' (ids, empty = none). stop() disposes every geometry/material/texture made here. */
(function(){
  const THREE = window.THREE, TCS = window.TCS, U = TCS.util, SC = TCS.scene;
  const D3 = TCS.duel3d = { active: false };
  let sides = null, unUpd = null;
  const LJ_POS = new THREE.Vector3(-3.0, 0, 0.35), NOTCH_Y = Math.atan2(-3.0, 0.35) + SC.NOTCH_TURN;   // notch angle, turned toward the camera like the main view
  const tmp = new THREE.Vector3();

  function parseCos(cos){
    const p = String(cos || '').split('|'), byId = TCS.data.cosmeticById || {}, out = {};
    ['hat', 'face', 'boots'].forEach((slot, k) => { const id = p[k]; if (id && byId[id] && byId[id].slot === slot) out[slot] = id; });
    return out;
  }
  function build(o){
    const stage = ((o.stage | 0) % 8 + 8) % 8;
    const scene = new THREE.Scene();
    const vg = TCS.world.vignette(stage);
    scene.add(vg.root);
    scene.background = new THREE.Color(vg.sky);
    scene.fog = new THREE.Fog(vg.sky, 22, 46);
    const trunk = SC.makeTrunk(TCS.data.SPECIES[stage], 4);
    const pivot = new THREE.Group(); pivot.add(trunk.group); scene.add(pivot);   // tip-over pivot at the base
    const lj = SC.makeLumberjack();
    lj.root.position.copy(LJ_POS); lj.root.scale.setScalar(1.35); scene.add(lj.root);
    SC.aimLumberAt(lj, pivot.position, NOTCH_Y);
    const cos = parseCos(o.cos), spin = [];
    ['hat', 'face', 'boots'].forEach(slot => {
      if (!cos[slot] || !TCS.fx || !TCS.fx.makeCosmetic) return;
      try { const m = TCS.fx.makeCosmetic(cos[slot]); if (m) lj.attach(slot, m, { pop: false }); } catch(e){ console.warn('duel cosmetic', e); }
    });
    lj.root.traverse(x => { if (x.userData.fxSpin) spin.push(x); });
    const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 80);
    return { el: o.el, stage, cos, scene, vg, trunk, pivot, lj, cam, spin, queue: 0, qT: 0, fallen: false, shakeT: 0, role: null, oT: 0, zoom: 0, dim: 0, conf: null };
  }

  function hit(s){
    s.lj.swing();
    U.tween(0.075, () => {}, { done(){
      if (!sides) return;
      U.squash(s.trunk.group, 0.05, 0.18); s.shakeT = 0.16;
      const low = TCS.state && TCS.state.data.settings.graphics === 'low';
      SC.spawnChips(s.trunk.impact(tmp, NOTCH_Y).clone(), low ? 2 : 4, false, { parent: s.scene, center: s.pivot.position, mats: s.trunk.mats });
    } });
  }
  function update(dt){
    if (!sides) return;
    for (const k of ['me', 'op']){
      const s = sides[k];
      s.lj.update(dt);
      if (s.role) outroPose(s, dt);
      s.spin.forEach(x => { x.rotation.y += x.userData.fxSpin * dt; });
      // queued remote chops (progress arrives in batches every ~250 ms): play them spread out
      if (s.queue > 0){ s.qT -= dt; if (s.qT <= 0){ s.queue--; hit(s); s.qT = Math.max(0.06, 0.25 / Math.max(1, s.queue + 1)); } }
      if (s.shakeT > 0){ s.shakeT -= dt; s.trunk.group.rotation.z = Math.sin(s.shakeT * 90) * 0.012 * (s.shakeT / 0.16); }
    }
  }
  // ---------- outro ----------
  const smooth = (a, b, x) => { const k = U.clamp((x - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
  function outroPose(s, dt){
    s.oT += dt; const t = s.oT, lj = s.lj;
    if (s.role === 'win'){
      s.zoom = smooth(0, 0.9, t);
      // turn to face the camera (+z), hop + full spin at ~0.5 s, then a second small hop
      const face = U.lerp(s.yaw0, 0, smooth(0, 0.35, t));
      const spinK = smooth(0.45, 1.05, t);
      lj.root.rotation.y = face + spinK * Math.PI * 2;
      const hop = (a, d, hgt) => (t > a && t < a + d) ? Math.sin((t - a) / d * Math.PI) * hgt : 0;
      lj.root.position.y = hop(0.45, 0.6, 0.9) + hop(1.25, 0.4, 0.35) + hop(1.85, 0.4, 0.35);
      // axe overhead, pumping
      const up = smooth(0.1, 0.4, t);
      lj.armPivot.rotation.y = U.lerp(lj.armPivot.rotation.y, 0, up);
      lj.armPivot.rotation.x = U.lerp(lj.armPivot.rotation.x, -1.55 + Math.sin(t * 9) * 0.12 * smooth(1.1, 1.3, t), up);
      lj.slots.head.rotation.x = -0.18 * up;
    } else {
      s.dim = smooth(0, 0.6, t);
      const k = smooth(0.1, 0.8, t);
      lj.slots.head.rotation.x = 0.5 * k;
      lj.armPivot.rotation.x = U.lerp(lj.armPivot.rotation.x, 0.55, k);
      lj.root.position.y = -0.04 * k;
    }
    if (s.conf) stepConfetti(s, dt);
  }
  // confetti / leaf / chip bits in the winner's stage colours (one plane geometry + a few private materials)
  function confetti(s, n){
    const sp = TCS.data.SPECIES[s.stage];
    const g = s.conf ? s.conf.geo : new THREE.PlaneGeometry(0.22, 0.14);
    const mats = s.conf ? s.conf.mats : [sp.leaf, sp.leaf2, 0xffe25a, sp.bark, 0xff7a5a, 0xffffff].map(c => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
    const c = s.conf || (s.conf = { geo: g, mats, bits: [], root: new THREE.Group() });
    if (!c.root.parent) s.scene.add(c.root);
    const o = s.lj.root.position;
    for (let i = 0; i < n; i++){
      const m = new THREE.Mesh(g, mats[i % mats.length]);
      m.position.set(o.x + U.rand(-0.4, 0.4), 2.6, o.z + U.rand(-0.4, 0.4));
      const a = U.rand(0, Math.PI * 2), r = U.rand(1.5, 4.2);
      m.userData.v = new THREE.Vector3(Math.cos(a) * r, U.rand(5, 9), Math.sin(a) * r * 0.6);
      m.userData.w = new THREE.Vector3(U.rand(-9, 9), U.rand(-9, 9), U.rand(-9, 9));
      m.userData.life = U.rand(2.2, 3.2);
      c.root.add(m); c.bits.push(m);
    }
  }
  function stepConfetti(s, dt){
    const c = s.conf;
    c.bits = c.bits.filter(m => {
      const v = m.userData.v; m.userData.life -= dt;
      v.y -= 9.5 * dt; v.multiplyScalar(Math.pow(0.35, dt)); if (v.y < -2.2) v.y = -2.2;
      m.position.addScaledVector(v, dt);
      m.rotation.x += m.userData.w.x * dt; m.rotation.y += m.userData.w.y * dt; m.rotation.z += m.userData.w.z * dt;
      if (m.position.y < 0.05 || m.userData.life <= 0){ c.root.remove(m); return false; }
      return true;
    });
  }
  // dark veil for the loser's view (drawn over his viewport)
  let veil = null;
  function getVeil(){
    if (veil) return veil;
    const sc = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0x0e160a, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); sc.add(mesh);
    return (veil = { sc, cam, mat, mesh });
  }

  // draw both vignettes into their slot rects with the main renderer
  function draw(r){
    const cv = r.domElement, W = cv.clientWidth, H = cv.clientHeight;
    r.setScissorTest(false); r.setViewport(0, 0, W, H); r.setClearColor(0x0e160a, 1); r.clear();
    const order = sides && sides.op.role === 'win' ? ['me', 'op'] : sides && sides.me.role === 'win' ? ['op', 'me'] : ['me', 'op'];
    for (const k of order){
      const s = sides && sides[k]; if (!s || !s.el || !s.el.isConnected) continue;
      const b = s.el.getBoundingClientRect(), cb = cv.getBoundingClientRect();
      const x = b.left - cb.left, y = H - (b.bottom - cb.top), w = b.width, h = b.height;
      if (w < 4 || h < 4) continue;
      const aspect = w / h, c = s.cam, t = Math.tan(THREE.MathUtils.degToRad(c.fov / 2));
      c.aspect = aspect; c.updateProjectionMatrix();
      const z = s.zoom;
      const dist = Math.max(5.6 / (t * aspect), 4.1 / t) * U.lerp(1, 0.6, z);
      const yaw = THREE.MathUtils.degToRad(U.lerp(-6, 4, z)), pitch = THREE.MathUtils.degToRad(U.lerp(30, 18, z));
      const fx = U.lerp(-0.9, -2.6, z), fy = U.lerp(1.9, 2.0, z), fz = U.lerp(0.2, 0.4, z);
      c.position.set(fx + Math.sin(yaw) * Math.cos(pitch) * dist, fy + Math.sin(pitch) * dist, fz + Math.cos(yaw) * Math.cos(pitch) * dist);
      c.lookAt(fx, fy, fz);
      r.setViewport(x, y, w, h); r.setScissor(x, y, w, h); r.setScissorTest(true);
      r.render(s.scene, c);
      if (s.dim > 0){ const v = getVeil(); v.mat.opacity = 0.5 * s.dim; const ac = r.autoClear; r.autoClear = false; r.render(v.sc, v.cam); r.autoClear = ac; }
    }
    r.setScissorTest(false); r.setViewport(0, 0, W, H);
    try { r.setClearColor(TCS.scene.scene.background || 0x9fe3ff); } catch(e){}
  }

  D3.start = function(o){
    D3.stop();
    try { sides = { me: build(o.me), op: build(o.op) }; }
    catch(e){ console.error('duel3d', e); D3.stop(); return false; }
    unUpd = SC.onUpdate(update);
    SC.setRenderOverride(draw);
    D3.active = true;
    return true;
  };
  D3.chop = function(side, n){
    const s = sides && sides[side]; if (!s || s.fallen) return;
    n = n == null ? 1 : n | 0; if (n <= 0) return;
    if (side === 'me' && n === 1) hit(s); else s.queue = Math.min(12, s.queue + n);
  };
  // the trunk tips over away from the lumberjack (+x), with a small bounce, and a dust of chips
  D3.fall = function(side){
    const s = sides && sides[side]; if (!s || s.fallen) return;
    s.fallen = true; s.queue = 0;
    hit(s);
    U.tween(1.0, k => { s.pivot.rotation.z = -k * 1.45; }, { ease: 'inQuad', delay: 0.15, done(){
      if (!sides) return;
      U.tween(0.35, k => { s.pivot.rotation.z = -1.45 + Math.sin(k * Math.PI) * 0.12; }, { ease: 'outQuad' });
      SC.spawnChips(new THREE.Vector3(3.5, 0.5, 0), 6, false, { parent: s.scene, center: new THREE.Vector3(3.5, 0, -2), mats: s.trunk.mats });
    } });
  };
  // winner known: focus + victory pose + confetti on the winner, slump + darken on the loser. opts.light = fewer particles
  D3.outro = function(winner, opts){
    if (!sides || !sides[winner]) return;
    const loser = winner === 'me' ? 'op' : 'me', w = sides[winner], l = sides[loser];
    if (w.role) return;
    w.role = 'win'; l.role = 'lose'; w.oT = l.oT = 0; w.queue = l.queue = 0;
    w.yaw0 = w.lj.root.rotation.y;
    const low = (opts && opts.light) || (TCS.state && TCS.state.data.settings.graphics === 'low');
    const n = low ? 14 : 34;
    confetti(w, n);
    U.tween(0.5, () => {}, { done(){ if (sides && sides[winner] === w) confetti(w, Math.round(n * 0.6)); } });
  };
  D3.stop = function(){
    SC.setRenderOverride(null);
    if (unUpd){ unUpd(); unUpd = null; }
    if (sides) ['me', 'op'].forEach(k => {
      const s = sides[k]; if (!s) return;
      try { U.disposeTree(s.scene); } catch(e){ console.warn(e); }
      if (s.conf){ s.conf.geo.dispose(); s.conf.mats.forEach(m => m.dispose()); s.conf = null; }
      s.scene.clear();
    });
    if (veil){ veil.mesh.geometry.dispose(); veil.mat.dispose(); veil = null; }
    sides = null; D3.active = false;
  };
  Object.defineProperty(D3, 'sides', { get(){ return sides; } });
})();
