/* friends.js — friends + friend duels (cloud accounts only; hidden in local mode / offline).
   Firestore (see firestore.rules):
     friendReqs/{from}_{to} = {from, to, fromName, at}         sender creates; recipient accepts (batch: both friends docs + delete) or declines
     friends/{uid}/list/{other} = {uid, username, at}         both sides written by the recipient on accept
     presence/{uid} = {username, lastSeen, wood, acorns}      every 60 s while playing (online dot + balances the duel rules check)
     duels/{id} = {a, b, aName, bName, kind:'logs'|'acorns', amount, status, createdAt, startAt, ta, tb, pa, pb, winner, endAt, paidA, paidB}
   Duel: pending (2 min) -> accepted (3-2-1, then chop DUEL_HP times) -> done (winner via transaction). Each player writes only
   its own pa/ta (<= 4/s + 3 s heartbeat). Payout once per player: S.data.duelsPaid ids + paidA/paidB on the doc.
   UI: friends button next to the outfit buttons + F, one compact panel, incoming duel cards, duel overlay, one-line result.
   API (TCS.friends): active, friends, incoming, duels, live, request(name), accept(uid), decline(uid), remove(uid),
        challenge(uid, kind, amount), acceptDuel(id), declineDuel(id), chop(), toggle(), open(), close() */
(function(){
  const TCS = window.TCS, bus = TCS.bus, D = TCS.data, U = TCS.util;
  const FR = TCS.friends = { active: false, friends: {}, incoming: {}, duels: {}, live: null };
  const C = TCS.cloud, fb = TCS.fb;
  if (!C || !C.active || !fb) return;
  const F = fb.F;
  let db; try { db = F.getFirestore(fb.app); } catch(e){ return; }

  const HP = D.DUEL_HP || 100, CPS = D.DUEL_MAX_CPS || 20, CD = (D.DUEL_COUNTDOWN || 3) * 1000;
  const EXPIRE = (D.DUEL_EXPIRE || 120) * 1000, FORFEIT = (D.DUEL_FORFEIT || 15) * 1000, ONLINE_MS = 150000;
  const S = () => TCS.state;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const ms = t => t && t.toMillis ? t.toMillis() : 0;
  const err = e => ({ ok: false, error: e });
  const sfx = n => { try { TCS.audio.play(n); } catch(e){} };
  const icon = k => (TCS.ui && TCS.ui.ICONS && TCS.ui.ICONS[k === 'acorns' ? 'acorn' : 'log']) || '';
  const unit = (k, n) => k === 'acorns' ? (n === 1 ? 'acorn' : 'acorns') : 'logs';
  const bal = k => { const d = S().data; return k === 'acorns' ? d.acorns : d.wood; };
  const parseAmount = v => {
    v = String(v || '').trim().toLowerCase().replace(/[,\s]/g, '');
    const m = v.match(/^(\d*\.?\d+(?:e\d+)?)([a-z]*)$/); if (!m) return NaN;
    const suf = { '': 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12, qa: 1e15, qi: 1e18, sx: 1e21, sp: 1e24, oc: 1e27, no: 1e30, dc: 1e33 }[m[2]];
    return suf ? Math.floor(parseFloat(m[1]) * suf) : NaN;
  };
  FR.parseAmount = parseAmount;
  FR.writePresence = () => writePresence();

  let me = null, unsubs = [], presTimer = null, ui = null;
  const dref = id => F.doc(db, 'duels', id);

  /* ---------- lifecycle ---------- */
  function start(){
    stop();
    me = C.uid; FR.active = true;
    const L = (q, fn) => unsubs.push(F.onSnapshot(q, fn, e => console.warn('friends listener', e)));
    L(F.collection(db, 'friends', me, 'list'), qs => {
      const next = {};
      qs.forEach(d => { const o = FR.friends[d.id] || {}; next[d.id] = Object.assign(o, { uid: d.id, username: d.data().username }); });
      FR.friends = next; refreshPresence(); render();
    });
    L(F.query(F.collection(db, 'friendReqs'), F.where('to', '==', me)), qs => {
      const next = {}; qs.forEach(d => { const r = d.data(); next[r.from] = { uid: r.from, username: r.fromName }; });
      const fresh = Object.keys(next).some(k => !FR.incoming[k]);
      FR.incoming = next; render();
      if (fresh) sfx('toast');
    });
    const onDuels = qs => qs.docChanges().forEach(ch => {
      const id = ch.doc.id;
      if (ch.type === 'removed'){ delete FR.duels[id]; renderCards(); return; }
      FR.duels[id] = Object.assign(ch.doc.data({ serverTimestamps: 'estimate' }), { id });
      if (!ch.doc.metadata.hasPendingWrites) process(FR.duels[id]);   // only act on server-confirmed state
    });
    L(F.query(F.collection(db, 'duels'), F.where('a', '==', me)), onDuels);
    L(F.query(F.collection(db, 'duels'), F.where('b', '==', me)), onDuels);
    writePresence();
    presTimer = setInterval(() => { writePresence(); refreshPresence(); sweep(); }, 60000);
    render();
  }
  function stop(){
    if (FR.live) endLive(true);
    unsubs.forEach(u => { try { u(); } catch(e){} }); unsubs = [];
    if (presTimer){ clearInterval(presTimer); presTimer = null; }
    // withdraw my own unanswered challenges
    Object.values(FR.duels).forEach(d => { if (d.a === me && d.status === 'pending') F.updateDoc(dref(d.id), { status: 'cancelled' }).catch(() => {}); });
    FR.active = false; FR.friends = {}; FR.incoming = {}; FR.duels = {}; me = null;
    close(); render(); renderCards();
  }
  bus.on('load', e => { if (C.uid && e && e.profile && e.profile.username === C.username && db) start(); });
  bus.on('unload', stop);
  bus.on('logout', stop);

  /* ---------- presence ---------- */
  function writePresence(){
    if (!FR.active || !S().loaded) return Promise.resolve();
    const d = S().data;
    return F.setDoc(F.doc(db, 'presence', me), { username: C.username, lastSeen: F.serverTimestamp(), wood: Math.floor(d.wood) || 0, acorns: Math.floor(d.acorns) || 0 }).catch(() => {});
  }
  async function presenceOf(uid){
    try { const s = await F.getDoc(F.doc(db, 'presence', uid)); return s.exists() ? s.data() : null; } catch(e){ return null; }
  }
  function refreshPresence(){
    Object.keys(FR.friends).forEach(uid => presenceOf(uid).then(p => {
      const f = FR.friends[uid]; if (!f) return;
      const on = !!p && Date.now() - ms(p.lastSeen) < ONLINE_MS;
      if (f.online !== on){ f.online = on; render(); }
    }));
  }

  /* ---------- friends ---------- */
  FR.request = async function(name){
    if (!FR.active) return err('Offline');
    const lower = String(name || '').trim().toLowerCase();
    if (!/^[a-z0-9_]{3,16}$/.test(lower)) return err('Enter a username');
    if (lower === String(C.username).toLowerCase()) return err("That's you!");
    let to;
    try { const s = await F.getDoc(F.doc(db, 'usernames', lower)); if (!s.exists()) return err('No such player'); to = s.data().uid; }
    catch(e){ return err('Offline'); }
    if (FR.friends[to]) return err('Already friends');
    if (FR.incoming[to]) return FR.accept(to);
    try {
      const ref = F.doc(db, 'friendReqs', me + '_' + to);
      if ((await F.getDoc(ref)).exists()) return err('Already sent');
      await F.setDoc(ref, { from: me, to, fromName: C.username, at: F.serverTimestamp() });
      return { ok: true, sent: true };
    } catch(e){ return err('Could not send'); }
  };
  FR.accept = async function(from){
    const r = FR.incoming[from]; if (!r) return err('No request');
    try {
      const b = F.writeBatch(db);
      b.set(F.doc(db, 'friends', me, 'list', from), { uid: from, username: r.username, at: F.serverTimestamp() });
      b.set(F.doc(db, 'friends', from, 'list', me), { uid: me, username: C.username, at: F.serverTimestamp() });
      b.delete(F.doc(db, 'friendReqs', from + '_' + me));
      await b.commit();
      return { ok: true, accepted: true };
    } catch(e){ console.warn(e); return err('Could not accept'); }
  };
  FR.decline = function(from){ return F.deleteDoc(F.doc(db, 'friendReqs', from + '_' + me)).then(() => ({ ok: true }), () => err('Failed')); };
  FR.remove = async function(uid){
    try {
      await Promise.all([F.deleteDoc(F.doc(db, 'friends', me, 'list', uid)), F.deleteDoc(F.doc(db, 'friends', uid, 'list', me))]);
      return { ok: true };
    } catch(e){ return err('Failed'); }
  };

  /* ---------- duels: send / answer ---------- */
  const busy = () => Object.values(FR.duels).some(d => d.status === 'accepted' && !d.winner) || !!FR.live;
  FR.challenge = async function(uid, kind, amount){
    const f = FR.friends[uid];
    if (!FR.active || !f) return err('Not a friend');
    kind = kind === 'acorns' ? 'acorns' : 'logs';
    amount = typeof amount === 'string' ? parseAmount(amount) : Math.floor(amount);
    if (!(amount > 0)) return err('Enter an amount');
    if (bal(kind) < amount) return err('Not enough ' + unit(kind));
    if (busy()) return err('Already in a duel');
    if (Object.values(FR.duels).some(d => d.a === me && d.b === uid && d.status === 'pending')) return err('Already challenged');
    const p = await presenceOf(uid);
    if (!p || (kind === 'acorns' ? p.acorns : p.wood) < amount) return err(f.username + " can't match that");
    await writePresence();
    try {
      const ref = await F.addDoc(F.collection(db, 'duels'), { a: me, b: uid, aName: C.username, bName: f.username, kind, amount,
        status: 'pending', createdAt: F.serverTimestamp(), startAt: null, ta: null, tb: null, pa: 0, pb: 0, winner: '', endAt: null, paidA: false, paidB: false });
      return { ok: true, id: ref.id };
    } catch(e){ console.warn(e); return err('Could not send'); }
  };
  FR.acceptDuel = async function(id){
    const d = FR.duels[id];
    if (!d || d.b !== me || d.status !== 'pending') return err('Gone');
    if (Date.now() - ms(d.createdAt) > EXPIRE) return err('Expired');
    if (bal(d.kind) < d.amount) return err('Not enough ' + unit(d.kind));
    if (busy()) return err('Already in a duel');
    const p = await presenceOf(d.a);
    if (!p || (d.kind === 'acorns' ? p.acorns : p.wood) < d.amount) return err(d.aName + " can't pay that now");
    await writePresence();
    try { const st = F.serverTimestamp(); await F.updateDoc(dref(id), { status: 'accepted', startAt: st, ta: st, tb: st }); return { ok: true }; }
    catch(e){ console.warn(e); return err('Could not accept'); }
  };
  FR.declineDuel = id => F.updateDoc(dref(id), { status: 'declined' }).then(() => ({ ok: true }), () => err('Failed'));

  // react to every duel doc change
  function process(d){
    const now = Date.now(), mine = d.a === me;
    if (d.status === 'pending'){
      if (now - ms(d.createdAt) > EXPIRE + 5000) F.deleteDoc(dref(d.id)).catch(() => {});
    } else if (d.status === 'declined'){
      if (mine){ toast(esc(d.bName) + ' declined'); F.deleteDoc(dref(d.id)).catch(() => {}); }
    } else if (d.status === 'cancelled'){
      if (FR.live && FR.live.id === d.id){ endLive(true); toast('Duel cancelled'); }
      F.deleteDoc(dref(d.id)).catch(() => {});
    } else if (d.status === 'accepted'){
      if (!FR.live) enterLive(d);
      else if (FR.live.id === d.id) liveSnap(d);
    } else if (d.status === 'done'){
      if (FR.live && FR.live.id === d.id) liveSnap(d);
      payout(d);
    }
    renderCards(); render();
  }
  function sweep(){ Object.values(FR.duels).forEach(process); }

  /* ---------- payout (exactly once per player) ---------- */
  const paying = {};
  async function payout(d){
    const side = d.a === me ? 'A' : 'B', flag = 'paid' + side;
    if (d[flag] || paying[d.id] || !S().loaded){ if (d[flag] && FR.live && FR.live.id === d.id && !(ui && ui.ov && ui.ov._res)) endLive(); return maybeDelete(d); }
    paying[d.id] = true;
    // pay from the server's copy only (never from a local, unconfirmed write)
    try { const snap = await F.getDocFromServer(dref(d.id)); if (!snap.exists() || snap.data().status !== 'done' || snap.data()[flag]){ paying[d.id] = false; return; } d = Object.assign(snap.data(), { id: d.id }); }
    catch(e){ paying[d.id] = false; return; }
    if (!S().loaded || C.uid !== me){ paying[d.id] = false; return; }
    const s = S(), data = s.data;
    const list = data.duelsPaid = Array.isArray(data.duelsPaid) ? data.duelsPaid : [];
    const won = d.winner === me;
    if (list.indexOf(d.id) < 0){
      let delta = d.amount;
      if (d.kind === 'acorns'){ if (won) data.acorns += delta; else { delta = Math.min(delta, data.acorns); data.acorns -= delta; } }
      else { if (won) data.wood += delta; else { delta = Math.min(delta, data.wood); data.wood = Math.max(0, data.wood - delta); } }
      list.push(d.id); if (list.length > 50) list.splice(0, list.length - 50);
      s.save();
      try { await C.flush(); } catch(e){}
      const msg = (won ? 'You won +' : 'You lost −') + U.fmt(d.amount) + ' ' + unit(d.kind, d.amount);
      bus.emit('duelResult', { id: d.id, won, kind: d.kind, amount: d.amount });
      if (FR.live && FR.live.id === d.id) showResult(msg, won); else toast(esc(msg));
      writePresence();
    }
    try { await F.updateDoc(dref(d.id), { [flag]: true }); } catch(e){ paying[d.id] = false; return; }
    d[flag] = true;
    if (FR.live && FR.live.id === d.id && !(ui && ui.ov && ui.ov._res)) endLive();
    maybeDelete(d);
  }
  function maybeDelete(d){ if (d.status === 'done' && d.paidA && d.paidB) F.deleteDoc(dref(d.id)).catch(() => {}); }

  /* ---------- live duel ---------- */
  function enterLive(d){
    const side = d.a === me ? 'a' : 'b', o = side === 'a' ? 'b' : 'a';
    const now = performance.now(), since = Math.max(0, Date.now() - ms(d.startAt));
    const L = FR.live = { id: d.id, d, side, p: 'p' + side, t: 't' + side, op: 'p' + o, ot: 't' + o,
      opName: side === 'a' ? d.bName : d.aName, kind: d.kind, amount: d.amount,
      mine: d['p' + side] || 0, sent: d['p' + side] || 0, opp: d['p' + o] || 0, oppT: ms(d['t' + o]), oppSeen: now,
      goAt: now + Math.max(0, CD - since), clicks: [], lastWrite: 0, finishing: false, lastForfeit: 0, done: false };
    TCS.duel = true;
    close();
    buildOverlay();
    // challenger: re-check my balance now that it's on (abort during the countdown if it's gone)
    if (side === 'a' && bal(d.kind) < d.amount) F.updateDoc(dref(d.id), { status: 'cancelled' }).catch(() => {});
    L.timer = setInterval(liveTick, 100);
    liveTick();
  }
  function liveSnap(d){
    const L = FR.live; L.d = d;
    if (d[L.op] !== L.opp || ms(d[L.ot]) !== L.oppT){ L.opp = d[L.op] || 0; L.oppT = ms(d[L.ot]); L.oppSeen = performance.now(); }
    if (d.status === 'done') L.done = true;
    drawLive();
  }
  function liveTick(){
    const L = FR.live; if (!L || L.done) return;
    const now = performance.now();
    if (now >= L.goAt){
      if (L.mine !== L.sent ? now - L.lastWrite >= 250 : now - L.lastWrite >= 3000) writeProgress();
      if (now - L.oppSeen > FORFEIT && now - L.goAt > FORFEIT && now - L.lastForfeit > 2000){ L.lastForfeit = now; finish(); }
    }
    drawLive();
  }
  function writeProgress(){
    const L = FR.live; L.lastWrite = performance.now(); const n = L.mine;
    F.updateDoc(dref(L.id), { [L.p]: n, [L.t]: F.serverTimestamp() }).then(() => { if (FR.live === L && L.sent < n) L.sent = n; }, () => {});
  }
  // the first finisher (or a forfeit claim) wins: one transaction, so exactly one winner is recorded
  function finish(){
    const L = FR.live; if (!L || L.finishing || L.done) return;
    L.finishing = true;
    const ref = dref(L.id), n = L.mine;
    F.runTransaction(db, async tx => {
      const s = await tx.get(ref);
      if (!s.exists() || s.data().status !== 'accepted') return false;
      tx.update(ref, { status: 'done', winner: me, endAt: F.serverTimestamp(), [L.p]: n, [L.t]: F.serverTimestamp() });
      return true;
    }).catch(e => { console.warn('duel finish', e && e.code); })
      .then(() => { L.finishing = false; if (FR.live === L && !L.done && L.mine >= HP) setTimeout(finish, 500); });
  }
  FR.chop = function(){
    const L = FR.live; if (!L || L.done || L.mine >= HP) return false;
    const now = performance.now(); if (now < L.goAt) return false;
    L.clicks = L.clicks.filter(t => now - t < 1000);
    if (L.clicks.length >= CPS || L.mine >= CPS * (now - L.goAt) / 1000 + 5) return false;   // anti-cheat: plausible click rate only
    L.clicks.push(now); L.mine++;
    sfx('chop');
    if (ui && ui.tree){ ui.tree.classList.remove('hit'); void ui.tree.offsetWidth; ui.tree.classList.add('hit'); }
    if (L.mine >= HP) finish();
    drawLive();
    return true;
  };
  function endLive(silent){
    const L = FR.live; if (!L) return;
    clearInterval(L.timer); FR.live = null; TCS.duel = false;
    if (ui && ui.ov){ ui.ov.remove(); ui.ov = null; }
    if (!silent) render();
  }

  /* ---------- UI ---------- */
  const PEOPLE = '<svg viewBox="0 0 40 40"><g stroke="#1b1b1b" stroke-width="3" stroke-linejoin="round"><circle cx="14" cy="14" r="6" fill="#ffc83a"/><path d="M3 33c0-8 5-11 11-11s11 3 11 11z" fill="#5ec2ff"/><circle cx="27" cy="12" r="5" fill="#ff8fb1"/><path d="M24 20c7-1 13 3 13 11h-9" fill="#6fd043"/></g></svg>';
  function toast(html){ try { TCS.ui.toast(html, PEOPLE); } catch(e){} }
  function layer(){ return document.getElementById('ui-layer'); }
  function stopP(e){ e.stopPropagation(); }
  function buildUi(){
    if (ui || !layer()) return ui;
    const box = document.getElementById('outfit-btns') || layer();
    const btn = document.createElement('button');
    btn.className = 'outfit-btn friends-btn'; btn.title = 'Friends (F)'; btn.innerHTML = PEOPLE + '<i class="fr-dot"></i>';
    btn.addEventListener('click', e => { e.stopPropagation(); FR.toggle(); });
    btn.addEventListener('pointerdown', stopP);
    box.appendChild(btn);
    const panel = document.createElement('div');
    panel.id = 'friends-panel'; panel.className = 'card-panel'; panel.hidden = true;
    panel.innerHTML = '<input class="fr-add" maxlength="16" placeholder="ADD FRIEND" spellcheck="false" autocomplete="off"><div class="fr-msg outlined outlined-sm"></div><div class="fr-list"></div>';
    panel.addEventListener('pointerdown', stopP);
    layer().appendChild(panel);
    const cards = document.createElement('div'); cards.id = 'duel-cards'; cards.addEventListener('pointerdown', stopP);
    layer().appendChild(cards);
    ui = { btn, panel, cards, input: panel.querySelector('.fr-add'), msg: panel.querySelector('.fr-msg'), list: panel.querySelector('.fr-list'), ov: null };
    ui.input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') return close();
      if (e.key !== 'Enter') return;
      const v = ui.input.value; say('...');
      FR.request(v).then(r => { say(r.ok ? (r.accepted ? 'Friends!' : 'Request sent') : r.error); if (r.ok) ui.input.value = ''; });
    });
    ui.list.addEventListener('click', onListClick);
    return ui;
  }
  function say(t){ if (ui){ ui.msg.textContent = t || ''; clearTimeout(say.t); if (t && t !== '...') say.t = setTimeout(() => { ui.msg.textContent = ''; }, 3500); } }
  let editing = null; // uid of the row showing the wager input
  function render(){
    if (!buildUi()) return;
    const vis = FR.active && S().loaded;
    ui.btn.style.display = vis ? '' : 'none';
    const pend = Object.keys(FR.incoming).length + Object.values(FR.duels).filter(incomingDuel).length;
    ui.btn.classList.toggle('dot', vis && pend > 0);
    if (!vis){ ui.panel.hidden = true; return; }
    if (ui.panel.hidden || editing) return;
    const req = Object.values(FR.incoming).map(r => '<div class="fr-row req" data-uid="' + esc(r.uid) + '"><span class="fr-name">' + esc(r.username) + '</span>' +
      '<button class="fr-ic ok" data-act="acc" title="Accept">✓</button><button class="fr-ic no" data-act="dec" title="Decline">✕</button></div>').join('');
    const fr = Object.values(FR.friends).sort((a, b) => (!!b.online - !!a.online) || a.username.localeCompare(b.username)).map(f =>
      '<div class="fr-row" data-uid="' + esc(f.uid) + '"><i class="fr-on' + (f.online ? ' on' : '') + '"></i><span class="fr-name">' + esc(f.username) + '</span>' +
      '<button class="fr-x" data-act="rm" title="Remove friend">×</button><button class="fr-ic duel" data-act="duel" title="Challenge">⚔</button></div>').join('');
    ui.list.innerHTML = req + fr;
    ui.list.querySelectorAll('.fr-row:not(.req)').forEach(row => {   // long-press reveals the tiny remove ×
      let t = null;
      row.addEventListener('pointerdown', () => { t = setTimeout(() => row.classList.add('show-x'), 550); });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => row.addEventListener(ev, () => clearTimeout(t)));
    });
  }
  function onListClick(e){
    const b = e.target.closest('button'); if (!b) return;
    const row = b.closest('.fr-row'), uid = row && row.dataset.uid, act = b.dataset.act;
    sfx('click');
    if (act === 'acc') FR.accept(uid).then(r => say(r.ok ? 'Friends!' : r.error));
    else if (act === 'dec') FR.decline(uid);
    else if (act === 'rm') FR.remove(uid);
    else if (act === 'duel') wagerRow(row, uid);
    else if (act === 'kind'){ row._kind = row._kind === 'acorns' ? 'logs' : 'acorns'; b.innerHTML = icon(row._kind); b.title = row._kind; row.querySelector('input').focus(); }
  }
  function wagerRow(row, uid){
    editing = uid; row._kind = 'logs'; row.classList.add('wager');
    row.innerHTML = '<span class="fr-name">' + esc(FR.friends[uid].username) + '</span><input class="fr-amt" placeholder="AMOUNT" maxlength="12" spellcheck="false" autocomplete="off">' +
      '<button class="fr-ic kind" data-act="kind" title="logs">' + icon('logs') + '</button>';
    const inp = row.querySelector('input'); inp.focus();
    const done = () => { editing = null; render(); };
    inp.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') return done();
      if (e.key !== 'Enter') return;
      say('...');
      FR.challenge(uid, row._kind, inp.value).then(r => { say(r.ok ? 'Challenge sent' : r.error); if (r.ok) done(); });
    });
    inp.addEventListener('blur', () => setTimeout(() => { if (editing === uid && !row.contains(document.activeElement)) done(); }, 150));
  }
  const incomingDuel = d => d.b === me && d.status === 'pending' && Date.now() - ms(d.createdAt) < EXPIRE;
  function renderCards(){
    if (!buildUi()) return;
    const list = FR.active ? Object.values(FR.duels).filter(incomingDuel) : [];
    const key = list.map(d => d.id).join(',');
    if (ui.cards._k === key) return; ui.cards._k = key;
    ui.cards.innerHTML = list.map(d => '<div class="duel-card card-panel" data-id="' + esc(d.id) + '"><span class="dc-txt outlined outlined-sm">⚔ ' + esc(d.aName) +
      ' <b>' + U.fmt(d.amount) + '</b></span><i class="dc-ic">' + icon(d.kind) + '</i>' +
      '<button class="fr-ic ok" data-act="acc">✓</button><button class="fr-ic no" data-act="dec">✕</button></div>').join('');
    if (list.length) sfx('toast');
    ui.cards.onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      const id = b.closest('.duel-card').dataset.id;
      if (b.dataset.act === 'acc') FR.acceptDuel(id).then(r => { if (!r.ok) toast(esc(r.error)); });
      else FR.declineDuel(id);
    };
  }
  setInterval(() => { if (FR.active && ui && ui.cards._k) { ui.cards._k = null; renderCards(); render(); } }, 5000); // expire old cards

  FR.open = function(){ if (!FR.active || FR.live || !buildUi()) return; ui.panel.hidden = false; editing = null; render(); refreshPresence(); setTimeout(() => ui.input.focus(), 0); };
  function close(){ if (ui){ ui.panel.hidden = true; editing = null; if (ui.panel.contains(document.activeElement)) document.activeElement.blur(); } }
  FR.close = close;
  FR.toggle = () => (ui && !ui.panel.hidden ? close() : FR.open());
  bus.on('menuOpen', close);

  // duel overlay: big tree + HP bar, both players' bars, 3-2-1, then one-line result
  const TREE = '<svg viewBox="0 0 120 170"><g stroke="#1b1b1b" stroke-width="5" stroke-linejoin="round"><rect x="47" y="92" width="26" height="70" rx="6" fill="#a8693a"/>' +
    '<path class="dv-notch" d="M73 128 l-14 6 l14 6 z" fill="#f2cf8c"/><circle cx="60" cy="60" r="44" fill="#6fd043"/><circle cx="34" cy="74" r="22" fill="#5cbf35"/><circle cx="86" cy="74" r="22" fill="#5cbf35"/></g>' +
    '<ellipse cx="60" cy="164" rx="40" ry="6" fill="rgba(0,0,0,.25)"/></svg>';
  function buildOverlay(){
    if (!buildUi()) return;
    const ov = ui.ov = document.createElement('div');
    ov.id = 'duel-ov';
    ov.innerHTML = '<div class="dv-wager outlined">' + U.fmt(FR.live.amount) + ' <i class="dc-ic">' + icon(FR.live.kind) + '</i></div>' +
      '<div class="dv-hp"><i></i><span class="outlined outlined-sm"></span></div><div class="dv-tree">' + TREE + '</div>' +
      '<div class="dv-bars"><div class="dv-bar me"><span class="outlined outlined-sm">YOU</span><b><i></i></b></div>' +
      '<div class="dv-bar op"><span class="outlined outlined-sm">' + esc(FR.live.opName) + '</span><b><i></i></b></div></div>' +
      '<div class="dv-big outlined"></div>';
    ov.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); if (ov._res) return closeResult(); FR.chop(); });
    layer().appendChild(ov);
    ui.tree = ov.querySelector('.dv-tree');
    ui.dv = { hp: ov.querySelector('.dv-hp i'), hpT: ov.querySelector('.dv-hp span'), me: ov.querySelector('.dv-bar.me i'), op: ov.querySelector('.dv-bar.op i'), big: ov.querySelector('.dv-big'), notch: ov.querySelector('.dv-notch') };
  }
  function drawLive(){
    const L = FR.live; if (!L || !ui || !ui.dv || ui.ov._res) return;
    const v = ui.dv, left = Math.max(0, HP - L.mine), now = performance.now();
    v.hp.style.width = (left / HP * 100) + '%'; v.hpT.textContent = left + ' HP';
    v.me.style.width = Math.min(100, L.mine / HP * 100) + '%'; v.op.style.width = Math.min(100, L.opp / HP * 100) + '%';
    v.notch.setAttribute('transform', 'translate(' + (-16 * L.mine / HP) + ' 0) scale(1 1)');
    const c = Math.ceil((L.goAt - now) / 1000);
    const t = c > 0 ? String(c) : now - L.goAt < 700 ? 'CHOP!' : L.done || L.mine >= HP ? '...' : '';
    if (v.big._t !== t){ v.big._t = t; v.big.textContent = t; v.big.classList.remove('pop'); void v.big.offsetWidth; if (t) v.big.classList.add('pop'); }
  }
  function showResult(msg, won){
    const L = FR.live; if (!L || !ui.ov) return toast(esc(msg));
    clearInterval(L.timer); L.done = true;
    ui.ov._res = true; ui.ov.classList.add('result', won ? 'won' : 'lost');
    ui.ov.innerHTML = '<div class="dv-result outlined">' + esc(msg) + '</div>';
    sfx(won ? 'fanfare' : 'denied');
    ui.resT = setTimeout(closeResult, 3500);
  }
  function closeResult(){ clearTimeout(ui && ui.resT); endLive(); }

  // keys: F toggles the panel; during a duel Space chops and nothing else reaches the game (capture phase, runs first)
  window.addEventListener('keydown', e => {
    if (!FR.live) return;
    if (e.code === 'Space' || e.key === 'Escape' || e.code === 'KeyF'){ e.preventDefault(); e.stopImmediatePropagation(); }
    if (e.code === 'Space' && !e.repeat) FR.chop();
    if (e.key === 'Escape' && ui && ui.ov && ui.ov._res) closeResult();
  }, true);
  window.addEventListener('keydown', e => {
    if (e.code !== 'KeyF' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (!FR.active || !S().loaded || window.__fxCine || (TCS.scene && TCS.scene.mode !== 'play')) return;
    e.preventDefault(); FR.toggle();
  });
  bus.on('ready', () => { buildUi(); render(); });
})();
