/* duel3d.js — the two 3D duel vignettes (js/friends.js drives it). Each side = that player's lumberjack (their equipped
   cosmetics) chopping a trunk of their stage on a small copy of the stage's ground + accent props (TCS.world.vignette).
   Rendering: the ONE main renderer draws both THREE.Scenes into the screen rects of two HTML slots (setViewport + scissor)
   via TCS.scene.setRenderOverride, so the world render is paused for the duel and no extra WebGL context is made.
   API (TCS.duel3d): start({me:{el, stage, cos}, op:{el, stage, cos}}), chop(side, n=1), fall(side), stop(), active
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
    return { el: o.el, stage, cos, scene, vg, trunk, pivot, lj, cam, spin, queue: 0, qT: 0, fallen: false, shakeT: 0 };
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
      s.spin.forEach(x => { x.rotation.y += x.userData.fxSpin * dt; });
      // queued remote chops (progress arrives in batches every ~250 ms): play them spread out
      if (s.queue > 0){ s.qT -= dt; if (s.qT <= 0){ s.queue--; hit(s); s.qT = Math.max(0.06, 0.25 / Math.max(1, s.queue + 1)); } }
      if (s.shakeT > 0){ s.shakeT -= dt; s.trunk.group.rotation.z = Math.sin(s.shakeT * 90) * 0.012 * (s.shakeT / 0.16); }
    }
  }
  // draw both vignettes into their slot rects with the main renderer
  function draw(r){
    const cv = r.domElement, W = cv.clientWidth, H = cv.clientHeight;
    r.setScissorTest(false); r.setViewport(0, 0, W, H); r.setClearColor(0x0e160a, 1); r.clear();
    for (const k of ['me', 'op']){
      const s = sides && sides[k]; if (!s || !s.el || !s.el.isConnected) continue;
      const b = s.el.getBoundingClientRect(), cb = cv.getBoundingClientRect();
      const x = b.left - cb.left, y = H - (b.bottom - cb.top), w = b.width, h = b.height;
      if (w < 4 || h < 4) continue;
      const aspect = w / h, c = s.cam, t = Math.tan(THREE.MathUtils.degToRad(c.fov / 2));
      c.aspect = aspect; c.updateProjectionMatrix();
      const dist = Math.max(5.6 / (t * aspect), 4.1 / t);
      const yaw = THREE.MathUtils.degToRad(-6), pitch = THREE.MathUtils.degToRad(30);
      const fx = -0.9, fy = 1.9, fz = 0.2;
      c.position.set(fx + Math.sin(yaw) * Math.cos(pitch) * dist, fy + Math.sin(pitch) * dist, fz + Math.cos(yaw) * Math.cos(pitch) * dist);
      c.lookAt(fx, fy, fz);
      r.setViewport(x, y, w, h); r.setScissor(x, y, w, h); r.setScissorTest(true);
      r.render(s.scene, c);
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
  D3.stop = function(){
    SC.setRenderOverride(null);
    if (unUpd){ unUpd(); unUpd = null; }
    if (sides) ['me', 'op'].forEach(k => {
      const s = sides[k]; if (!s) return;
      try { U.disposeTree(s.scene); } catch(e){ console.warn(e); }
      s.scene.clear();
    });
    sides = null; D3.active = false;
  };
  Object.defineProperty(D3, 'sides', { get(){ return sides; } });
})();
