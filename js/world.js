/* world.js â€” per-stage environments. Every rebirth (state.data.speciesIndex, cycles after 8) moves the player to a new place:
   ground checker colours, sky/fog, light tint, decor props (merged per material, popped in per prop by a vertex-shader
   scale-bounce), ambient particles, and on the title screen a few idle workers and animals.
   API: TCS.world.setStage(i, {fade=true, banner=false}), TCS.world.stage, TCS.world.STAGES (local defs), TCS.world.drawCalls()
   Decor keeps clear of the tree, the lumberjack and every upgrades3d zone (see ZONES). */
(function(){
  const THREE = window.THREE;
  const TCS = window.TCS;
  const U = TCS.util, M = TCS.model, bus = TCS.bus, SC = TCS.scene;
  const PI = Math.PI;

  const NAMES = ['Oak Meadow', 'Birch Lake', 'Pine Mountains', 'Redwood Valley', 'Cherry Blossom Garden', 'Ice Spruce Tundra', 'Crystal Caverns', 'Golden Temple'];
  const stageName = i => { try { const s = TCS.data.STAGES && TCS.data.STAGES[i]; if (s && s.name) return s.name; } catch(e){} return NAMES[i]; };
  const low = () => { try { return !!TCS.lowParticles || TCS.state.data.settings.graphics === 'low'; } catch(e){ return false; } };

  /* ---------- keep-out zones (upgrades3d layout + tree + lumberjack) ---------- */
  const ZONES = [[0, 0, 3.6], [-3, 0.35, 2.2], [-4.5, -1.3, 1.5], [-6, 2.5, 2.4], [0.7, 4.4, 3.0], [-6.8, -4.6, 2.4], [2.35, 1.1, 1.6],
    [3.2, 2.8, 1.3], [-5.3, 0.6, 1.3], [-4.7, 3.3, 1.3], [4.2, 2.0, 1.3], [-6.2, -1.2, 1.3], [-2.5, 4.6, 2.2], [4.2, -2.8, 1.9], [4.6, -4.1, 1.9], [5.0, -5.4, 1.9],
    [3.8, 0, 1.8], [-4.4, -2.9, 1.7], [-1.6, 2.2, 1.5], [2.95, -2.1, 1.5], [-0.8, -14, 6], [2.7, -4, 1.8], [3.4, -9.4, 3], [-20, -8.6, 3]];
  [270, 288, 252, 276, 282, 296, 262].forEach((d, k) => { const r = [5.4, 5.6, 5.6, 8.6, 7.2, 7.6, 7.2][k], a = d * PI / 180; ZONES.push([Math.cos(a) * r, Math.sin(a) * r, 1.4]); });
  function clear(x, z, r){
    for (const q of ZONES){ const dx = x - q[0], dz = z - q[1], rr = q[2] + r; if (dx * dx + dz * dz < rr * rr) return false; }
    if (z > -11.5 - r && z < -5.8 + r && x < 7 + r) return false;   // truck road + log flume band
    if (Math.hypot(x, z) < 4.2 + r) return false;                    // never crowd the tree
    return true;
  }

  /* ---------- seeded random ---------- */
  let seed = 1;
  const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const R = (a, b) => a + rnd() * (b - a);
  const pickOf = arr => arr[(rnd() * arr.length) | 0];

  /* ---------- geometry ---------- */
  const extra = new Map();
  function geo(type, size){
    if (type === 'oct'){ const k = 'oct' + size[0]; if (!extra.has(k)) extra.set(k, new THREE.OctahedronGeometry(size[0], 0)); return extra.get(k); }
    if (type === 'disc'){ const k = 'disc' + size.join(); if (!extra.has(k)) extra.set(k, new THREE.CylinderGeometry(size[0], size[0], 0.04, size[1] || 40)); return extra.get(k); }
    return M.geo(type, size);
  }

  /* ---------- prop builder: collects parts, merges them per material with a per-prop pop-in attribute ---------- */
  const _m = new THREE.Matrix4(), _l = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
  function Builder(){
    const parts = []; let prop = null;
    return {
      parts,
      // prop(x, z, rotY, scale, delay): subsequent part() calls are in this prop's local space
      prop(x, z, ry, s, delay, y){ prop = { m: new THREE.Matrix4().compose(_p.set(x, y || 0, z), _q.setFromEuler(_e.set(0, ry || 0, 0)), _s.set(s || 1, s || 1, s || 1)), o: [x, y || 0, z], d: delay || 0 }; return this; },
      part(type, size, color, o){
        o = o || {};
        const sc = o.scale == null ? [1, 1, 1] : typeof o.scale === 'number' ? [o.scale, o.scale, o.scale] : o.scale;
        _l.compose(_p.set(...(o.pos || [0, 0, 0])), _q.setFromEuler(_e.set(...(o.rot || [0, 0, 0]))), _s.set(sc[0], sc[1], sc[2]));
        parts.push({ g: geo(type, size), mat: new THREE.Matrix4().multiplyMatrices(prop.m, _l), key: color + '|' + (o.emissive || 0) + '|' + (o.ei || 0),
          color, emissive: o.emissive, ei: o.ei, outline: o.outline === false ? 0 : (o.outline || 0.06), o: prop.o, d: prop.d });
        return this;
      }
    };
  }
  const POP_GLSL = `#include <begin_vertex>
    float pk = clamp((uPopT - aPop.w) / 0.55, 0.0, 1.0);
    float pq = pk - 1.0; float pe = max(1.0 + 3.2 * pq * pq * pq + 2.2 * pq * pq, 0.0001);
    pe = max(pe * smoothstep(7.0, 11.0, distance(aPop.xz, cameraPosition.xz)), 0.0001); // props right beside the camera shrink away (title orbit)
    transformed = aPop.xyz + (transformed - aPop.xyz) * pe;`;
  function popPatch(mat, uni){
    mat.onBeforeCompile = sh => {
      sh.uniforms.uPopT = uni;
      sh.vertexShader = 'attribute vec4 aPop;\nuniform float uPopT;\n' + sh.vertexShader.replace('#include <begin_vertex>', POP_GLSL);
    };
    mat.customProgramCacheKey = () => 'tcsPop';
    return mat;
  }
  function mergeList(list, hull){
    let nv = 0, ni = 0;
    for (const p of list){ nv += p.g.attributes.position.count; ni += p.g.index ? p.g.index.count : p.g.attributes.position.count; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), pop = new Float32Array(nv * 4);
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let vo = 0, io = 0; const v = new THREE.Vector3(), nm = new THREE.Matrix3(), hm = new THREE.Matrix4();
    for (const p of list){
      const ga = p.g.attributes.position, na = p.g.attributes.normal;
      const mat = hull ? hm.multiplyMatrices(p.mat, _l.makeScale(1 + p.outline, 1 + p.outline, 1 + p.outline)) : p.mat;
      nm.getNormalMatrix(mat);
      for (let i = 0; i < ga.count; i++){
        v.fromBufferAttribute(ga, i).applyMatrix4(mat); pos.set([v.x, v.y, v.z], (vo + i) * 3);
        v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize(); nor.set([v.x, v.y, v.z], (vo + i) * 3);
        pop.set([p.o[0], p.o[1], p.o[2], p.d], (vo + i) * 4);
      }
      if (p.g.index){ const a = p.g.index.array; for (let i = 0; i < a.length; i++) idx[io++] = a[i] + vo; }
      else for (let i = 0; i < ga.count; i++) idx[io++] = vo + i;
      vo += ga.count;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('aPop', new THREE.BufferAttribute(pop, 4));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    return g;
  }
  function bake(b, uni){
    const root = new THREE.Group(); root.name = 'worldDecor';
    const byKey = new Map();
    for (const p of b.parts){ if (!byKey.has(p.key)) byKey.set(p.key, []); byKey.get(p.key).push(p); }
    for (const list of byKey.values()){
      const f = list[0];
      const mat = popPatch(U.toon(f.color, { emissive: f.emissive, emissiveIntensity: f.ei, nocache: true }), uni);
      const mesh = new THREE.Mesh(mergeList(list), mat); mesh.raycast = () => {}; mesh.matrixAutoUpdate = false; root.add(mesh);
    }
    const ol = b.parts.filter(p => p.outline > 0);
    if (ol.length){
      const om = popPatch(new THREE.MeshBasicMaterial({ color: 0x1b1b1b, side: THREE.BackSide }), uni);
      const h = new THREE.Mesh(mergeList(ol, true), om); h.userData.isOutline = true; h.raycast = () => {}; h.matrixAutoUpdate = false; root.add(h);
    }
    return root;
  }

  /* ---------- prop library (local space, base at y=0) ---------- */
  const C = { bark: 0x8a5a33, barkDk: 0x6b4226, rock: 0x9aa3a8, rockDk: 0x7c868c, wood: 0x9a5b2c, woodLt: 0xd9a066, white: 0xf7f7f7, dark: 0x3a3f47 };
  const P = {
    oak(b, lf){ lf = lf || [0x4fb83a, 0x3e9a2c, 0x5fc94a];
      b.part('cyl', [0.32, 0.46, 2.4, 8], C.bark, { pos: [0, 1.2, 0] });
      b.part('ico', [1.5, 1], lf[0], { pos: [0, 3.2, 0] }).part('ico', [1.1, 1], lf[1], { pos: [0.9, 2.7, 0.3] }).part('ico', [1.0, 1], lf[2], { pos: [-0.8, 2.9, -0.2] }); },
    birch(b){ b.part('cyl', [0.22, 0.28, 3.8, 8], 0xf1ede2, { pos: [0, 1.9, 0] });
      [[0.7, 0], [1.5, 2], [2.4, 4], [3.1, 1]].forEach(([y, a]) => b.part('box', [0.2, 0.08, 0.06], 0x3a3a3a, { pos: [Math.cos(a) * 0.24, y, Math.sin(a) * 0.24], rot: [0, -a, 0], outline: false }));
      b.part('ico', [1.05, 1], 0x9ad94a, { pos: [0, 4.0, 0], scale: [1, 1.25, 1] }).part('ico', [0.75, 1], 0x7cc23a, { pos: [0.5, 3.4, 0.3] }); },
    pine(b, c1, c2, cap){ c1 = c1 || 0x2f8f4e; c2 = c2 || 0x23703c;
      b.part('cyl', [0.25, 0.32, 1.4, 7], 0x7a4b2a, { pos: [0, 0.7, 0] });
      b.part('cone', [1.7, 2.0, 8], c2, { pos: [0, 2.0, 0] }).part('cone', [1.35, 1.8, 8], c1, { pos: [0, 3.1, 0] }).part('cone', [0.95, 1.6, 8], c2, { pos: [0, 4.1, 0] });
      if (cap) b.part('cone', [0.55, 0.8, 8], cap, { pos: [0, 4.65, 0], outline: false }); },
    redwood(b){ b.part('cyl', [0.45, 0.65, 6.5, 9], 0xa8452a, { pos: [0, 3.25, 0] });
      b.part('cone', [1.9, 2.4, 8], 0x2f7d2d, { pos: [0, 5.2, 0] }).part('cone', [1.5, 2.2, 8], 0x3f9b3a, { pos: [0, 6.6, 0] }).part('cone', [1.0, 1.8, 8], 0x2f7d2d, { pos: [0, 7.9, 0] }); },
    giant(b, h){ h = h || 34; b.part('cyl', [1.7, 2.3, h, 12], 0x9a3f26, { pos: [0, h / 2, 0], outline: 0.02 });
      b.part('cyl', [0.5, 0.9, 2.2, 7], 0x7d311d, { pos: [2.1, 0.5, 0.3], rot: [0, 0, 1.0], outline: 0.04 }).part('cyl', [0.5, 0.9, 2.2, 7], 0x7d311d, { pos: [-1.9, 0.5, -0.6], rot: [0.3, 0, -1.0], outline: 0.04 });
      b.part('box', [0.35, 6, 0.2], 0x7d311d, { pos: [0, 8, 2.1], outline: false }).part('box', [0.3, 5, 0.2], 0x7d311d, { pos: [1.3, 14, 1.7], rot: [0, 0.6, 0], outline: false }); },
    cherry(b){ b.part('cyl', [0.28, 0.4, 2.3, 8], 0x5e3a35, { pos: [0, 1.15, 0], rot: [0, 0, 0.08] });
      b.part('cyl', [0.12, 0.18, 1.3, 6], 0x5e3a35, { pos: [0.55, 2.4, 0], rot: [0, 0, -0.7] });
      b.part('ico', [1.4, 1], 0xffb3d1, { pos: [0.1, 3.1, 0] }).part('ico', [1.0, 1], 0xff8fbd, { pos: [1.1, 2.8, 0.3] }).part('ico', [0.95, 1], 0xffc7dd, { pos: [-0.9, 2.8, -0.3] }); },
    crystalTree(b){ b.part('cyl', [0.22, 0.38, 2.6, 6], 0x8a5ee8, { pos: [0, 1.3, 0], emissive: 0x2a1060, ei: 1 });
      [[0, 3.2, 0, 0x7ef0ff, 1.0], [0.8, 2.6, 0.2, 0xff8ff3, 0.7], [-0.7, 2.7, -0.2, 0xb48cff, 0.75]].forEach(([x, y, z, c, r]) => b.part('oct', [r], c, { pos: [x, y, z], scale: [1, 1.4, 1], emissive: c, ei: 0.45 })); },
    goldTree(b){ b.part('cyl', [0.3, 0.42, 2.4, 8], 0xd99a14, { pos: [0, 1.2, 0], emissive: 0x332200, ei: 1 });
      b.part('ico', [1.4, 1], 0xfff07a, { pos: [0, 3.1, 0], emissive: 0x554400, ei: 1 }).part('ico', [1.0, 1], 0xffd84a, { pos: [0.9, 2.7, 0.3], emissive: 0x443300, ei: 1 }); },
    bush(b, c){ c = c || 0x46a837; b.part('ico', [0.7, 1], c, { pos: [0, 0.45, 0], scale: [1.2, 0.8, 1] }).part('ico', [0.5, 1], c, { pos: [0.65, 0.35, 0.1], scale: [1, 0.8, 1] }); },
    rock(b, c){ c = c || C.rock; b.part('dodeca', [0.7, 0], c, { pos: [0, 0.35, 0], scale: [1.3, 0.8, 1] }).part('dodeca', [0.38, 0], c, { pos: [0.75, 0.2, 0.25], rot: [0.5, 0.3, 0] }); },
    boulder(b, c){ b.part('dodeca', [1.6, 0], c || C.rockDk, { pos: [0, 0.9, 0], scale: [1.2, 0.85, 1], rot: [0.2, 0.5, 0.1] }); },
    flowers(b, cols){ cols = cols || [0xff5a5a, 0xffd23f, 0xffffff, 0xb07cff];
      for (let i = 0; i < 5; i++){ const x = R(-0.8, 0.8), z = R(-0.8, 0.8), c = pickOf(cols);
        b.part('cyl', [0.03, 0.03, 0.4, 4], 0x3e9a2c, { pos: [x, 0.2, z], outline: false }).part('sphere', [0.13, 7, 5], c, { pos: [x, 0.42, z], outline: 0.12 }); } },
    fence(b, n){ n = n || 4;
      for (let i = 0; i <= n; i++) b.part('box', [0.18, 1.0, 0.18, 0.03], C.wood, { pos: [i * 1.2, 0.5, 0] });
      [0.35, 0.75].forEach(y => b.part('box', [n * 1.2 + 0.2, 0.14, 0.08], C.woodLt, { pos: [n * 0.6, y, 0.08] })); },
    cabin(b, roof){ roof = roof || 0xc0392b;
      b.part('box', [3.2, 2.0, 2.6, 0.08], 0xa0663a, { pos: [0, 1.0, 0] });
      for (let i = 0; i < 4; i++) b.part('cyl', [0.12, 0.12, 2.7, 6], 0x7d4a26, { pos: [0, 0.3 + i * 0.5, 1.33], rot: [0, 0, PI / 2], outline: false });
      b.part('box', [3.7, 0.18, 1.85], roof, { pos: [0, 2.4, 0.66], rot: [0.62, 0, 0] }).part('box', [3.7, 0.18, 1.85], roof, { pos: [0, 2.4, -0.66], rot: [-0.62, 0, 0] });
      b.part('box', [0.7, 1.2, 0.1], 0x5a3418, { pos: [0.6, 0.6, 1.33] }).part('box', [0.6, 0.55, 0.1], 0xffe082, { pos: [-0.8, 1.15, 1.33], emissive: 0xffb300, ei: 0.35 });
      b.part('box', [0.45, 1.3, 0.45], 0x8c939b, { pos: [-1.0, 2.6, -0.4] }); },
    pond(b, r, water, rim){ b.part('disc', [r + 0.7, 40], rim || 0xe8d6a0, { pos: [0, 0.03, 0], outline: false }).part('disc', [r, 40], water || 0x4fb6ef, { pos: [0, 0.05, 0], outline: false })
      .part('disc', [r * 0.6, 32], 0x7fd0ff, { pos: [0.2 * r, 0.065, -0.15 * r], scale: [1, 1, 0.5], outline: false }); },
    patch(b, c){ b.part('disc', [R(0.9, 1.8), 18], c, { pos: [0, 0.02, 0], scale: [1, 1, R(0.6, 1)], outline: false }); },
    tuft(b, c){ for (let i = 0; i < 3; i++) b.part('cone', [0.09, R(0.35, 0.55), 4], c, { pos: [R(-0.25, 0.25), 0.2, R(-0.25, 0.25)], rot: [R(-.3, .3), 0, R(-.3, .3)], outline: false }); },
    lily(b){ b.part('cyl', [0.42, 0.42, 0.05, 10], 0x5cbf4a, { pos: [0, 0.07, 0], outline: 0.08 }).part('sphere', [0.12, 6, 5], 0xffb3d1, { pos: [0.1, 0.15, 0], outline: false }); },
    reeds(b){ for (let i = 0; i < 5; i++){ const x = R(-0.4, 0.4), z = R(-0.4, 0.4), h = R(0.9, 1.5);
      b.part('cyl', [0.035, 0.045, h, 4], 0x6aa84f, { pos: [x, h / 2, z], rot: [R(-.15, .15), 0, R(-.15, .15)], outline: false }).part('capsule', [0.07, 0.25], 0x7b4a26, { pos: [x, h, z], outline: false }); } },
    dock(b){ b.part('box', [1.4, 0.14, 3.6, 0.03], C.woodLt, { pos: [0, 0.35, 0] });
      [[-0.6, -1.6], [0.6, -1.6], [-0.6, 1.6], [0.6, 1.6]].forEach(([x, z]) => b.part('cyl', [0.1, 0.1, 0.8, 6], C.wood, { pos: [x, 0.2, z] })); },
    mountain(b, h, c, cap){ b.part('cone', [h * 0.9, h, 7], c, { pos: [0, h / 2, 0], outline: 0.012 });
      if (cap) b.part('cone', [h * 0.32, h * 0.36, 7], cap, { pos: [0, h * 0.82, 0], scale: 1.02, outline: false }); },
    fern(b){ for (let i = 0; i < 5; i++){ const a = i / 5 * PI * 2; b.part('cone', [0.22, 1.2, 4], 0x3a9a35, { pos: [Math.cos(a) * 0.35, 0.4, Math.sin(a) * 0.35], rot: [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9], outline: 0.08 }); } },
    mushroom(b, cap, glow){ b.part('cyl', [0.12, 0.16, 0.5, 6], 0xf3e6cf, { pos: [0, 0.25, 0] }).part('sphere', [0.36, 10, 6], cap, { pos: [0, 0.5, 0], scale: [1, 0.6, 1], emissive: glow ? cap : null, ei: glow ? 0.5 : 0 });
      if (!glow) [[0.15, 0.68, 0.12], [-0.18, 0.62, -0.1], [0.05, 0.66, -0.2]].forEach(p => b.part('sphere', [0.06, 5, 4], 0xffffff, { pos: p, outline: false })); },
    log(b){ b.part('cyl', [0.4, 0.4, 3.0, 10], 0x8a4a2b, { pos: [0, 0.4, 0], rot: [0, 0, PI / 2] }).part('cyl', [0.3, 0.3, 0.04, 10], 0xe7a77a, { pos: [1.51, 0.4, 0], rot: [0, 0, PI / 2], outline: false }); },
    lantern(b){ b.part('box', [0.6, 0.2, 0.6, 0.04], 0x9aa3a8, { pos: [0, 0.1, 0] }).part('cyl', [0.12, 0.16, 0.8, 6], 0x9aa3a8, { pos: [0, 0.6, 0] })
      .part('box', [0.5, 0.42, 0.5, 0.04], 0xfff3c4, { pos: [0, 1.2, 0], emissive: 0xffc46b, ei: 0.5 }).part('cone', [0.55, 0.4, 4], 0x7c868c, { pos: [0, 1.6, 0], rot: [0, PI / 4, 0] }); },
    torii(b){ [-1.6, 1.6].forEach(x => b.part('cyl', [0.22, 0.26, 4.0, 10], 0xe0402e, { pos: [x, 2.0, 0] }));
      b.part('box', [4.8, 0.35, 0.5, 0.06], 0x3a2626, { pos: [0, 4.15, 0] }).part('box', [4.0, 0.28, 0.38], 0xe0402e, { pos: [0, 3.4, 0] }); },
    snowman(b){ b.part('sphere', [0.7, 12, 9], 0xffffff, { pos: [0, 0.6, 0] }).part('sphere', [0.5, 12, 9], 0xffffff, { pos: [0, 1.55, 0] }).part('sphere', [0.36, 12, 9], 0xffffff, { pos: [0, 2.3, 0] })
      .part('cone', [0.07, 0.4, 6], 0xff8a1c, { pos: [0, 2.3, 0.45], rot: [PI / 2, 0, 0], outline: false })
      .part('torus', [0.33, 0.08], 0xe53935, { pos: [0, 2.02, 0], rot: [PI / 2, 0, 0], outline: false })
      .part('sphere', [0.05, 5, 4], 0x1b1b1b, { pos: [-0.12, 2.4, 0.31], outline: false }).part('sphere', [0.05, 5, 4], 0x1b1b1b, { pos: [0.12, 2.4, 0.31], outline: false }); },
    igloo(b){ b.part('sphere', [1.6, 16, 8], 0xf4fbff, { pos: [0, 0, 0], scale: [1, 0.85, 1] }).part('cyl', [0.6, 0.6, 1.0, 12], 0xe6f4fc, { pos: [0, 0.45, 1.45], rot: [PI / 2, 0, 0] })
      .part('box', [0.7, 0.75, 0.1], 0x5a7f99, { pos: [0, 0.4, 1.96], outline: false }); },
    iceBlock(b){ b.part('box', [1.1, 1.1, 1.1, 0.08], 0xbfeaff, { pos: [0, 0.55, 0], rot: [0, 0.4, 0], emissive: 0x3aa0d8, ei: 0.15 }).part('box', [0.7, 0.7, 0.7, 0.06], 0xd9f4ff, { pos: [0.9, 0.35, 0.3], rot: [0, 1.1, 0] }); },
    crystals(b, cols){ cols = cols || [0x7ef0ff, 0xff8ff3, 0xb48cff];
      for (let i = 0; i < 4; i++){ const c = pickOf(cols), h = R(0.8, 1.9);
        b.part('oct', [0.45], c, { pos: [R(-0.6, 0.6), h * 0.45, R(-0.6, 0.6)], scale: [0.7, h, 0.7], rot: [R(-.35, .35), R(0, 3), R(-.35, .35)], emissive: c, ei: 0.55, outline: 0.07 }); } },
    stalag(b, h, c){ b.part('cone', [h * 0.35, h, 6], c || 0x3a2858, { pos: [0, h / 2, 0], outline: 0.03 }).part('cone', [h * 0.18, h * 0.5, 6], c || 0x3a2858, { pos: [h * 0.35, h * 0.25, 0.2] }); },
    caveWall(b, h){ b.part('dodeca', [h, 0], 0x2a1c44, { pos: [0, h * 0.4, 0], scale: [1.4, 1, 1], rot: [0.3, R(0, 3), 0], outline: 0.015 }); },
    pillar(b, h, broken){ h = h || 4.2; b.part('box', [1.0, 0.35, 1.0, 0.05], 0xe2c271, { pos: [0, 0.17, 0] }).part('cyl', [0.36, 0.4, h, 12], 0xf2dc9b, { pos: [0, h / 2 + 0.3, 0] });
      for (let i = 0; i < 6; i++){ const a = i / 6 * PI * 2; b.part('box', [0.06, h, 0.06], 0xd9bd72, { pos: [Math.cos(a) * 0.39, h / 2 + 0.3, Math.sin(a) * 0.39], outline: false }); }
      if (!broken) b.part('box', [1.05, 0.4, 1.05, 0.05], 0xf5c033, { pos: [0, h + 0.5, 0], emissive: 0x332200, ei: 1 }); },
    temple(b){ for (let i = 0; i < 4; i++) b.part('box', [12 - i * 2, 0.8, 7 - i * 1.1, 0.05], i % 2 ? 0xe2c271 : 0xf0d48a, { pos: [0, 0.4 + i * 0.8, 0], outline: 0.02 });
      for (let i = 0; i < 5; i++) b.part('cyl', [0.4, 0.45, 3.6, 12], 0xf2dc9b, { pos: [-3 + i * 1.5, 5.0, 1.0], outline: 0.03 });
      b.part('box', [8.0, 0.6, 3.6, 0.05], 0xf5c033, { pos: [0, 7.1, 0.2], emissive: 0x332200, ei: 1, outline: 0.02 });
      b.part('cone', [4.8, 2.0, 4], 0xf5c033, { pos: [0, 8.4, 0.2], rot: [0, PI / 4, 0], scale: [1.2, 1, 0.55], emissive: 0x332200, ei: 1, outline: 0.02 });
      b.part('box', [2.0, 2.8, 0.2], 0x5a3a14, { pos: [0, 4.6, -0.5], outline: false }); },
    urn(b){ b.part('lathe', [[0, 0], [0.4, 0.05], [0.55, 0.5], [0.35, 0.95], [0.42, 1.15], [0, 1.15]], 0xf5c033, { pos: [0, 0, 0], emissive: 0x443300, ei: 1 }); },
    palm(b){ b.part('cyl', [0.2, 0.3, 4.2, 7], 0xb88a4a, { pos: [0.3, 2.1, 0], rot: [0, 0, -0.14] });
      for (let i = 0; i < 6; i++){ const a = i / 6 * PI * 2; b.part('box', [2.2, 0.08, 0.6, 0.03], 0x5fae3a, { pos: [0.6 + Math.cos(a) * 0.9, 4.1, Math.sin(a) * 0.9], rot: [0, -a, -0.45], outline: 0.06 }); } },
    stump(b){ b.part('cyl', [0.55, 0.65, 0.6, 10], 0x8a5a33, { pos: [0, 0.3, 0] }).part('cyl', [0.48, 0.48, 0.04, 10], 0xf2cf8c, { pos: [0, 0.61, 0], outline: false }); },
    hay(b){ b.part('cyl', [0.7, 0.7, 1.2, 12], 0xf0c75a, { pos: [0, 0.7, 0], rot: [0, 0, PI / 2] }); },
    /* small low accents for the visible play area (all under ~0.6 tall) */
    posy(b, cols){ for (let i = 0; i < 3; i++){ const x = R(-0.35, 0.35), z = R(-0.3, 0.3), h = R(0.22, 0.34);
      b.part('cyl', [0.025, 0.025, h, 4], 0x3e9a2c, { pos: [x, h / 2, z], outline: false }).part('sphere', [0.1, 7, 5], pickOf(cols), { pos: [x, h, z], outline: 0.14 }); }
      b.part('cone', [0.07, 0.3, 4], 0x4fae36, { pos: [0.05, 0.12, 0.05], outline: false }); },
    pebbles(b, c){ b.part('dodeca', [0.24, 0], c, { pos: [0, 0.1, 0], scale: [1.3, 0.7, 1] }).part('dodeca', [0.15, 0], c, { pos: [0.34, 0.06, 0.12], rot: [0.4, 0.2, 0] })
      .part('dodeca', [0.11, 0], c, { pos: [-0.26, 0.05, 0.2], rot: [0.2, 0.7, 0] }); },
    shroom(b, cap, glow){ [[0, 0, 1], [0.24, 0.1, 0.7]].forEach(([x, z, k]) => b.part('cyl', [0.06 * k, 0.08 * k, 0.24 * k, 6], 0xf3e6cf, { pos: [x, 0.12 * k, z] })
      .part('sphere', [0.18 * k, 10, 6], cap, { pos: [x, 0.24 * k, z], scale: [1, 0.6, 1], emissive: glow ? cap : null, ei: glow ? 0.5 : 0 })); },
    shards(b, cols){ for (let i = 0; i < 3; i++){ const c = pickOf(cols), h = R(0.35, 0.6);
      b.part('oct', [0.2], c, { pos: [R(-0.25, 0.25), h * 0.42, R(-0.2, 0.2)], scale: [0.7, h * 2.2, 0.7], rot: [R(-.35, .35), R(0, 3), R(-.35, .35)], emissive: c, ei: 0.55, outline: 0.09 }); } },
    petals(b){ [[0, 0, 0.42, 0xffb3d1], [0.3, 0.15, 0.26, 0xff8fbd], [-0.25, 0.2, 0.22, 0xffc7dd]].forEach(([x, z, r, c]) =>
      b.part('sphere', [r, 10, 6], c, { pos: [x, 0, z], scale: [1, 0.28, 1], outline: 0.05 })); },
    snowPile(b){ b.part('sphere', [0.42, 10, 6], 0xffffff, { pos: [0, 0, 0], scale: [1, 0.45, 0.8], outline: 0.05 }).part('sphere', [0.26, 10, 6], 0xf2f9ff, { pos: [0.34, 0, 0.12], scale: [1, 0.5, 1], outline: 0.06 }); },
    iceShard(b){ b.part('box', [0.36, 0.36, 0.36, 0.04], 0xbfeaff, { pos: [0, 0.18, 0], rot: [0, 0.5, 0], emissive: 0x3aa0d8, ei: 0.15 }).part('box', [0.22, 0.22, 0.22, 0.03], 0xd9f4ff, { pos: [0.32, 0.11, 0.1], rot: [0, 1.2, 0] }); },
    pinecones(b){ [[0, 0], [0.26, 0.14], [-0.2, 0.18]].forEach(([x, z]) => b.part('cone', [0.09, 0.24, 6], 0x8a5a33, { pos: [x, 0.09, z], rot: [PI / 2, R(0, 3), 0] })); },
    coins(b){ for (let i = 0; i < 5; i++) b.part('cyl', [0.12, 0.12, 0.05, 10], 0xffd23f, { pos: [R(-0.15, 0.15) + (i > 2 ? 0.3 : 0), 0.03 + (i % 3) * 0.055, R(-0.1, 0.1)], emissive: 0x554400, ei: 1, outline: 0.1 }); },
    sprout(b, c){ for (let i = 0; i < 4; i++){ const a = i / 4 * PI * 2 + 0.4; b.part('cone', [0.08, 0.42, 4], c, { pos: [Math.cos(a) * 0.08, 0.17, Math.sin(a) * 0.08], rot: [Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6], outline: 0.1 }); } }
  };
  // accent spots: inside the visible play area left of the shop (1280x720 and up), clear of the tree, the lumberjack,
  // the rolling-log arc (behind-left of the tree) and the footprint of every maxed upgrades3d model.
  const ACCENT_SPOTS = [[-5.5, 4.6], [-4.3, 4.4], [-1.2, 4.5], [2.6, 4.4], [3.8, 3.6], [2.2, 3.0], [-0.6, 2.9], [-3.6, 3.0], [1.0, -4.6], [2.8, -4.4], [-7.4, -2.3], [-6.8, -0.3]];
  const ACCENTS = [
    [b => P.posy(b, [0xff5a5a, 0xffd23f, 0xffffff]), b => P.pebbles(b, C.rock), b => P.sprout(b, 0x4fae36), b => P.shroom(b, 0xe53935)],
    [b => P.posy(b, [0xffffff, 0xffe46b, 0x9fd8ff]), b => P.pebbles(b, 0xb7bfc4), b => P.sprout(b, 0x6fb84a)],
    [b => P.pinecones(b), b => P.pebbles(b, 0x8c969c), b => P.sprout(b, 0x5e8a52)],
    [b => P.shroom(b, 0xe53935), b => P.sprout(b, 0x2f7d2d), b => P.pebbles(b, 0x7c8a78)],
    [b => P.petals(b), b => P.posy(b, [0xffffff, 0xff6fae, 0xffd1e3]), b => P.petals(b), b => P.sprout(b, 0x6fbf5a)],
    [b => P.snowPile(b), b => P.iceShard(b), b => P.pebbles(b, 0xdfeef7)],
    [b => P.shards(b, [0x7ef0ff, 0xff8ff3, 0xb48cff]), b => P.shroom(b, pickOf([0x7ef0ff, 0xff8ff3]), true), b => P.shards(b, [0xb48cff, 0x7ef0ff])],
    [b => P.coins(b), b => P.pebbles(b, 0xd9bd72), b => P.posy(b, [0xffd23f, 0xffffff, 0xff8a1c])]
  ];

  /* ---------- stage definitions ---------- */
  // env: ground [a, b], sky, fog [near, far], hemi [sky, ground, intensity], sun [color, intensity]; fx: particle kind
  const STAGES = [
    { env: { ground: ['#8EE05C', '#6FD043'], sky: 0x9fe3ff, fog: [50, 120], hemi: [0xffffff, 0x8fcf6a, 1.1], sun: [0xffffff, 1.9] }, fx: 'leaf',
      build(d){ d.at(-12.5, -1.5, 0, 1, b => P.pond(b, 2.6), 3.6); d.ground([0x7fd64e, 0x9be86a], 0x4fae36, (x, z) => Math.hypot(x + 12.5, z + 1.5) > 4);
        d.at(-13, -8, 1.2, 1, b => P.cabin(b), 3); d.at(-10, 6.5, 0.15, 1, b => P.fence(b, 4), 1); d.at(8.5, -14.5, 0.8, 1, b => P.hay(b));
        d.ring(18, 10, 15, b => P.oak(b), 2.4); d.ring(30, 15, 34, b => P.oak(b), 2.6);
        d.ring(10, 6, 12, b => P.bush(b), 1.1); d.ring(12, 5, 12, b => P.flowers(b), 0.9); d.ring(7, 6, 18, b => P.rock(b), 1.1); d.ring(3, 6, 12, b => P.stump(b), 0.9); } },
    { env: { ground: ['#A6E070', '#93D25E'], sky: 0xbfeaff, fog: [50, 125], hemi: [0xffffff, 0x9fd8a0, 1.1], sun: [0xfff6e0, 1.85] }, fx: 'fluff',
      build(d){ d.at(-15, -4, 0, 1, b => P.pond(b, 6.2, 0x45aee8, 0xecd9a0), 7.4); d.at(10, -16, 0, 1, b => P.pond(b, 5.5, 0x45aee8, 0xecd9a0), 6.6);
        d.ground([0x9ad864, 0xb4ea80], 0x6fb84a, (x, z) => !inLake(x, z, 0.8));
        d.at(-8.4, -3.2, 1.45, 1, b => P.dock(b), 1); [[-17, -6], [-14, -1.5], [-18, -2], [9, -14], [12, -18]].forEach(([x, z]) => d.at(x, z, R(0, 6), 1, b => P.lily(b), 0.05));
        d.ring(18, 9, 15, b => P.birch(b), 2.0, (x, z) => !inLake(x, z)); d.ring(26, 15, 34, b => P.birch(b), 2.2, (x, z) => !inLake(x, z));
        d.ring(12, 6, 20, b => P.reeds(b), 0.6, (x, z) => !inLake(x, z, 0) && inLake(x, z, 1.8)); d.ring(10, 5, 13, b => P.flowers(b, [0xffffff, 0xffe46b, 0x9fd8ff]), 0.9, (x, z) => !inLake(x, z));
        d.ring(6, 6, 16, b => P.rock(b, 0xb7bfc4), 1.1, (x, z) => !inLake(x, z)); d.ring(5, 6, 12, b => P.bush(b, 0x7cc23a), 1.1, (x, z) => !inLake(x, z)); } },
    { env: { ground: ['#93B97C', '#80A86C'], sky: 0xc6e2f2, fog: [60, 150], hemi: [0xf2f8ff, 0x8aa080, 1.05], sun: [0xfff2e0, 1.8] }, fx: 'snowLight',
      build(d){ for (let i = 0; i < 16; i++){ const a = i / 16 * PI * 2 + R(-0.1, 0.1), r = R(48, 66); d.at(Math.cos(a) * r, Math.sin(a) * r, R(0, 6), 1, b => P.mountain(b, R(20, 32), pickOf([0x8a9aa6, 0x7d8e9b, 0x9aa8b2]), 0xffffff), 0.6); }
        d.ground([0x88ad72, 0xa3c48c], 0x5e8a52);
        d.at(-12.5, -6, 0.9, 1, b => P.cabin(b, 0x5d4037), 3); d.at(-10.5, 3.8, 0.4, 1, b => P.log(b), 1.6);
        d.ring(20, 9, 15, b => P.pine(b), 2.0); d.ring(30, 15, 36, b => P.pine(b), 2.2); d.ring(6, 9, 20, b => P.boulder(b), 2); d.ring(9, 5, 14, b => P.rock(b, 0x8c969c), 1.1);
        d.ring(6, 6, 13, b => P.bush(b, 0x3d7f45), 1.1); d.ring(4, 6, 12, b => P.stump(b), 0.9); } },
    { env: { ground: ['#4F9E3C', '#438C33'], sky: 0xa8d8bf, fog: [32, 95], hemi: [0xf4fff0, 0x5c8c4a, 1.05], sun: [0xffe8c0, 1.8] }, fx: 'dust',
      build(d){ d.ground([0x3f8a30, 0x5aa846], 0x2f7d2d);
        d.at(-13, -3, 0.3, 1, b => P.giant(b), 3.4); d.at(9, -15, 0, 1, b => P.giant(b), 3.4); d.ring(12, 15, 34, b => P.giant(b), 4); d.ring(14, 9, 16, b => P.redwood(b), 2.0); d.ring(10, 16, 26, b => P.redwood(b), 2.2);
        d.ring(18, 5, 14, b => P.fern(b), 0.8); d.ring(8, 5, 12, b => P.mushroom(b, 0xe53935), 0.5); d.at(-9.5, 6.2, 0.5, 1, b => P.log(b), 1.6);
        d.ring(5, 7, 16, b => P.rock(b, 0x7c8a78), 1.1); } },
    { env: { ground: ['#F7BCD5', '#EFA6C6'], sky: 0xffe3ef, fog: [50, 120], hemi: [0xffffff, 0xf0a3c4, 1.1], sun: [0xfff0f4, 1.85] }, fx: 'petal',
      build(d){ d.at(-12.5, -2, 0, 1, b => P.pond(b, 3.0, 0x5cc0f0, 0xd9d2c8), 4); d.ground([0xffc8de, 0xffa9cb], 0xe887b0, (x, z) => Math.hypot(x + 12.5, z + 2) > 4.2);
        d.at(-2, -17, 0, 1.25, b => P.torii(b), 3); d.ring(16, 9, 15, b => P.cherry(b), 2.2); d.ring(24, 15, 32, b => P.cherry(b), 2.4); d.ring(7, 6, 13, b => P.lantern(b), 0.9);
        d.ring(10, 5, 13, b => P.bush(b, 0xff9cc6), 1.1); d.ring(10, 5, 13, b => P.flowers(b, [0xffffff, 0xff6fae, 0xffd1e3]), 0.9); d.ring(5, 7, 18, b => P.rock(b, 0xb3aaa8), 1.1); } },
    { env: { ground: ['#EEF8FF', '#D6EBF7'], sky: 0xd4ecfb, fog: [45, 120], hemi: [0xffffff, 0xbfdff0, 1.0], sun: [0xf0f8ff, 1.75] }, fx: 'snow',
      build(d){ for (let i = 0; i < 14; i++){ const a = i / 14 * PI * 2 + 0.2, r = R(48, 64); d.at(Math.cos(a) * r, Math.sin(a) * r, 0, 1, b => P.mountain(b, R(18, 28), 0xc4dcea, 0xffffff), 0.6); }
        d.at(-13, -2.5, 0, 1, b => P.pond(b, 3.4, 0xa9dcf5, 0xffffff), 4.4); d.ground([0xffffff, 0xcfe6f4], 0xb8e6fb, (x, z) => Math.hypot(x + 13, z + 2.5) > 4.5);
        d.at(-9.5, 6, 0.6, 1, b => P.snowman(b), 1.2); d.at(9.5, -14, -0.7, 1, b => P.igloo(b), 2.2);
        d.ring(18, 9, 15, b => P.pine(b, 0xe6f8ff, 0xb8e6fb, 0xffffff), 2.0); d.ring(26, 15, 34, b => P.pine(b, 0xe6f8ff, 0xb8e6fb, 0xffffff), 2.2);
        d.ring(9, 5, 14, b => P.iceBlock(b), 1.1); d.ring(8, 6, 18, b => P.rock(b, 0xdfeef7), 1.1); } },
    { env: { ground: ['#4C3170', '#3E2660'], sky: 0x1d1333, fog: [26, 80], hemi: [0xd6c4ff, 0x3a2a5a, 1.0], sun: [0xe0d0ff, 1.5] }, fx: 'sparkle',
      build(d){ d.ground(null, 0x7ef0ff); d.tiles([0x37225a, 0x331f54], 0x7ef0ff); d.ring(26, 20, 34, b => P.caveWall(b, R(4, 7)), 5); d.ring(12, 10, 20, b => P.stalag(b, R(3, 6)), 1.8);
        d.ring(18, 5, 14, b => P.crystals(b), 1.1); d.ring(12, 9, 18, b => P.crystalTree(b), 1.8); d.ring(10, 5, 13, b => P.mushroom(b, pickOf([0x7ef0ff, 0xff8ff3]), true), 0.5); } },
    { env: { ground: ['#F0D48A', '#E2C271'], sky: 0xffe8b5, fog: [50, 125], hemi: [0xffffff, 0xd9b45f, 1.1], sun: [0xfff0c8, 1.9] }, fx: 'gold',
      build(d){ d.at(-12.5, -2, 0, 1, b => P.pond(b, 2.8, 0x4fd0e0, 0xf5c033), 3.8); d.ground([0xe9c977, 0xf7e0a0], 0xc9a64f, (x, z) => Math.hypot(x + 12.5, z + 2) > 4);
        d.at(3, -21, 0, 1.3, b => P.temple(b), 8); for (let i = 0; i < 6; i++) d.at(-7.5 + i * 3.2, -13.5, 0, 1, b => P.pillar(b, 4.2, i === 1), 1.2);
        d.ring(10, 7, 15, b => P.pillar(b, R(3, 5), rnd() < 0.4), 1.3); d.ring(12, 10, 16, b => rnd() < 0.5 ? P.palm(b) : P.goldTree(b), 2.0); d.ring(20, 16, 34, b => rnd() < 0.5 ? P.palm(b) : P.goldTree(b), 2.4);
        d.ring(9, 5, 13, b => P.urn(b), 0.7); d.ring(6, 7, 20, b => P.rock(b, 0xd9bd72), 1.1); } }
  ];
  function inLake(x, z, pad){ pad = pad == null ? 1.2 : pad; return Math.hypot(x + 15, z + 4) < 6.9 + pad || Math.hypot(x - 10, z + 16) < 6.2 + pad; }

  function buildStage(i){
    seed = 1000 + i * 7919;
    const b = Builder(), placed = [];
    const ok = (x, z, r) => clear(x, z, r) && placed.every(p => Math.hypot(p[0] - x, p[1] - z) > p[2] + r);
    const delayAt = (x, z) => 0.05 + Math.min(1, Math.hypot(x, z) / 40) * 0.7 + R(0, 0.15);
    const d = {
      at(x, z, ry, s, fn, r){ b.prop(x, z, ry, s, delayAt(x, z)); fn(b); placed.push([x, z, r == null ? 1.5 : r]); },
      ground(cols, tuft, filter){
        for (let k = 0, t = 0; cols && k < 26 && t < 400; t++){ const a = rnd() * PI * 2, rr = R(3.2, 20), x = Math.cos(a) * rr, z = Math.sin(a) * rr;
          if (filter && !filter(x, z)) continue; b.prop(x, z, R(0, 6), 1, delayAt(x, z) * 0.5); P.patch(b, pickOf(cols)); k++; }
        for (let k = 0, t = 0; k < 30 && t < 600; t++){ const a = rnd() * PI * 2, rr = R(4.5, 16), x = Math.cos(a) * rr, z = Math.sin(a) * rr;
          if (!clear(x, z, 0.3) || (filter && !filter(x, z))) continue; b.prop(x, z, R(0, 6), R(0.8, 1.2), delayAt(x, z)); P.tuft(b, tuft); k++; }
      },
      // crisp darker floor tiles snapped to the 2-unit ground checker (tile centres sit on odd coordinates)
      tiles(cols, glow){
        const used = new Set();
        for (let k = 0, t = 0; k < 22 && t < 400; t++){
          const x = 2 * Math.round(R(-12, 10) / 2) + 1, z = 2 * Math.round(R(-14, 8) / 2) + 1, key = x + ',' + z;
          if (used.has(key) || Math.hypot(x, z) < 2.5) continue; used.add(key); k++;
          b.prop(x, z, 0, 1, delayAt(x, z) * 0.5);
          b.part('box', [1.86, 0.02, 1.86], pickOf(cols), { pos: [0, 0.012, 0], outline: false });
          if (rnd() < 0.35) b.part('box', [1.5, 0.022, 1.5], 0x2a1846, { pos: [0, 0.016, 0], outline: false }).part('box', [0.12, 0.024, 1.2], glow, { pos: [0, 0.02, 0], rot: [0, PI / 4, 0], emissive: glow, ei: 0.4, outline: false });
        }
      },
      ring(n, rMin, rMax, fn, r, filter){
        let tries = 0;
        for (let k = 0; k < n && tries < n * 30; tries++){
          const a = rnd() * PI * 2, rr = Math.sqrt(R(rMin * rMin, rMax * rMax)), x = Math.cos(a) * rr, z = Math.sin(a) * rr;
          if (!ok(x, z, r) || (filter && !filter(x, z))) continue;
          b.prop(x, z, R(0, PI * 2), R(0.8, 1.2), delayAt(x, z)); fn(b); placed.push([x, z, r]); k++;
        }
      }
    };
    STAGES[i].build(d);
    ACCENT_SPOTS.forEach(([x, z], k) => { if (rnd() < 0.2) return; x += R(-0.2, 0.2); z += R(-0.2, 0.2);
      b.prop(x, z, R(0, PI * 2), R(1.35, 1.6), 0.1 + k * 0.03); pickOf(ACCENTS[i])(b); });
    const st = { uni: { value: 99 } };
    st.root = bake(b, st.uni);
    U.trackOutlines(st.root);
    st.parts = b.parts.length;
    return st;
  }

  /* ---------- environment (ground / sky / lights) ---------- */
  let ground = null;
  function applyEnv(env){
    const s = SC.scene;
    if (!ground) ground = s.getObjectByName('ground');
    if (ground && ground.material.map){
      const c = ground.material.map.image, x = c.getContext('2d');
      x.fillStyle = env.ground[0]; x.fillRect(0, 0, 2, 2); x.fillStyle = env.ground[1]; x.fillRect(0, 0, 1, 1); x.fillRect(1, 1, 1, 1);
      ground.material.map.needsUpdate = true;
    }
    s.background.setHex(env.sky); SC.renderer.setClearColor(env.sky);
    s.fog.color.setHex(env.sky); s.fog.near = env.fog[0]; s.fog.far = env.fog[1];
    const L = SC.lights; L.hemi.color.setHex(env.hemi[0]); L.hemi.groundColor.setHex(env.hemi[1]); L.hemi.intensity = env.hemi[2];
    L.sun.color.setHex(env.sun[0]); L.sun.intensity = env.sun[1];
  }

  /* ---------- ambient particles ---------- */
  const FX = {
    leaf: { color: 0x8fd14f, size: 0.32, n: 60, fall: 0.7, sway: 1.0, shape: 'leaf' },
    fluff: { color: 0xffffff, size: 0.22, n: 70, fall: 0.25, sway: 0.8, shape: 'dot' },
    snowLight: { color: 0xffffff, size: 0.22, n: 70, fall: 1.0, sway: 0.5, shape: 'dot' },
    dust: { color: 0xffe79a, size: 0.2, n: 80, fall: -0.08, sway: 0.4, shape: 'dot' },
    petal: { color: 0xff9cc6, size: 0.36, n: 110, fall: 0.8, sway: 1.3, shape: 'leaf' },
    snow: { color: 0xffffff, size: 0.28, n: 160, fall: 1.4, sway: 0.6, shape: 'dot' },
    sparkle: { color: 0x9ff3ff, size: 0.3, n: 90, fall: -0.3, sway: 0.5, shape: 'star', add: true },
    gold: { color: 0xffe066, size: 0.28, n: 80, fall: -0.25, sway: 0.5, shape: 'star', add: true }
  };
  const texCache = {};
  function ptex(shape){
    if (texCache[shape]) return texCache[shape];
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    x.fillStyle = '#fff';
    if (shape === 'leaf'){ x.translate(32, 32); x.rotate(0.6); x.beginPath(); x.ellipse(0, 0, 26, 14, 0, 0, PI * 2); x.fill(); x.strokeStyle = 'rgba(0,0,0,.35)'; x.lineWidth = 4; x.stroke(); }
    else if (shape === 'star'){ const g = x.createRadialGradient(32, 32, 0, 32, 32, 30); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, 64, 64); x.fillStyle = '#fff'; x.fillRect(30, 4, 4, 56); x.fillRect(4, 30, 56, 4); }
    else { x.beginPath(); x.arc(32, 32, 24, 0, PI * 2); x.fill(); x.strokeStyle = 'rgba(80,110,140,.35)'; x.lineWidth = 4; x.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return texCache[shape] = t;
  }
  let parts = null;
  const BOX = { x: [-18, 14], y: [0, 14], z: [-22, 12] };
  function makeParticles(kind){
    if (parts){ SC.scene.remove(parts.pts); parts.pts.geometry.dispose(); parts.pts.material.dispose(); parts = null; }
    const f = FX[kind]; if (!f) return;
    const n = Math.round(f.n * (low() ? 0.3 : 1));
    const pos = new Float32Array(n * 3), ph = new Float32Array(n);
    for (let i = 0; i < n; i++){ pos[i * 3] = U.rand(BOX.x[0], BOX.x[1]); pos[i * 3 + 1] = U.rand(BOX.y[0], BOX.y[1]); pos[i * 3 + 2] = U.rand(BOX.z[0], BOX.z[1]); ph[i] = Math.random() * 6.28; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: f.color, size: f.size, map: ptex(f.shape), transparent: true, depthWrite: false, alphaTest: f.add ? 0 : 0.3,
      blending: f.add ? THREE.AdditiveBlending : THREE.NormalBlending, fog: true });
    const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.raycast = () => {}; pts.name = 'worldParticles';
    SC.scene.add(pts);
    parts = { pts, f, ph, n, t: 0 };
  }
  function updateParticles(dt){
    if (!parts) return;
    const p = parts.pts.geometry.attributes.position, a = p.array, f = parts.f; parts.t += dt;
    for (let i = 0; i < parts.n; i++){
      const k = i * 3, ph = parts.ph[i];
      a[k + 1] -= (f.fall * (0.7 + (ph % 1) * 0.6)) * dt;
      a[k] += Math.sin(parts.t * 0.9 + ph) * f.sway * dt + 0.15 * dt;
      a[k + 2] += Math.cos(parts.t * 0.7 + ph * 1.3) * f.sway * 0.6 * dt;
      if (a[k + 1] < 0 || a[k + 1] > BOX.y[1] || a[k] > BOX.x[1]){
        a[k] = U.rand(BOX.x[0], BOX.x[1]); a[k + 2] = U.rand(BOX.z[0], BOX.z[1]); a[k + 1] = f.fall > 0 ? BOX.y[1] : U.rand(0, 2);
      }
    }
    p.needsUpdate = true;
    if (f.add) parts.pts.material.opacity = 0.75 + Math.sin(parts.t * 3) * 0.25;
  }

  /* ---------- title-screen life: idle workers + animals ---------- */
  let life = null;
  function buildLife(){
    const g = new THREE.Group(); g.name = 'titleLife'; const items = [];
    const worker = (x, z, ry, shirt, hat) => {
      const w = M.group(g, [x, 0, z]); w.rotation.y = ry;
      M.part('box', [0.5, 0.55, 0.36, 0.12], shirt, { parent: w, pos: [0, 0.75, 0], abs: 0.035 });
      [-1, 1].forEach(sd => M.part('capsule', [0.11, 0.25], 0x3866c9, { parent: w, pos: [sd * 0.13, 0.27, 0], abs: 0.03 }));
      const head = M.part('sphere', [0.27, 12, 9], 0xffc9a0, { parent: w, pos: [0, 1.28, 0], abs: 0.035 });
      M.part('sphere', [0.29, 12, 8], hat, { parent: head, pos: [0, 0.1, 0], scale: [1, 0.7, 1], abs: 0.03 });
      [-1, 1].forEach(sd => M.part('sphere', [0.045, 6, 5], 0x1b1b1b, { parent: head, pos: [sd * 0.09, 0.02, 0.24], outline: false }));
      const arm = M.group(w, [0, 0.95, 0.12]);
      M.part('capsule', [0.09, 0.3], shirt, { parent: arm, pos: [0.28, 0, 0.12], rot: [PI / 2, 0, 0], abs: 0.03 });
      M.part('cyl', [0.04, 0.045, 0.9, 6], 0xd9a066, { parent: arm, pos: [0.28, 0, 0.55], rot: [PI / 2, 0, 0], abs: 0.025 });
      M.part('box', [0.08, 0.22, 0.24, 0.03], 0xc8d3dc, { parent: arm, pos: [0.28, -0.08, 0.95], abs: 0.03 });
      const st = M.group(g, [x + Math.sin(ry) * 1.05, 0, z + Math.cos(ry) * 1.05]);
      M.part('cyl', [0.42, 0.5, 0.5, 10], 0x8a5a33, { parent: st, pos: [0, 0.25, 0], abs: 0.035 });
      M.part('cyl', [0.36, 0.36, 0.03, 10], 0xf2cf8c, { parent: st, pos: [0, 0.51, 0], outline: false });
      w.add(U.blobShadow(0.55, 0.25));
      items.push({ kind: 'worker', w, arm, ph: Math.random() * 6 });
    };
    worker(4.6, 3.2, -2.3, 0x2f7de1, 0xffc928); worker(-4.4, -3.6, 0.9, 0x3bb54a, 0xff8a1c);
    const bunny = (cx, cz, r, col) => {
      const b = M.group(g);
      M.part('sphere', [0.28, 10, 8], col, { parent: b, pos: [0, 0.28, 0], scale: [0.9, 0.85, 1.15], abs: 0.03 });
      M.part('sphere', [0.18, 10, 8], col, { parent: b, pos: [0, 0.5, 0.26], abs: 0.03 });
      [-1, 1].forEach(sd => M.part('capsule', [0.05, 0.22], col, { parent: b, pos: [sd * 0.07, 0.78, 0.22], rot: [-0.2, 0, sd * 0.15], abs: 0.02 }));
      M.part('sphere', [0.09, 6, 5], 0xffffff, { parent: b, pos: [0, 0.32, -0.3], outline: false });
      [-1, 1].forEach(sd => M.part('sphere', [0.03, 5, 4], 0x1b1b1b, { parent: b, pos: [sd * 0.08, 0.55, 0.41], outline: false }));
      b.add(U.blobShadow(0.35, 0.22));
      items.push({ kind: 'hop', o: b, cx, cz, r, ph: Math.random() * 6, sp: U.rand(0.25, 0.4) });
    };
    bunny(6.5, -1, 1.2, 0xf4efe8); bunny(-6.5, 3.5, 1.0, 0xc8a27a); bunny(1.5, 6.2, 1.1, 0xf4efe8);
    const bird = (r, y, sp, col) => {
      const b = M.group(g);
      M.part('sphere', [0.22, 10, 8], col, { parent: b, scale: [0.9, 0.8, 1.3], abs: 0.025 });
      M.part('cone', [0.06, 0.16, 5], 0xffb300, { parent: b, pos: [0, 0, 0.32], rot: [PI / 2, 0, 0], outline: false });
      const wings = [-1, 1].map(sd => { const p = M.group(b, [sd * 0.12, 0.05, 0]); M.part('box', [0.4, 0.04, 0.22, 0.02], col, { parent: p, pos: [sd * 0.2, 0, 0], abs: 0.02 }); return p; });
      items.push({ kind: 'bird', o: b, wings, r, y, sp, ph: Math.random() * 6 });
    };
    bird(15, 10, 0.3, 0xff6b5e); bird(18, 12, -0.25, 0x2f7de1);
    return { g, items, t: 0 };
  }
  function updateLife(dt){
    if (!life || !life.g.visible) return;
    const t = life.t += dt;
    for (const it of life.items){
      if (it.kind === 'worker'){ const s = (t * 1.3 + it.ph) % 1; it.arm.rotation.x = s < 0.25 ? -1.3 + s * 4 * 1.9 : 0.6 - (s - 0.25) / 0.75 * 1.9; it.w.position.y = Math.max(0, Math.sin(t * 2.6 + it.ph)) * 0.03; }
      else if (it.kind === 'hop'){ const a = t * it.sp + it.ph, hop = Math.abs(Math.sin(t * 5 + it.ph));
        it.o.position.set(it.cx + Math.cos(a) * it.r, hop * 0.25, it.cz + Math.sin(a) * it.r); it.o.rotation.y = -a; }
      else { const a = t * it.sp + it.ph; it.o.position.set(Math.cos(a) * it.r, it.y + Math.sin(t * 1.7 + it.ph) * 0.4, Math.sin(a) * it.r);
        it.o.rotation.y = -a + (it.sp > 0 ? 0 : PI); it.wings.forEach((w, k) => { w.rotation.z = (k ? -1 : 1) * Math.sin(t * 12 + it.ph) * 0.7; }); }
    }
  }

  /* ---------- stage switching + transition ---------- */
  const cache = {};
  let current = null, stage = -1, fadeEl = null, popT = 99;
  function overlay(){
    if (fadeEl && fadeEl.isConnected) return fadeEl;
    fadeEl = document.createElement('div'); fadeEl.id = 'world-fade'; fadeEl.className = 'passthrough';
    fadeEl.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:45;opacity:0;background:radial-gradient(circle at 45% 50%,#ffffff 0%,#ffffff 45%,#fff6dc 100%)';
    (document.getElementById('ui-layer') || document.body).appendChild(fadeEl);
    return fadeEl;
  }
  function banner(text){
    const L = document.getElementById('ui-layer'); if (!L) return;
    const el = document.createElement('div'); el.className = 'outlined passthrough world-banner'; el.textContent = text;
    // centre it over the play area left of the icon column + shop (mirrors scene.js / ui.css --shop-w, --ib) and size it to fit
    const W = window.innerWidth, H = window.innerHeight, phone = W < 600;
    const playW = phone ? W : Math.max(200, W - U.clamp(W * 0.36, 290, 540) - U.clamp(H * 0.064, 50, 64) - 48);
    const fs = Math.max(22, Math.min(64, W * 0.08, playW * 0.9 / (text.length * 0.52)));
    el.style.cssText = 'position:absolute;left:' + (phone ? W / 2 : playW / 2 + 12) + 'px;top:40%;transform:translate(-50%,-50%) scale(0);font-size:' + fs + 'px;--stroke:6px;z-index:44;pointer-events:none;white-space:nowrap';
    L.appendChild(el);
    U.tween(0.45, k => { el.style.transform = 'translate(-50%,-50%) scale(' + k + ')'; }, { ease: 'outBack' });
    U.tween(0.5, k => { el.style.opacity = String(1 - k); }, { delay: 2.0, done(){ el.remove(); } });
  }
  function swapNow(i){
    if (current) SC.scene.remove(current.root);
    current = cache[i] || (cache[i] = buildStage(i));
    SC.scene.add(current.root);
    applyEnv(STAGES[i].env);
    makeParticles(STAGES[i].fx);
    stage = i; popT = 0; current.uni.value = 0;
  }
  let fading = null;
  function setStage(i, opts){
    opts = opts || {};
    i = ((Math.floor(i) % 8) + 8) % 8;
    if (i === stage && !opts.force) return;
    if (fading){ fading.cancel(); fading = null; }
    const el = overlay();
    if (opts.fade === false || stage < 0){ el.style.opacity = '0'; swapNow(i); if (opts.banner) banner(stageName(i)); return; }
    const from = parseFloat(el.style.opacity) || 0;
    fading = U.tween(0.22 * (1 - from), k => { el.style.opacity = String(from + (1 - from) * k); }, { ease: 'linear', done(){
      swapNow(i);
      if (opts.species){ try { SC.tree.setSpecies(TCS.data.SPECIES[i]); } catch(e){} }
      fading = U.tween(0.5, k => { el.style.opacity = String(1 - k); }, { ease: 'outQuad', delay: 0.06, done(){ fading = null; if (opts.banner) banner(stageName(i)); } });
    } });
  }
  function stateStage(){ try { const d = TCS.state.data; const v = d.speciesIndex != null ? d.speciesIndex : (d.species || 0); return ((v % 8) + 8) % 8; } catch(e){ return 0; } }

  // title showcase: start on Oak Meadow, then tour every stage
  const SHOWCASE_EVERY = 16;
  let showT = 0;
  function titleTick(dt){
    if (SC.mode !== 'orbit' || (TCS.state && TCS.state.loaded)) return;
    showT += dt;
    if (showT > SHOWCASE_EVERY){ showT = 0; setStage(stage + 1, { species: true }); }
  }

  SC.onUpdate(dt => {
    if (current && popT < 3){ popT += dt; current.uni.value = popT; }
    updateParticles(dt); updateLife(dt); titleTick(dt);
  });
  bus.on('sceneMode', m => {
    if (!life){ life = buildLife(); SC.addToWorld(life.g); }
    life.g.visible = m === 'orbit';
    if (life.g.visible) for (const it of life.items) if (it.o) U.popIn(it.o, 1, 0.5);
    if (m === 'orbit'){ showT = 0; }
  });
  bus.on('menuOpen', () => { showT = 0; });
  bus.on('load', () => setStage(stateStage(), { fade: stage >= 0 }));
  bus.on('rebirth', () => setStage(stateStage()));                    // tree is hidden mid-cinematic: swap under a white flash
  bus.on('rebirthCinematicEnd', () => { if (stateStage() !== stage) setStage(stateStage()); banner(stageName(stage)); });
  bus.on('settings', s => { if (s && current && parts && Math.round(parts.f.n * (s.graphics === 'low' ? 0.3 : 1)) !== parts.n) makeParticles(STAGES[stage].fx); });

  swapNow(0);

  TCS.world = {
    setStage, get stage(){ return stage; }, STAGES, NAMES, stageName, clear,
    get life(){ return life; },
    drawCalls(){ return current ? current.root.children.length : 0; }
  };
})();
