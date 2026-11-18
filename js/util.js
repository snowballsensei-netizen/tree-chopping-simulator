/* util.js — phase 1. Shared helpers: formatting, toon materials, outlines, model builder, tweens, event bus. */
(function(){
  const THREE = window.THREE;
  const TCS = window.TCS = window.TCS || {};

  /* ---------- event bus ---------- */
  const handlers = {};
  TCS.bus = {
    on(ev, fn){ (handlers[ev] = handlers[ev] || []).push(fn); return () => TCS.bus.off(ev, fn); },
    off(ev, fn){ const h = handlers[ev]; if (h){ const i = h.indexOf(fn); if (i >= 0) h.splice(i, 1); } },
    emit(ev, data){ const h = handlers[ev]; if (!h) return; for (const fn of h.slice()){ try { fn(data); } catch(e){ console.error('bus handler', ev, e); } } }
  };

  /* ---------- number formatting ---------- */
  const SUFFIX = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc',
    'UDc', 'DDc', 'TDc', 'QaDc', 'QiDc', 'SxDc', 'SpDc', 'OcDc', 'NoDc', 'Vg'];
  function suffixFor(i){
    if (i < SUFFIX.length) return SUFFIX[i];
    const n = i - SUFFIX.length; // beyond: aa, ab, ac ...
    return String.fromCharCode(97 + Math.floor(n / 26) % 26) + String.fromCharCode(97 + n % 26);
  }
  function trim(s){ return s.indexOf('.') >= 0 ? s.replace(/\.?0+$/, '') : s; }
  // fmt(n, opts?) -> string. opts.decimals forces decimals below 1000; opts.sci forces scientific.
  function fmt(n, opts){
    if (n == null || isNaN(n)) return '0';
    if (!isFinite(n)) return '∞';
    const neg = n < 0; n = Math.abs(n);
    let out;
    const st = TCS.state && TCS.state.data;
    const sci = (opts && opts.sci) || (st && st.settings && st.settings.numberFormat === 'scientific');
    if (n < 1000){
      const d = (opts && opts.decimals != null) ? opts.decimals : (n < 10 && n % 1 ? 1 : 0);
      out = trim(n.toFixed(d));
    } else if (n < 1e4 && !sci){
      out = Math.floor(n).toLocaleString('en-US');
    } else if (sci){
      if (n < 1e6) out = Math.floor(n).toLocaleString('en-US');
      else { const e = Math.floor(Math.log10(n)); out = (n / Math.pow(10, e)).toFixed(2) + 'e' + e; }
    } else {
      let i = Math.floor(Math.log10(n) / 3);
      let v = n / Math.pow(1000, i);
      if (v >= 999.95){ v /= 1000; i++; }
      const s = v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : v.toFixed(0);
      out = trim(s) + suffixFor(i);
    }
    return (neg ? '-' : '') + out;
  }
  function fmtTime(sec){
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    if (h) return h + 'h ' + m + 'm';
    if (m) return m + 'm ' + s + 's';
    return s + 's';
  }

  /* ---------- toon materials ---------- */
  const gradData = new Uint8Array([95, 95, 95, 255, 180, 180, 180, 255, 255, 255, 255, 255]);
  const gradientMap = new THREE.DataTexture(gradData, 3, 1, THREE.RGBAFormat);
  gradientMap.minFilter = gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.generateMipmaps = false;
  gradientMap.needsUpdate = true;

  const matCache = new Map();
  // toon(color, opts?) -> cached MeshToonMaterial. opts: {emissive, emissiveIntensity, opacity, map, nocache}
  function toon(color, opts){
    opts = opts || {};
    const key = !opts.nocache && !opts.map && (String(color) + '|' + (opts.emissive || '') + '|' + (opts.emissiveIntensity || '') + '|' + (opts.opacity || ''));
    if (key && matCache.has(key)) return matCache.get(key);
    const m = new THREE.MeshToonMaterial({ color: new THREE.Color(color), gradientMap });
    if (opts.emissive != null){ m.emissive = new THREE.Color(opts.emissive); m.emissiveIntensity = opts.emissiveIntensity != null ? opts.emissiveIntensity : 1; }
    if (opts.map) m.map = opts.map;
    if (opts.opacity != null){ m.transparent = true; m.opacity = opts.opacity; }
    if (key) matCache.set(key, m);
    return m;
  }

  /* ---------- outlines (inverted hull) ---------- */
  const outlineMat = new THREE.MeshBasicMaterial({ color: 0x1b1b1b, side: THREE.BackSide });
  const outlines = new Set();
  let outlinesOn = true;
  // outline(mesh, thickness=0.06, opts?) -> black BackSide child, uniformly scaled 1+thickness.
  // opts.abs = absolute world-ish thickness per axis (better for thin/long parts like handles).
  function outline(mesh, thickness, opts){
    if (!mesh.geometry) return null;
    thickness = thickness == null ? 0.06 : thickness;
    const hull = new THREE.Mesh(mesh.geometry, outlineMat);
    hull.name = '__outline';
    hull.userData.isOutline = true;
    if (opts && opts.abs){
      mesh.geometry.computeBoundingBox();
      const s = new THREE.Vector3(); mesh.geometry.boundingBox.getSize(s);
      hull.scale.set(1 + 2 * opts.abs / Math.max(s.x, 1e-3), 1 + 2 * opts.abs / Math.max(s.y, 1e-3), 1 + 2 * opts.abs / Math.max(s.z, 1e-3));
    } else hull.scale.setScalar(1 + thickness);
    hull.raycast = () => {};
    hull.visible = outlinesOn;
    mesh.add(hull);
    outlines.add(hull);
    return hull;
  }
  function setOutlines(on){
    outlinesOn = !!on;
    for (const h of outlines) h.visible = outlinesOn;
  }
  // call when permanently discarding an object tree with outlines
  // trackOutlines(root): register outline hulls inside a cloned object so the Low-graphics toggle reaches them
  function trackOutlines(root){ root.traverse(o => { if (o.userData.isOutline){ outlines.add(o); o.visible = outlinesOn; } }); return root; }
  function forgetOutlines(root){ root.traverse(o => { if (o.userData.isOutline) outlines.delete(o); }); }

  /* ---------- model helper ---------- */
  const geoCache = new Map();
  function geo(type, size){
    const key = type + ':' + JSON.stringify(size);
    if (geoCache.has(key)) return geoCache.get(key);
    let g;
    switch (type){
      case 'box': g = size[3] ? roundedBox(size[0], size[1], size[2], size[3]) : new THREE.BoxGeometry(size[0], size[1], size[2]); break;
      case 'cyl': g = new THREE.CylinderGeometry(size[0], size[1], size[2], size[3] || 18); break;
      case 'sphere': g = new THREE.SphereGeometry(size[0], size[1] || 20, size[2] || 14); break;
      case 'capsule': g = new THREE.CapsuleGeometry(size[0], size[1], 6, 14); break;
      case 'cone': g = new THREE.ConeGeometry(size[0], size[1], size[2] || 16); break;
      case 'torus': g = new THREE.TorusGeometry(size[0], size[1], 10, 24); break;
      case 'lathe': g = new THREE.LatheGeometry(size.map(p => new THREE.Vector2(p[0], p[1])), 18); break;
      case 'dodeca': g = new THREE.DodecahedronGeometry(size[0], size[1] || 0); break;
      case 'ico': g = new THREE.IcosahedronGeometry(size[0], size[1] || 0); break;
      default: throw new Error('model.part: unknown type ' + type);
    }
    geoCache.set(key, g);
    return g;
  }
  function roundedBox(w, h, d, r){
    const g = new THREE.BoxGeometry(w, h, d, 5, 5, 5);
    const p = g.attributes.position, v = new THREE.Vector3(), c = new THREE.Vector3();
    const hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r;
    for (let i = 0; i < p.count; i++){
      v.fromBufferAttribute(p, i);
      c.set(THREE.MathUtils.clamp(v.x, -hw, hw), THREE.MathUtils.clamp(v.y, -hh, hh), THREE.MathUtils.clamp(v.z, -hd, hd));
      v.sub(c); if (v.lengthSq() > 0) v.normalize().multiplyScalar(r);
      p.setXYZ(i, c.x + v.x, c.y + v.y, c.z + v.z);
    }
    g.computeVertexNormals();
    return g;
  }
  // part(type, size[], color|material, opts) -> outlined toon Mesh
  function part(type, size, color, opts){
    opts = opts || {};
    const mat = color && color.isMaterial ? color : toon(color, opts);
    const m = new THREE.Mesh(geo(type, size), mat);
    if (opts.name) m.name = opts.name;
    if (opts.pos) m.position.set(opts.pos[0], opts.pos[1], opts.pos[2]);
    if (opts.rot) m.rotation.set(opts.rot[0], opts.rot[1], opts.rot[2]);
    if (opts.scale != null){ if (typeof opts.scale === 'number') m.scale.setScalar(opts.scale); else m.scale.set(opts.scale[0], opts.scale[1], opts.scale[2]); }
    if (opts.outline !== false) outline(m, typeof opts.outline === 'number' ? opts.outline : 0.06, opts.abs ? { abs: opts.abs } : null);
    if (opts.parent) opts.parent.add(m);
    return m;
  }
  function group(parent, pos){ const g = new THREE.Group(); if (pos) g.position.set(pos[0], pos[1], pos[2]); if (parent) parent.add(g); return g; }
  TCS.model = { part, group, geo, roundedBox };

  /* ---------- blob shadow ---------- */
  let shadowTex = null;
  function blobShadow(radius, opacity){
    if (!shadowTex){
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d'); const gr = x.createRadialGradient(32, 32, 4, 32, 32, 32);
      gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.8)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
      shadowTex = new THREE.CanvasTexture(c);
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: opacity == null ? 0.3 : opacity, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.y = 0.03; m.renderOrder = 1; m.name = '__shadow';
    m.raycast = () => {};
    return m;
  }

  /* ---------- tweens ---------- */
  const tweens = [];
  const ease = {
    linear: t => t,
    outQuad: t => 1 - (1 - t) * (1 - t),
    inQuad: t => t * t,
    inOutQuad: t => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
    outBack: t => { const c1 = 2.2, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    outElastic: t => t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1
  };
  // tween(durSec, fn(easedK, rawT), {ease:'outQuad'|fn, delay, done}) -> {cancel()}. Driven by main loop.
  function tween(dur, fn, opts){
    opts = opts || {};
    const t = { dur: Math.max(dur, 1e-4), fn, e: typeof opts.ease === 'function' ? opts.ease : (ease[opts.ease] || ease.outQuad),
      t: -(opts.delay || 0), done: opts.done, dead: false, cancel(){ this.dead = true; } };
    tweens.push(t); return t;
  }
  function updateTweens(dt){
    for (let i = tweens.length - 1; i >= 0; i--){
      const t = tweens[i];
      if (t.dead){ tweens.splice(i, 1); continue; }
      t.t += dt; if (t.t < 0) continue;
      const r = Math.min(t.t / t.dur, 1);
      try { t.fn(t.e(r), r); } catch(e){ console.error(e); t.dead = true; }
      if (r >= 1){ const k = tweens.indexOf(t); if (k >= 0) tweens.splice(k, 1); if (t.done) try { t.done(); } catch(e){ console.error(e); } }
    }
  }
  // popIn(obj, targetScale=1, dur=0.5): scale-bounce from ~0 to target
  function popIn(obj, target, dur){
    const s = target == null ? 1 : target;
    obj.scale.setScalar(0.001);
    return tween(dur || 0.5, k => obj.scale.setScalar(Math.max(0.001, s * k)), { ease: 'outBack', done(){ obj.scale.setScalar(s); } });
  }
  // squash(obj, amount=0.15, dur=0.2): brief squash & stretch around obj.userData.baseScale
  function squash(obj, amt, dur){
    amt = amt == null ? 0.15 : amt;
    const b = obj.userData.baseScale || (obj.userData.baseScale = obj.scale.clone());
    if (obj.userData._sq) obj.userData._sq.cancel();
    return obj.userData._sq = tween(dur || 0.2, (k, r) => {
      const w = Math.sin(r * Math.PI * 1.5) * (1 - r);
      obj.scale.set(b.x * (1 + amt * w), b.y * (1 - amt * w), b.z * (1 + amt * w));
    }, { ease: 'linear', done(){ obj.scale.copy(b); obj.userData._sq = null; } });
  }

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  TCS.util = { fmt, fmtTime, toon, gradientMap, outline, setOutlines, forgetOutlines, trackOutlines, get outlinesOn(){ return outlinesOn; },
    outlineMaterial: outlineMat, blobShadow, tween, updateTweens, popIn, squash, ease, rand, clamp, lerp };
})();
