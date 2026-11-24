/* patchnotes.js — "What's new" card shown once per update to RETURNING players (anyone with tcs_* data in this browser).
   Brand-new players skip it (they're marked as seen). To announce an update: bump VERSION and edit NOTES.
   API: TCS.patchnotes.show() (force open), .VERSION */
(function(){
  const TCS = window.TCS, KEY = 'tcs_patch_seen';
  const VERSION = '2026-11-24c';
  const NOTES = [
    ['💬', 'Friend chat', 'Tap the chat bubble next to a friend to message them — no cursing allowed!'],
    ['🔥', 'Mythic Phoenix', 'A 0.5% Mythic pet is now hiding in the eggs — x5 logs'],
    ['🎮', 'Custom controls', 'Pick your own two chop buttons in Settings — any key or mouse button'],
    ['🥚', 'Pet eggs', 'Spend acorns on eggs and hatch a Bunny, Fox or rare Dragon that multiply your logs — press E'],
    ['🎯', 'Matchmaking', 'Queue up and duel 300 rival lumberjacks — win big, lose some'],
    ['📜', 'Quests', 'Daily and weekly quests with acorn rewards — press Q'],
    ['🎁', 'Daily rewards', 'Log in every day for a bigger reward — day 7 is huge'],
    ['🥇', 'Leaderboards', 'See the top 50 lumberjacks on the title screen'],
    ['🏆', 'Duel finale', 'Ready, Set, GO!, battle music while you duel, and a victory celebration for the winner'],
    ['👥', 'Friends', 'Tap the friends button (or press F) to add friends by username'],
    ['⚔️', 'Duels', 'Wager logs or acorns, then race your friend\'s lumberjack to 250 chops'],
    ['🌲', 'Easier rebirths', 'Later stages no longer get impossibly expensive'],
    ['🟢', 'Players online', 'See how many lumberjacks are chopping right now']
  ];
  const store = () => TCS.store || { get: k => { try { return localStorage.getItem(k); } catch(e){ return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch(e){} } };
  function returning(){
    try { for (let i = 0; i < localStorage.length; i++){ const k = localStorage.key(i); if (k && k.indexOf('tcs_') === 0 && k !== KEY) return true; } } catch(e){}
    return false;
  }
  let el = null;
  function close(){
    if (!el) return;
    store().set(KEY, VERSION);
    el.classList.add('out'); const e = el; el = null;
    setTimeout(() => e.remove(), 250);
    try { TCS.audio && TCS.audio.sfx && TCS.audio.sfx('click'); } catch(e){}
  }
  function show(){
    if (el) return;
    el = document.createElement('div');
    el.id = 'patch-notes';
    el.innerHTML = '<div class="pn-card card-panel" role="dialog" aria-label="What\'s new">' +
      '<h2 class="outlined">What\'s new</h2>' +
      '<ul>' + NOTES.map(n => '<li><i>' + n[0] + '</i><span><b>' + n[1] + '</b>' + n[2] + '</span></li>').join('') + '</ul>' +
      '<button class="btn btn-green pn-ok">Got it</button></div>';
    el.addEventListener('pointerdown', e => { e.stopPropagation(); if (e.target === el) close(); });
    el.querySelector('.pn-ok').onclick = close;
    (document.getElementById('ui-layer') || document.body).appendChild(el);
    setTimeout(() => { const b = el && el.querySelector('.pn-ok'); if (b) b.focus({ preventScroll: true }); }, 50);
  }
  document.addEventListener('keydown', e => { if (el && (e.key === 'Escape' || e.key === 'Enter')){ e.preventDefault(); e.stopImmediatePropagation(); close(); } }, true);
  function maybeShow(){
    if (store().get(KEY) === VERSION) return;
    if (/[?&](guest|local|emu)\b/.test(location.search) && !/[?&]patch\b/.test(location.search)) return;   // keep tests/dev quiet
    if (!returning()){ store().set(KEY, VERSION); return; }                                       // first visit ever: nothing is "new"
    show();
  }
  TCS.patchnotes = { VERSION, show, close };
  // wait for the title menu to be up, then show over it
  let tries = 0;
  (function wait(){ if (TCS.menu && (TCS.menu.screen || (TCS.state && TCS.state.loaded))) return setTimeout(maybeShow, 600); if (++tries < 120) setTimeout(wait, 250); })();
})();
