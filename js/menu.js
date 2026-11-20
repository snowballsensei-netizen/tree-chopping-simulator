/* menu.js — title screen (orbit scene + logo + left white-card panel), login / create account, 3-slot profile select.
   API: init(), open(screen?), startGame(username, slot), logout(), switchProfile(), screen
   Dev shortcut: ?guest skips the menu and plays as 'guest' slot 0. */
(function(){
  const TCS = window.TCS;
  const bus = TCS.bus;
  let root, panel, logo, screen = null;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const click = () => { try { TCS.audio.play('click'); } catch(e){} };

  const LOGO_SVG = `
<svg class="tcs-logo-svg" viewBox="0 0 640 270" xmlns="http://www.w3.org/2000/svg" aria-label="Tree Chopping Simulator">
  <defs>
    <linearGradient id="lgWood" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffd27a"/><stop offset=".55" stop-color="#f0a83c"/><stop offset="1" stop-color="#c9741f"/>
    </linearGradient>
    <linearGradient id="lgLog" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#a8683a"/><stop offset="1" stop-color="#6e3f1f"/>
    </linearGradient>
    <linearGradient id="lgBlade" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f4f8fb"/><stop offset="1" stop-color="#9fb1bf"/>
    </linearGradient>
  </defs>
  <!-- axe behind the title -->
  <g transform="translate(560 40) rotate(28)">
    <rect x="-9" y="0" width="18" height="190" rx="8" fill="#b97a43" stroke="#1b1b1b" stroke-width="6"/>
    <path d="M-8 6 L-62 -18 Q-80 30 -62 78 L-8 54 Z" fill="url(#lgBlade)" stroke="#1b1b1b" stroke-width="6" stroke-linejoin="round"/>
    <rect x="-14" y="-4" width="28" height="64" rx="6" fill="#59636b" stroke="#1b1b1b" stroke-width="6"/>
  </g>
  <!-- log banner -->
  <g>
    <rect x="70" y="150" width="480" height="96" rx="22" fill="url(#lgLog)" stroke="#1b1b1b" stroke-width="7"/>
    <path d="M110 176 H300 M330 220 H500 M160 228 H260" stroke="#4e2a12" stroke-width="5" stroke-linecap="round" opacity=".55"/>
    <ellipse cx="550" cy="198" rx="34" ry="48" fill="#f2c98a" stroke="#1b1b1b" stroke-width="7"/>
    <ellipse cx="550" cy="198" rx="20" ry="30" fill="none" stroke="#c99256" stroke-width="5"/>
    <ellipse cx="550" cy="198" rx="8" ry="12" fill="#c99256"/>
  </g>
  <text x="300" y="118" text-anchor="middle" font-family="'Patrick Hand SC', 'Comic Sans MS', sans-serif" font-size="100"
    fill="url(#lgWood)" stroke="#1b1b1b" stroke-width="12" paint-order="stroke fill" stroke-linejoin="round" letter-spacing="2">TREE CHOPPING</text>
  <text x="300" y="226" text-anchor="middle" font-family="'Patrick Hand SC', 'Comic Sans MS', sans-serif" font-size="78"
    fill="#ffffff" stroke="#1b1b1b" stroke-width="10" paint-order="stroke fill" stroke-linejoin="round" letter-spacing="6">SIMULATOR</text>
</svg>`;

  function build(){
    root = document.createElement('div');
    root.id = 'menu-root';
    root.className = 'passthrough';
    root.innerHTML = `<div class="menu-vignette"></div><div class="menu-online card-panel" aria-live="off"><i class="online-dot"></i><b class="online-n">0</b> <span><span class="online-pl">players </span>online</span></div><div class="menu-col"><div class="menu-logo">${LOGO_SVG}</div><div class="menu-panel card-panel" role="dialog"></div></div>`;
    document.getElementById('ui-layer').appendChild(root);
    logo = root.querySelector('.menu-logo');
    panel = root.querySelector('.menu-panel');
    panel.addEventListener('pointerdown', e => e.stopPropagation());
    startOnline(root.querySelector('.online-n'));
  }

  // "players online" counter: drifts slowly within 500..2200, a new value every 10 s, counted up/down over ~2 s
  const ONLINE = { MIN: 500, MAX: 2200, EVERY: 10000, TWEEN: 2000 };
  function startOnline(el){
    let shown = 900 + Math.floor(Math.random() * 900), trend = Math.random() < 0.5 ? -1 : 1, anim = 0;
    const fmt = n => Math.round(n).toLocaleString('en-US');
    el.textContent = fmt(shown);
    TCS.menu._online = () => shown;
    setInterval(() => {
      if (root.style.display === 'none') return;           // only tick while the menu is showing
      if (Math.random() < 0.25) trend = -trend;            // gentle wandering, not jitter
      let next = shown + trend * (8 + Math.floor(Math.random() * 45));
      if (next > ONLINE.MAX){ next = ONLINE.MAX - (next - ONLINE.MAX); trend = -1; }
      if (next < ONLINE.MIN){ next = ONLINE.MIN + (ONLINE.MIN - next); trend = 1; }
      const from = shown, t0 = performance.now();
      shown = next;
      cancelAnimationFrame(anim);
      const step = now => {
        const k = Math.min(1, (now - t0) / ONLINE.TWEEN), e = k * (2 - k);
        el.textContent = fmt(from + (next - from) * e);
        if (k < 1) anim = requestAnimationFrame(step);
      };
      anim = requestAnimationFrame(step);
    }, ONLINE.EVERY);
  }

  function render(name){
    screen = name;
    panel.dataset.screen = name;
    root.classList.toggle('wide', name === 'profiles');
    ({ auth: renderAuth, login: () => renderForm(false), create: () => renderForm(true), profiles: renderProfiles })[name]();
  }

  function renderAuth(){
    panel.innerHTML = `
      <button class="btn menu-btn btn-green" data-act="login">Log In</button>
      <button class="btn menu-btn" data-act="create">Create Account</button>`;
    panel.querySelector('[data-act=login]').onclick = () => { click(); render('login'); };
    panel.querySelector('[data-act=create]').onclick = () => { click(); render('create'); };
    panel.querySelector('button').focus({ preventScroll: true });
  }

  function field(id, label, type, extra){
    return `<label class="menu-field"><span class="outlined outlined-sm">${label}</span>
      <input id="${id}" type="${type}" ${extra || ''} autocomplete="off" autocapitalize="off" spellcheck="false">
      <em class="menu-err" data-for="${id}"></em></label>`;
  }

  function renderForm(isCreate){
    const last = TCS.store.get('tcs_last_user') || '';
    panel.innerHTML = `
      <h2 class="outlined">${isCreate ? 'Create Account' : 'Log In'}</h2>
      <form class="menu-form" novalidate>
        ${field('m-user', 'Username', 'text', 'maxlength="16"')}
        ${field('m-pass', 'Password', 'password')}
        ${isCreate ? field('m-pass2', 'Repeat password', 'password') : ''}
        <em class="menu-err menu-err-form"></em>
        <div class="menu-row">
          <button type="button" class="btn menu-btn btn-grey" data-act="back">Back</button>
          <button type="submit" class="btn menu-btn btn-green">${isCreate ? 'Create' : 'Log In'}</button>
        </div>
      </form>`;
    const form = panel.querySelector('form');
    const u = form.querySelector('#m-user');
    if (!isCreate && last) u.value = last;
    (u.value ? form.querySelector('#m-pass') : u).focus({ preventScroll: true });
    const setErr = (id, msg) => {
      const el = id ? form.querySelector(`.menu-err[data-for="${id}"]`) : form.querySelector('.menu-err-form');
      el.textContent = msg || '';
      if (id) form.querySelector('#' + id).classList.toggle('bad', !!msg);
    };
    const clearErrs = () => { form.querySelectorAll('.menu-err').forEach(e => e.textContent = ''); form.querySelectorAll('input').forEach(i => i.classList.remove('bad')); };
    form.querySelectorAll('input').forEach(i => i.addEventListener('input', () => { setErr(i.id, ''); setErr(null, ''); }));
    if (isCreate) u.addEventListener('blur', () => { const e = u.value && TCS.accounts.validateUsername(u.value.trim()); if (e) setErr('m-user', e); });
    form.querySelector('[data-act=back]').onclick = () => { click(); render('auth'); };
    let busy = false;
    form.onsubmit = async ev => {
      ev.preventDefault();
      if (busy) return; busy = true; click(); clearErrs();
      const user = u.value.trim(), pass = form.querySelector('#m-pass').value;
      try {
        if (isCreate){
          const r = await TCS.accounts.create(user, pass, form.querySelector('#m-pass2').value);
          if (!r.ok){ setErr({ user: 'm-user', pass: 'm-pass', pass2: 'm-pass2' }[r.field] || null, r.error); try { TCS.audio.play('denied'); } catch(e){} return; }
        } else {
          if (!user || !pass){ setErr(null, 'Wrong username or password'); try { TCS.audio.play('denied'); } catch(e){} return; }
          const r = await TCS.accounts.login(user, pass);
          if (!r.ok){ setErr(null, r.error); form.querySelector('#m-pass').value = ''; try { TCS.audio.play('denied'); } catch(e){} return; }
        }
        TCS.store.set('tcs_last_user', TCS.accounts.current);
        render('profiles');
      } finally { busy = false; }
    };
  }

  function renderProfiles(){
    const user = TCS.accounts.current;
    const U = TCS.util;
    const CL = TCS.cloud && TCS.cloud.active ? TCS.cloud : null;
    // cloud mode: tiny cloud / offline icon next to the name (nothing in local mode)
    const ico = CL ? `<span class="cloud-ico${CL.online ? '' : ' off'}" title="${CL.online ? 'Cloud save' : 'Offline'}"><svg viewBox="0 0 24 16" width="22" height="15" aria-hidden="true"><path d="M6 15h12a4.5 4.5 0 0 0 .6-9 6 6 0 0 0-11.5 1.6A3.7 3.7 0 0 0 6 15z" fill="#fff" stroke="#1b1b1b" stroke-width="2" stroke-linejoin="round"/><path class="slash" d="M4 1l16 14" stroke="#1b1b1b" stroke-width="2.4" stroke-linecap="round"/></svg></span>` : '';
    let html = `<div class="menu-head"><h2 class="outlined">${esc(user)}${ico}</h2>
      <button class="btn menu-btn btn-grey btn-small" data-act="logout">Log Out</button></div><div class="slots">`;
    for (let s = 0; s < 3; s++){
      const info = TCS.state.slotInfo(user, s);
      if (!info){
        html += `<button class="slot slot-empty" data-slot="${s}" data-act="new"><span class="outlined">New Game</span></button>`;
      } else {
        html += `<div class="slot" data-slot="${s}">
          <input class="slot-name" maxlength="20" value="${esc(info.profileName || ('Profile ' + (s + 1)))}" aria-label="Profile name">
          <div class="slot-stats">
            <span><b>Wood</b>${esc(U.fmt(info.lifetimeWood))}</span>
            <span><b>Rebirths</b>${info.rebirths}</span>
            <span><b>Tree</b>${esc(info.species)}</span>
            <span><b>Time</b>${esc(U.fmtTime(info.playTime))}</span>
          </div>
          <div class="slot-actions">
            <button class="btn btn-green btn-small" data-act="play">Play</button>
            <button class="btn btn-red btn-small" data-act="delete">Delete</button>
          </div>
          <div class="slot-confirm" hidden>
            <span class="outlined outlined-sm">Delete forever?</span>
            <button class="btn btn-red btn-small" data-act="yes">Yes</button>
            <button class="btn btn-grey btn-small" data-act="no">No</button>
          </div>
        </div>`;
      }
    }
    panel.innerHTML = html + '</div>';
    if (CL && !renderProfiles.syncing){
      renderProfiles.syncing = true;
      CL.syncSlots().then(changed => {
        renderProfiles.syncing = false;
        if (changed && screen === 'profiles' && TCS.accounts.current === user && !panel.contains(document.activeElement)) renderProfiles.again();
      });
    }
    panel.querySelector('[data-act=logout]').onclick = () => { click(); A_logout(); };
    panel.querySelectorAll('[data-slot]').forEach(el => {
      const slot = +el.dataset.slot;
      if (el.dataset.act === 'new'){
        el.onclick = () => { click(); TCS.state.newGame(user, slot, 'Profile ' + (slot + 1)); enterGame(user, slot); };
        return;
      }
      const name = el.querySelector('.slot-name');
      const commit = () => { const v = name.value.trim().slice(0, 20); if (v) TCS.state.renameSlot(user, slot, v); else name.value = TCS.state.slotInfo(user, slot).profileName; };
      name.addEventListener('change', commit);
      name.addEventListener('keydown', e => { if (e.key === 'Enter') name.blur(); });
      const confirmBox = el.querySelector('.slot-confirm'), actions = el.querySelector('.slot-actions');
      el.querySelector('[data-act=play]').onclick = () => { click(); commit(); TCS.menu.startGame(user, slot); };
      el.querySelector('[data-act=delete]').onclick = () => { click(); actions.hidden = true; confirmBox.hidden = false; confirmBox.querySelector('[data-act=no]').focus({ preventScroll: true }); };
      confirmBox.querySelector('[data-act=no]').onclick = () => { click(); confirmBox.hidden = true; actions.hidden = false; };
      confirmBox.querySelector('[data-act=yes]').onclick = () => { click(); TCS.state.deleteSlot(user, slot); renderProfiles(); };
    });
  }

  renderProfiles.again = () => { renderProfiles.syncing = true; try { renderProfiles(); } finally { renderProfiles.syncing = false; } };
  bus.on('cloudStatus', e => { const i = panel && panel.querySelector('.cloud-ico'); if (i){ i.classList.toggle('off', !e.online); i.title = e.online ? 'Cloud save' : 'Offline'; } });

  // a restored session that arrived after the menu already opened (slow network): go to profile select
  bus.on('cloudUser', () => { if (screen === 'auth' && root && root.style.display !== 'none') render('profiles'); });

  function A_logout(){
    TCS.accounts.logout(); // unloads + emits 'logout'
    show(); render('auth');
  }

  function show(){
    TCS.paused = true;
    root.style.display = '';
    try { TCS.scene.setMode('orbit'); } catch(e){ console.error(e); }
    try { TCS.ui.show(false); } catch(e){ console.error(e); }
  }

  function enterGame(username, slot){
    root.style.display = 'none';
    screen = null;
    TCS.paused = false;
    TCS.scene.setMode('play');
    TCS.ui.show(true);
    try { TCS.audio.startMusic(); } catch(e){}
    bus.emit('gameStart', { username, slot });
  }

  TCS.menu = {
    get screen(){ return screen; },
    init(){
      build();
      if (/[?&]guest\b/.test(location.search)){ TCS.menu.startGame('guest', 0); return; }
      if (TCS.cloud && TCS.cloud.active){ show(); TCS.cloud.ready.then(() => { if (screen === null && !TCS.state.loaded) TCS.menu.open(); }); return; }
      TCS.menu.open();
    },
    // open(screen?): show the title menu. Defaults to profile select when logged in, else Log In / Create.
    open(name){
      if (!root) build();
      if (TCS.state.loaded) TCS.state.unload();
      show();
      render(name || (TCS.accounts.current ? 'profiles' : 'auth'));
      bus.emit('menuOpen');
    },
    startGame(username, slot){
      const CL = TCS.cloud;
      if (CL && CL.active && CL.uid && username === CL.username && !TCS.menu._pulled){
        // pull the newest cloud copy of this slot first (falls back to the local cache when offline)
        return CL.pullSlot(slot).finally(() => { TCS.menu._pulled = true; try { TCS.menu.startGame(username, slot); } finally { TCS.menu._pulled = false; } });
      }
      TCS.accounts.current = username;
      TCS.state.load(username, slot);
      enterGame(username, slot);
    },
    // for the settings / pause panel
    switchProfile(){ if (TCS.state.loaded) TCS.state.save(); TCS.menu.open(TCS.accounts.current ? 'profiles' : 'auth'); },
    logout(){ if (TCS.state.loaded) TCS.state.save(); if (!root) build(); A_logout(); bus.emit('menuOpen'); }
  };
})();
