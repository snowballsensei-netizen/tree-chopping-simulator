/* eggs.js — buy eggs with acorns, hatch pets that multiply production (TCS.eggs).
   Save: S.data.pets = { bunny|fox|dragon: level 0..PET_MAX } (0 = not hatched), S.data.pet = id shown next to the lumberjack (null = best one).
   An egg costs D.EGG_COST acorns and rolls a pet by D.PETS[].chance. A new pet starts at level 1, a duplicate levels it up,
   a duplicate of a maxed pet refunds half the egg. The multiplier itself is S.petMult() (state.js).
   UI: egg button in #outfit-btns (key E) -> #eggs-panel (hatch button + the 3 pets, tap one to show it); hatch plays a centred egg-crack reveal.
   API: hatch() -> {id, level, isNew, refund} | null, open(), close(), toggle(), equip(id), roll(r) */
(function(){
  const TCS = window.TCS, bus = TCS.bus, D = TCS.data, U = TCS.util;
  const S = () => TCS.state;
  const byId = Object.fromEntries(D.PETS.map(p => [p.id, p]));

  /* ---------- logic ---------- */
  const pets = () => { const d = S().data; if (!d.pets || typeof d.pets !== 'object') d.pets = {}; return d.pets; };
  const level = id => pets()[id] || 0;
  const petMultOf = id => { const p = byId[id], l = level(id); return l > 0 ? p.mult + p.per * (l - 1) : 1; };
  function roll(r){
    if (r === undefined) r = Math.random();
    let acc = 0;
    for (const p of D.PETS){ acc += p.chance; if (r < acc) return p.id; }
    return D.PETS[D.PETS.length - 1].id;
  }
  // the pet shown next to the lumberjack: the chosen one, else the rarest hatched
  function shownPet(){
    const d = S().data;
    if (d.pet && level(d.pet) > 0) return d.pet;
    for (let i = D.PETS.length - 1; i >= 0; i--) if (level(D.PETS[i].id) > 0) return D.PETS[i].id;
    return null;
  }
  function hatch(){
    const s = S();
    if (!s.loaded || s.data.acorns < D.EGG_COST) return null;
    s.data.acorns -= D.EGG_COST;
    const id = roll(), p = pets(), before = p[id] || 0;
    let refund = 0;
    if (before >= D.PET_MAX){ refund = Math.floor(D.EGG_COST / 2); s.data.acorns += refund; }
    else p[id] = before + 1;
    const res = { id, level: p[id], isNew: before === 0, refund };
    bus.emit('petHatch', res);
    try { s.save(); } catch(e){}
    return res;
  }
  function equip(id){
    if (!byId[id] || level(id) < 1) return false;
    S().data.pet = id; show3d(); render();
    try { S().save(); } catch(e){}
    return true;
  }

  /* ---------- art ---------- */
  const INK = '#1b1b1b';
  const g = p => '<svg viewBox="0 0 40 40"><g stroke="' + INK + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round">' + p + '</g></svg>';
  const eyes = (y, c) => '<circle cx="15" cy="' + y + '" r="2.2" fill="' + INK + '" stroke="none"/><circle cx="25" cy="' + y + '" r="2.2" fill="' + INK + '" stroke="none"/>' +
    (c ? '<circle cx="11" cy="' + (y + 4) + '" r="2" fill="#ff9fb0" stroke="none"/><circle cx="29" cy="' + (y + 4) + '" r="2" fill="#ff9fb0" stroke="none"/>' : '');
  const ART = {
    egg: g('<path d="M20 4c8 0 14 11 14 20a14 12 0 0 1-28 0C6 15 12 4 20 4z" fill="#fff6dc"/><path d="M11 21l4 3 5-4 5 4 4-3" fill="none" stroke-width="2"/><circle cx="15" cy="13" r="2.4" fill="#8fd3ff" stroke="none"/><circle cx="26" cy="15" r="3" fill="#ffb3c7" stroke="none"/><circle cx="22" cy="29" r="2.6" fill="#b5e87a" stroke="none"/>'),
    bunny: g('<path d="M13 19C10 10 11 3 14 3s5 7 4 16M27 19c3-9 2-16-1-16s-5 7-4 16" fill="#fff"/><path d="M14 17c-1-5 0-10 0-10M26 17c1-5 0-10 0-10" stroke="#ffb3c7" stroke-width="2.5"/><ellipse cx="20" cy="26" rx="12" ry="10" fill="#fff"/>' + eyes(25, 1) + '<path d="M18.5 29h3l-1.5 1.5z" fill="#ff7a9a" stroke-width="1.5"/>'),
    fox: g('<path d="M7 7l9 7-6 6zM33 7l-9 7 6 6z" fill="#ff8a2a"/><path d="M7 16c0-4 6-6 13-6s13 2 13 6c0 9-7 17-13 17S7 25 7 16z" fill="#ff8a2a"/><path d="M9 20c4 1 7 3 11 11 4-8 7-10 11-11-2 7-6 13-11 13S11 27 9 20z" fill="#fff"/>' + eyes(19) + '<circle cx="20" cy="29" r="2" fill="' + INK + '" stroke="none"/>'),
    dragon: g('<path d="M11 13L8 3l8 7M29 13l3-10-8 7" fill="#ffc83a"/><path d="M6 21c0-8 6-12 14-12s14 4 14 12-6 14-14 14S6 29 6 21z" fill="#5ccf6a"/><ellipse cx="20" cy="28" rx="8" ry="5" fill="#b8f08a"/>' + eyes(19) + '<circle cx="17" cy="27" r="1.2" fill="' + INK + '" stroke="none"/><circle cx="23" cy="27" r="1.2" fill="' + INK + '" stroke="none"/><path d="M4 15l-2-5 6 3M36 15l2-5-6 3" fill="#3fae52"/>'),
    lock: g('<rect x="9" y="18" width="22" height="16" rx="4" fill="#bbb"/><path d="M14 18v-4a6 6 0 0 1 12 0v4" fill="none"/>')
  };
  const uiIc = k => (TCS.ui && TCS.ui.ICONS && TCS.ui.ICONS[k]) || '';
  const xFmt = m => 'x' + (Math.round(m * 100) / 100);

  /* ---------- 3D pet next to the lumberjack ---------- */
  const M = TCS.model, THREE = window.THREE;
  function makePet(id){
    const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
    const P = (t, s, c, o) => M.part(t, s, c, Object.assign({ parent: body }, o));
    const eye = (x, y, z, r) => { [-1, 1].forEach(sd => { P('sphere', [r || 0.05, 10, 8], 0x1b1b1b, { pos: [sd * x, y, z], scale: [1, 1.3, 0.6], outline: false });
      P('sphere', [(r || 0.05) * 0.35, 6, 6], 0xffffff, { pos: [sd * x + 0.015, y + 0.03, z + 0.02], outline: false }); }); };
    let wings = null, tail = null;
    if (id === 'bunny'){
      P('sphere', [0.28, 18, 14], 0xffffff, { pos: [0, 0.26, 0], scale: [1, 0.9, 1.05] });
      P('sphere', [0.22, 18, 14], 0xffffff, { pos: [0, 0.58, 0.12] });
      [-1, 1].forEach(sd => { P('capsule', [0.06, 0.32], 0xffffff, { pos: [sd * 0.09, 0.9, 0.08], rot: [-0.15, 0, sd * -0.15] });
        P('capsule', [0.03, 0.22], 0xffb3c7, { pos: [sd * 0.09, 0.9, 0.125], rot: [-0.15, 0, sd * -0.15], outline: false }); });
      eye(0.08, 0.62, 0.31); P('sphere', [0.035, 8, 6], 0xff7a9a, { pos: [0, 0.55, 0.335], outline: false });
      tail = P('sphere', [0.1, 10, 8], 0xffffff, { pos: [0, 0.25, -0.3] });
    } else if (id === 'fox'){
      P('sphere', [0.27, 18, 14], 0xff8a2a, { pos: [0, 0.3, 0], scale: [0.9, 0.85, 1.25] });
      P('sphere', [0.17, 14, 10], 0xffffff, { pos: [0, 0.33, 0.2], scale: [1, 1, 0.8], outline: false });
      P('sphere', [0.23, 18, 14], 0xff8a2a, { pos: [0, 0.62, 0.2] });
      P('cone', [0.1, 0.22, 10], 0xffffff, { pos: [0, 0.56, 0.44], rot: [Math.PI / 2, 0, 0] });
      P('sphere', [0.035, 8, 6], 0x1b1b1b, { pos: [0, 0.57, 0.55], outline: false });
      [-1, 1].forEach(sd => P('cone', [0.08, 0.2, 4], 0xff8a2a, { pos: [sd * 0.13, 0.86, 0.17], rot: [0, 0, sd * -0.25] }));
      eye(0.09, 0.67, 0.39, 0.045);
      tail = new THREE.Group(); tail.position.set(0, 0.32, -0.3); body.add(tail);
      M.part('capsule', [0.11, 0.3], 0xff8a2a, { parent: tail, pos: [0, 0.12, -0.12], rot: [-0.9, 0, 0] });
      M.part('sphere', [0.1, 10, 8], 0xffffff, { parent: tail, pos: [0, 0.27, -0.28] });
    } else {
      P('sphere', [0.3, 18, 14], 0x5ccf6a, { pos: [0, 0.34, 0], scale: [0.95, 0.9, 1.15] });
      P('sphere', [0.2, 14, 10], 0xb8f08a, { pos: [0, 0.3, 0.17], scale: [1, 1.1, 0.7], outline: false });
      P('sphere', [0.25, 18, 14], 0x5ccf6a, { pos: [0, 0.7, 0.18] });
      P('sphere', [0.13, 12, 10], 0x5ccf6a, { pos: [0, 0.63, 0.38], scale: [1.1, 0.8, 1] });
      [-1, 1].forEach(sd => { P('cone', [0.05, 0.18, 8], 0xffc83a, { pos: [sd * 0.12, 0.95, 0.12], rot: [-0.4, 0, sd * -0.3] });
        P('sphere', [0.02, 6, 6], 0x1b1b1b, { pos: [sd * 0.05, 0.66, 0.5], outline: false }); });
      eye(0.1, 0.76, 0.39, 0.05);
      wings = [-1, 1].map(sd => { const w = new THREE.Group(); w.position.set(sd * 0.2, 0.5, -0.05); body.add(w);
        M.part('box', [0.42, 0.03, 0.26, 0.02], 0x3fae52, { parent: w, pos: [sd * 0.2, 0.05, 0], rot: [0, 0, sd * 0.3] }); w.userData.sd = sd; return w; });
      tail = new THREE.Group(); tail.position.set(0, 0.26, -0.3); body.add(tail);
      M.part('cone', [0.1, 0.4, 8], 0x5ccf6a, { parent: tail, pos: [0, 0, -0.18], rot: [-Math.PI / 2 - 0.3, 0, 0] });
      M.part('cone', [0.06, 0.12, 4], 0xffc83a, { parent: tail, pos: [0, 0.08, -0.38], rot: [-0.3, 0, 0] });
    }
    try { root.add(U.blobShadow(0.32, 0.25)); } catch(e){}
    return { root, body, wings, tail, id, t: Math.random() * 6, pop: 0 };
  }
  let pet3d = null;
  function show3d(){
    const sc = TCS.scene; if (!sc || !sc.lumberjack) return;
    const id = S().loaded ? shownPet() : null;
    if (pet3d && pet3d.id === id) return;
    if (pet3d){ sc.lumberjack.root.remove(pet3d.root); try { U.forgetOutlines(pet3d.root); } catch(e){} pet3d = null; }
    if (!id) return;
    pet3d = makePet(id);
    pet3d.root.position.set(-0.9, 0, -0.9);           // lumberjack-local: at his side, on the screen-left of him
    pet3d.root.scale.setScalar(0.001);
    sc.lumberjack.root.add(pet3d.root);
  }
  function update3d(dt){
    const p = pet3d; if (!p) return;
    p.t += dt; p.pop = Math.min(1, p.pop + dt * 2.5);
    const k = p.pop < 1 ? U.ease.outBack(p.pop) : 1;
    p.root.scale.setScalar(Math.max(0.001, k * 1.15));
    if (p.wings){                                        // dragon hovers and flaps
      p.body.position.y = 0.25 + Math.sin(p.t * 3) * 0.08;
      p.wings.forEach(w => { w.rotation.z = w.userData.sd * Math.sin(p.t * 12) * 0.5; });
    } else {                                             // little hops
      const h = Math.max(0, Math.sin(p.t * 4.5));
      p.body.position.y = h * h * 0.14;
      p.body.scale.set(1 + (1 - h) * 0.06, 1 - (1 - h) * 0.06, 1);
    }
    if (p.tail) p.tail.rotation.y = Math.sin(p.t * 6) * 0.4;
    // stand on the screen-left of the lumberjack (camera-relative, so it never hides behind him) and face the camera
    const par = p.root.parent, cam = TCS.scene.camera;
    if (par && cam){
      par.getWorldPosition(tmpA); cam.getWorldDirection(tmpB); tmpB.y = 0; tmpB.normalize();   // ground-plane view direction
      tmpC.set(-tmpB.z, 0, tmpB.x);                                                            // screen-right on the ground (y-up)
      tmpA.addScaledVector(tmpC, -1.3).addScaledVector(tmpB, -0.35); tmpA.y = par.getWorldPosition(tmpD).y;
      p.root.position.copy(par.worldToLocal(tmpA));
      par.worldToLocal(camLocal.copy(cam.position));
      p.root.rotation.y = Math.atan2(camLocal.x - p.root.position.x, camLocal.z - p.root.position.z) - 0.3;
    }
  }
  const camLocal = new THREE.Vector3(), tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3(), tmpD = new THREE.Vector3();

  /* ---------- UI ---------- */
  let btn = null, panel = null, reveal = null;
  function ensureBtn(){
    if (btn && btn.isConnected) return btn;
    const box = document.getElementById('outfit-btns'); if (!box) return null;
    btn = document.createElement('button');
    btn.className = 'outfit-btn eggs-btn'; btn.title = 'Eggs (E)';
    btn.innerHTML = ART.egg;
    btn.addEventListener('pointerdown', e => e.stopPropagation());
    btn.addEventListener('click', e => { e.stopPropagation(); toggle(); });
    const qb = box.querySelector('.quests-btn');
    if (qb && qb.nextSibling) box.insertBefore(btn, qb.nextSibling); else box.appendChild(btn);
    return btn;
  }
  function render(){
    if (!panel) return;
    const s = S(), d = s.data, can = d.acorns >= D.EGG_COST, shown = shownPet();
    panel.innerHTML =
      '<div class="eg-top"><span class="eg-egg">' + ART.egg + '</span>' +
      '<button class="eg-hatch' + (can ? '' : ' off') + '"><span class="outlined outlined-sm">HATCH</span><span class="eg-cost"><i>' + uiIc('acorn') + '</i>' + D.EGG_COST + '</span></button>' +
      '<span class="eg-have"><i>' + uiIc('acorn') + '</i>' + U.fmt(Math.floor(d.acorns)) + '</span></div>' +
      D.PETS.map(p => {
        const l = level(p.id), has = l > 0;
        return '<div class="eg-pet' + (has ? ' has' : '') + (shown === p.id ? ' on' : '') + '" data-id="' + p.id + '" style="--rc:' + p.color + '">' +
          '<span class="eg-ic">' + (has ? ART[p.id] : ART.lock) + '</span>' +
          '<span class="eg-mid"><span class="eg-name">' + (has ? p.name : '???') + (has ? ' <small>Lv ' + l + (l >= D.PET_MAX ? ' MAX' : '') + '</small>' : '') + '</span>' +
          '<span class="eg-rar">' + p.rarity + ' · ' + Math.round(p.chance * 100) + '%</span></span>' +
          '<span class="eg-mult outlined outlined-sm">' + xFmt(has ? petMultOf(p.id) : p.mult) + '</span></div>';
      }).join('') +
      '<div class="eg-foot">Pets boost all logs <b>' + xFmt(s.petMult()) + '</b></div>';
  }
  function onTap(e){
    e.stopPropagation();
    if (e.target.closest('.eg-hatch')){
      if (reveal) return;
      const r = hatch();
      if (!r){ try { TCS.audio.play('denied'); } catch(err){} const b = panel.querySelector('.eg-hatch'); if (b){ b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); } return; }
      playReveal(r); render(); return;
    }
    const row = e.target.closest('.eg-pet.has'); if (row) equip(row.dataset.id);
  }
  function playReveal(r){
    const p = byId[r.id];
    reveal = document.createElement('div'); reveal.id = 'egg-reveal';
    reveal.innerHTML = '<div class="er-glow" style="--rc:' + p.color + '"></div><div class="er-egg">' + ART.egg + '</div>' +
      '<div class="er-pet">' + ART[r.id] + '</div>' +
      '<div class="er-txt"><div class="er-name outlined" style="color:' + p.color + '">' + p.name + '</div>' +
      '<div class="er-sub outlined outlined-sm">' + (r.refund ? 'Max level · +' + r.refund + ' acorns back' : r.isNew ? 'NEW! ' + p.rarity + ' · ' + xFmt(petMultOf(r.id)) + ' logs' : 'Level ' + r.level + '! ' + xFmt(petMultOf(r.id)) + ' logs') + '</div></div>';
    reveal.addEventListener('pointerdown', e => e.stopPropagation());
    reveal.addEventListener('click', e => { e.stopPropagation(); if (reveal && reveal.classList.contains('done')) endReveal(); });
    (document.getElementById('ui-layer') || document.body).appendChild(reveal);
    try { TCS.audio.play('click'); } catch(e){}
    setTimeout(() => { try { TCS.audio.play('click'); } catch(e){} }, 450);
    setTimeout(() => { if (!reveal) return; reveal.classList.add('open'); try { TCS.audio.play(p.chance < 0.1 ? 'achievement' : 'buy'); } catch(e){}
      if (r.isNew && !S().data.pet || p.chance < 0.1) S().data.pet = r.id;
      show3d(); if (pet3d && pet3d.id === r.id) pet3d.pop = 0; render(); }, 1300);
    setTimeout(() => { if (reveal) reveal.classList.add('done'); }, 1900);
    setTimeout(endReveal, 4200);
  }
  function endReveal(){ if (reveal){ reveal.remove(); reveal = null; } }
  function canShow(){
    const s = S();
    return s && s.loaded && !TCS.duel && !(TCS.friends && TCS.friends.live) && !window.__fxCine && TCS.scene && TCS.scene.mode === 'play' &&
      (!TCS.menu || !TCS.menu.screen) && !!document.getElementById('hud') && getComputedStyle(document.getElementById('hud')).display !== 'none';
  }
  function open(){
    if (!canShow()) return false;
    try { if (TCS.friends && TCS.friends.close) TCS.friends.close(); } catch(e){}
    try { if (TCS.quests && TCS.quests.close) TCS.quests.close(); } catch(e){}
    if (!panel){
      panel = document.createElement('div'); panel.id = 'eggs-panel'; panel.className = 'card-panel';
      panel.addEventListener('pointerdown', e => e.stopPropagation());
      panel.addEventListener('click', onTap);
      (document.getElementById('ui-layer') || document.body).appendChild(panel);
    }
    render(); return true;
  }
  function close(){ if (panel){ panel.remove(); panel = null; } }
  function toggle(){ return panel ? (close(), false) : open(); }

  document.addEventListener('keydown', e => {
    if (panel && (e.key === 'Escape' || e.code === 'Escape')){ e.preventDefault(); e.stopImmediatePropagation(); close(); return; }
    if (e.code !== 'KeyE' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (!panel && !canShow()) return;
    e.preventDefault(); toggle();
  }, true);
  // the friends / quests panels share the bottom-left spot: opening one closes ours
  document.addEventListener('click', e => { if (panel && e.target.closest && e.target.closest('.friends-btn,.quests-btn')) close(); }, true);
  document.addEventListener('keydown', e => { if (panel && (e.code === 'KeyQ' || e.code === 'KeyF') && !(e.target && e.target.tagName === 'INPUT')) close(); }, true);

  let lastAcorns = -1;
  bus.on('load', () => { ensureBtn(); show3d(); });
  bus.on('gameStart', () => { ensureBtn(); show3d(); });
  bus.on('unload', () => { close(); endReveal(); show3d(); });
  bus.on('logout', () => { close(); endReveal(); show3d(); });
  bus.on('menuOpen', close);
  bus.on('rebirth', () => setTimeout(show3d, 0));
  try { TCS.scene.onUpdate(update3d); } catch(e){ console.warn('eggs: no scene update hook', e); }
  setInterval(() => {
    ensureBtn();
    if (panel && !canShow()) close();
    const a = S().loaded ? Math.floor(S().data.acorns) : -1;
    if (btn) btn.classList.toggle('can', a >= D.EGG_COST);
    if (panel && a !== lastAcorns) render();
    lastAcorns = a;
  }, 500);

  TCS.eggs = { hatch, roll, equip, open, close, toggle, shownPet, petMult: id => petMultOf(id), ART,
    get panel(){ return panel; }, get btn(){ return ensureBtn(); }, get pet3d(){ return pet3d; } };
})();
