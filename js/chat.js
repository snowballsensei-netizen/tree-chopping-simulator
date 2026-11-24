/* chat.js — chat with friends (cloud accounts only), with a curse filter (TCS.chat).
   Firestore (see firestore.rules): chats/{a}_{b} (uids sorted) = {members:[a,b], last, lastFrom, lastAt}, chats/{pair}/msgs/{id} = {from, text, at}.
   Only the two members, while they are friends, can read or write; messages are 1-MAX chars, never edited or deleted.
   Filter: clean(text) masks curse words with *, catching caps, l33t spelling (sh1t, $h!t), stretched letters (fuuuck), dots and
   spaced letters (f.u.c.k / f u c k), without flagging innocent words (class, hello, Scunthorpe). Text is cleaned when sent AND
   when shown, so a modified client can't get curses onto anyone's screen.
   UI: a 💬 button on each friend row (friends panel) opens a small chat panel in the same spot; unread chats light the friends button dot
   and the row's 💬, and a new message from a friend shows a toast when that chat isn't open.
   API: clean(text), hasCurse(text), open(uid), close(), send(text) -> Promise<{ok, error?, filtered?}>, unread(uid), get openUid() */
(function(){
  const TCS = window.TCS, bus = TCS.bus;
  const MAX = 120, PAGE = 40;

  /* ---------- curse filter ---------- */
  const LEET = { '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '+': 't', '8': 'b', '9': 'g', '(': 'c', '¢': 'c', '€': 'e' };
  // anywhere inside a word (unambiguous roots)
  const ROOTS = ['fuck', 'fuk', 'fck', 'fuq', 'phuck', 'phuk', 'shit', 'shyt', 'bitch', 'biatch', 'btch', 'cunt', 'nigg', 'nigga', 'faggot', 'fagot',
    'whore', 'slut', 'bastard', 'asshole', 'arsehole', 'motherf', 'wank', 'twat', 'pussy', 'retard', 'dildo', 'porn', 'penis', 'vagina', 'boob',
    'jackass', 'dumbass', 'smartass', 'badass', 'bullshit', 'horseshit', 'goddamn', 'skank', 'cock', 'jizz'].sort((a, b) => b.length - a.length);
  // only whole words (they hide inside innocent words: cl-ass, hell-o, dick-ens, cock-atoo is handled by the safe list)
  const WORDS = new Set(['ass', 'asses', 'arse', 'dick', 'dicks', 'dik', 'damn', 'damnit', 'dammit', 'hell', 'crap', 'piss', 'pissed', 'tits', 'titty', 'titties',
    'fag', 'fags', 'hoe', 'hoes', 'sex', 'sexy', 'wtf', 'stfu', 'fu', 'fk', 'fking', 'fkin', 'omfg', 'lmfao', 'prick', 'douche', 'nig', 'thot', 'sht', 'cum', 'cums', 'cumming']);
  // innocent words that contain a root
  const SAFE = new Set(['cocktail', 'cockatoo', 'cockpit', 'cockroach', 'peacock', 'hancock', 'scunthorpe', 'cucumber', 'cumulus', 'document', 'circumstance',
    'accumulate', 'cumbersome', 'shitake', 'shiitake', 'therapist', 'cocky', 'cucumbers', 'documents', 'cumin', 'scum', 'vacuum', 'circumference', 'incumbent',
    'pussycat', 'swank', 'swanky', 'retardant', 'retardation', 'snigger', 'sniggers', 'niggle', 'niggles', 'niggling', 'boobook', 'shuttlecock', 'weathercock', 'gamecock', 'woodcock']);
  const letters = s => { let o = ''; for (const ch of s.toLowerCase()){ const c = LEET[ch] || ch; if (c >= 'a' && c <= 'z') o += c; } return o; };
  const squash = s => s.replace(/(.)\1+/g, '$1');                     // fuuuuck -> fuck
  function bad(w){
    if (!w || SAFE.has(w)) return false;
    const forms = [w, squash(w)];
    for (const f of forms){
      if (SAFE.has(f)) return false;
      if (WORDS.has(f) || WORDS.has(f.replace(/s$/, ''))) return true;
      for (const r of ROOTS) if (f.indexOf(r) >= 0) return true;
    }
    return false;
  }
  // split into tokens, merge runs of single letters ("f u c k", "f.u.c.k" stays one token), test each, mask the bad ones
  function scan(text){
    const parts = String(text).split(/(\s+)/), toks = [];
    for (let i = 0; i < parts.length; i++) if (parts[i] && !/^\s+$/.test(parts[i])) toks.push({ i, w: letters(parts[i].replace(/^["'(\[]+|[!?.,;:'")\]]+$/g, '')) });
    const hits = new Set();
    toks.forEach(t => { if (bad(t.w)) hits.add(t.i); });
    // runs of 1-letter tokens (after leet), e.g. "f u c k"
    for (let a = 0; a < toks.length; a++){
      if (toks[a].w.length !== 1) continue;
      let b = a; while (b + 1 < toks.length && toks[b + 1].w.length === 1) b++;
      if (b > a){
        const run = toks.slice(a, b + 1), word = run.map(t => t.w).join('');
        for (let s = 0; s < run.length; s++) for (let e = s + 2; e <= run.length; e++){
          if (bad(run.slice(s, e).map(t => t.w).join(''))) for (let k = s; k < e; k++) hits.add(run[k].i);
        }
        if (bad(word)) run.forEach(t => hits.add(t.i));
      }
      a = b;
    }
    return { parts, hits };
  }
  function clean(text){
    const { parts, hits } = scan(text);
    if (!hits.size) return String(text);
    return parts.map((p, i) => hits.has(i) ? p.replace(/[^\s]/g, '*') : p).join('');
  }
  const hasCurse = text => scan(text).hits.size > 0;

  /* ---------- cloud ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ms = t => t && t.toMillis ? t.toMillis() : 0;
  const sfx = n => { try { TCS.audio.play(n); } catch(e){} };
  let F = null, db = null, me = null, unChats = null, unMsgs = null;
  const chats = {};                 // pair -> {last, lastFrom, lastAt}
  let openUid = null, msgs = [], panel = null, firstLoad = true;
  const pairOf = uid => [me, uid].sort().join('_');
  const otherOf = pair => pair.split('_').find(x => x !== me);
  const readKey = () => 'tcs_chatread_' + me;
  const readMap = () => (TCS.store && TCS.store.getJSON(readKey(), {})) || {};
  function markRead(pair, at){ const m = readMap(); if (!(m[pair] >= at)){ m[pair] = at; TCS.store.setJSON(readKey(), m); } }
  function unread(uid){
    const c = chats[pairOf(uid)];
    return !!c && c.lastFrom !== me && c.lastAt > (readMap()[pairOf(uid)] || 0) && openUid !== uid;
  }
  const anyUnread = () => Object.keys(chats).some(p => { const o = otherOf(p); return o && TCS.friends.friends[o] && unread(o); });

  function start(){
    stop();
    const fb = TCS.fb; if (!fb) return;
    try { F = fb.F; db = F.getFirestore(fb.app); } catch(e){ return; }
    me = TCS.cloud.uid; firstLoad = true;
    unChats = F.onSnapshot(F.query(F.collection(db, 'chats'), F.where('members', 'array-contains', me)), qs => {
      qs.docChanges().forEach(ch => {
        const id = ch.doc.id;
        if (ch.type === 'removed'){ delete chats[id]; return; }
        const d = ch.doc.data({ serverTimestamps: 'estimate' }), prev = chats[id];
        chats[id] = { last: d.last, lastFrom: d.lastFrom, lastAt: ms(d.lastAt) };
        const o = otherOf(id), f = o && TCS.friends.friends[o];
        if (!firstLoad && !ch.doc.metadata.hasPendingWrites && d.lastFrom !== me && f && openUid !== o && (!prev || chats[id].lastAt > prev.lastAt)){
          sfx('toast');
          try { TCS.ui.toast('<b>' + esc(f.username) + '</b><br><small>' + esc(clean(d.last)) + '</small>', BUBBLE); } catch(e){}
        }
      });
      firstLoad = false;
      paintDots();
    }, e => console.warn('chats listener', e));
  }
  function stop(){
    if (unChats){ try { unChats(); } catch(e){} unChats = null; }
    closeChat(); for (const k in chats) delete chats[k]; me = null;
  }
  function listenMsgs(uid){
    if (unMsgs){ try { unMsgs(); } catch(e){} unMsgs = null; }
    msgs = [];
    const pair = pairOf(uid);
    unMsgs = F.onSnapshot(F.query(F.collection(db, 'chats', pair, 'msgs'), F.orderBy('at', 'desc'), F.limit(PAGE)), qs => {
      msgs = []; qs.forEach(d => { const m = d.data({ serverTimestamps: 'estimate' }); msgs.push({ id: d.id, from: m.from, text: m.text, at: ms(m.at) }); });
      msgs.reverse();
      if (msgs.length) markRead(pair, Math.max(msgs[msgs.length - 1].at, (chats[pair] && chats[pair].lastAt) || 0));
      drawMsgs(); paintDots();
    }, e => { console.warn('chat msgs', e); if (panel) panel.querySelector('.ch-list').innerHTML = '<div class="ch-empty">Can\'t load this chat</div>'; });
  }
  function send(text){
    const uid = openUid;
    text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX);
    if (!uid || !db || !me) return Promise.resolve({ ok: false, error: 'Not in a chat' });
    if (!text) return Promise.resolve({ ok: false, error: 'Type a message' });
    if (!TCS.friends.friends[uid]) return Promise.resolve({ ok: false, error: 'Not friends' });
    const filtered = hasCurse(text), out = clean(text), pair = pairOf(uid);
    const b = F.writeBatch(db);
    b.set(F.doc(db, 'chats', pair), { members: pair.split('_'), last: out, lastFrom: me, lastAt: F.serverTimestamp() });
    b.set(F.doc(F.collection(db, 'chats', pair, 'msgs')), { from: me, text: out, at: F.serverTimestamp() });
    return b.commit().then(() => ({ ok: true, filtered }), e => { console.warn('chat send', e); return { ok: false, error: 'Could not send' }; });
  }

  /* ---------- UI ---------- */
  const BUBBLE = '<svg viewBox="0 0 40 40"><g stroke="#1b1b1b" stroke-width="3" stroke-linejoin="round"><path d="M6 9h28v18H18l-8 7v-7H6z" fill="#8fd3ff"/>' +
    '<circle cx="14" cy="18" r="1.5" fill="#1b1b1b" stroke="none"/><circle cx="20" cy="18" r="1.5" fill="#1b1b1b" stroke="none"/><circle cx="26" cy="18" r="1.5" fill="#1b1b1b" stroke="none"/></g></svg>';
  function paintDots(){
    const fp = document.getElementById('friends-panel');
    if (fp) fp.querySelectorAll('.fr-row[data-uid]').forEach(r => { const b = r.querySelector('.fr-ic.chat'); if (b) b.classList.toggle('new', unread(r.dataset.uid)); });
    const btn = document.querySelector('.friends-btn');
    if (btn && TCS.friends.active) btn.classList.toggle('chat-dot', anyUnread());
  }
  function time(t){ if (!t) return ''; const d = new Date(t), n = new Date(); const hm = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return d.toDateString() === n.toDateString() ? hm : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + hm; }
  function drawMsgs(){
    if (!panel) return;
    const list = panel.querySelector('.ch-list'), f = TCS.friends.friends[openUid];
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    list.innerHTML = msgs.length ? msgs.map(m => '<div class="ch-msg' + (m.from === me ? ' mine' : '') + '" title="' + esc(time(m.at)) + '">' +
      '<span class="ch-txt">' + esc(clean(m.text)) + '</span></div>').join('')
      : '<div class="ch-empty">Say hi to ' + esc(f ? f.username : 'your friend') + '!</div>';
    if (atBottom || !list._init){ list.scrollTop = list.scrollHeight; list._init = true; }
  }
  function openChat(uid){
    const f = TCS.friends.friends[uid]; if (!f || !db) return false;
    try { TCS.friends.close(); } catch(e){}
    try { if (TCS.quests) TCS.quests.close(); if (TCS.eggs) TCS.eggs.close(); } catch(e){}
    openUid = uid;
    if (!panel){
      panel = document.createElement('div'); panel.id = 'chat-panel'; panel.className = 'card-panel';
      panel.innerHTML = '<div class="ch-head"><button class="ch-back" title="Back">‹</button><i class="fr-on"></i><span class="ch-name"></span><button class="ch-x" title="Close">✕</button></div>' +
        '<div class="ch-list"></div><div class="ch-warn"></div><input class="ch-in" maxlength="' + MAX + '" placeholder="MESSAGE" spellcheck="true" autocomplete="off">';
      panel.addEventListener('pointerdown', e => e.stopPropagation());
      panel.querySelector('.ch-back').addEventListener('click', e => { e.stopPropagation(); closeChat(); try { TCS.friends.open(); } catch(err){} });
      panel.querySelector('.ch-x').addEventListener('click', e => { e.stopPropagation(); closeChat(); });
      const inp = panel.querySelector('.ch-in'), warn = panel.querySelector('.ch-warn');
      inp.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Escape'){ closeChat(); return; }
        if (e.key !== 'Enter' || e.repeat) return;
        const t = inp.value; if (!t.trim()) return;
        inp.value = '';
        send(t).then(r => {
          warn.textContent = !r.ok ? r.error : r.filtered ? 'No cursing! That word was hidden.' : '';
          clearTimeout(warn._t); if (warn.textContent) warn._t = setTimeout(() => { warn.textContent = ''; }, 3500);
          if (!r.ok) inp.value = t; else sfx('click');
        });
      });
      (document.getElementById('ui-layer') || document.body).appendChild(panel);
    }
    panel.querySelector('.ch-name').textContent = f.username;
    panel.querySelector('.fr-on').classList.toggle('on', !!f.online);
    panel.querySelector('.ch-list')._init = false;
    panel.querySelector('.ch-list').innerHTML = '';
    panel.querySelector('.ch-warn').textContent = '';
    listenMsgs(uid);
    setTimeout(() => { if (panel) panel.querySelector('.ch-in').focus(); }, 0);
    paintDots();
    return true;
  }
  function closeChat(){
    if (unMsgs){ try { unMsgs(); } catch(e){} unMsgs = null; }
    openUid = null; msgs = [];
    if (panel){ if (panel.contains(document.activeElement)) document.activeElement.blur(); panel.remove(); panel = null; }
    paintDots();
  }

  // the 💬 button on friend rows (friends.js renders rows; we add the button after each render)
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('#friends-panel .fr-ic.chat'); if (!b) return;
    e.stopPropagation(); sfx('click');
    const row = b.closest('.fr-row'); if (row) openChat(row.dataset.uid);
  }, true);
  function decorate(){
    const fp = document.getElementById('friends-panel'); if (!fp || !me) return;
    const list = fp.querySelector('.fr-list');
    if (list && !list._chatObs){ list._chatObs = new MutationObserver(() => decorate()); list._chatObs.observe(list, { childList: true }); }
    if (fp.hidden) return;
    fp.querySelectorAll('.fr-row[data-uid]:not(.req):not(.wager)').forEach(r => {
      if (r.querySelector('.fr-ic.chat')) return;
      const b = document.createElement('button'); b.className = 'fr-ic chat'; b.title = 'Chat'; b.innerHTML = BUBBLE;
      const duel = r.querySelector('.fr-ic.duel'); r.insertBefore(b, duel || null);
    });
    paintDots();
  }
  // opening the friends panel / quests / eggs closes the chat (they share the bottom-left spot)
  document.addEventListener('click', e => { if (panel && e.target.closest && e.target.closest('.friends-btn,.quests-btn,.eggs-btn')) closeChat(); }, true);

  setInterval(() => {
    const on = !!(TCS.friends && TCS.friends.active && TCS.cloud && TCS.cloud.uid);
    if (on && me !== TCS.cloud.uid) start();
    else if (!on && me) stop();
    if (!me) return;
    if (openUid && !TCS.friends.friends[openUid]) closeChat();     // unfriended
    if (panel && (TCS.duel || (TCS.menu && TCS.menu.screen) || !TCS.state.loaded)) closeChat();
    decorate();
  }, 300);
  bus.on('logout', stop); bus.on('menuOpen', closeChat); bus.on('unload', closeChat);

  TCS.chat = { clean, hasCurse, open: openChat, close: closeChat, send, unread, MAX, get openUid(){ return openUid; }, get panel(){ return panel; } };
})();
