/* cloud.js — Firebase cloud accounts + saves. Inactive (TCS.cloud.active = false) when js/firebase-config.js is null.
   Auth: Email/Password with <username lowercased>@players.treechopping.game. Firestore layout:
     usernames/{lower} = {uid, username}            (create-only, uniqueness)
     users/{uid} = {username, usernameLower}
     users/{uid}/slots/{0|1|2} = {uid, username, usernameLower, slot, lastSaved, profileName, wood, lifetimeWood, rebirths, speciesIndex, playTime, data: <save JSON string>}
     users/{uid}/grants/{id} = {slot, amount (+give / -take), kind logs|acorns, by, at}  (written by the admin, consumed + deleted by the owner's client)
   The game itself still plays from localStorage: each cloud slot is cached under 'tcs_csave_<uid>_<slot>' (see state.key),
   pulled before profile select / play (newer lastSaved wins) and pushed at most every 30 s plus on hide/unload/switch/logout/rebirth.
   API: active, online, uid, username, admin, ready, create(u,p), login(u,p), logout(), syncSlots(), pullSlot(s), flush(),
        onDelete(s), onRename(s,d), adminTargets(q), grant(uid,slot,n,kind) */
(function(){
  const TCS = window.TCS, bus = TCS.bus, store = TCS.store;
  const fb = TCS.fb || null;
  const DOMAIN = 'players.treechopping.game';
  const PUSH_EVERY = 30000;
  const K_SESSION = 'tcs_cloud_session', K_CREDS = 'tcs_cloud_creds';
  const fail = { ok: false, error: 'Wrong username or password' };
  const taken = { ok: false, error: 'Username taken', field: 'user' };

  let auth = null, db = null, A = null, F = null;
  if (fb){
    try {
      A = fb.A; F = fb.F;
      auth = A.getAuth(fb.app); db = F.getFirestore(fb.app);
      if (fb.emu){
        A.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
        F.connectFirestoreEmulator(db, '127.0.0.1', 8080);
      }
    } catch(e){ console.warn('cloud init failed', e); auth = db = null; }
  }

  const C = TCS.cloud = {
    active: !!TCS.FIREBASE_CONFIG,
    online: false, uid: null, username: null, admin: false,
    ready: Promise.resolve()
  };
  if (!C.active) return;

  const email = u => String(u).toLowerCase() + '@' + DOMAIN;
  const mkey = (uid, s) => 'tcs_csync_' + uid + '_' + s;   // lastSaved of the copy last known to be in the cloud
  const ckey = (uid, s) => 'tcs_csave_' + uid + '_' + s;
  const isNet = e => /network|unavailable|offline|deadline/i.test((e && (e.code || e.message)) || '');
  function setOnline(v){ v = !!v && !!db && navigator.onLine !== false; if (v !== C.online){ C.online = v; bus.emit('cloudStatus', { online: v }); } }

  function setUser(uid, username){
    C.uid = uid; C.username = username; C.admin = false;
    TCS.accounts.current = username;
    store.setJSON(K_SESSION, { uid, username });
    bus.emit('cloudUser', { uid, username });
    if (db) F.getDoc(F.doc(db, 'usernames', 'shiv')).then(s => { C.admin = s.exists() && s.data().uid === uid && C.uid === uid; setOnline(true); }).catch(() => {});
  }
  async function cacheCreds(username, uid, password){
    const salt = TCS.accounts._makeSalt(), hash = await TCS.accounts._sha256(salt + ':' + password);
    const all = store.getJSON(K_CREDS, {}) || {}; all[username.toLowerCase()] = { username, uid, salt, hash };
    store.setJSON(K_CREDS, all);
  }
  async function offlineLogin(username, password){
    const c = (store.getJSON(K_CREDS, {}) || {})[String(username).toLowerCase()];
    if (!c || !(await TCS.accounts.verify(c, password))) return fail;
    setUser(c.uid, c.username); setOnline(false);
    return { ok: true, username: c.username, offline: true };
  }

  // restore the session: Firebase persistence when the SDK loaded, else the last session from the local cache
  C.ready = new Promise(res => {
    if (!auth){ const s = store.getJSON(K_SESSION, null); if (s && s.uid) setUser(s.uid, s.username); return res(); }
    let done = false;
    const finish = () => { if (!done){ done = true; res(); } };
    const un = A.onAuthStateChanged(auth, u => {
      un();
      if (u) setUser(u.uid, u.displayName || (store.getJSON(K_SESSION, {}) || {}).username || u.email.split('@')[0]);
      else store.remove(K_SESSION);
      setOnline(true); finish();
    }, () => finish());
    setTimeout(finish, 8000);
  });

  /* ---------- accounts ---------- */
  C.create = async function(username, password){
    if (!auth) return { ok: false, error: 'Offline - try again later', field: 'user' };
    const lower = username.toLowerCase();
    const local = TCS.accounts.find(username);
    if (local && !(await TCS.accounts.verify(local, password))) return taken;  // name exists on this device only
    let cred;
    try { cred = await A.createUserWithEmailAndPassword(auth, email(username), password); }
    catch(e){
      if (e.code === 'auth/email-already-in-use') return taken;
      if (e.code === 'auth/weak-password') return { ok: false, error: 'At least 6 characters', field: 'pass' };
      if (isNet(e)) return { ok: false, error: 'Offline - try again later', field: 'user' };
      console.warn(e); return { ok: false, error: 'Could not create account', field: 'user' };
    }
    const uid = cred.user.uid;
    try {
      await F.runTransaction(db, async tx => {
        const ref = F.doc(db, 'usernames', lower);
        const s = await tx.get(ref);
        if (s.exists() && s.data().uid !== uid) throw new Error('taken');
        if (!s.exists()) tx.set(ref, { uid, username });
        tx.set(F.doc(db, 'users', uid), { username, usernameLower: lower });
      });
    } catch(e){
      console.warn(e);
      try { await cred.user.delete(); } catch(_){}
      return e.message === 'taken' ? taken : { ok: false, error: 'Could not create account', field: 'user' };
    }
    try { await A.updateProfile(cred.user, { displayName: username }); } catch(e){}
    await cacheCreds(username, uid, password);
    setUser(uid, username); setOnline(true);
    if (local) await migrateLocal(local.username);
    return { ok: true, username, migrated: !!local };
  };

  C.login = async function(username, password){
    if (!username || !password) return fail;
    if (!auth) return offlineLogin(username, password);
    let cred;
    try { cred = await A.signInWithEmailAndPassword(auth, email(username), password); }
    catch(e){
      if (isNet(e)) return offlineLogin(username, password);
      // no cloud account yet but a matching local one on this device: move it to the cloud
      const local = TCS.accounts.find(username);
      if (local && await TCS.accounts.verify(local, password)){
        const r = await C.create(local.username, password);
        if (r.ok) return r;
      }
      return fail;
    }
    const name = cred.user.displayName || username;
    await cacheCreds(name, cred.user.uid, password);
    setUser(cred.user.uid, name); setOnline(true);
    return { ok: true, username: name };
  };

  C.logout = function(){
    const uid = C.uid;
    C.uid = C.username = null; C.admin = false;
    store.remove(K_SESSION);
    stopGrants();
    if (auth) Promise.resolve(flushing).catch(() => {}).then(() => A.signOut(auth)).catch(() => {});
    return uid;
  };

  // upload a local account's 3 slots into the new cloud account
  async function migrateLocal(username){
    for (let s = 0; s < 3; s++){
      const d = store.getJSON('tcs_save_' + username.toLowerCase() + '_' + s, null);
      if (!d || typeof d !== 'object') continue;
      store.setJSON(ckey(C.uid, s), d);
      try { await push(C.uid, s, JSON.stringify(d), d); } catch(e){}
    }
  }

  /* ---------- saves ---------- */
  const num = v => (typeof v === 'number' && isFinite(v)) ? v : 0;
  function slotDoc(uid, s, json, d){
    return { uid, username: C.username || '', usernameLower: String(C.username || '').toLowerCase(), slot: s,
      lastSaved: num(d.lastSaved), profileName: String(d.profileName || ('Profile ' + (s + 1))).slice(0, 20),
      wood: num(d.wood), lifetimeWood: num(d.lifetimeWood), rebirths: num(d.stats && d.stats.rebirths),
      speciesIndex: num(d.speciesIndex), playTime: num(d.stats && d.stats.playTime), data: json };
  }
  async function push(uid, s, json, d){
    if (!db || !uid) throw new Error('offline');
    try {
      await F.setDoc(F.doc(db, 'users', uid, 'slots', String(s)), slotDoc(uid, s, json, d));
      store.set(mkey(uid, s), String(num(d.lastSaved)));
      setOnline(true);
    } catch(e){ setOnline(false); throw e; }
  }
  // decide between the cloud copy cd (or undefined) and the local cache; returns true if the local cache changed
  function reconcile(uid, s, cd){
    const local = store.getJSON(ckey(uid, s), null), marker = store.get(mkey(uid, s));
    if (cd){
      if (!local || num(cd.lastSaved) > num(local.lastSaved) || (num(cd.lastSaved) === num(local.lastSaved) && cd.profileName !== local.profileName)){
        try { const d = JSON.parse(cd.data); store.setJSON(ckey(uid, s), d); store.set(mkey(uid, s), String(num(cd.lastSaved))); return true; }
        catch(e){ console.warn('bad cloud save', e); return false; }
      }
      if (num(local.lastSaved) > num(cd.lastSaved)) push(uid, s, JSON.stringify(local), local).catch(() => {});
      return false;
    }
    if (local){
      if (marker){ store.remove(ckey(uid, s)); store.remove(mkey(uid, s)); return true; } // deleted on another device
      push(uid, s, JSON.stringify(local), local).catch(() => {});                       // made while offline
    }
    return false;
  }
  C.syncSlots = async function(){
    const uid = C.uid; if (!db || !uid) return false;
    try {
      const qs = await F.getDocs(F.collection(db, 'users', uid, 'slots'));
      const cloud = {}; qs.forEach(d => cloud[d.id] = d.data());
      if (uid !== C.uid) return false;
      let changed = false;
      for (let s = 0; s < 3; s++) changed = reconcile(uid, s, cloud[s]) || changed;
      setOnline(true);
      return changed;
    } catch(e){ setOnline(false); return false; }
  };
  C.pullSlot = async function(s){
    const uid = C.uid; if (!db || !uid) return false;
    try {
      const snap = await F.getDoc(F.doc(db, 'users', uid, 'slots', String(s)));
      setOnline(true);
      return uid === C.uid && reconcile(uid, s, snap.exists() ? snap.data() : undefined);
    } catch(e){ setOnline(false); return false; }
  };
  C.onDelete = function(s){
    const uid = C.uid; store.remove(mkey(uid, s));
    if (db) F.deleteDoc(F.doc(db, 'users', uid, 'slots', String(s))).then(() => setOnline(true), () => setOnline(false));
  };
  C.onRename = function(s, d){ push(C.uid, s, JSON.stringify(d), d).catch(() => {}); };

  // throttled push of the live profile: every local save snapshots, cloud writes at most every 30 s
  let snap = null, lastPush = 0, flushing = null;
  bus.on('save', () => {
    const S = TCS.state;
    if (!C.uid || !S.profile || !S.loaded || S.profile.username !== C.username) return;
    snap = { uid: C.uid, slot: S.profile.slot, json: JSON.stringify(S.data), lastSaved: S.data.lastSaved };
    if (Date.now() - lastPush >= PUSH_EVERY) C.flush();
  });
  C.flush = function(){
    if (!snap) return flushing || Promise.resolve();
    const p = snap; snap = null; lastPush = Date.now();
    const d = JSON.parse(p.json);
    flushing = push(p.uid, p.slot, p.json, d).catch(() => { if (!snap) snap = p; }); // keep it for the next try
    return flushing;
  };
  const saveAndFlush = () => { const S = TCS.state; if (S.loaded) S.save(); C.flush(); };
  bus.on('unload', () => { C.flush(); stopGrants(); });
  bus.on('rebirth', () => setTimeout(saveAndFlush, 0));
  bus.on('offlineCollected', () => setTimeout(saveAndFlush, 0));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveAndFlush(); });
  window.addEventListener('pagehide', saveAndFlush);
  window.addEventListener('beforeunload', saveAndFlush);
  window.addEventListener('online', () => { setOnline(true); C.flush(); });
  window.addEventListener('offline', () => setOnline(false));
  // a loaded cloud slot: push right away (so another device won't count the same offline time) and listen for grants
  bus.on('load', e => {
    if (!C.uid || !e || !e.profile || e.profile.username !== C.username) return;
    setTimeout(() => { lastPush = 0; saveAndFlush(); }, 0);
    startGrants(C.uid, e.profile.slot);
  });

  /* ---------- admin grants ---------- */
  let unGrants = null;
  function stopGrants(){ if (unGrants){ try { unGrants(); } catch(e){} unGrants = null; } }
  function startGrants(uid, slot){
    stopGrants();
    if (!db) return;
    const q = F.query(F.collection(db, 'users', uid, 'grants'), F.where('slot', '==', slot));
    unGrants = F.onSnapshot(q, qs => {
      const S = TCS.state;
      if (!S.loaded || !S.profile || S.profile.slot !== slot || C.uid !== uid) return;
      const seen = S.data.appliedGrants = Array.isArray(S.data.appliedGrants) ? S.data.appliedGrants : [];
      let got = 0;
      qs.forEach(g => {
        const amt = num(g.data().amount), kind = g.data().kind === 'acorns' ? 'acorns' : 'logs';
        if (seen.indexOf(g.id) < 0 && amt){
          if (kind === 'logs' && amt > 0) S.addWood(amt); else S.applyAdmin(S.data, kind, amt);
          got++; seen.push(g.id);
        }
        F.deleteDoc(g.ref).catch(() => {});
      });
      if (seen.length > 50) seen.splice(0, seen.length - 50);
      if (got > 0){ bus.emit('adminGrant', { count: got }); lastPush = 0; S.save(); }
    }, err => console.warn('grants listener', err));
  }

  C.adminTargets = async function(query){
    if (!db || !C.admin) return [];
    const S = TCS.state, rows = [];
    const add = d => {
      const self = d.uid === C.uid && S.profile && S.profile.slot === d.slot && S.loaded;
      rows.push({ key: d.uid, username: d.username, slot: d.slot, name: d.profileName, wood: self ? S.data.wood : d.wood, self });
    };
    query = String(query || '').trim().toLowerCase();
    if (query){
      const u = await F.getDoc(F.doc(db, 'usernames', query));
      if (!u.exists()) return [];
      (await F.getDocs(F.collection(db, 'users', u.data().uid, 'slots'))).forEach(d => add(d.data()));
    } else {
      (await F.getDocs(F.query(F.collectionGroup(db, 'slots'), F.limit(200)))).forEach(d => add(d.data()));
    }
    rows.sort((a, b) => (b.self - a.self) || a.username.localeCompare(b.username) || a.slot - b.slot);
    return rows;
  };
  // n > 0 gives, n < 0 takes; kind 'logs' | 'acorns'
  C.grant = async function(uid, slot, n, kind){
    if (!db || !C.admin) return false;
    try {
      await F.addDoc(F.collection(db, 'users', uid, 'grants'), { slot: +slot, amount: n, kind: kind === 'acorns' ? 'acorns' : 'logs', by: C.uid, at: F.serverTimestamp() });
      return true;
    } catch(e){ console.warn(e); return false; }
  };
})();
