/* ui.js — UI phase. HTML/CSS overlay: top-left HUD, right-hand shop column (shop / achievements / rebirth /
   settings / outfit panels), icon column, outfit buttons, axe frenzy meter, toasts, offline card.
   Public API (ARCHITECTURE.md): TCS.ui = { init, update, show, toast, ICONS, open(panel) }.
   DOM is built once; update() only writes text/classes when a value changed. */
(function(){
  const TCS = window.TCS;
  const U = TCS.util, bus = TCS.bus, D = TCS.data;
  const S = () => TCS.state;
  const INK = '#1b1b1b';

  /* ---------- drawn icons ---------- */
  const g = (inner, vb) => '<svg viewBox="' + (vb || '0 0 40 40') + '"><g stroke="' + INK + '" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">' + inner + '</g></svg>';
  const ICONS = {
    log: g('<rect x="4" y="11" width="28" height="18" rx="9" fill="#a8693a"/><ellipse cx="31" cy="20" rx="6" ry="9" fill="#f2cf8c"/><ellipse cx="31" cy="20" rx="2.5" ry="4" fill="none" stroke-width="2"/>'),
    cursor: '<svg viewBox="0 0 40 40"><path d="M9 4 L9 32 L16 26 L21 37 L26 35 L21 24 L31 24 Z" fill="#fff" stroke="' + INK + '" stroke-width="3" stroke-linejoin="round"/></svg>',
    gear: g('<path fill="#ffc83a" d="M17 3h6l1 5 4 2 4-3 4 4-3 4 2 4 5 1v6l-5 1-2 4 3 4-4 4-4-3-4 2-1 5h-6l-1-5-4-2-4 3-4-4 3-4-2-4-5-1v-6l5-1 2-4-3-4 4-4 4 3 4-2z" transform="scale(.92) translate(1.6 1.6)"/><circle cx="20" cy="20" r="5" fill="#fff"/>'),
    settings: g('<path fill="#d9dde3" d="M17 3h6l1 5 4 2 4-3 4 4-3 4 2 4 5 1v6l-5 1-2 4 3 4-4 4-4-3-4 2-1 5h-6l-1-5-4-2-4 3-4-4 3-4-2-4-5-1v-6l5-1 2-4-3-4 4-4 4 3 4-2z" transform="scale(.92) translate(1.6 1.6)"/><circle cx="20" cy="20" r="5.5" fill="#7a8492"/>'),
    trophy: g('<path d="M10 7h20v8a10 10 0 0 1-20 0z" fill="#ffc83a"/><path d="M10 10H5v3a6 6 0 0 0 6 6M30 10h5v3a6 6 0 0 1-6 6" fill="none"/><path d="M17 25h6v5h-6z" fill="#e0a21f"/><rect x="11" y="30" width="18" height="6" rx="2" fill="#a8693a"/>'),
    coffee: g('<path d="M8 15h20v11a8 8 0 0 1-8 8h-4a8 8 0 0 1-8-8z" fill="#fff"/><path d="M28 18h3a4 4 0 0 1 0 8h-3" fill="none"/><path d="M11 18h14" stroke="#7b4a26" stroke-width="4"/><path d="M14 5c-2 3 2 4 0 7M21 5c-2 3 2 4 0 7" fill="none" stroke-width="2.5"/>'),
    sprout: g('<path d="M20 36V20" fill="none" stroke-width="4"/><path d="M20 22C9 23 5 15 6 8c9-1 14 5 14 14z" fill="#6fd043"/><path d="M20 19c1-9 7-13 15-12 0 8-6 13-15 12z" fill="#8ee05c"/><path d="M10 36h20" stroke-width="4"/>'),
    acorn: g('<path d="M11 18h18v5a9 10 0 0 1-18 0z" fill="#ffc83a"/><path d="M8 18a12 8 0 0 1 24 0z" fill="#a8693a"/><path d="M20 10V5" fill="none"/>'),
    hat: g('<path d="M8 27c0-12 5-18 12-18s12 6 12 18z" fill="#e8443a"/><rect x="5" y="25" width="30" height="7" rx="3.5" fill="#fff"/><circle cx="20" cy="7" r="3.5" fill="#fff"/>'),
    face: g('<circle cx="20" cy="17" r="12" fill="#f6c89a"/><path d="M8 19c0 10 5 17 12 17s12-7 12-17c-3 3-6 4-12 4s-9-1-12-4z" fill="#8a4b22"/><circle cx="15" cy="15" r="1.6" fill="' + INK + '"/><circle cx="25" cy="15" r="1.6" fill="' + INK + '"/>'),
    boots: g('<path d="M12 5h11v18l10 4v8H9V5z" fill="#7b4a26"/><path d="M9 30h24" fill="none"/><path d="M12 11h11" fill="none" stroke-width="2.5"/>'),
    lock: g('<path d="M13 18v-5a7 7 0 0 1 14 0v5" fill="none"/><rect x="9" y="18" width="22" height="16" rx="4" fill="#b9b9b9"/>'),
    star: g('<path d="M20 4l4.7 10 10.8 1.3-8 7.4 2.1 10.8L20 28l-9.6 5.5 2.1-10.8-8-7.4L15.3 14z" fill="#ffc83a"/>')
  };
  // unique fallback emoji for each upgrade (data.js reuses one, so we keep our own map)
  const UP_EMOJI = { whetstone:'\u{1FAA8}', rookie:'\u{1F9D1}', steelAxe:'\u{1FA93}', hauler:'\u{1FAB5}', doubleBit:'⚔️',
    beaver:'\u{1F9AB}', crosscut:'\u{1FA9A}', muleCart:'\u{1FACF}', chainsaw:'⛽', sawmill:'\u{1F6D6}', crew:'\u{1F477}',
    splitter:'\u{1F529}', skidSteer:'\u{1F69C}', feller:'\u{1F980}', flume:'\u{1F30A}', mech:'\u{1F916}', trucks:'\u{1F69B}',
    thunderAxe:'⚡', skyCrane:'\u{1F681}', robots:'\u{1F9BE}', drill:'\u{1F529}', megafactory:'\u{1F3ED}', satellite:'\u{1F6F0}️',
    giantAxe:'\u{1F31F}', portal:'\u{1F300}' };
  UP_EMOJI.drill = '\u{1F573}️'; // hole — keeps drill distinct from splitter's nut-and-bolt
  const UP_TINT = ['#cfe8ff','#ffe0b8','#e2e7ee','#f1d3b0','#ffd6d6','#e7d2bd','#fff0b3','#ddeccd','#ffd9a8','#e6d6c4','#ffe8a0','#d6e4ff',
    '#ffe6a6','#ffd1c7','#c9ecff','#dcdcf5','#f5d0d0','#fff3a3','#d4f0e0','#e0e6f0','#e8d8ff','#d8d8d8','#d9e8ff','#ffe9a8','#ead1ff'];
  const STAT_EMOJI = { lifetimeWood:'\u{1FAB5}', clicks:'\u{1F446}', squirrels:'\u{1F43F}️', frenzies:'\u{1F525}', rebirths:'\u{1F331}', height:'\u{1F4CF}', coffees:'☕' };

  // drawn icon per upgrade (all different); used when TCS.upgrades3d.icon(id) gives nothing
  const UP_SVG = {
    whetstone: g('<rect x="5" y="17" width="30" height="13" rx="4" fill="#8f9aa6"/><path d="M8 17l4-6h16l4 6" fill="#b8c2cc"/><path d="M27 6l3 4M31 4l1 5M23 5l2 4" stroke="#ffc83a" stroke-width="2.5"/>'),
    rookie: g('<circle cx="20" cy="17" r="10" fill="#f6c89a"/><path d="M10 15c0-8 20-8 20 0z" fill="#e8443a"/><path d="M9 36c1-7 5-9 11-9s10 2 11 9z" fill="#d23b3b"/><circle cx="16.5" cy="18" r="1.4" fill="#1b1b1b"/><circle cx="23.5" cy="18" r="1.4" fill="#1b1b1b"/>'),
    steelAxe: g('<path d="M22 6l4 3-14 28-4-2z" fill="#a8693a"/><path d="M20 8c6-6 15-3 16 5l-12 2z" fill="#dfe6ee"/>'),
    hauler: g('<rect x="5" y="20" width="22" height="10" rx="5" fill="#a8693a"/><rect x="9" y="11" width="22" height="10" rx="5" fill="#b97a45"/><ellipse cx="31" cy="16" rx="3.5" ry="5" fill="#f2cf8c"/><ellipse cx="27" cy="25" rx="3.5" ry="5" fill="#f2cf8c"/>'),
    doubleBit: g('<path d="M19 4h3v32h-3z" fill="#a8693a"/><path d="M19 7C12 4 6 8 6 15s6 10 13 7zM22 7c7-3 13 1 13 8s-6 10-13 7z" fill="#dfe6ee"/>'),
    beaver: g('<ellipse cx="20" cy="22" rx="12" ry="11" fill="#8a5a33"/><circle cx="11" cy="12" r="3.5" fill="#8a5a33"/><circle cx="29" cy="12" r="3.5" fill="#8a5a33"/><rect x="17" y="25" width="6" height="6" fill="#fff"/><circle cx="15" cy="19" r="1.6" fill="#1b1b1b"/><circle cx="25" cy="19" r="1.6" fill="#1b1b1b"/><ellipse cx="20" cy="23" rx="3" ry="2" fill="#1b1b1b"/>'),
    crosscut: g('<path d="M6 16h28v8c-3-3-5 3-7 0s-4 3-7 0-4 3-7 0-4 3-7 0z" fill="#dfe6ee"/><rect x="2" y="10" width="5" height="16" rx="2" fill="#a8693a"/><rect x="33" y="10" width="5" height="16" rx="2" fill="#a8693a"/>'),
    muleCart: g('<rect x="4" y="13" width="24" height="11" rx="2" fill="#c98b4f"/><circle cx="11" cy="28" r="5" fill="#7b4a26"/><circle cx="23" cy="28" r="5" fill="#7b4a26"/><path d="M28 18h8" fill="none"/><path d="M30 8l3-4 2 5z" fill="#9b8f84"/>'),
    chainsaw: g('<rect x="4" y="14" width="15" height="14" rx="4" fill="#ff8a1f"/><path d="M19 16h15a4 4 0 0 1 0 8H19z" fill="#dfe6ee"/><path d="M8 14c0-5 8-5 8 0" fill="none"/><circle cx="7" cy="9" r="2.5" fill="#ddd" stroke-width="2"/>'),
    sawmill: g('<path d="M5 18l10-9 10 9v16H5z" fill="#c98b4f"/><circle cx="29" cy="25" r="8" fill="#dfe6ee"/><circle cx="29" cy="25" r="2" fill="#1b1b1b"/><rect x="11" y="24" width="7" height="10" fill="#7b4a26"/>'),
    crew: g('<circle cx="12" cy="22" r="7" fill="#f6c89a"/><circle cx="28" cy="22" r="7" fill="#e8b585"/><path d="M5 20a7 7 0 0 1 14 0zM21 20a7 7 0 0 1 14 0z" fill="#ffc928"/><circle cx="20" cy="15" r="7" fill="#f6c89a"/><path d="M13 13a7 7 0 0 1 14 0z" fill="#ffc928"/><path d="M7 36c0-5 26-5 26 0" fill="#ff8a1f"/>'),
    splitter: g('<rect x="6" y="28" width="28" height="7" rx="2" fill="#5a6470"/><path d="M14 6h12v10l-6 8-6-8z" fill="#e8443a"/><rect x="17" y="2" width="6" height="5" fill="#8f9aa6"/><rect x="12" y="24" width="7" height="5" fill="#a8693a"/><rect x="21" y="24" width="7" height="5" fill="#a8693a"/>'),
    skidSteer: g('<path d="M8 12h16v16H8z" fill="#ffc928"/><rect x="11" y="15" width="10" height="7" fill="#bfe6ff"/><path d="M24 20h6l5 8H24z" fill="#8f9aa6"/><circle cx="12" cy="31" r="4" fill="#333"/><circle cx="22" cy="31" r="4" fill="#333"/>'),
    feller: g('<rect x="4" y="22" width="18" height="10" rx="3" fill="#2f9e44"/><circle cx="9" cy="33" r="3" fill="#333"/><circle cx="18" cy="33" r="3" fill="#333"/><path d="M18 22l8-12" fill="none" stroke-width="4"/><path d="M26 8c6 0 9 4 9 8M26 8c-1 6 2 10 7 12" fill="none" stroke-width="3.5"/>'),
    flume: g('<path d="M3 12l34 14v6L3 18z" fill="#5ec2ff"/><path d="M3 18l34 14" fill="none"/><rect x="12" y="11" width="12" height="6" rx="3" fill="#a8693a" transform="rotate(22 18 14)"/>'),
    mech: g('<rect x="11" y="6" width="16" height="14" rx="3" fill="#8f9aa6"/><rect x="14" y="10" width="10" height="4" fill="#5ec2ff"/><path d="M14 20l-3 14M24 20l3 14" fill="none" stroke-width="4"/><circle cx="33" cy="15" r="5" fill="#dfe6ee"/><path d="M27 13h2" fill="none"/>'),
    trucks: g('<rect x="3" y="12" width="20" height="14" rx="2" fill="#c98b4f"/><path d="M23 16h8l5 6v4H23z" fill="#e8443a"/><circle cx="9" cy="29" r="4" fill="#333"/><circle cx="29" cy="29" r="4" fill="#333"/><path d="M6 16h14M6 21h14" fill="none" stroke-width="2"/>'),
    thunderAxe: g('<path d="M21 3L9 22h9l-4 15 15-21h-9l5-13z" fill="#ffe25a"/>'),
    skyCrane: g('<path d="M4 9h32" fill="none"/><path d="M20 9v4" fill="none"/><path d="M8 16h18a6 6 0 0 1 0 12H14z" fill="#e8443a"/><rect x="18" y="18" width="7" height="5" fill="#bfe6ff"/><path d="M8 18L3 14" fill="none"/>'),
    robots: g('<rect x="9" y="12" width="22" height="16" rx="4" fill="#b8c2cc"/><circle cx="15" cy="20" r="3" fill="#ff5a4f"/><circle cx="25" cy="20" r="3" fill="#ff5a4f"/><path d="M20 12V6" fill="none"/><circle cx="20" cy="5" r="2.5" fill="#ffc83a"/><path d="M14 28v6M26 28v6" fill="none" stroke-width="4"/>'),
    drill: g('<rect x="4" y="13" width="14" height="14" rx="3" fill="#ffc928"/><path d="M18 11l18 9-18 9z" fill="#b8c2cc"/><path d="M22 14l3 12M28 17l1.5 6" fill="none" stroke-width="2.5"/>'),
    megafactory: g('<path d="M3 36V20l8 5v-5l8 5v-5l8 5V8h6v28z" fill="#9b8f84"/><rect x="7" y="28" width="5" height="5" fill="#ffe25a"/><rect x="16" y="28" width="5" height="5" fill="#ffe25a"/><circle cx="31" cy="4" r="3" fill="#ddd" stroke-width="2"/>'),
    satellite: g('<rect x="15" y="14" width="10" height="10" rx="2" fill="#dfe6ee"/><rect x="2" y="15" width="11" height="8" fill="#3b6fe0"/><rect x="27" y="15" width="11" height="8" fill="#3b6fe0"/><path d="M20 24l-3 13h6z" fill="#ff5a4f" stroke-width="2"/>'),
    giantAxe: g('<path d="M23 4l4 3-16 30-4-3z" fill="#ffc83a"/><path d="M19 7c9-7 19-3 19 7l-15 3z" fill="#7ff0ff"/><circle cx="10" cy="9" r="2" fill="#fff" stroke-width="2"/>'),
    portal: g('<ellipse cx="20" cy="20" rx="15" ry="17" fill="#9b5de5"/><ellipse cx="20" cy="20" rx="10" ry="12" fill="#c77dff"/><path d="M20 20c0-5 6-5 6 0s-6 8-11 3-3-12 5-12" fill="none" stroke="#fff" stroke-width="2.5"/>')
  };
  const ACH_SVG = { lifetimeWood: ICONS.log, clicks: ICONS.cursor,
    squirrels: g('<path d="M25 30c10 0 12-14 4-20-6-4-12 2-8 8" fill="#ffc83a"/><ellipse cx="16" cy="26" rx="8" ry="8" fill="#ffb300"/><circle cx="12" cy="16" r="6" fill="#ffb300"/><circle cx="10" cy="15" r="1.3" fill="#1b1b1b"/>'),
    frenzies: g('<path d="M20 4c4 8 12 10 12 20a12 12 0 0 1-24 0c0-6 4-8 5-13 3 3 3 6 5 7 1-5 0-9 2-14z" fill="#ff8a1f"/><path d="M20 22c3 3 5 5 5 9a5 5 0 0 1-10 0c0-3 3-5 5-9z" fill="#ffe25a"/>'),
    rebirths: ICONS.sprout, coffees: ICONS.coffee,
    height: g('<rect x="13" y="3" width="14" height="34" rx="2" fill="#ffc83a"/><path d="M13 9h6M13 15h4M13 21h6M13 27h4M13 33h6" fill="none" stroke-width="2.5"/>') };

  function upIcon(id){
    try {
      const u3 = TCS.upgrades3d;
      if (u3 && typeof u3.icon === 'function'){
        const v = u3.icon(id);
        if (v){
          if (typeof v === 'string') return v.startsWith('<') ? v : '<img src="' + v + '" alt="">';
          if (v.toDataURL) return '<img src="' + v.toDataURL() + '" alt="">';
          if (v.nodeType) return v.outerHTML;
        }
      }
    } catch(e){}
    return UP_SVG[id] || ('<span class="emo">' + (UP_EMOJI[id] || '?') + '</span>');
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
  function el(tag, cls, html, parent){ const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; if (parent) parent.appendChild(e); return e; }
  // text setter that only touches the DOM when the value changes
  function txt(e, v){ if (e._t !== v){ e._t = v; e.textContent = v; } }
  function cls(e, c, on){ on = !!on; if (e['_c' + c] !== on){ e['_c' + c] = on; e.classList.toggle(c, on); } }

  const PERK_EMOJI = { strongArms:'\u{1F4AA}', earlyBird:'\u{1F426}', luckySquirrel:'\u{1F43F}\uFE0F', autoSwing:'\u{1F501}',
    unionContract:'\u{1F4DC}', longerFrenzy:'\u{1F525}', nightShift:'\u{1F319}', seedBank:'\u{1F3E6}' };

  /* ---------- detail tips: hover (mouse) or long-press (touch) ---------- */
  let tipEl = null, tipOwner = null;
  function showTip(owner, html){
    if (!tipEl) return; tipOwner = owner;
    tipEl.innerHTML = '<span class="outlined outlined-sm">' + html + '</span>';
    const r = owner.getBoundingClientRect(), phone = window.innerWidth < 600;
    tipEl.classList.add('on');
    const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    let x, y;
    if (phone){ x = U.clamp(r.left + r.width / 2 - tw / 2, 6, window.innerWidth - tw - 6); y = r.top - th - 8; if (y < 6) y = r.bottom + 8; }
    else { x = r.left - tw - 12; y = U.clamp(r.top + r.height / 2 - th / 2, 6, window.innerHeight - th - 6); if (x < 6) x = r.right + 12; }
    tipEl.style.left = Math.round(x) + 'px'; tipEl.style.top = Math.round(y) + 'px';
  }
  function hideTip(){ if (tipEl){ tipEl.classList.remove('on'); tipOwner = null; } }
  function attachTip(c, html){
    c.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') showTip(c, html()); });
    c.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && tipOwner === c) hideTip(); });
    let timer = null;
    c.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse') return;
      clearTimeout(timer); c._tipped = false;
      timer = setTimeout(() => { c._tipped = true; showTip(c, html()); setTimeout(() => { if (tipOwner === c) hideTip(); }, 2200); }, 450);
    });
    const stop = () => clearTimeout(timer);
    c.addEventListener('pointerup', stop); c.addEventListener('pointercancel', stop);
    c.addEventListener('pointermove', e => { if (e.pointerType !== 'mouse' && (Math.abs(e.movementX) + Math.abs(e.movementY)) > 4) stop(); });
    c.addEventListener('contextmenu', e => e.preventDefault());
  }

  /* ---------- state ---------- */
  let hudEls = null, root = [], shop, body, footer, footMult, backBtn, title, panel = 'shop';
  const panels = {};
  let cards = {}, techCards = {}, techKey = '', revealKey = '';
  let achBtnCount, coffeeBtn, coffeeWipe, coffeeTime, frenzyEl, frenzyFill, toastWrap;
  let slowT = 0;

  function init(){
    const layer = document.getElementById('ui-layer');
    // HUD (ids kept: #hud, #hud-wood-icon)
    const hud = el('div', null, null, layer); hud.id = 'hud';
    hud.innerHTML =
      '<div class="row outlined"><span class="icon" id="hud-wood-icon">' + ICONS.log + '</span><span id="hud-wood">x0</span></div>' +
      '<div class="row small outlined"><span class="icon">' + ICONS.cursor + '</span><span id="hud-click">1/click</span></div>' +
      '<div class="row small outlined"><span class="icon">' + ICONS.gear + '</span><span id="hud-sec">0/second</span></div>' +
      '<div class="outlined outlined-sm" id="hud-height">0 m</div>';
    hudEls = { wood: hud.querySelector('#hud-wood'), click: hud.querySelector('#hud-click'), sec: hud.querySelector('#hud-sec'), height: hud.querySelector('#hud-height') };
    root.push(hud);

    // shop column
    shop = el('div', 'card-panel', null, layer); shop.id = 'shop'; root.push(shop);
    title = el('div', 'shop-title outlined', 'SHOP', shop);
    body = el('div', 'shop-scroll', null, shop);
    footer = el('div', 'shop-footer', null, shop);
    footMult = el('div', 'foot-mult outlined outlined-sm', 'X1.00', shop);
    footMult.title = 'Total multiplier';
    backBtn = el('button', 'btn back-btn', 'BACK', footer);
    backBtn.addEventListener('click', () => open('shop'));
    makeDragScroll(body);

    panels.shop = el('div', 'panel panel-shop', null, body);
    panels.achievements = el('div', 'panel panel-ach', null, body);
    panels.rebirth = el('div', 'panel panel-rebirth', null, body);
    panels.settings = el('div', 'panel panel-settings', null, body);
    panels.outfit = el('div', 'panel panel-outfit', null, body);
    buildShop(); buildAch(); buildRebirth(); buildSettings();

    // icon column
    const col = el('div', null, null, layer); col.id = 'icon-col'; root.push(col);
    const iconBtn = (name, icon, fn, extra) => { const b = el('button', 'icon-btn ' + name, '<span class="ib-icon">' + icon + '</span>' + (extra || ''), col); b.title = name; b.addEventListener('click', fn); return b; };
    const ab = iconBtn('achievements', ICONS.trophy, () => toggle('achievements'), '<span class="ib-count outlined outlined-sm">0/0</span>');
    achBtnCount = ab.querySelector('.ib-count');
    coffeeBtn = iconBtn('coffee', ICONS.coffee, () => { const s = S(); if (s.canCoffee && s.canCoffee()) s.startCoffee(); }, '<span class="ib-wipe"></span><span class="ib-time outlined outlined-sm"></span>');
    coffeeWipe = coffeeBtn.querySelector('.ib-wipe'); coffeeTime = coffeeBtn.querySelector('.ib-time');
    iconBtn('rebirth', ICONS.sprout, () => toggle('rebirth'));

    // outfit buttons
    const ob = el('div', null, null, layer); ob.id = 'outfit-btns'; root.push(ob);
    ['hat', 'face', 'boots'].forEach(slot => {
      const b = el('button', 'outfit-btn', ICONS[slot], ob); b.title = slot;
      b.addEventListener('click', () => { if (panel === 'outfit' && outfitSlot === slot) open('shop'); else { outfitSlot = slot; open('outfit'); } });
    });

    // axe frenzy meter
    frenzyEl = el('div', null, null, layer); frenzyEl.id = 'frenzy'; root.push(frenzyEl);
    // chunky outlined axe: big crescent blade + poll on a long handle; the whole silhouette fills bottom-up
    const axeShape = 'M35 14 h11 v108 a5.5 5.5 0 0 1 -11 0 Z M37 12 L13 4 C-1 18 -1 52 13 66 L37 56 Z M44 18 h13 a3 3 0 0 1 3 3 v22 a3 3 0 0 1 -3 3 h-13 Z';
    frenzyEl.innerHTML = '<svg viewBox="-4 0 70 130"><defs><clipPath id="axeClip"><path d="' + axeShape + '"/></clipPath>' +
      '<linearGradient id="fzGrad" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#ff6a00"/><stop offset="1" stop-color="#ffc83a"/></linearGradient></defs>' +
      '<path d="' + axeShape + '" fill="#fff"/>' +
      '<g clip-path="url(#axeClip)"><rect class="fz-fill" x="-4" y="130" width="70" height="130" fill="url(#fzGrad)"/>' +
      '<path d="M8 14 C2 26 2 44 8 56" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="3" stroke-linecap="round"/></g>' +
      '<path d="' + axeShape + '" fill="none" stroke="' + INK + '" stroke-width="5" stroke-linejoin="round"/>' +
      '<path d="M35 14 v44 M46 18 v28" stroke="' + INK + '" stroke-width="3"/></svg>';
    frenzyFill = frenzyEl.querySelector('.fz-fill');
    frenzyEl.addEventListener('pointerdown', e => e.stopPropagation());

    toastWrap = el('div', 'passthrough', null, layer); toastWrap.id = 'toasts'; root.push(toastWrap);
    tipEl = el('div', 'tip passthrough', null, layer); tipEl.id = 'tip'; root.push(tipEl);

    // Esc toggles Settings (not while typing, in the title menu or during the stage cinematic)
    window.addEventListener('keydown', e => {
      if (e.key !== 'Escape' && e.code !== 'Escape') return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const s = S();
      if (!s || !s.loaded || !shown || rebirthing || window.__fxCine || (TCS.scene && TCS.scene.mode !== 'play')) return;
      e.preventDefault(); hideTip();
      toggle('settings');
    });
    // bus
    // show the welcome-back screen once the game view is up (after load / returning from the menu)
    bus.on('load', () => setTimeout(offlineCard, 400));
    bus.on('gameStart', () => setTimeout(offlineCard, 400));
    bus.on('achievement', e => { toastAch(e && e.ach); dirtyAch = true; });
    bus.on('owned', () => { revealKey = ''; techKey = ''; });
    bus.on('buy', () => { techKey = ''; });
    bus.on('buyTech', () => { techKey = ''; });
    bus.on('load', () => { revealKey = ''; techKey = ''; dirtyAch = true; open('shop'); syncSettings(); });
    bus.on('rebirth', () => { revealKey = ''; techKey = ''; });
    bus.on('settings', () => syncSettings());
    bus.on('cosmeticUnlock', () => { if (panel === 'outfit') buildOutfit(); });
    bus.on('equip', () => { if (panel === 'outfit') buildOutfit(); });
    open('shop');
    layer.addEventListener('click', e => {
      const b = e.target.closest && e.target.closest('button');
      if (!b || !root.some(r => r.contains(b)) || b.closest('.up-card,.tech-card,.perk-card,.perk-tile')) return;
      if (b.classList.contains('rb-btn') && b.classList.contains('disabled')) sfx('denied'); else sfx('click');
    });
  }

  /* ---------- drag + wheel scrolling ---------- */
  function makeDragScroll(sc){
    // wheel + scrollbar + touch are native (overflow-y:auto). Mouse/pen drag is added here; touch also handled
    // manually so dragging starting on a button still scrolls.
    let id = null, y0 = 0, s0 = 0, moved = false;
    sc.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      if (e.target.closest('input,textarea,select')) return;
      id = e.pointerId; y0 = e.clientY; s0 = sc.scrollTop; moved = false;
    });
    sc.addEventListener('pointermove', e => {
      if (e.pointerId !== id) return;
      const dy = e.clientY - y0;
      if (!moved && Math.abs(dy) > 6){ moved = true; try { sc.setPointerCapture(id); } catch(_){} sc.classList.add('dragging'); }
      if (moved) sc.scrollTop = s0 - dy;
    });
    const end = e => { if (e.pointerId !== id) return; id = null; sc.classList.remove('dragging'); if (moved) setTimeout(() => moved = false, 0); };
    sc.addEventListener('pointerup', end); sc.addEventListener('pointercancel', end);
    sc.addEventListener('click', e => { if (moved){ e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
    // keep the wheel inside the panel
    sc.addEventListener('wheel', e => e.stopPropagation(), { passive: true });
  }

  /* ---------- panel switching ---------- */
  const TITLES = { shop: 'SHOP', achievements: 'ACHIEVEMENTS', rebirth: 'NEXT STAGE', settings: 'SETTINGS', outfit: 'OUTFIT' };
  let outfitSlot = 'hat';
  function toggle(p){ open(panel === p ? 'shop' : p); }
  function open(p){
    if (!panels[p]) p = 'shop';
    panel = p;
    for (const k in panels) panels[k].style.display = k === p ? '' : 'none';
    title.textContent = p === 'outfit' ? ({hat:'HATS', face:'FACE', boots:'BOOTS'})[outfitSlot] : TITLES[p];
    shop.dataset.panel = p;
    footMult.style.display = p === 'shop' ? '' : 'none';
    footer.style.display = p === 'shop' ? 'none' : '';
    hideTip();
    if (p === 'achievements') refreshAch(true);
    if (p === 'rebirth') refreshRebirth();
    if (p === 'settings') syncSettings();
    if (p === 'outfit') buildOutfit();
    body.scrollTop = 0;
    document.querySelectorAll('#icon-col .icon-btn').forEach(b => b.classList.toggle('active', b.title === p));
  }

  /* ---------- sounds ---------- */
  function sfx(n){ try { TCS.audio.play(n); } catch(e){} }
  function denied(c){ sfx('denied'); if (c){ c.classList.remove('nope'); void c.offsetWidth; c.classList.add('nope'); } }

  /* ---------- shop ---------- */
  function typeBadge(type){ return '<span class="badge ' + (type === 'click' ? 'b-click' : 'b-sec') + '">' + (type === 'click' ? ICONS.cursor : ICONS.gear) + '</span>'; }
  function buildShop(){
    const p = panels.shop;
    p.innerHTML = '';
    const techList = el('div', 'tech-list', null, p);
    panels.techList = techList;
    D.UPGRADES.forEach((u, i) => {
      const c = el('button', 'card up-card locked', null, p);
      c.innerHTML = '<span class="c-icon" style="background:' + UP_TINT[i % UP_TINT.length] + '">' + upIcon(u.id) + '</span>' +
        '<span class="c-main"><span class="c-name outlined outlined-sm">' + esc(u.name) + '</span>' +
        '<span class="c-cost outlined outlined-sm"><i class="mini">' + ICONS.log + '</i><b></b></span></span>' +
        '<span class="c-lvl"><span class="lvl-txt outlined outlined-sm"></span><span class="lvl-bar"><i></i></span></span>' + typeBadge(u.type);
      c.addEventListener('click', () => { if (c._tipped){ c._tipped = false; return; } if (!S().buy(u.id)) denied(c); });
      attachTip(c, () => {
        const s = S(), out = u.value * (s.techMult ? s.techMult(u.id) * s.techMult(u.type) : 1);
        return '<b>' + esc(u.name) + '</b><br>+' + U.fmt(out, { decimals: 1 }) + (u.type === 'click' ? ' PER CLICK' : ' PER SECOND') + ' EACH';
      });
      cards[u.id] = { el: c, cost: c.querySelector('.c-cost b'), lvl: c.querySelector('.lvl-txt'), bar: c.querySelector('.lvl-bar i'), u };
    });
  }
  function techLabel(t){
    return t.desc || (t.effect && (D.upgradeById[t.effect.target] ? D.upgradeById[t.effect.target].name : t.effect.target) + ' x' + t.effect.mult);
  }
  function rebuildTech(list){
    const wrap = panels.techList;
    const want = new Set(list.map(t => t.id));
    for (const id in techCards) if (!want.has(id)){ techCards[id].el.remove(); delete techCards[id]; }
    list.forEach(t => {
      if (techCards[t.id]) return;
      const target = t.effect && D.upgradeById[t.effect.target] ? t.effect.target : null;
      const c = el('button', 'card tech-card', null, wrap);
      c.innerHTML = '<span class="c-icon tech-icon">' + (target ? upIcon(target) : (({ worker: ICONS.hat, machine: ICONS.gear, click: ICONS.cursor })[t.effect && t.effect.target] || ICONS.star)) +
        '<span class="tier">' + '★'.repeat(t.tier || 1) + '</span></span>' +
        '<span class="c-main"><span class="c-name outlined outlined-sm">' + esc(t.name) + '</span>' +
        '<span class="c-cost outlined outlined-sm"><i class="mini">' + ICONS.log + '</i><b></b></span></span>' +
        '<span class="badge b-tech">' + ICONS.star + '</span>';
      c.addEventListener('click', () => { if (c._tipped){ c._tipped = false; return; } if (S().buyTech(t.id)) sfx('buy'); else denied(c); });
      attachTip(c, () => '<b>' + esc(t.name) + '</b><br>' + esc(techLabel(t)));
      techCards[t.id] = { el: c, t, cost: c.querySelector('.c-cost b') };
    });
    // keep order cheapest first
    list.slice().sort((a, b) => a.cost - b.cost).forEach(t => wrap.appendChild(techCards[t.id].el));
  }
  function updateShop(){
    const s = S(), d = s.data;
    // tech list
    const av = s.availableTech ? s.availableTech() : [];
    const key = av.map(t => t.id).join(',');
    if (key !== techKey){ techKey = key; rebuildTech(av); }
    for (const id in techCards){ const tc = techCards[id], tcost = s.techCost(id); cls(tc.el, 'afford', d.wood >= tcost); cls(tc.el, 'locked', d.wood < tcost); txt(tc.cost, U.fmt(tcost)); }
    // reveal: every upgrade up to the highest owned, plus exactly one locked card after it
    let maxI = 1;
    D.UPGRADES.forEach((u, i) => { if ((d.owned[u.id] || 0) > 0) maxI = Math.max(maxI, i + 1); });
    const rk = String(maxI);
    if (rk !== revealKey){ revealKey = rk; D.UPGRADES.forEach((u, i) => { cards[u.id].el.style.display = i <= maxI ? '' : 'none'; }); }
    for (const u of D.UPGRADES){
      const c = cards[u.id];
      const n = d.owned[u.id] || 0, max = u.max, isMax = n >= max, cost = isMax ? Infinity : s.upgradeCost(u.id);
      txt(c.cost, isMax ? 'MAX' : U.fmt(Math.ceil(cost)));
      txt(c.lvl, n + '/' + max);
      const w = Math.round(n / max * 100) + '%';
      if (c.bar._w !== w){ c.bar._w = w; c.bar.style.width = w; }
      cls(c.el, 'maxed', isMax);
      cls(c.el, 'afford', !isMax && d.wood >= cost);
      cls(c.el, 'locked', !isMax && d.wood < cost);
    }
    txt(footMult, 'X' + s.multiplier().toFixed(2));
  }

  /* ---------- achievements ---------- */
  let achCells = {}, achInfo, dirtyAch = true;
  function buildAch(){
    const p = panels.achievements;
    achInfo = el('div', 'ach-info outlined outlined-sm', '', p); achInfo.style.display = 'none';
    const grid = el('div', 'ach-grid', null, p);
    D.ACHIEVEMENTS.forEach(a => {
      const stat = a.stat.indexOf('own:') === 0 ? null : a.stat;
      const ic = stat ? (ACH_SVG[stat] || ICONS.star) : (UP_SVG[a.stat.slice(4)] || ICONS.star);
      const c = el('button', 'ach-cell', '<span class="ach-ic">' + ic + '</span>' + (a.cosmetic ? '<span class="ach-gift">' + ICONS.hat + '</span>' : ''), grid);
      c.addEventListener('click', () => {
        const s = S(); const have = s.data.achievements[a.id];
        if (achInfo._id === a.id && achInfo.style.display !== 'none'){ achInfo.style.display = 'none'; return; }
        achInfo._id = a.id; achInfo.style.display = '';
        achInfo.innerHTML = '<b>' + esc(a.name) + '</b><br>' + esc(a.desc) + (have ? ' ✔' : ' (' + U.fmt(Math.min(s.statValue(a.stat), a.n)) + '/' + U.fmt(a.n) + ')') +
          (a.cosmetic && D.cosmeticById[a.cosmetic] ? '<br>REWARD: ' + esc(D.cosmeticById[a.cosmetic].name) : '');
      });
      achCells[a.id] = c;
    });
  }
  function refreshAch(force){
    if (!dirtyAch && !force) return; dirtyAch = false;
    const got = S().data.achievements;
    for (const id in achCells) cls(achCells[id], 'got', got[id]);
  }

  /* ---------- rebirth ---------- */
  let rb = {};
  function buildRebirth(){
    const p = panels.rebirth;
    p.innerHTML =
      '<div class="rb-top"><div class="rb-next outlined"></div>' +
      '<div class="rb-prog"><i></i><span class="outlined outlined-sm"></span></div>' +
      '<button class="btn rb-btn">GO <span class="rb-gain"></span><i class="mini">' + ICONS.acorn + '</i></button></div>' +
      '<div class="sec-title outlined"><i class="mini">' + ICONS.acorn + '</i><span class="rb-acorns"></span></div><div class="perk-grid"></div>';
    rb = { next: p.querySelector('.rb-next'), prog: p.querySelector('.rb-prog i'), progTxt: p.querySelector('.rb-prog span'), acorns: p.querySelector('.rb-acorns'), gain: p.querySelector('.rb-gain'), btn: p.querySelector('.rb-btn'), perks: {} };
    rb.btn.addEventListener('click', doRebirth);
    const list = p.querySelector('.perk-grid');
    D.PERKS.forEach(pk => {
      const c = el('button', 'perk-tile', '<span class="pt-icon emo">' + (PERK_EMOJI[pk.id] || '\u{1F330}') + '</span><span class="pt-lvl outlined outlined-sm"></span>' +
        '<span class="pt-cost outlined outlined-sm"><i class="mini">' + ICONS.acorn + '</i><b></b></span>', list);
      c.dataset.perk = pk.id;
      c.addEventListener('click', () => { if (c._tipped){ c._tipped = false; return; } if (S().buyPerk(pk.id)) sfx('buy'); else denied(c); refreshRebirth(); });
      attachTip(c, () => '<b>' + esc(pk.name) + '</b><br>' + esc(pk.desc));
      rb.perks[pk.id] = { el: c, cost: c.querySelector('.pt-cost b'), lvl: c.querySelector('.pt-lvl') };
    });
  }
  let rebirthing = false;
  function doRebirth(){
    const s = S();
    if (rebirthing) return;
    if (!s.canRebirth()) return; // the layer click handler already plays 'denied'
    rebirthing = true; open('shop');
    const go = () => { rebirthing = false; try { s.rebirth(); } catch(e){ console.error(e); } };
    try { if (TCS.fx && TCS.fx.rebirthCinematic) TCS.fx.rebirthCinematic(go); else go(); } catch(e){ console.error(e); go(); }
  }
  function refreshRebirth(){
    const s = S(), d = s.data;
    txt(rb.next, s.stage(d.speciesIndex + 1).name);
    txt(rb.acorns, U.fmt(d.acorns));
    const need = D.UPGRADES.length - D.REBIRTH_ALLOWED_UNMAXED, have = Math.min(need, s.maxedCount());
    txt(rb.progTxt, 'MAXED ' + have + '/' + need);
    const w = Math.round(have / need * 100) + '%'; if (rb.prog._w !== w){ rb.prog._w = w; rb.prog.style.width = w; }
    txt(rb.gain, '+' + U.fmt(Math.max(0, s.acornsOnRebirth())));
    const ok = s.canRebirth();
    cls(rb.btn, 'disabled', !ok);
    rb.btn.setAttribute('aria-disabled', String(!ok));
    D.PERKS.forEach(pk => {
      const r = rb.perks[pk.id], lvl = s.perk(pk.id), cost = s.perkCost(pk.id), max = !isFinite(cost);
      txt(r.cost, max ? 'MAX' : U.fmt(cost));
      txt(r.lvl, lvl + '/' + pk.costs.length);
      cls(r.el, 'afford', !max && d.acorns >= cost); cls(r.el, 'locked', !max && d.acorns < cost); cls(r.el, 'maxed', max);
    });
  }

  /* ---------- settings ---------- */
  let st = {};
  function buildSettings(){
    const p = panels.settings;
    p.innerHTML =
      '<label class="set-row outlined outlined-sm">MUSIC<input type="range" min="0" max="1" step="0.05" data-k="music"></label>' +
      '<label class="set-row outlined outlined-sm">SFX<input type="range" min="0" max="1" step="0.05" data-k="sfx"></label>' +
      '<div class="set-row outlined outlined-sm">GRAPHICS<span class="seg" data-k="graphics"><button data-v="low">LOW</button><button data-v="high">HIGH</button></span></div>' +
      '<div class="set-row outlined outlined-sm">NUMBERS<span class="seg" data-k="numberFormat"><button data-v="short">1.2K</button><button data-v="scientific">1.2E3</button></span></div>' +
      '<div class="ctl-box"><div class="sec-title outlined">CONTROLS</div>' +
        '<div class="set-row outlined outlined-sm">CHOP<button class="bind-btn" data-i="0"></button></div>' +
        '<div class="set-row outlined outlined-sm">CHOP<button class="bind-btn" data-i="1"></button></div>' +
        '<div class="bind-foot"><span class="bind-msg outlined outlined-sm"></span><button class="bind-reset outlined outlined-sm">RESET</button></div></div>' +
      '<div class="sec-title outlined">SAVE</div>' +
      '<textarea class="save-box" spellcheck="false" placeholder="PASTE SAVE HERE"></textarea>' +
      '<div class="set-btns"><button class="btn b-export">EXPORT</button><button class="btn b-import">IMPORT</button></div>' +
      '<div class="save-msg outlined outlined-sm"></div>' +
      '<div class="admin-box" hidden><div class="sec-title outlined">ADMIN</div>' +
        '<input class="adm-search" type="text" placeholder="SEARCH USERNAME" hidden>' +
        '<select class="adm-target"></select>' +
        '<div class="adm-row"><input class="adm-amt" type="text" inputmode="decimal" placeholder="AMOUNT (E.G. 5000 OR 2.5M)">' +
          '<div class="adm-kind"><button data-v="logs" class="on">LOGS</button><button data-v="acorns">ACORNS</button><button data-v="rebirths">REBIRTHS</button></div></div>' +
        '<div class="set-btns"><button class="btn b-give">GIVE</button><button class="btn red b-take">TAKE</button></div>' +
        '<div class="adm-msg outlined outlined-sm"></div></div>' +
      '<div class="set-btns"><button class="btn b-switch">SWITCH PROFILE</button><button class="btn red b-logout">LOG OUT</button></div>';
    st.ranges = p.querySelectorAll('input[type=range]');
    st.segs = p.querySelectorAll('.seg');
    st.box = p.querySelector('.save-box'); st.msg = p.querySelector('.save-msg');
    buildBinds(p);
    st.ranges.forEach(r => r.addEventListener('input', () => S().setSetting(r.dataset.k, parseFloat(r.value))));
    st.segs.forEach(sg => sg.addEventListener('click', e => { const b = e.target.closest('button'); if (b) S().setSetting(sg.dataset.k, b.dataset.v); }));
    p.querySelector('.b-export').addEventListener('click', () => {
      st.box.value = S().exportSave(); st.box.select();
      try { navigator.clipboard && navigator.clipboard.writeText(st.box.value).catch(() => {}); } catch(e){}
      st.msg.textContent = 'COPIED';
    });
    p.querySelector('.b-import').addEventListener('click', () => {
      const ok = st.box.value.trim() && S().importSave(st.box.value.trim());
      st.msg.textContent = ok ? 'SAVE LOADED' : 'INVALID SAVE';
    });
    st.admin = p.querySelector('.admin-box'); st.admTarget = p.querySelector('.adm-target');
    st.admAmt = p.querySelector('.adm-amt'); st.admMsg = p.querySelector('.adm-msg');
    st.admSearch = p.querySelector('.adm-search');
    st.admSearch.hidden = !(TCS.cloud && TCS.cloud.active);
    st.admSearch.addEventListener('change', fillAdminTargets);
    st.admSearch.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') st.admSearch.blur(); });
    st.admKind = 'logs';
    const kindSeg = p.querySelector('.adm-kind');
    kindSeg.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      st.admKind = b.dataset.v; kindSeg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    });
    const adminDo = sign => {
      const s = S(); if (!s.isAdmin()) return;
      let n = parseAmount(st.admAmt.value);
      const kind = st.admKind, unit = kind === 'acorns' ? 'ACORNS' : kind === 'rebirths' ? (Math.round(n) === 1 ? 'REBIRTH' : 'REBIRTHS') : 'LOGS';
      if (kind !== 'logs') n = Math.round(n);
      const [u, slot] = (st.admTarget.value || '').split('|');
      if (!u){ st.admMsg.textContent = 'PICK A PLAYER'; return; }
      if (!(n > 0)){ st.admMsg.textContent = 'ENTER AN AMOUNT'; return; }
      st.admMsg.textContent = '...';
      Promise.resolve(s.adminAdjust(u, +slot, kind, sign * n)).then(ok => {
        st.admMsg.textContent = ok ? (sign > 0 ? 'GAVE ' : 'TOOK ') + U.fmt(n) + ' ' + unit : 'FAILED';
        if (ok) fillAdminTargets();
      });
    };
    p.querySelector('.b-give').addEventListener('click', () => adminDo(1));
    p.querySelector('.b-take').addEventListener('click', () => adminDo(-1));
    p.querySelector('.b-switch').addEventListener('click', () => {
      try { TCS.menu.switchProfile(); } catch(e){ console.error(e); }
    });
    p.querySelector('.b-logout').addEventListener('click', () => {
      try { TCS.menu.logout(); } catch(e){ console.error(e); }
    });
  }
  // controls: click a bind, then press a key or click a mouse button (Esc cancels)
  function buildBinds(p){
    const B = TCS.binds; if (!B){ p.querySelector('.ctl-box').hidden = true; return; }
    const btns = [...p.querySelectorAll('.bind-btn')], msg = p.querySelector('.bind-msg');
    let cap = -1;
    const draw = () => { const b = B.get(); btns.forEach((x, i) => { x.textContent = cap === i ? 'PRESS A KEY...' : B.label(b[i]); x.classList.toggle('wait', cap === i); }); };
    const stop = () => { cap = -1; B.capturing = false; window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', onPtr, true); window.removeEventListener('contextmenu', noMenu, true); draw(); };
    const take = code => {
      const r = B.set(cap, code);
      msg.textContent = r === 'reserved' ? B.label(code) + ' IS ALREADY USED' : '';
      stop();
    };
    const onKey = e => { e.preventDefault(); e.stopImmediatePropagation(); if (e.repeat) return; if (e.code === 'Escape'){ msg.textContent = ''; stop(); return; } if (e.code) take(e.code); };
    const onPtr = e => { if (e.pointerType && e.pointerType !== 'mouse') return; e.preventDefault(); e.stopImmediatePropagation(); take('Mouse' + (e.button || 0)); };
    const noMenu = e => { e.preventDefault(); e.stopImmediatePropagation(); if (cap >= 0) take('Mouse2'); };   // fallback when a right click sends no pointerdown
    btns.forEach((x, i) => x.addEventListener('click', e => {
      e.stopPropagation();
      if (cap >= 0) return;
      cap = i; B.capturing = true; msg.textContent = 'ESC TO CANCEL'; draw();
      setTimeout(() => { if (cap !== i) return; window.addEventListener('keydown', onKey, true); window.addEventListener('pointerdown', onPtr, true); window.addEventListener('contextmenu', noMenu, true); }, 0);
    }));
    p.querySelector('.bind-reset').addEventListener('click', () => { if (cap >= 0) stop(); B.reset(); msg.textContent = ''; draw(); });
    st.drawBinds = () => { if (cap >= 0) stop(); msg.textContent = ''; draw(); };
    draw();
  }
  // "5000", "2.5k", "3M", "1e12", "1,000" -> number
  function parseAmount(v){
    v = String(v || '').trim().toLowerCase().replace(/[,\s]/g, '');
    const m = v.match(/^(\d*\.?\d+(?:e\d+)?)([a-z]*)$/); if (!m) return NaN;
    const suf = { '': 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12, qa: 1e15, qi: 1e18, sx: 1e21, sp: 1e24, oc: 1e27, no: 1e30, dc: 1e33 }[m[2]];
    return suf ? parseFloat(m[1]) * suf : NaN;
  }
  function fillAdminTargets(){
    const keep = st.admTarget.value, ticket = fillAdminTargets.n = (fillAdminTargets.n || 0) + 1;
    // local mode returns rows, cloud mode a Promise (key = uid); optional username search in cloud mode
    Promise.resolve(S().adminTargets(st.admSearch && !st.admSearch.hidden ? st.admSearch.value : '')).catch(() => []).then(rows => {
      if (ticket !== fillAdminTargets.n) return;
      st.admTarget.innerHTML = (rows || []).map(t =>
        '<option value="' + esc(t.key || t.username) + '|' + t.slot + '">' + (t.self ? 'ME' : esc(t.username)) + ' - ' + esc(t.name) +
        ' (' + U.fmt(Math.floor(t.wood)) + ')</option>').join('');
      if (keep && [...st.admTarget.options].some(o => o.value === keep)) st.admTarget.value = keep;
    });
  }
  function syncSettings(){
    if (!st.ranges) return;
    const admin = !!(S().isAdmin && S().isAdmin());
    st.admin.hidden = !admin;
    if (admin){ fillAdminTargets(); st.admMsg.textContent = ''; }
    const set = S().data.settings;
    st.ranges.forEach(r => { if (document.activeElement !== r) r.value = set[r.dataset.k]; });
    st.segs.forEach(sg => sg.querySelectorAll('button').forEach(b => b.classList.toggle('on', set[sg.dataset.k] === b.dataset.v)));
    st.msg.textContent = '';
    if (st.drawBinds) st.drawBinds();
    if (U.setOutlines) U.setOutlines(set.graphics !== 'low');
    document.body.classList.toggle('gfx-low', set.graphics === 'low');
    TCS.lowParticles = set.graphics === 'low';
  }

  /* ---------- outfits ---------- */
  function buildOutfit(){
    const p = panels.outfit, s = S(), d = s.data, slot = outfitSlot;
    title.textContent = ({hat:'HATS', face:'FACE', boots:'BOOTS'})[slot];
    p.innerHTML = '';
    const auto = el('button', 'btn auto-btn' + (d.autoselect ? ' on' : ''), 'AUTOSELECT: ' + (d.autoselect ? 'ON' : 'OFF'), p);
    auto.addEventListener('click', () => { d.autoselect = !d.autoselect; buildOutfit(); });
    const items = [{ id: null, name: 'None', color: null }].concat(D.COSMETICS[slot]);
    items.forEach(c => {
      const have = c.id === null || d.cosmetics[c.id];
      const eq = (d.equipped[slot] || null) === c.id;
      const sw = c.id === null ? g('<path d="M11 11l18 18M29 11L11 29" fill="none" stroke-width="5"/>') : have ? '<span class="swatch" style="background:#' + ('00000' + c.color.toString(16)).slice(-6) + '"></span>' : ICONS.lock;
      const b = el('button', 'card outfit-card' + (have ? ' afford' : ' locked') + (eq ? ' equipped' : ''),
        '<span class="c-icon">' + sw + '</span><span class="c-main"><span class="c-name outlined outlined-sm">' + esc(c.name) + '</span>' +
        '<span class="c-eff outlined outlined-sm">' + (eq ? 'EQUIPPED' : have ? '' : esc(c.unlockText || 'LOCKED')) + '</span></span>', p);
      if (have) b.addEventListener('click', () => { s.equip(slot, c.id); buildOutfit(); });
    });
  }

  /* ---------- toasts / offline ---------- */
  // queued toasts: at most toastMax() on screen, the rest wait their turn (slide in, hold, slide out)
  const toastQueue = []; let toastLive = 0; const toastMax = () => (window.innerWidth < 600 ? 1 : 2);
  function toast(text, icon){
    toastQueue.push({ text, icon });
    if (toastQueue.length > 12) toastQueue.splice(0, toastQueue.length - 12);
    pumpToasts();
  }
  function pumpToasts(){
    while (toastLive < toastMax() && toastQueue.length){
      const q = toastQueue.shift(); toastLive++;
      const t = el('div', 'toast', '<span class="t-icon">' + (q.icon || ICONS.trophy) + '</span><span class="outlined outlined-sm">' + q.text + '</span>', toastWrap);
      const hold = toastQueue.length ? 1700 : 2600; // hurry when a backlog builds up
      setTimeout(() => { t.classList.add('out'); setTimeout(() => { t.remove(); toastLive--; pumpToasts(); }, 360); }, hold);
    }
  }
  function toastAch(a){ if (a) toast('<b>' + esc(a.name) + '</b><br><small>' + esc(a.desc) + '</small>'); }
  // welcome-back screen: shows what the crew made while the player was away; wood is added on COLLECT
  function offlineCard(){
    const s = S(); const p = s && s.data && s.data.pendingOffline;
    if (!p || !(p.amount > 0) || !shown) return;
    const layer = document.getElementById('ui-layer');
    const old = document.getElementById('offline-card'); if (old) old.remove();
    const rows = p.lines.slice(0, 6).map(l =>
      '<div class="oc-row"><span class="oc-ic">' + upIcon(l.id) + '</span><span class="oc-nm outlined outlined-sm">' + esc(l.name) +
      ' <small>x' + l.owned + '</small></span><span class="oc-v outlined outlined-sm">+' + U.fmt(l.amount) + '</span></div>').join('') +
      (p.lines.length > 6 ? '<div class="oc-more outlined outlined-sm">+' + (p.lines.length - 6) + ' MORE</div>' : '');
    const wrap = el('div', '', '', layer); wrap.id = 'offline-card';
    const c = el('div', 'card-panel oc-box',
      '<div class="oc-title outlined">WELCOME BACK!</div>' +
      '<div class="oc-time outlined outlined-sm">AWAY ' + U.fmtTime(p.seconds) + (p.capped ? ' <small>(MAX ' + p.capHours + 'H)</small>' : '') + '</div>' +
      '<div class="oc-list">' + rows + '</div>' +
      '<div class="oc-amt outlined"><i class="mini">' + ICONS.log + '</i>+' + U.fmt(p.amount) + '</div>' +
      '<button class="btn oc-collect">COLLECT</button>', wrap);
    const btn = c.querySelector('.oc-collect');
    let done = false;
    const collect = () => {
      if (done) return; done = true;
      const amt = s.collectOffline();
      try { TCS.audio.play('buy'); } catch(e){}
      // a shower of wood chips flies from the tree into the HUD counter
      const sc = TCS.scene;
      for (let i = 0; i < 8; i++) setTimeout(() => { try { sc.spawnChips(sc.tree.impactPoint(), 3, true); } catch(e){} }, i * 70);
      wrap.classList.add('out'); setTimeout(() => wrap.remove(), 300);
      return amt;
    };
    btn.addEventListener('click', e => { e.stopPropagation(); collect(); });
    wrap.addEventListener('pointerdown', e => e.stopPropagation());
    TCS.ui._collectOffline = collect;
  }

  /* ---------- per frame ---------- */
  function update(dt){
    if (!hudEls) return;
    const s = S(); if (!s || !s.data) return;
    const d = s.data;
    txt(hudEls.wood, 'x' + U.fmt(Math.floor(d.wood)));
    txt(hudEls.click, U.fmt(s.perClick()) + '/click');
    txt(hudEls.sec, U.fmt(s.perSecond(), { decimals: 1 }) + '/second');
    txt(hudEls.height, U.fmt(Math.floor(d.stats.height)) + ' m');
    if (panel === 'shop') updateShop();

    // coffee wipe
    const c = d.coffee, active = c.timeLeft > 0, cd = c.cooldown > 0;
    const frac = active ? c.timeLeft / D.COFFEE_DURATION : cd ? c.cooldown / D.COFFEE_COOLDOWN : 0;
    const pct = Math.round(frac * 200) / 2;
    if (coffeeWipe._p !== pct){ coffeeWipe._p = pct; coffeeWipe.style.setProperty('--p', pct + '%'); }
    cls(coffeeBtn, 'brewing', active); cls(coffeeBtn, 'cooldown', cd && !active);
    txt(coffeeTime, active ? Math.ceil(c.timeLeft) + 's' : cd ? fmtClock(c.cooldown) : '');

    // frenzy meter
    const fz = s.frenzyActive();
    const fill = fz ? Math.max(0, d.frenzy.timeLeft) / Math.max(1, D.FRENZY_DURATION + 5 * (s.perk('longerFrenzy') || 0)) : d.frenzy.meter;
    const fy = Math.round((1 - U.clamp(fill, 0, 1)) * 1300) / 10;
    if (frenzyFill._y !== fy){ frenzyFill._y = fy; frenzyFill.setAttribute('y', fy); }
    cls(frenzyEl, 'frenzy', fz);

    slowT -= dt;
    if (slowT <= 0){
      slowT = 0.25;
      txt(achBtnCount, s.achievementCount() + '/' + D.ACHIEVEMENTS.length);
      if (panel === 'achievements') refreshAch();
      if (panel === 'rebirth') refreshRebirth();
    }
  }
  function fmtClock(sec){ sec = Math.ceil(sec); const m = Math.floor(sec / 60), s = sec % 60; return m + ':' + (s < 10 ? '0' : '') + s; }

  function show(visible){
    shown = !!visible;
    root.forEach(e => e.style.display = visible ? '' : 'none');
    document.querySelectorAll('#ui-layer > .float-num').forEach(e => { if (!visible) e.remove(); });
    if (!visible){ const o = document.getElementById('offline-card'); if (o) o.remove(); toastQueue.length = 0; }
  }
  let shown = true;

  TCS.ui = { init, update, toast, show, open, ICONS };
})();
