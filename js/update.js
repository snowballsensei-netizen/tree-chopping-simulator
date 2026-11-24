/* update.js — when a new release goes live, open tabs count down 10 s, save, and reload onto it (TCS.update).
   The loaded release is TCS.BUILD (index.html reads version.json at boot). Every 60 s, and when the tab comes back into view,
   version.json is fetched uncached; a different "v" starts the countdown banner. A running duel finishes first (the banner waits).
   To ship an update: bump "v" in version.json in the same commit.
   API: check() -> Promise, start(sec=10) (also a test hook), get counting() */
(function(){
  const TCS = window.TCS, bus = TCS.bus;
  const SECS = 10, EVERY = 60000;
  let el = null, left = 0, timer = null, target = null;

  function check(){
    if (!TCS.BUILD || timer) return Promise.resolve(false);
    return fetch('version.json?t=' + Date.now(), { cache: 'no-store' }).then(r => r.json()).then(r => {
      const v = r && r.v ? String(r.v) : '';
      if (v && v !== TCS.BUILD){ target = v; start(SECS); return true; }
      return false;
    }).catch(() => false);
  }
  function draw(){
    if (!el) return;
    const wait = !!TCS.duel;
    el.querySelector('.up-n').textContent = wait ? '…' : left;
    el.querySelector('.up-sub').textContent = wait ? 'after your duel' : 'saving your progress, then reloading';
  }
  function start(sec){
    if (timer) return;
    left = Math.max(1, Math.round(sec || SECS));
    el = document.createElement('div'); el.id = 'update-bar'; el.className = 'card-panel';
    el.innerHTML = '<span class="up-n outlined"></span><span class="up-txt"><b class="outlined outlined-sm">NEW UPDATE!</b><small class="up-sub"></small></span>';
    el.addEventListener('pointerdown', e => e.stopPropagation());
    (document.getElementById('ui-layer') || document.body).appendChild(el);
    draw();
    try { TCS.audio.play('toast'); } catch(e){}
    timer = setInterval(() => {
      if (TCS.duel){ draw(); return; }                 // let a duel finish first
      left--; draw();
      if (el){ const n = el.querySelector('.up-n'); n.classList.remove('tick'); void n.offsetWidth; n.classList.add('tick'); }
      if (left <= 0){ clearInterval(timer); go(); }
    }, 1000);
  }
  function go(){
    const S = TCS.state;
    try { if (S && S.loaded) S.save(); } catch(e){}
    let flushed = Promise.resolve();
    try { if (TCS.cloud && TCS.cloud.flush) flushed = Promise.resolve(TCS.cloud.flush()); } catch(e){}
    const reload = () => { try { location.reload(); } catch(e){} };
    Promise.race([flushed.catch(() => {}), new Promise(r => setTimeout(r, 3000))]).then(reload);
  }

  setInterval(check, EVERY);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });

  TCS.update = { check, start, get counting(){ return !!timer; }, get left(){ return left; }, get target(){ return target; } };
})();
