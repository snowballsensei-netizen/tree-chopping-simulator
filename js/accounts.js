/* accounts.js — local accounts stored in localStorage key 'tcs_accounts' = [{username, salt, hash}].
   NOTE: this is LOCAL-ONLY convenience, NOT real security. Anyone with access to this browser can read or
   edit localStorage; the salted SHA-256 hash only avoids keeping passwords in plain text.
   Contract: current, list(), create(u,p), login(u,p), logout(), validateUsername(u), find(u) */
(function(){
  const TCS = window.TCS;
  const KEY = 'tcs_accounts';

  // ---- pure-JS SHA-256 fallback (crypto.subtle is missing on some file:// / insecure contexts) ----
  function sha256js(bytes){
    const K = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,
      0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,
      0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,
      0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,
      0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
    const H = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
    const l = bytes.length, n = ((l + 9 + 63) >> 6) << 6;
    const m = new Uint8Array(n); m.set(bytes); m[l] = 0x80;
    const dv = new DataView(m.buffer);
    dv.setUint32(n - 4, (l * 8) >>> 0); dv.setUint32(n - 8, Math.floor(l / 0x20000000));
    const W = new Uint32Array(64);
    const r = (x, s) => (x >>> s) | (x << (32 - s));
    for (let o = 0; o < n; o += 64){
      for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++){
        const s0 = r(W[i-15],7) ^ r(W[i-15],18) ^ (W[i-15] >>> 3), s1 = r(W[i-2],17) ^ r(W[i-2],19) ^ (W[i-2] >>> 10);
        W[i] = (W[i-16] + s0 + W[i-7] + s1) >>> 0;
      }
      let [a,b,c,d,e,f,g,h] = H;
      for (let i = 0; i < 64; i++){
        const t1 = (h + (r(e,6) ^ r(e,11) ^ r(e,25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
        const t2 = ((r(a,2) ^ r(a,13) ^ r(a,22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0]+=a; H[1]+=b; H[2]+=c; H[3]+=d; H[4]+=e; H[5]+=f; H[6]+=g; H[7]+=h;
    }
    const out = new Uint8Array(32), odv = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) odv.setUint32(i * 4, H[i]);
    return out;
  }
  const hex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  async function sha256(str){
    const bytes = new TextEncoder().encode(str);
    try {
      if (window.crypto && crypto.subtle && crypto.subtle.digest) return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
    } catch(e){ /* fall through */ }
    return hex(sha256js(bytes));
  }
  function makeSalt(){
    const b = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.random() * 256 | 0;
    return hex(b);
  }

  const A = TCS.accounts = {
    current: null,
    list(){ const l = TCS.store.getJSON(KEY, []); return Array.isArray(l) ? l : []; },
    find(u){ const lu = String(u || '').toLowerCase(); return A.list().find(a => a && a.username && a.username.toLowerCase() === lu) || null; },
    validateUsername(u){
      if (!u) return 'Enter a username';
      if (u.length < 4) return 'At least 4 characters';
      if (u.length > 16) return 'At most 16 characters';
      if (!/^[A-Za-z0-9_]+$/.test(u)) return 'Letters, numbers and _ only';
      if (TCS.leaderboard && TCS.leaderboard.isBot && TCS.leaderboard.isBot(u)) return 'Username taken';   // leaderboard players' names
      if (TCS.mmBots && TCS.mmBots.isBot(u)) return 'Username taken';   // matchmaking opponents' names
      if (!(TCS.cloud && TCS.cloud.active) && A.find(u)) return 'Username taken'; // cloud: checked on create (local-only names may migrate)
      return null;
    },
    // returns {ok, error, field:'user'|'pass'|'pass2'}
    async create(username, password, password2){
      username = String(username || '').trim();
      const ue = A.validateUsername(username);
      if (ue) return { ok: false, error: ue, field: 'user' };
      if (!password || password.length < 6) return { ok: false, error: 'At least 6 characters', field: 'pass' };
      if (password2 !== undefined && password2 !== password) return { ok: false, error: "Passwords don't match", field: 'pass2' };
      if (TCS.cloud && TCS.cloud.active) return TCS.cloud.create(username, password);
      const salt = makeSalt();
      const hash = await sha256(salt + ':' + password);
      const list = A.list(); list.push({ username, salt, hash });
      if (!TCS.store.setJSON(KEY, list)) return { ok: false, error: 'Could not save (storage blocked)', field: 'user' };
      A.current = username;
      return { ok: true, username };
    },
    async login(username, password){
      if (TCS.cloud && TCS.cloud.active) return TCS.cloud.login(String(username || '').trim(), password);
      const acc = A.find(String(username || '').trim());
      const fail = { ok: false, error: 'Wrong username or password' };
      if (!acc || !password) return fail;
      const hash = await sha256(acc.salt + ':' + password);
      if (hash !== acc.hash) return fail;
      A.current = acc.username;
      return { ok: true, username: acc.username };
    },
    logout(){
      if (TCS.state.loaded) TCS.state.unload();
      A.current = null;
      if (TCS.cloud && TCS.cloud.active) TCS.cloud.logout();
      TCS.bus.emit('logout');
    },
    // local account check (used by cloud migration): true when acc's salted hash matches
    async verify(acc, password){ return !!acc && !!password && (await sha256(acc.salt + ':' + password)) === acc.hash; },
    _makeSalt: makeSalt,
    _sha256js: s => hex(sha256js(new TextEncoder().encode(s))), _sha256: sha256
  };
})();
