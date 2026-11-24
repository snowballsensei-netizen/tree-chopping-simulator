/* binds.js — the two chop binds (TCS.binds), per device in localStorage 'tcs_binds'.
   A bind is 'Mouse0' (left) / 'Mouse1' (middle) / 'Mouse2' (right) — chops when that button clicks the tree or lumberjack —
   or a KeyboardEvent.code ('Space', 'KeyJ', ...) — chops anywhere in the game. Touch taps always chop.
   Keys already used by the game (Esc, Q, E, F, M, Tab, Enter) can't be bound. Defaults: left click + Space.
   API: get() -> [a, b], set(i, code) -> true | 'reserved', reset(), key(e), mouse(button), pointer(e), label(code), DEFAULT */
(function(){
  const TCS = window.TCS = window.TCS || {};
  const KEY = 'tcs_binds', DEFAULT = ['Mouse0', 'Space'];
  const RESERVED = ['Escape', 'KeyQ', 'KeyE', 'KeyF', 'KeyM', 'Tab', 'Enter', 'NumpadEnter', 'MetaLeft', 'MetaRight'];
  const valid = c => typeof c === 'string' && c.length > 0 && c.length < 32 && RESERVED.indexOf(c) < 0;
  let binds = DEFAULT.slice();
  try { const v = JSON.parse(localStorage.getItem(KEY)); if (Array.isArray(v) && v.length === 2 && v.every(valid) && v[0] !== v[1]) binds = v; } catch(e){}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(binds)); } catch(e){} if (TCS.bus) TCS.bus.emit('binds', binds.slice()); };
  const NAMES = { Mouse0: 'LEFT CLICK', Mouse1: 'MIDDLE CLICK', Mouse2: 'RIGHT CLICK', Space: 'SPACE', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    ShiftLeft: 'L SHIFT', ShiftRight: 'R SHIFT', ControlLeft: 'L CTRL', ControlRight: 'R CTRL', AltLeft: 'L ALT', AltRight: 'R ALT', Backspace: 'BACKSPACE',
    CapsLock: 'CAPS LOCK', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
    Comma: ',', Period: '.', Slash: '/' };
  function label(c){
    if (NAMES[c]) return NAMES[c];
    if (/^Key[A-Z]$/.test(c)) return c.slice(3);
    if (/^Digit\d$/.test(c)) return c.slice(5);
    if (/^Numpad/.test(c)) return 'NUM ' + c.slice(6).toUpperCase();
    if (/^Mouse\d$/.test(c)) return 'MOUSE ' + (+c.slice(5) + 1);
    return c.toUpperCase();
  }
  const B = TCS.binds = {
    DEFAULT, RESERVED,
    get: () => binds.slice(),
    set(i, code){
      if (!valid(code)) return 'reserved';
      const j = 1 - i;
      if (binds[j] === code) binds[j] = binds[i];         // taking the other slot's bind swaps them
      binds[i] = code; save(); return true;
    },
    reset(){ binds = DEFAULT.slice(); save(); },
    key: e => !!e && !!e.code && binds.indexOf(e.code) >= 0,
    mouse: button => binds.indexOf('Mouse' + (button || 0)) >= 0,
    // a pointerdown that should chop: any touch/pen tap, or a bound mouse button
    pointer: e => !!e && (e.pointerType === 'touch' || e.pointerType === 'pen' || B.mouse(e.button)),
    label
  };
})();
