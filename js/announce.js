/* announce.js — global announcements from the admin (TCS.announce).
   Cloud: Firestore doc meta/announcement = {text (1-140 chars), at: server time, by: uid}; only Shiv may write it (firestore.rules),
   anyone may read it. Every open game listens; a post shows as a banner at the top of the screen for SHOW_MS
   (on the title menu too), once per device (localStorage 'tcs_ann_seen'). Players who open the game within FRESH_MS of a post still see it.
   Local mode (?local): posts go to localStorage 'tcs_ann' (other tabs pick it up via the storage event).
   API: post(text) -> Promise<bool>, show(text) (just the banner), MAX */
(function(){
  const TCS = window.TCS, bus = TCS.bus;
  const MAX = 140, SHOW_MS = 12000, FRESH_MS = 10 * 60 * 1000, SEEN = 'tcs_ann_seen', LOCAL = 'tcs_ann';
  const store = TCS.store;
  let el = null, hideT = null, db = null, F = null;

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MEGA = '<svg viewBox="0 0 40 40"><g stroke="#1b1b1b" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">' +
    '<path d="M6 16h7l15-8v24l-15-8H6z" fill="#ffc83a"/><path d="M11 24l3 9h5l-2-9" fill="#ff7a3a"/><path d="M33 15c2 3 2 7 0 10" fill="none"/></g></svg>';

  function hide(){
    clearTimeout(hideT);
    if (!el) return;
    const e = el; el = null; e.classList.add('out');
    setTimeout(() => e.remove(), 350);
  }
  function show(text){
    text = String(text || '').trim().slice(0, MAX); if (!text) return;
    if (el){ el.remove(); el = null; }
    el = document.createElement('div'); el.id = 'announce-bar'; el.className = 'card-panel';
    el.innerHTML = '<span class="an-ic">' + MEGA + '</span><span class="an-txt">' + esc(text) + '</span><button class="an-x" title="Close">✕</button>';
    el.addEventListener('pointerdown', e => e.stopPropagation());
    el.querySelector('.an-x').addEventListener('click', e => { e.stopPropagation(); hide(); });
    (document.getElementById('ui-layer') || document.body).appendChild(el);
    try { TCS.audio.play('toast'); } catch(e){}
    clearTimeout(hideT); hideT = setTimeout(hide, SHOW_MS);
  }
  // show a post once per device, and only while it's fresh
  function receive(id, text, atMs){
    if (!id || !text) return;
    if (atMs && Date.now() - atMs > FRESH_MS) return;
    if (store.get(SEEN) === id) return;
    store.set(SEEN, id);
    show(text);
  }

  /* ---------- cloud ---------- */
  function listen(){
    const fb = TCS.fb, C = TCS.cloud;
    if (!fb || !C || !C.active) return;
    try { F = fb.F; db = F.getFirestore(fb.app); } catch(e){ return; }
    F.onSnapshot(F.doc(db, 'meta', 'announcement'), snap => {
      if (!snap.exists() || snap.metadata.hasPendingWrites) return;
      const d = snap.data(), at = d.at && d.at.toMillis ? d.at.toMillis() : 0;
      if (!at) return;
      receive('c' + at, d.text, at);
    }, err => console.warn('announce listener', err));
  }

  /* ---------- local ---------- */
  function readLocal(){
    const a = store.getJSON(LOCAL, null);
    if (a && a.text && a.at) receive('l' + a.at, a.text, a.at);
  }

  function post(text){
    text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX);
    const S = TCS.state;
    if (!text || !S || !S.isAdmin || !S.isAdmin()) return Promise.resolve(false);
    if (db && TCS.cloud && TCS.cloud.active){
      return F.setDoc(F.doc(db, 'meta', 'announcement'), { text, at: F.serverTimestamp(), by: TCS.cloud.uid })
        .then(() => true).catch(e => { console.warn('announce', e); return false; });
    }
    const at = Date.now();
    store.setJSON(LOCAL, { text, at });
    readLocal();
    return Promise.resolve(true);
  }

  window.addEventListener('storage', e => { if (e.key === LOCAL) readLocal(); });
  bus.on('ready', () => { if (TCS.cloud && TCS.cloud.active) listen(); else readLocal(); });

  TCS.announce = { post, show, hide, MAX, get bar(){ return el; } };
})();
