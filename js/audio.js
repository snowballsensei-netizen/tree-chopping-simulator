/* audio.js — WebAudio-synthesised SFX + procedural per-stage music (no audio files).
   API: play(name, opts?), setMusicVolume(0..1), setSfxVolume(0..1), startMusic(), stopMusic(), unlock(),
        setMuted(bool), toggleMute(), setStage(i), playTrack(name), muted, musicVolume, sfxVolume, stage, track, ctx
   Tracks: 'title', 'stage0'..'stage7' (Oak, Birch, Pine, Redwood, Cherry, Tundra, Crystal, Golden), 'battle' (friend duels:
        duelMusic(true|false) crossfades to it and back to the stage track; duelSting(won) fades it out + victory / aww sting)
   SFX names: chop, chip, buy, denied, log, achievement, squirrel, caught, frenzy, coffee, rebirth/timber, sprout,
        click, toast, fanfare (stage-arrival; opts.stage), victory, aww, ready (opts.go)
   chop / chip / log / fanfare are stage-flavoured (current stage, or opts.stage). */
(function(){
  const TCS = window.TCS;
  const bus = TCS.bus;
  let ctx = null, master, limiter, musicBus, sfxBus, duckBus, reverb, revSend, noiseBuf;
  let music = 0.5, sfx = 0.8;
  let muted = false;
  try { muted = TCS.store.get('tcs_mute') === '1'; } catch(e){}
  let stage = 0, curTrack = 'title', musicWanted = false;

  function makeImpulse(c){
    const len = Math.floor(c.sampleRate * 1.6), b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++){ const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    return b;
  }
  // builds the bus graph on any (realtime or offline) context
  function buildGraph(c){
    const G = {};
    G.master = c.createGain(); G.master.gain.value = muted ? 0 : 1;
    G.limiter = c.createDynamicsCompressor();
    G.limiter.threshold.value = -8; G.limiter.knee.value = 4; G.limiter.ratio.value = 12;
    G.limiter.attack.value = 0.003; G.limiter.release.value = 0.2;
    const out = c.createGain(); out.gain.value = 0.9;
    G.master.connect(G.limiter); G.limiter.connect(out); out.connect(c.destination);
    G.musicBus = c.createGain(); G.musicBus.gain.value = music * 0.55;
    G.duckBus = c.createGain(); G.duckBus.gain.value = 1;
    G.musicBus.connect(G.duckBus); G.duckBus.connect(G.master);
    G.sfxBus = c.createGain(); G.sfxBus.gain.value = sfx * 0.9; G.sfxBus.connect(G.master);
    G.reverb = c.createConvolver(); G.reverb.buffer = makeImpulse(c);
    G.revSend = c.createGain(); G.revSend.gain.value = 0.22;
    G.revSend.connect(G.reverb); G.reverb.connect(G.duckBus);
    return G;
  }
  function useGraph(c, G){ ctx = c; master = G.master; limiter = G.limiter; musicBus = G.musicBus; sfxBus = G.sfxBus; duckBus = G.duckBus; reverb = G.reverb; revSend = G.revSend; }
  let realG = null;
  function ensure(){
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    let c; try { c = new AC(); } catch(e){ return null; }
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    realG = buildGraph(c); useGraph(c, realG);
    return ctx;
  }
  const ready = () => ctx && ctx.state === 'running';
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[Math.floor(Math.random() * a.length)];

  // ---------- building blocks ----------
  function env(g, t, a, peak, dur){
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dur);
  }
  function tone(out, { f = 440, f2, type = 'sine', t = ctx.currentTime, a = 0.004, dur = 0.2, vol = 0.3, curve = 'exp', detune = 0 }){
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
    if (f2) curve === 'lin' ? o.frequency.linearRampToValueAtTime(f2, t + a + dur) : o.frequency.exponentialRampToValueAtTime(f2, t + a + dur);
    env(g, t, a, vol, dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + a + dur + 0.05);
    return o;
  }
  function noise(out, { t = ctx.currentTime, a = 0.002, dur = 0.1, vol = 0.3, type = 'bandpass', freq = 1500, q = 1, freq2 }){
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(freq, t); fl.Q.value = q;
    if (freq2) fl.frequency.exponentialRampToValueAtTime(freq2, t + a + dur);
    const g = ctx.createGain(); env(g, t, a, vol, dur);
    s.connect(fl); fl.connect(g); g.connect(out);
    s.start(t, Math.random() * 0.5); s.stop(t + a + dur + 0.05);
  }
  // filtered tone (one shared-per-note lowpass) for fiddle / brass / funk bass
  function ftone(out, { f, type = 'sawtooth', t, a = 0.02, dur = 0.3, vol = 0.1, cut = 1800, cut2, q = 1, slide = 0, detune = 0 }){
    const o = ctx.createOscillator(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = type; o.detune.value = detune;
    if (slide){ o.frequency.setValueAtTime(f * (1 - slide), t); o.frequency.exponentialRampToValueAtTime(f, t + 0.05); }
    else o.frequency.setValueAtTime(f, t);
    fl.type = 'lowpass'; fl.Q.value = q; fl.frequency.setValueAtTime(cut, t);
    if (cut2) fl.frequency.exponentialRampToValueAtTime(cut2, t + a + dur);
    env(g, t, a, vol, dur);
    o.connect(fl); fl.connect(g); g.connect(out); o.start(t); o.stop(t + a + dur + 0.05);
  }
  const midi = n => 440 * Math.pow(2, (n - 69) / 12);

  // ---------- instruments: (out, midiNote, t, vol, dur) ----------
  function pluck(out, n, t, vol, dur = 0.35){ // ukulele-ish
    const f = midi(n);
    tone(out, { f, type: 'triangle', t, a: 0.003, dur, vol });
    tone(out, { f: f * 4, type: 'sine', t, a: 0.002, dur: dur * 0.18, vol: vol * 0.35 });
    tone(out, { f: f * 2, type: 'sine', t, a: 0.003, dur: dur * 0.5, vol: vol * 0.25 });
  }
  const INST = {
    pluck,
    marimba(out, n, t, vol, dur){ const f = midi(n);
      tone(out, { f, t, a: 0.002, dur: Math.min(dur, 0.45), vol });
      tone(out, { f: f * 4, t, a: 0.001, dur: 0.06, vol: vol * 0.4 }); },
    bell(out, n, t, vol, dur){ const f = midi(n); // celesta / glockenspiel
      tone(out, { f, t, a: 0.002, dur: Math.max(dur, 0.6), vol });
      tone(out, { f: f * 2.0, t, a: 0.002, dur: 0.3, vol: vol * 0.3 });
      tone(out, { f: f * 3.01, t, a: 0.001, dur: 0.12, vol: vol * 0.15 }); },
    harp(out, n, t, vol, dur){ const f = midi(n);
      tone(out, { f, type: 'triangle', t, a: 0.004, dur: Math.max(dur, 0.7), vol });
      tone(out, { f: f * 2, t, a: 0.003, dur: 0.25, vol: vol * 0.3 }); },
    koto(out, n, t, vol, dur){ const f = midi(n);
      tone(out, { f: f * 1.015, f2: f, type: 'triangle', t, a: 0.002, dur: Math.min(dur + 0.2, 0.7), vol });
      tone(out, { f: f * 3, type: 'sine', t, a: 0.001, dur: 0.08, vol: vol * 0.35 });
      noise(out, { t, dur: 0.015, vol: vol * 0.25, freq: f * 4, q: 4 }); },
    fiddle(out, n, t, vol, dur){ const f = midi(n);
      ftone(out, { f, t, a: 0.04, dur: Math.max(dur, 0.18), vol: vol * 0.7, cut: 2200, q: 2, slide: 0.02 });
      ftone(out, { f, t, a: 0.05, dur: Math.max(dur, 0.18), vol: vol * 0.5, cut: 1500, detune: 9 }); },
    brass(out, n, t, vol, dur){ const f = midi(n);
      ftone(out, { f, t, a: 0.03, dur: Math.max(dur, 0.2), vol: vol * 0.8, cut: 600, cut2: 2400, q: 1 });
      ftone(out, { f: f * 1.003, type: 'square', t, a: 0.03, dur: Math.max(dur, 0.2), vol: vol * 0.3, cut: 1600 }); },
    epiano(out, n, t, vol, dur){ const f = midi(n);
      tone(out, { f, t, a: 0.004, dur: Math.max(dur, 0.5), vol });
      tone(out, { f: f * 2, type: 'triangle', t, a: 0.002, dur: 0.18, vol: vol * 0.25 });
      tone(out, { f: f * 7, t, a: 0.001, dur: 0.04, vol: vol * 0.08 }); },
    flute(out, n, t, vol, dur){ const f = midi(n);
      tone(out, { f, t, a: 0.05, dur: Math.max(dur, 0.25), vol });
      noise(out, { t, a: 0.03, dur: 0.08, vol: vol * 0.12, freq: f * 2, q: 6 }); },
    // chiptune lead: square + octave pulse under a snappy lowpass (battle track)
    chipLead(out, n, t, vol, dur){ const f = midi(n);
      ftone(out, { f, type: 'square', t, a: 0.005, dur: Math.max(Math.min(dur, 0.32), 0.1), vol: vol * 0.5, cut: 3400, cut2: 1400, q: 2 });
      ftone(out, { f: f * 2, type: 'square', t, a: 0.004, dur: 0.06, vol: vol * 0.16, cut: 4200, detune: 6 }); },
    stab(out, n, t, vol, dur){ const f = midi(n);
      ftone(out, { f, type: 'sawtooth', t, a: 0.004, dur: Math.min(dur, 0.12), vol: vol * 0.75, cut: 2600, cut2: 700, q: 3 }); },
    // basses
    bassDrive(out, n, t, vol, dur){ const f = midi(n);
      ftone(out, { f, type: 'sawtooth', t, a: 0.004, dur: Math.min(dur, 0.16), vol: vol * 0.5, cut: 900, cut2: 180, q: 5 });
      tone(out, { f, type: 'triangle', t, a: 0.004, dur: Math.min(dur, 0.16), vol: vol * 0.55 }); },
    bassPluck(out, n, t, vol, dur){ pluck(out, n, t, vol, Math.min(dur, 0.45)); },
    bassSub(out, n, t, vol, dur){ const f = midi(n);
      tone(out, { f, t, a: 0.006, dur: Math.min(dur, 0.5), vol });
      tone(out, { f: f * 2, type: 'triangle', t, a: 0.004, dur: 0.1, vol: vol * 0.3 }); },
    bassFunk(out, n, t, vol, dur){ const f = midi(n);
      ftone(out, { f, type: 'square', t, a: 0.004, dur: Math.min(dur, 0.3), vol: vol * 0.55, cut: 1400, cut2: 220, q: 6 });
      tone(out, { f, t, a: 0.004, dur: Math.min(dur, 0.3), vol: vol * 0.6 }); },
    bassUpright(out, n, t, vol, dur){ const f = midi(n);
      tone(out, { f: f * 1.01, f2: f, type: 'triangle', t, a: 0.004, dur: Math.min(dur, 0.4), vol });
      tone(out, { f: f * 2, t, a: 0.003, dur: 0.07, vol: vol * 0.3 }); }
  };
  // soft pad: two detuned triangles under a lowpass, one per chord tone
  function pad(out, notes, t, vol, dur){
    notes.forEach(n => {
      [-7, 7].forEach(dt => ftone(out, { f: midi(n), type: 'triangle', t, a: Math.min(0.4, dur * 0.3), dur: dur * 0.8, vol: vol, cut: 1200, detune: dt }));
    });
  }
  const DRUM = {
    kick(out, t, v){ tone(out, { f: 130, f2: 45, t, a: 0.002, dur: 0.13, vol: 0.5 * v }); },
    snare(out, t, v){ noise(out, { t, dur: 0.1, vol: 0.16 * v, freq: 1800, q: 0.7 }); tone(out, { f: 220, f2: 160, t, dur: 0.06, vol: 0.1 * v }); },
    clap(out, t, v){ [0, 0.012, 0.024].forEach(d => noise(out, { t: t + d, dur: 0.05, vol: 0.1 * v, freq: 1300, q: 1.2 })); },
    rim(out, t, v){ tone(out, { f: 1700, t, a: 0.001, dur: 0.03, vol: 0.07 * v }); },
    hat(out, t, v){ noise(out, { t, dur: 0.03, vol: 0.05 * v, type: 'highpass', freq: 7500 }); },
    shaker(out, t, v){ noise(out, { t, a: 0.012, dur: 0.04, vol: 0.04 * v, type: 'highpass', freq: 5500 }); },
    tamb(out, t, v){ noise(out, { t, dur: 0.09, vol: 0.05 * v, type: 'bandpass', freq: 8000, q: 1.5 }); },
    tom(out, t, v){ tone(out, { f: 180, f2: 110, t, dur: 0.18, vol: 0.3 * v }); },
    block(out, t, v){ tone(out, { f: 1100, t, a: 0.001, dur: 0.04, vol: 0.08 * v }); tone(out, { f: 2400, t, a: 0.001, dur: 0.02, vol: 0.03 * v }); }
  };

  // ---------- track definitions ----------
  const SCALES = { major: [0,2,4,5,7,9,11], mix: [0,2,4,5,7,9,10], lyd: [0,2,4,6,7,9,11], minor: [0,2,3,5,7,8,10] };
  // chords are scale degrees (0=I, 3=IV, 4=V, 5=vi, 1=ii, 2=iii, 6=bVII in mixolydian)
  // drum strings: 16 sixteenth-steps, x = hit, o = soft hit
  const TRACKS = {
    title: { bpm: 100, root: 65, scale: 'major', swing: 0.08, seed: 11,
      A: [0,5,3,4, 0,5,1,4], B: [3,4,2,5, 3,1,4,4],
      lead: 'marimba', lead2: 'flute', chord: 'pluck', chordPat: '--x---x---x---x-', bass: 'bassSub', bassPat: 'r-------f---r---',
      pad: 0.018, drums: { kick: 'x-------x-------', rim: '----x-------x---', shaker: 'o-o-o-o-o-o-o-o-' }, leadOct: 12, density: 0.55 },
    stage0: { bpm: 112, root: 60, scale: 'major', swing: 0.1, seed: 3, // Oak Meadow: uke + marimba
      A: [0,4,5,3, 0,4,3,4], B: [3,0,1,4, 3,0,4,4],
      lead: 'marimba', lead2: 'pluck', chord: 'pluck', chordPat: '--x-x---x-x-x---', bass: 'bassPluck', bassPat: 'r-----f-r---o---',
      drums: { kick: 'x-----x-x-------', clap: '----x-------x---', hat: '--x---x---x---x-', shaker: 'oooooooooooooooo' }, leadOct: 12, density: 0.65 },
    stage1: { bpm: 104, root: 62, scale: 'major', swing: 0, seed: 17, // Birch Lake: plucky harp, soft pads
      A: [0,5,3,4, 0,2,3,4], B: [5,3,0,4, 5,3,1,4],
      lead: 'harp', lead2: 'bell', chord: 'harp', chordPat: 'x--x--x---x--x--', bass: 'bassSub', bassPat: 'r-------r---f---',
      pad: 0.022, drums: { kick: 'x-------x-----x-', rim: '----x-------x---', hat: '--o---o---o---o-' }, leadOct: 12, density: 0.55 },
    stage2: { bpm: 120, root: 67, scale: 'mix', swing: 0.12, seed: 29, // Pine Mountains: folky fiddle
      A: [0,6,3,0, 0,6,4,0], B: [3,3,0,0, 6,3,4,4],
      lead: 'fiddle', lead2: 'pluck', chord: 'pluck', chordPat: 'x-x-x-x-x-x-x-x-', bass: 'bassUpright', bassPat: 'r---f---r---f---',
      drums: { kick: 'x---x---x---x---', snare: '----x-------x---', tamb: '--x---x---x---x-' }, leadOct: 0, density: 0.75 },
    stage3: { bpm: 108, root: 57, scale: 'major', swing: 0.16, seed: 41, // Redwood Valley: warm funk
      A: [0,3,0,3, 5,1,4,4], B: [3,4,2,5, 1,4,0,4],
      lead: 'epiano', lead2: 'brass', chord: 'epiano', chordPat: '---x--x----x-x--', bass: 'bassFunk', bassPat: 'r--r--o-r-f--r-o',
      drums: { kick: 'x--x----x-x-----', snare: '----x-------x---', hat: 'xoxoxoxoxoxoxoxo' }, leadOct: 12, density: 0.6 },
    stage4: { bpm: 96, root: 64, scale: 'major', swing: 0, seed: 53, penta: true, // Cherry Blossom: koto pentatonic
      A: [0,5,3,0, 5,3,4,4], B: [3,4,5,0, 3,4,0,0],
      lead: 'koto', lead2: 'flute', chord: 'koto', chordPat: 'x-----x---x-----', bass: 'bassSub', bassPat: 'r-------f-------',
      pad: 0.016, drums: { kick: 'x-------x-------', block: '----x--x----x---', shaker: '--o---o---o---o-' }, leadOct: 12, density: 0.5 },
    stage5: { bpm: 116, root: 69, scale: 'major', swing: 0, seed: 67, // Ice Spruce Tundra: sparkly celesta
      A: [0,4,5,3, 0,4,3,4], B: [5,3,0,4, 5,3,1,4],
      lead: 'bell', lead2: 'bell', chord: 'pluck', chordPat: 'x-x-x-x-x-x-x-x-', bass: 'bassSub', bassPat: 'r-----r---f-----',
      pad: 0.02, drums: { kick: 'x-------x-x-----', clap: '----x-------x---', hat: 'o-o-o-o-o-o-o-o-' }, leadOct: 12, density: 0.6, chordOct: 12 },
    stage6: { bpm: 100, root: 63, scale: 'lyd', swing: 0, seed: 79, // Crystal Caverns: dreamy-bright lydian
      A: [0,1,0,1, 5,3,4,4], B: [3,4,5,0, 3,4,1,4],
      lead: 'bell', lead2: 'harp', chord: 'harp', chordPat: 'x--x--x-x--x--x-', bass: 'bassSub', bassPat: 'r-------r-----f-',
      pad: 0.024, drums: { kick: 'x-------x-------', rim: '----x-------x---', shaker: 'oooooooooooooooo' }, leadOct: 12, density: 0.55 },
    stage7: { bpm: 128, root: 62, scale: 'major', swing: 0, seed: 97, // Golden Temple: triumphant brass
      A: [0,4,5,3, 0,3,4,4], B: [3,4,0,5, 3,4,4,4],
      lead: 'brass', lead2: 'bell', chord: 'pluck', chordPat: 'x-x-x-x-x-x-x-x-', bass: 'bassSub', bassPat: 'r---r---f---o---',
      pad: 0.018, drums: { kick: 'x---x---x---x---', snare: '----x-------x---', hat: '--x---x---x---x-', tom: '--------------xx' }, leadOct: 0, density: 0.6 },
    battle: { bpm: 160, root: 57, scale: 'minor', swing: 0, seed: 131, noIntro: true, // friend duels: driving A-minor chiptune
      A: [0,5,2,6, 0,5,6,4], B: [3,3,0,0, 5,6,4,4],
      lead: 'chipLead', lead2: 'brass', chord: 'stab', chordPat: '--x---x---x---xx', bass: 'bassDrive', bassPat: 'r-r-r-o-r-r-f-o-',
      drums: { kick: 'x---x---x---x-x-', snare: '----x-------x---', hat: 'xoxoxoxoxoxoxoxo', clap: '------------x---' }, leadOct: 12, density: 0.8 }
  };

  // seeded RNG so melodies are fixed per track
  function mulberry(a){ return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  // motif = 8 eighth-note slots, values are scale-degree offsets above the chord root (null = rest)
  function makeMotif(r, density, cadence){
    const m = []; let prev = pickR(r, [0, 2, 4]);
    for (let i = 0; i < 8; i++){
      const strong = i % 4 === 0;
      if (!strong && r() > density){ m.push(null); continue; }
      let v = strong ? pickR(r, [0, 2, 4, 2]) : prev + pickR(r, [-1, 1, 1, 2, -2, 0]);
      v = Math.max(-2, Math.min(7, v)); m.push(v); prev = v;
    }
    if (cadence){ m[4] = 0; m[5] = null; m[6] = null; m[7] = null; }
    return m;
  }
  function pickR(r, a){ return a[Math.floor(r() * a.length)]; }
  function compile(def){
    const r = mulberry(def.seed);
    const d = def.density;
    def.motA = [makeMotif(r, d), makeMotif(r, d), makeMotif(r, d * 1.2), makeMotif(r, d, true)];
    def.motB = [makeMotif(r, d * 0.8), makeMotif(r, d), makeMotif(r, d * 1.1), makeMotif(r, d, true)];
    def.motC = [makeMotif(r, d * 1.2), makeMotif(r, d), makeMotif(r, d * 1.2), makeMotif(r, d, true)]; // A-variation
    def.sc = SCALES[def.scale];
    def.step = 60 / def.bpm / 4;
    return def;
  }
  Object.values(TRACKS).forEach(compile);
  function degMidi(def, deg){ // scale degree (any int) -> midi, relative to def.root
    const sc = def.sc, o = Math.floor(deg / 7), i = ((deg % 7) + 7) % 7;
    return def.root + o * 12 + sc[i];
  }
  function pentaFix(def, n){ // keep koto lead on major pentatonic (drop 4th and 7th)
    const pc = ((n - def.root) % 12 + 12) % 12;
    return (pc === 5 || pc === 11) ? n - 1 : n;
  }

  // 32-bar form per cycle: A (sparse) | A (full + counter) | B | A' (variation, lead up)
  function scheduleTrackStep(P, s, t){
    const def = P.def, out = P.gain;
    const bar = Math.floor(s / 16), st = s % 16;
    const cycle = Math.floor(bar / 32), sb = bar % 32, sec = Math.floor(sb / 8), b8 = sb % 8;
    const isB = sec === 2;
    const deg = (isB ? def.B : def.A)[b8];
    const swing = (st % 2 === 1) ? def.swing * def.step * 2 : 0;
    const tt = t + swing;
    const triad = [deg, deg + 2, deg + 4].map(x => degMidi(def, x));
    const intro = cycle === 0 && sec === 0 && b8 < 2 && !def.noIntro;
    const breakdown = sec === 2 && b8 >= 6 && cycle % 2 === 1;
    // pad once per bar
    if (def.pad && st === 0) pad(def.padOut || out, triad, t, def.pad * (sec === 0 ? 0.8 : 1), def.step * 16);
    // bass
    const bc = def.bassPat[st];
    if (bc !== '-' && !intro){
      const rootN = degMidi(def, deg) - 24 + (degMidi(def, deg) - def.root > 7 ? -12 : 0);
      const n = bc === 'f' ? rootN + 7 : bc === 'o' ? rootN + 12 : rootN;
      INST[def.bass](out, n, tt, 0.26, def.step * 3);
    }
    // chords
    if (def.chordPat[st] === 'x' && !breakdown){
      const co = def.chordOct || 0;
      triad.forEach((n, i) => INST[def.chord](out, n + co, tt + i * 0.011, 0.055, def.step * 3));
    }
    // drums
    const dv = sec === 0 ? 0.75 : 1;
    if (!intro) for (const k in def.drums){
      const c = def.drums[k][st];
      if (breakdown && k === 'kick') continue;
      if (c === 'x') DRUM[k](out, tt, dv); else if (c === 'o') DRUM[k](out, tt, dv * 0.55);
    }
    if (b8 === 7 && sec !== 3 && st >= 12 && st % 2 === 0) DRUM.tom(out, tt, 0.45); // fill into next section
    // melody on eighths
    if (st % 2 === 0){
      const mots = sec === 2 ? def.motB : sec === 3 ? def.motC : def.motA;
      const mi = b8 === 7 ? 3 : (b8 + (cycle % 2) * (b8 % 2 ? 1 : 0)) % 3;
      const mot = mots[mi], v = mot[st / 2];
      if (v != null && !intro){
        let n = degMidi(def, deg + v) + def.leadOct;
        while (n > def.root + def.leadOct + 14) n -= 12;
        while (n < def.root + def.leadOct - 3) n += 12;
        if (sec === 3 && cycle % 2 === 0) n += 0; else if (sec === 3) n += 12;
        if (n > 93) n -= 12;
        if (def.penta) n = pentaFix(def, n);
        let gap = 1; while (st / 2 + gap < 8 && mot[st / 2 + gap] == null) gap++;
        const leadInst = (sec === 2 && cycle % 2 === 1) ? def.lead2 : def.lead;
        const lv = sec === 0 ? 0.13 : 0.15;
        INST[leadInst](out, n, tt, lv, def.step * 2 * gap * 0.9);
        // countermelody: third below in sections 1 and 3
        if ((sec === 1 || sec === 3) && st % 4 === 0){
          let c = degMidi(def, deg + v - 2) + def.leadOct - 12;
          if (def.penta) c = pentaFix(def, c);
          INST[def.lead2](out, c, tt, 0.06, def.step * 4);
        }
      }
    }
  }

  // ---------- players with crossfade ----------
  const LOOK = 0.25, FADE = 1.6;
  let players = [], timer = null;
  function makePlayer(name, startAt){
    const def = TRACKS[name];
    const g = ctx.createGain(); g.gain.value = 0.0001; g.connect(musicBus);
    g.connect(revSend);
    g.gain.setValueAtTime(0.0001, startAt); g.gain.exponentialRampToValueAtTime(1, startAt + FADE);
    return { name, def, gain: g, step: 0, nextT: startAt, dying: false, endAt: 0 };
  }
  function scheduler(){
    if (!ctx) return;
    if (ctx.state !== 'running'){ players.forEach(p => { p.nextT = ctx.currentTime + 0.1; }); return; }
    const now = ctx.currentTime;
    players = players.filter(p => {
      if (p.dying && now > p.endAt){ try { p.gain.disconnect(); } catch(e){} return false; }
      return true;
    });
    for (const p of players){
      if (p.nextT < now - 0.2) p.nextT = now + 0.05; // tab throttled: skip ahead, don't burst
      while (p.nextT < now + LOOK && !(p.dying && p.nextT > p.endAt)){
        try { scheduleTrackStep(p, p.step, p.nextT); } catch(e){ console.error('music', e); }
        p.step = (p.step + 1) % (16 * 32 * 4);
        p.nextT += p.def.step;
      }
    }
    if (!players.length && !musicWanted && timer){ clearInterval(timer); timer = null; }
  }
  function switchTo(name){
    if (!ready() || !TRACKS[name]) return;
    const live = players.find(p => !p.dying);
    if (live && live.name === name) return;
    const t = ctx.currentTime + 0.05;
    players.forEach(p => { if (!p.dying){ p.dying = true; p.endAt = t + FADE;
      p.gain.gain.cancelScheduledValues(t); p.gain.gain.setValueAtTime(Math.max(0.0001, p.gain.gain.value), t);
      p.gain.gain.exponentialRampToValueAtTime(0.0001, t + FADE); } });
    players.push(makePlayer(name, t));
    if (!timer) timer = setInterval(scheduler, 50);
    scheduler();
  }
  function playTrack(name){
    if (!TRACKS[name]) return;
    curTrack = name; musicWanted = true;
    if (ready()) switchTo(name);
  }
  function startMusic(){ musicWanted = true; if (ready()) switchTo(curTrack); }
  function stopMusic(){
    musicWanted = false;
    if (!ctx) return;
    const t = ctx.currentTime;
    players.forEach(p => { if (!p.dying){ p.dying = true; p.endAt = t + 0.6; p.gain.gain.setTargetAtTime(0.0001, t, 0.15); } });
  }

  // ---------- per-stage SFX timbres ----------
  // chop: body thump + bite noise + knock + flavour extra (kept quiet & pitch-randomised for rapid clicks)
  const PENTA = [0, 2, 4, 7, 9];
  const chime = (o, base, t, v, dur) => { const n = base + pick(PENTA) + pick([0, 12]); tone(o, { f: midi(n), t, a: 0.002, dur, vol: v }); tone(o, { f: midi(n) * 2.76, t, a: 0.001, dur: dur * 0.3, vol: v * 0.25 }); };
  const STAGE_SFX = [
    { // 0 Oak: crisp woody knock
      body: [180, 55, 0.14, 0.75], bite: [1400, 2400, 1.2, 0.5], knock: [700, 0.25, 0.12], tick: [400, 0.18], chip: [1700, 2300, 'square'], log: [110, 45] },
    { // 1 Birch: papery, hollow
      body: [240, 95, 0.09, 0.55], bite: [2600, 3600, 2.5, 0.42], knock: [950, 0.18, 0.08], tick: [620, 0.12], chip: [2200, 2800, 'triangle'], log: [150, 70],
      extra(o, t, p, v){ noise(o, { t, dur: 0.09, vol: 0.2 * v, freq: 820 * p, q: 9 }); } },
    { // 2 Pine: resinous, deeper thunk
      body: [140, 46, 0.18, 0.8], bite: [1100, 1800, 1.0, 0.42], knock: [480, 0.3, 0.16], tick: [300, 0.16], chip: [1300, 1700, 'triangle'], log: [92, 38],
      extra(o, t, p, v){ tone(o, { f: 260 * p, f2: 200 * p, type: 'triangle', t: t + 0.015, dur: 0.12, vol: 0.12 * v }); } },
    { // 3 Redwood: big boomy
      body: [110, 34, 0.26, 0.9], bite: [900, 1500, 0.9, 0.38], knock: [380, 0.32, 0.22], tick: [220, 0.16], chip: [1000, 1400, 'triangle'], log: [70, 28],
      extra(o, t, p, v){ tone(o, { f: 55 * p, f2: 38, t, a: 0.004, dur: 0.3, vol: 0.35 * v }); } },
    { // 4 Cherry: soft, bell-tinged
      body: [200, 80, 0.12, 0.55], bite: [1800, 2600, 1.0, 0.28], knock: [800, 0.18, 0.1], tick: [500, 0.1], chip: [2000, 2600, 'sine'], log: [130, 60],
      extra(o, t, p, v){ chime(o, 76, t + 0.01, 0.07 * v, 0.5); } },
    { // 5 Tundra: icy crack + tinkle
      body: [190, 70, 0.1, 0.6], bite: [3500, 5000, 1.5, 0.35], knock: [900, 0.15, 0.08], tick: [700, 0.1], chip: [2800, 3600, 'sine'], log: [120, 50],
      extra(o, t, p, v){ noise(o, { t, dur: 0.025, vol: 0.3 * v, type: 'highpass', freq: 4000 });
        for (let i = 0; i < 2; i++) tone(o, { f: rnd(3000, 4800), t: t + 0.03 + i * rnd(0.03, 0.06), a: 0.001, dur: 0.12, vol: 0.035 * v }); } },
    { // 6 Crystal: glassy chime-crack
      body: [210, 90, 0.08, 0.5], bite: [3000, 4200, 3, 0.3], knock: [1100, 0.12, 0.06], tick: [800, 0.08], chip: [2400, 3200, 'sine'], log: [140, 60],
      extra(o, t, p, v){ chime(o, 84, t + 0.005, 0.08 * v, 0.7); noise(o, { t, dur: 0.02, vol: 0.2 * v, type: 'highpass', freq: 5000 }); } },
    { // 7 Golden: metallic ring
      body: [170, 60, 0.12, 0.65], bite: [2000, 3000, 2, 0.32], knock: [650, 0.18, 0.1], tick: [450, 0.12], chip: [1800, 2400, 'triangle'], log: [100, 42],
      extra(o, t, p, v){ const f = pick([587, 659, 740, 880]) * p; [[1, 0.07], [2.41, 0.03], [3.93, 0.015]].forEach(([m, a]) => tone(o, { f: f * m, t, a: 0.001, dur: 0.45 / m, vol: a * v })); } }
  ];
  const stageOf = opts => { const s = opts && opts.stage != null ? opts.stage : stage; return ((s % 8) + 8) % 8; };

  // ---------- SFX ----------
  const last = {};
  const LIMIT = { chop: 0.055, chip: 0.03, log: 0.08, click: 0.03, buy: 0.04, denied: 0.12, toast: 0.1, fanfare: 1.5 };
  const SFX = {
    chop(o, opts){
      const P = STAGE_SFX[stageOf(opts)];
      const t = ctx.currentTime, p = rnd(0.88, 1.15) * (opts && opts.pitch || 1), v = (opts && opts.vol) || 1;
      const [bf, bf2, bd, bv] = P.body, [lo, hi, q, nv] = P.bite, [kf, kv, kd] = P.knock;
      tone(o, { f: bf * p, f2: bf2 * p, t, a: 0.002, dur: bd, vol: bv * v });
      noise(o, { t, dur: 0.06, vol: nv * v, freq: rnd(lo, hi), q });
      noise(o, { t: t + 0.01, dur: kd, vol: kv * v, type: 'lowpass', freq: kf * p, q: 0.7 });
      tone(o, { f: rnd(0.95, 1.15) * P.tick[0] * p, type: 'triangle', t, a: 0.001, dur: 0.05, vol: P.tick[1] * v });
      if (P.extra) P.extra(o, t, p, v);
    },
    chip(o, opts){
      const P = STAGE_SFX[stageOf(opts)], t = ctx.currentTime, f = rnd(P.chip[0], P.chip[1]);
      tone(o, { f, f2: f * 1.25, type: P.chip[2], t, a: 0.001, dur: 0.04, vol: P.chip[2] === 'square' ? 0.05 : 0.08 });
      tone(o, { f: f * 1.5, type: 'sine', t: t + 0.03, a: 0.001, dur: 0.06, vol: 0.07 });
    },
    log(o, opts){
      const s = stageOf(opts), P = STAGE_SFX[s], t = ctx.currentTime, p = rnd(0.94, 1.06);
      tone(o, { f: P.log[0] * p, f2: P.log[1], t, dur: 0.25, vol: 0.7 });
      noise(o, { t, dur: 0.2, vol: 0.32, type: 'lowpass', freq: P.log[0] * 4.5 });
      tone(o, { f: P.log[0] * 1.45 * p, f2: P.log[1] * 1.5, t: t + 0.12, dur: 0.18, vol: 0.32 });
      if (P.extra) P.extra(o, t + 0.12, p, 0.7);
    },
    fanfare(o, opts){
      const s = stageOf(opts), def = TRACKS['stage' + s], t = ctx.currentTime + 0.02;
      const ins = INST[def.lead], q = 60 / def.bpm / 2;
      const top = def.leadOct === 0 ? 12 : 0;
      [0, 2, 4, 7].forEach((d, i) => ins(o, degMidi(def, d) + top, t + i * q * 0.5, 0.2, q));
      [[3, 2], [4, 2.5], [0, 3]].forEach(([d, at]) => [d, d + 2, d + 4].forEach((x, i) =>
        INST.pluck(o, degMidi(def, x), t + at * q + i * 0.012, 0.11, at === 3 ? 1.2 : 0.3)));
      ins(o, degMidi(def, 7) + top, t + 3 * q, 0.22, 1.0);
      ins(o, degMidi(def, 9) + top, t + 3 * q, 0.12, 1.0);
      DRUM.kick(o, t + 3 * q, 1); DRUM.tamb(o, t + 3 * q, 1.5);
      noise(o, { t: t + 3 * q, a: 0.01, dur: 0.6, vol: 0.06, type: 'highpass', freq: 6000 });
      // duck music briefly so the fanfare reads
      const g = duckBus.gain; g.cancelScheduledValues(t); g.setTargetAtTime(0.35, t, 0.08); g.setTargetAtTime(1, t + 3 * q + 0.8, 0.5);
    },
    buy(o){
      const t = ctx.currentTime;
      [76, 79, 84].forEach((n, i) => pluck(o, n, t + i * 0.055, 0.28, 0.25));
      tone(o, { f: midi(96), type: 'sine', t: t + 0.12, dur: 0.25, vol: 0.08 });
    },
    denied(o){
      const t = ctx.currentTime;
      tone(o, { f: 220, f2: 170, type: 'square', t, dur: 0.1, vol: 0.09 });
      tone(o, { f: 180, f2: 140, type: 'square', t: t + 0.11, dur: 0.14, vol: 0.09 });
    },
    achievement(o){
      const t = ctx.currentTime;
      [72, 76, 79, 84, 88].forEach((n, i) => pluck(o, n, t + i * 0.08, 0.26, 0.4));
      [84, 88, 91].forEach(n => tone(o, { f: midi(n), type: 'triangle', t: t + 0.42, a: 0.01, dur: 0.6, vol: 0.12 }));
    },
    frenzy(o){
      const t = ctx.currentTime;
      tone(o, { f: 220, f2: 880, type: 'sawtooth', t, a: 0.01, dur: 0.45, vol: 0.08 });
      noise(o, { t, a: 0.05, dur: 0.4, vol: 0.2, freq: 600, freq2: 5000, q: 2 });
      [79, 83, 86, 91].forEach((n, i) => pluck(o, n, t + 0.25 + i * 0.06, 0.22, 0.3));
    },
    squirrel(o){
      const t = ctx.currentTime;
      tone(o, { f: 1400, f2: 2600, type: 'triangle', t, dur: 0.07, vol: 0.18 });
      tone(o, { f: 1700, f2: 3000, type: 'triangle', t: t + 0.1, dur: 0.07, vol: 0.18 });
    },
    caught(o){
      const t = ctx.currentTime;
      tone(o, { f: 1200, f2: 3200, type: 'triangle', t, dur: 0.12, vol: 0.2 });
      [84, 88, 91, 96].forEach((n, i) => pluck(o, n, t + 0.08 + i * 0.05, 0.2, 0.25));
    },
    coffee(o){
      const t = ctx.currentTime;
      for (let i = 0; i < 4; i++) tone(o, { f: rnd(500, 800), f2: rnd(900, 1300), t: t + i * 0.06, dur: 0.05, vol: 0.12 });
      tone(o, { f: midi(72), type: 'triangle', t: t + 0.28, dur: 0.15, vol: 0.2 });
      tone(o, { f: midi(79), type: 'triangle', t: t + 0.36, dur: 0.35, vol: 0.2 });
    },
    timber(o){
      const t = ctx.currentTime;
      const voice = (t0, f0, f1, dur, vol) => {
        const src = ctx.createOscillator(); src.type = 'sawtooth';
        src.frequency.setValueAtTime(f0, t0); src.frequency.linearRampToValueAtTime(f1, t0 + dur);
        const vib = ctx.createOscillator(), vg = ctx.createGain(); vib.frequency.value = 6; vg.gain.value = 6; vib.connect(vg); vg.connect(src.frequency);
        const g = ctx.createGain(); env(g, t0, 0.03, vol, dur);
        [[700, 6, 1], [1150, 8, 0.6], [2600, 10, 0.3]].forEach(([ff, q, a]) => {
          const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(ff, t0);
          bp.frequency.linearRampToValueAtTime(ff * 0.75, t0 + dur); bp.Q.value = q;
          const ag = ctx.createGain(); ag.gain.value = a; src.connect(bp); bp.connect(ag); ag.connect(g);
        });
        g.connect(o); src.start(t0); vib.start(t0); src.stop(t0 + dur + 0.1); vib.stop(t0 + dur + 0.1);
      };
      voice(t, 260, 300, 0.22, 0.9);
      voice(t + 0.27, 330, 230, 0.9, 1.0);
      tone(o, { f: 90, f2: 60, type: 'sawtooth', t: t + 0.4, a: 0.2, dur: 0.6, vol: 0.06 });
      noise(o, { t: t + 1.25, dur: 0.9, vol: 0.6, type: 'lowpass', freq: 1800, freq2: 200 });
      tone(o, { f: 70, f2: 30, t: t + 1.25, dur: 0.7, vol: 0.9 });
    },
    // duel outro stings: short brass + chip victory fanfare / descending "aww" wah-wah
    // duel countdown tick: READY / SET (opts.go = false) and a higher, brighter GO!
    ready(o, opts){
      const t = ctx.currentTime, go = opts && opts.go;
      if (go){ [79, 86, 91].forEach((n, i) => INST.chipLead(o, n, t + i * 0.035, 0.24, 0.18)); DRUM.kick(o, t, 1); noise(o, { t, a: 0.004, dur: 0.25, vol: 0.08, type: 'highpass', freq: 5000 }); }
      else { INST.chipLead(o, 67, t, 0.22, 0.12); tone(o, { f: midi(79), t, a: 0.001, dur: 0.05, vol: 0.08 }); DRUM.rim(o, t, 1.2); }
    },
    victory(o){
      const t = ctx.currentTime + 0.02, q = 0.11;
      [67, 72, 76, 79].forEach((n, i) => INST.chipLead(o, n, t + i * q, 0.26, q * 0.9));
      [72, 76, 79, 84].forEach((n, i) => INST.brass(o, n, t + 4 * q + i * 0.01, 0.12, 0.7));
      INST.chipLead(o, 84, t + 4 * q, 0.22, 0.5);
      DRUM.kick(o, t + 4 * q, 1.1); DRUM.snare(o, t + 4 * q, 1.2);
      noise(o, { t: t + 4 * q, a: 0.01, dur: 0.9, vol: 0.07, type: 'highpass', freq: 6000 });
      [84, 88, 91, 96].forEach((n, i) => tone(o, { f: midi(n), t: t + 4 * q + 0.15 + i * 0.05, a: 0.002, dur: 0.3, vol: 0.05 }));
    },
    aww(o){
      const t = ctx.currentTime + 0.02;
      [[64, 0, 0.22], [63, 0.26, 0.22], [62, 0.52, 0.7]].forEach(([n, at, d]) => {
        const f = midi(n);
        ftone(o, { f, type: 'sawtooth', t: t + at, a: 0.03, dur: d, vol: 0.12, cut: 1300, cut2: 500, q: 3 });
        ftone(o, { f: f * 1.004, type: 'square', t: t + at, a: 0.03, dur: d, vol: 0.05, cut: 900 });
      });
      tone(o, { f: midi(62), f2: midi(58), type: 'triangle', t: t + 0.6, a: 0.05, dur: 0.6, vol: 0.12, curve: 'lin' });
      tone(o, { f: midi(38), t: t + 0.52, a: 0.01, dur: 0.6, vol: 0.18 });
    },
    sprout(o){
      const t = ctx.currentTime;
      tone(o, { f: 300, f2: 900, type: 'sine', t, a: 0.02, dur: 0.25, vol: 0.2 });
      [79, 84, 88].forEach((n, i) => pluck(o, n, t + 0.18 + i * 0.07, 0.18, 0.3));
    },
    click(o){
      const t = ctx.currentTime;
      tone(o, { f: 900, f2: 600, type: 'triangle', t, a: 0.001, dur: 0.04, vol: 0.18 });
    },
    toast(o){
      const t = ctx.currentTime;
      pluck(o, 84, t, 0.15, 0.2); pluck(o, 91, t + 0.07, 0.15, 0.3);
    }
  };
  SFX.rebirth = SFX.timber;

  function play(name, opts){
    if (!ready() || muted || sfx <= 0) return;
    const fn = SFX[name]; if (!fn) return;
    const now = ctx.currentTime, lim = LIMIT[name] || 0;
    if (lim && last[name] != null && now - last[name] < lim) return;
    last[name] = now;
    try { fn(sfxBus, opts); } catch(e){ console.error('audio', name, e); }
  }

  function applyGains(){
    if (!ctx) return;
    const t = ctx.currentTime;
    master.gain.setTargetAtTime(muted ? 0 : 1, t, 0.03);
    musicBus.gain.setTargetAtTime(music * 0.55, t, 0.05);
    sfxBus.gain.setTargetAtTime(sfx * 0.9, t, 0.03);
  }

  function unlock(){
    if (!ensure()) return;
    const go = () => { if (musicWanted || !players.length) startMusic(); };
    if (ctx.state !== 'running') ctx.resume().then(go).catch(() => {}); else go();
  }
  const g = () => { unlock(); if (ready()){ ['pointerdown','keydown','touchend'].forEach(e => window.removeEventListener(e, g, true)); } };
  ['pointerdown','keydown','touchend'].forEach(e => window.addEventListener(e, g, true));

  // friend duels: battle track while the duel overlay is up, then back to whatever should play (stage / title)
  let battle = false;
  function duelMusic(on){
    on = !!on; if (on === battle) return;
    battle = on;
    if (on) playTrack('battle');
    else { if (inGame) stage = ((dataStage() % 8) + 8) % 8; playTrack(inGame ? 'stage' + stage : 'title'); }
  }
  // the outro: fade the battle loop out quickly under a victory / aww sting (stage music comes back on duelMusic(false))
  function duelSting(won){
    if (ctx && battle){
      const t = ctx.currentTime;
      players.forEach(p => { if (!p.dying && p.name === 'battle'){ p.dying = true; p.endAt = t + 0.8;
        p.gain.gain.cancelScheduledValues(t); p.gain.gain.setTargetAtTime(0.0001, t, 0.15); } });
    }
    play(won ? 'victory' : 'aww');
  }
  function setStage(i, fanfare){
    i = ((+i || 0) % 8 + 8) % 8;
    stage = i;
    if (inGame && !battle) playTrack('stage' + i);
    if (fanfare) play('fanfare', { stage: i });
  }
  function dataStage(){
    const d = TCS.state && TCS.state.data; if (!d) return 0;
    return typeof d.species === 'number' ? d.species : (d.speciesIndex || 0);
  }

  // offline render (testing): renders `secs` of a track or a list of SFX; returns { peak, rms } in dBFS
  async function renderOffline(name, secs = 20, sfxList){
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const sr = 44100, oc = new OAC(2, Math.ceil(sr * secs), sr);
    if (!noiseBuf){ noiseBuf = oc.createBuffer(1, sr, sr); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const save = { ctx, master, limiter, musicBus, sfxBus, duckBus, reverb, revSend };
    const G = buildGraph(oc); G.master.gain.value = 1; G.musicBus.gain.value = 0.5 * 0.55; G.sfxBus.gain.value = 0.8 * 0.9;
    useGraph(oc, G);
    try {
      if (sfxList){
        // ctx.currentTime is 0 offline: shift each sfx via a delayed proxy context time
        let at = 0.05;
        for (const s of sfxList){ const real = ctx; ctx = new Proxy(oc, { get: (o, k) => k === 'currentTime' ? at : (typeof o[k] === 'function' ? o[k].bind(o) : o[k]) });
          try { SFX[s.name](G.sfxBus, s.opts); } finally { ctx = real; } at += s.gap || 0.35; }
      } else {
        const P = makePlayer(name, 0); P.gain.gain.cancelScheduledValues(0); P.gain.gain.value = 1;
        const start = (name === 'title' || /stage/.test(name)) ? 16 * 2 : 0; // skip the sparse intro bars
        for (let s = 0, t = 0; t < secs; s++, t += P.def.step) scheduleTrackStep(P, s + start, t);
      }
    } finally { useGraph(save.ctx, save); if (!save.ctx) ctx = null; }
    const buf = await oc.startRendering();
    let peak = 0, sum = 0, n = 0;
    for (let ch = 0; ch < buf.numberOfChannels; ch++){ const d = buf.getChannelData(ch); for (let i = 0; i < d.length; i++){ const a = Math.abs(d[i]); if (a > peak) peak = a; sum += d[i] * d[i]; n++; } }
    const db = x => +(20 * Math.log10(Math.max(x, 1e-9))).toFixed(2);
    return { peak: db(peak), rms: db(Math.sqrt(sum / n)), peakLin: +peak.toFixed(4) };
  }

  let inGame = false;
  TCS.audio = {
    play, startMusic, stopMusic, unlock, playTrack, renderOffline, duelMusic, duelSting,
    get battle(){ return battle; },
    get playing(){ const p = players.find(x => !x.dying); return p ? p.name : null; },
    setStage(i){ setStage(i, false); },
    setMusicVolume(v){ music = Math.max(0, Math.min(1, +v || 0)); applyGains(); },
    setSfxVolume(v){ sfx = Math.max(0, Math.min(1, +v || 0)); applyGains(); },
    setMuted(m){ muted = !!m; try { TCS.store.set('tcs_mute', muted ? '1' : '0'); } catch(e){} applyGains(); bus.emit('mute', muted); },
    toggleMute(){ TCS.audio.setMuted(!muted); return muted; },
    get muted(){ return muted; },
    get musicVolume(){ return music; }, get sfxVolume(){ return sfx; },
    get stage(){ return stage; }, get track(){ return curTrack; },
    get tracks(){ return Object.keys(TRACKS); },
    get ctx(){ return ctx; }
  };

  // ---------- bus hooks (main already plays chop / buy / log / achievement) ----------
  let pendingFanfare = false;
  bus.on('settings', s => { if (s){ TCS.audio.setMusicVolume(s.music); TCS.audio.setSfxVolume(s.sfx); } });
  bus.on('chipLanded', () => play('chip'));
  bus.on('frenzyStart', () => play('frenzy'));
  bus.on('coffeeStart', () => play('coffee'));
  bus.on('squirrel', () => play('caught'));
  bus.on('menuOpen', () => { inGame = false; battle = false; playTrack('title'); });
  bus.on('gameStart', () => { inGame = true; });
  bus.on('load', () => { inGame = true; stage = ((dataStage() % 8) + 8) % 8; if (!battle) playTrack('stage' + stage); });
  bus.on('rebirth', () => { pendingFanfare = true; setTimeout(() => play('sprout'), 2600); // timber: fx plays it at the cinematic start
    // fallback if no cinematic follows
    setTimeout(() => { if (pendingFanfare){ pendingFanfare = false; setStage(dataStage(), true); } }, 9000); });
  bus.on('rebirthCinematicEnd', () => { pendingFanfare = false; setStage(dataStage(), true); });
  bus.on('stage', i => { const n = typeof i === 'object' && i ? i.index : i; setStage(n, true); });
  bus.on('chopImpact', () => { if (TCS.scene && TCS.scene.mode === 'orbit') play('chop', { vol: 0.35 }); });
})();
