/* main.js — phase 1. Boot order, game loop, input wiring. Loaded last. */
(function(){
  const TCS = window.TCS;
  const bus = TCS.bus, S = TCS.state, SC = TCS.scene;

  function safe(fn, label){ try { fn(); } catch(e){ console.error('init ' + label, e); } }

  // boot: ui -> 3d upgrades -> fx -> menu (menu starts or loads a profile)
  safe(() => TCS.ui.init(), 'ui');
  safe(() => TCS.upgrades3d.init(), 'upgrades3d');
  safe(() => TCS.fx.init(), 'fx');

  // wiring
  bus.on('owned', owned => { try { TCS.upgrades3d.sync(owned); } catch(e){ console.error(e); } });
  bus.on('chop', e => { if (SC.mode === 'play'){ TCS.audio.play('chop'); try { TCS.upgrades3d.onClick(e); } catch(err){ console.error(err); } } });
  bus.on('buy', () => TCS.audio.play('buy'));
  bus.on('segment', () => TCS.audio.play('log'));
  bus.on('achievement', () => TCS.audio.play('achievement'));
  bus.on('load', () => { try { TCS.fx.applyEquipped(); } catch(e){ console.error(e); } });
  bus.on('equip', () => { try { TCS.fx.applyEquipped(); } catch(e){ console.error(e); } });

  function canPlay(){ return S.loaded && SC.mode === 'play' && !TCS.paused; }
  bus.on('treeClick', () => { if (canPlay()) S.chop('click'); });
  window.addEventListener('keydown', e => {
    if (e.repeat || e.ctrlKey || e.metaKey || !(TCS.binds ? TCS.binds.key(e) : e.code === 'Space')) return;   // chop keys (binds.js)
    const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (TCS.binds && TCS.binds.capturing) return;
    e.preventDefault();
    if (canPlay()) S.chop('space');
  });
  const unlock = () => { TCS.audio.unlock(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);
  window.addEventListener('contextmenu', e => { if (e.target === SC.renderer.domElement) e.preventDefault(); });

  // game loop
  let last = performance.now();
  TCS.paused = false;
  function frame(now){
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000; last = now;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.25){ // tab was in background: credit income, but clamp animation step
      if (S.loaded && !TCS.paused) S.tick(dt);
      dt = 0.25;
    } else if (S.loaded && !TCS.paused) S.tick(dt);
    try { SC.update(dt); } catch(e){ console.error(e); }
    try { TCS.upgrades3d.update(dt); } catch(e){ console.error(e); }
    try { TCS.fx.update(dt); } catch(e){ console.error(e); }
    try { TCS.ui.update(dt); } catch(e){ console.error(e); }
    SC.render();
  }

  safe(() => S.startAutosave(), 'autosave');
  safe(() => TCS.menu.init(), 'menu');
  safe(() => TCS.leaderboard && TCS.leaderboard.init(), 'leaderboard');
  requestAnimationFrame(frame);
  TCS.ready = true;
  bus.emit('ready');
})();
