/*!
 * KWADZILLA — THE BIGGEST LIZARD BREAKS OUT
 * A Rampage-style arcade splash game. Zero dependencies, single file.
 *
 * Mount by putting an element with [data-kwadzilla] on the page.
 * Everything else (canvas, HUD, overlays, touch pad) is injected here so the
 * Shopify section and the standalone demo page never drift apart.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Constants                                                           */
  /* ------------------------------------------------------------------ */

  // Virtual (pixel-art) resolution. The screen is banded top to bottom:
  //   0..24    top HUD          24..SEA_Y   sky
  //   SEA_Y..LAND_Y  ocean      LAND_Y..    the island
  //   BASE_Y   foundations      GROUND      Kwadzilla's walk line
  //   HUD_Y..VH      bottom HUD
  var VW = 480;
  var VH = 270;
  var CELL = 8;          // destructible cell size, in virtual pixels
  var SEA_Y = 132;       // horizon
  var LAND_Y = 174;      // shoreline behind the facilities
  var BASE_Y = 222;      // foundations of the facilities
  var GROUND = 236;      // the line Kwadzilla's feet walk along (in front)
  var SURF_Y = 244;      // foreground water
  var HUD_Y = 250;       // bottom HUD band
  var MAX_ROWS = 24;     // tallest a facility may get without clipping the HUD
  var JUMP_V = -6.5;     // launch speed of a full-height jump
  var MAX_PARTICLES = 420;
  var STORE_KEY = 'kwadzilla.v1';
  var STEP = 1000 / 60;

  var C = {
    skyTop: '#070a1c', skyMid: '#221a4a', skyLow: '#5a2a63', haze: '#93386a',
    moon: '#ffeec2', moonDim: '#e6d0a0', star: '#ccd6ff',
    sea: '#0e1c40', seaLite: '#1b3b73', foam: '#63dbe4',
    ridge: '#0b1524', land: '#0d1c16', landLite: '#163a29', tree: '#061109',
    pave: '#272c39', paveLite: '#394052', curb: '#4a5265',
    body: '#4fb84a', bodyLite: '#7fe36a', bodyDark: '#286c30',
    belly: '#dcf47c', spine: '#f5f07a', eye: '#ffd93d', tooth: '#f4fff2',
    fire1: '#fff6c2', fire2: '#ffb03a', fire3: '#ff4b2b',
    hud: '#eaf7ff', hudDim: '#7f93b5', gold: '#ffd23f',
    red: '#ff4d5e', green: '#6ef2a0', cyan: '#59e6ff'
  };

  // Concrete palettes for the facilities.
  var PALETTES = [
    { a: '#8f96a6', b: '#6d7483', c: '#4e5462', d: '#343948', win: '#161b29', lit: '#ffcf5c', trim: '#aab3c5' },
    { a: '#9a8f86', b: '#786e66', c: '#57504a', d: '#3a3531', win: '#191512', lit: '#ffd98a', trim: '#b6aaa0' },
    { a: '#7e8ba0', b: '#5f6b7e', c: '#454e5e', d: '#2e3542', win: '#121723', lit: '#9ef0ff', trim: '#98a8bf' },
    { a: '#8a8296', b: '#696174', c: '#4c4657', d: '#332e3b', win: '#15111c', lit: '#ffb0d8', trim: '#a79ebb' }
  ];

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function irnd(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function hit(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }
  function pad(n, len) {
    var s = String(Math.max(0, Math.floor(n)));
    while (s.length < len) s = '0' + s;
    return s;
  }
  function store(key, val) {
    try {
      if (val === undefined) {
        var raw = window.localStorage.getItem(STORE_KEY);
        return raw ? (JSON.parse(raw)[key]) : undefined;
      }
      var all = {};
      try { all = JSON.parse(window.localStorage.getItem(STORE_KEY)) || {}; } catch (e) { all = {}; }
      all[key] = val;
      window.localStorage.setItem(STORE_KEY, JSON.stringify(all));
    } catch (e) { /* private mode / sandboxed iframe — scores just don't persist */ }
  }

  /* ------------------------------------------------------------------ */
  /* 5x7 bitmap font (keeps the pixel look without loading a webfont)    */
  /* ------------------------------------------------------------------ */

  var FONT_ROWS = {
    'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    'B': ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
    'C': ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
    'D': ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
    'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    'F': ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
    'G': ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
    'H': ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
    'I': ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
    'J': ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
    'K': ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
    'L': ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
    'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
    'N': ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
    'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    'Q': ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
    'R': ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    'S': ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    'T': ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    'U': ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
    'V': ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
    'W': ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
    'X': ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
    'Y': ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
    'Z': ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
    '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
    '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
    '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
    '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
    '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
    '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
    '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
    '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
    ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
    '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
    ',': ['00000', '00000', '00000', '00000', '01100', '01100', '11000'],
    '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
    '?': ['01110', '10001', '00001', '00010', '00100', '00000', '00100'],
    ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
    '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
    '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
    "'": ['00100', '00100', '00000', '00000', '00000', '00000', '00000'],
    '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
    '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'],
    '(': ['00010', '00100', '01000', '01000', '01000', '00100', '00010'],
    ')': ['01000', '00100', '00010', '00010', '00010', '00100', '01000'],
    '<': ['00010', '00100', '01000', '10000', '01000', '00100', '00010'],
    '>': ['01000', '00100', '00010', '00001', '00010', '00100', '01000'],
    '*': ['00000', '10101', '01110', '11111', '01110', '10101', '00000'],
    '#': ['01010', '01010', '11111', '01010', '11111', '01010', '01010']
  };

  var FONT = {};
  (function buildFont() {
    for (var ch in FONT_ROWS) {
      if (!Object.prototype.hasOwnProperty.call(FONT_ROWS, ch)) continue;
      var rows = FONT_ROWS[ch], px = [];
      for (var y = 0; y < rows.length; y++) {
        for (var x = 0; x < rows[y].length; x++) {
          if (rows[y].charAt(x) === '1') px.push(x, y);
        }
      }
      FONT[ch] = px;
    }
  })();

  var GW = 5, GH = 7, GAP = 1;

  function textW(s, sc) {
    sc = sc || 1;
    return s.length ? (s.length * (GW + GAP) - GAP) * sc : 0;
  }

  function text(g, str, x, y, opt) {
    opt = opt || {};
    var sc = opt.scale || 1;
    var s = String(str).toUpperCase();
    var w = textW(s, sc);
    if (opt.align === 'center') x -= w / 2;
    else if (opt.align === 'right') x -= w;
    x = Math.round(x); y = Math.round(y);

    if (opt.shadow) {
      drawGlyphs(g, s, x + sc, y + sc, sc, opt.shadow);
    }
    drawGlyphs(g, s, x, y, sc, opt.color || C.hud);
    return w;
  }

  function drawGlyphs(g, s, x, y, sc, color) {
    g.fillStyle = color;
    for (var i = 0; i < s.length; i++) {
      var px = FONT[s.charAt(i)];
      if (!px) continue;
      var ox = x + i * (GW + GAP) * sc;
      for (var p = 0; p < px.length; p += 2) {
        g.fillRect(ox + px[p] * sc, y + px[p + 1] * sc, sc, sc);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Audio — tiny WebAudio synth, no samples to download                */
  /* ------------------------------------------------------------------ */

  function createAudio() {
    var ctx = null, master = null, musicGain = null, sfxGain = null;
    var on = true, started = false, musicTimer = null, step = 0, nextNote = 0;

    function boot() {
      if (ctx) return true;
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try { ctx = new AC(); } catch (e) { return false; }
      master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);
      sfxGain = ctx.createGain(); sfxGain.gain.value = 1; sfxGain.connect(master);
      musicGain = ctx.createGain(); musicGain.gain.value = 0.22; musicGain.connect(master);
      return true;
    }

    function noiseBuffer(dur) {
      var len = Math.floor(ctx.sampleRate * dur);
      var buf = ctx.createBuffer(1, len, ctx.sampleRate);
      var d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return buf;
    }

    function tone(freq, dur, type, vol, slideTo) {
      if (!on || !ctx) return;
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, ctx.currentTime);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), ctx.currentTime + dur);
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(vol || 0.2, ctx.currentTime + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      o.connect(g); g.connect(sfxGain);
      o.start(); o.stop(ctx.currentTime + dur + 0.02);
    }

    function noise(dur, vol, freq, q) {
      if (!on || !ctx) return;
      var src = ctx.createBufferSource();
      src.buffer = noiseBuffer(dur);
      var f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(freq || 1800, ctx.currentTime);
      f.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + dur);
      f.Q.value = q || 1;
      var g = ctx.createGain();
      g.gain.setValueAtTime(vol || 0.3, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      src.connect(f); f.connect(g); g.connect(sfxGain);
      src.start(); src.stop(ctx.currentTime + dur + 0.02);
    }

    // Bassline for the island. Deliberately short and low in the mix.
    var BASS = [55, 55, 65.41, 55, 49, 49, 58.27, 65.41];
    var LEAD = [0, 0, 220, 0, 0, 261.6, 0, 196];

    function musicTick() {
      if (!ctx || !on) return;
      var now = ctx.currentTime;
      while (nextNote < now + 0.25) {
        var t = Math.max(nextNote, now);
        var b = BASS[step % BASS.length];
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'triangle'; o.frequency.setValueAtTime(b, t);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        o.connect(g); g.connect(musicGain); o.start(t); o.stop(t + 0.26);

        var l = LEAD[step % LEAD.length];
        if (l) {
          var o2 = ctx.createOscillator(), g2 = ctx.createGain();
          o2.type = 'square'; o2.frequency.setValueAtTime(l, t);
          g2.gain.setValueAtTime(0.0001, t);
          g2.gain.exponentialRampToValueAtTime(0.16, t + 0.01);
          g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
          o2.connect(g2); g2.connect(musicGain); o2.start(t); o2.stop(t + 0.2);
        }
        step++;
        nextNote += 0.1875; // 160bpm eighths
      }
    }

    return {
      unlock: function () {
        if (!boot()) return;
        if (ctx.state === 'suspended') ctx.resume();
      },
      setOn: function (v) {
        on = !!v;
        if (on) { this.unlock(); this.startMusic(); }
        else this.stopMusic();
      },
      isOn: function () { return on; },
      startMusic: function () {
        if (!on || !ctx || musicTimer) return;
        started = true;
        nextNote = ctx.currentTime + 0.1;
        musicTimer = setInterval(musicTick, 90);
      },
      stopMusic: function () {
        if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
      },
      punch: function () { tone(180, 0.07, 'square', 0.16, 90); noise(0.07, 0.18, 1200); },
      smash: function () { noise(0.16, 0.32, 2400, 2); tone(90, 0.12, 'sawtooth', 0.12, 45); },
      collapse: function () { noise(0.9, 0.5, 900, 3); tone(70, 0.8, 'sawtooth', 0.18, 28); },
      free: function () { tone(523, 0.07, 'square', 0.14); setTimeout(function () { tone(659, 0.07, 'square', 0.14); }, 60); setTimeout(function () { tone(784, 0.11, 'square', 0.15); }, 120); },
      hurt: function () { tone(320, 0.22, 'sawtooth', 0.2, 70); noise(0.15, 0.2, 900); },
      shoot: function () { tone(880, 0.05, 'square', 0.07, 420); },
      boom: function () { noise(0.35, 0.4, 2600, 1.5); tone(120, 0.3, 'sawtooth', 0.16, 40); },
      roar: function () {
        tone(120, 0.55, 'sawtooth', 0.22, 60);
        tone(181, 0.5, 'square', 0.1, 74);
        noise(0.55, 0.28, 700, 4);
      },
      jump: function () { tone(260, 0.1, 'square', 0.1, 480); },
      point: function () { tone(1046, 0.05, 'square', 0.08); },
      levelUp: function () {
        var seq = [392, 523, 659, 784];
        seq.forEach(function (f, i) { setTimeout(function () { tone(f, 0.14, 'square', 0.16); }, i * 90); });
      },
      gameOver: function () {
        var seq = [392, 330, 262, 196];
        seq.forEach(function (f, i) { setTimeout(function () { tone(f, 0.3, 'sawtooth', 0.18); }, i * 180); });
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Level data                                                          */
  /* ------------------------------------------------------------------ */

  // Everything here is fictional — no real facility, company or person.
  // `name` is painted on the facade, so it has to fit inside cols * CELL.
  var TYPES = {
    JAIL:     { name: 'COUNTY JAIL', pal: 0, cols: 10, rows: 13 },
    ANNEX:    { name: 'DETENTION',   pal: 1, cols: 9,  rows: 10 },
    SOLITARY: { name: 'SOLITARY',    pal: 0, cols: 8,  rows: 16 },
    PROFIT:   { name: 'PROFITCORP',  pal: 2, cols: 11, rows: 15 },
    PROCESS:  { name: 'PROCESSING',  pal: 1, cols: 12, rows: 11 },
    BAIL:     { name: 'BAIL CO',     pal: 3, cols: 7,  rows: 19 },
    TOWER:    { name: 'TOWER 9',     pal: 2, cols: 6,  rows: 20, turret: true },
    COURT:    { name: 'COURTHOUSE',  pal: 1, cols: 13, rows: 12 },
    SUPERMAX: { name: 'SUPERMAX',    pal: 0, cols: 14, rows: 18 },
    PANOPT:   { name: 'PANOPTICON',  pal: 3, cols: 12, rows: 22, turret: true }
  };

  var LEVELS = [
    {
      name: 'CELLBLOCK COVE',
      layout: ['JAIL', 'ANNEX', 'TOWER', 'PROCESS'],
      spawn: 210, kinds: ['van', 'chopper'], maxFoes: 3
    },
    {
      name: 'RAZORWIRE REEF',
      layout: ['ANNEX', 'SOLITARY', 'BAIL', 'PROFIT', 'TOWER'],
      spawn: 165, kinds: ['van', 'chopper', 'chopper'], maxFoes: 4
    },
    {
      name: 'PANOPTICON POINT',
      layout: ['COURT', 'TOWER', 'SUPERMAX', 'PROFIT', 'PANOPT'],
      spawn: 125, kinds: ['van', 'chopper', 'jet'], maxFoes: 5, gunship: true
    }
  ];

  /* ------------------------------------------------------------------ */
  /* The game                                                            */
  /* ------------------------------------------------------------------ */

  function createGame(root) {
    /* ---------- configuration read off the mount element ------------- */
    var cfg = {
      cta1Label: root.getAttribute('data-cta-1-label') || '',
      cta1Url: root.getAttribute('data-cta-1-url') || '',
      cta2Label: root.getAttribute('data-cta-2-label') || '',
      cta2Url: root.getAttribute('data-cta-2-url') || '',
      rewardCode: root.getAttribute('data-reward-code') || '',
      rewardLabel: root.getAttribute('data-reward-label') || 'You unlocked a discount',
      rewardNote: root.getAttribute('data-reward-note') || '',
      rewardScore: parseInt(root.getAttribute('data-reward-score'), 10) || 20000,
      soundDefault: root.getAttribute('data-sound') !== 'off'
    };

    /* ---------- DOM ---------------------------------------------------*/
    root.classList.add('kwad-game');
    root.innerHTML =
      '<div class="kwad-cab">' +
        '<div class="kwad-screen">' +
          '<canvas class="kwad-canvas" width="' + VW + '" height="' + VH + '" ' +
            'aria-label="Kwadzilla arcade game. Use arrow keys to move, up to climb, space to smash."' +
            ' tabindex="0" role="application"></canvas>' +
          '<div class="kwad-scan" aria-hidden="true"></div>' +
          '<div class="kwad-ui" data-ui></div>' +
        '</div>' +
        '<div class="kwad-bar">' +
          '<button type="button" class="kwad-chip" data-act="pause" aria-label="Pause game">| |</button>' +
          '<button type="button" class="kwad-chip" data-act="sound" aria-pressed="true">SOUND: ON</button>' +
          '<p class="kwad-hint"><kbd>&larr;</kbd><kbd>&rarr;</kbd> move &middot; <kbd>&uarr;</kbd> climb &middot; ' +
            '<kbd>Space</kbd> smash &middot; <kbd>Shift</kbd> rage</p>' +
        '</div>' +
        '<div class="kwad-touch" data-touch aria-hidden="true">' +
          '<div class="kwad-dpad">' +
            '<button type="button" class="kwad-key kwad-key--u" data-key="up">&uarr;</button>' +
            '<button type="button" class="kwad-key kwad-key--l" data-key="left">&larr;</button>' +
            '<button type="button" class="kwad-key kwad-key--r" data-key="right">&rarr;</button>' +
            '<button type="button" class="kwad-key kwad-key--d" data-key="down">&darr;</button>' +
          '</div>' +
          '<div class="kwad-acts">' +
            '<button type="button" class="kwad-key kwad-key--rage" data-key="rage">RAGE</button>' +
            '<button type="button" class="kwad-key kwad-key--hit" data-key="hit">SMASH</button>' +
            '<button type="button" class="kwad-key kwad-key--jump" data-key="jump">JUMP</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    var canvas = root.querySelector('.kwad-canvas');
    var g = canvas.getContext('2d');
    var ui = root.querySelector('[data-ui]');
    var soundBtn = root.querySelector('[data-act="sound"]');
    var pauseBtn = root.querySelector('[data-act="pause"]');
    g.imageSmoothingEnabled = false;

    var audio = createAudio();
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var soundPref = store('sound');
    var soundOn = soundPref === undefined ? cfg.soundDefault : !!soundPref;

    /* ---------- input -------------------------------------------------*/
    var keys = {};
    var K = {
      left: false, right: false, up: false, down: false,
      hit: false, rage: false, jump: false
    };
    var pressed = {}; // edge-triggered

    var MAP = {
      ArrowLeft: 'left', KeyA: 'left',
      ArrowRight: 'right', KeyD: 'right',
      ArrowUp: 'up', KeyW: 'up',
      ArrowDown: 'down', KeyS: 'down',
      Space: 'hit', KeyJ: 'hit',
      ShiftLeft: 'rage', ShiftRight: 'rage', KeyK: 'rage',
      KeyZ: 'jump', KeyX: 'jump'
    };

    function onKey(e, down) {
      var name = MAP[e.code];
      if (!name) {
        if (down && (e.code === 'Escape' || e.code === 'KeyP')) togglePause();
        if (down && e.code === 'Enter' && state !== 'play') primaryAction();
        return;
      }
      if (!focused) return;
      e.preventDefault();
      if (down && !K[name]) pressed[name] = true;
      K[name] = down;
      if (down) audio.unlock();
    }

    var focused = false;
    function setFocused(v) { focused = v; }
    canvas.addEventListener('focus', function () { setFocused(true); });
    canvas.addEventListener('blur', function () { setFocused(false); clearKeys(); });
    canvas.addEventListener('pointerdown', function () { canvas.focus(); });
    root.addEventListener('pointerdown', function () { audio.unlock(); }, { once: true });

    window.addEventListener('keydown', function (e) { onKey(e, true); });
    window.addEventListener('keyup', function (e) { onKey(e, false); });
    window.addEventListener('blur', clearKeys);

    function clearKeys() {
      for (var k in K) K[k] = false;
    }

    // Touch pad
    var touchWrap = root.querySelector('[data-touch]');
    Array.prototype.forEach.call(root.querySelectorAll('[data-key]'), function (btn) {
      var name = btn.getAttribute('data-key');
      function down(e) {
        e.preventDefault();
        audio.unlock();
        if (!K[name]) pressed[name] = true;
        K[name] = true;
        btn.classList.add('is-down');
      }
      function up(e) {
        if (e) e.preventDefault();
        K[name] = false;
        btn.classList.remove('is-down');
      }
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', up);
      btn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    });

    function consume(name) {
      if (pressed[name]) { pressed[name] = false; return true; }
      return false;
    }

    /* ---------- world state ------------------------------------------*/
    var state = 'attract';   // attract | play | pause | clear | dead | over
    var level = 0, score = 0, hiScore = store('hi') || 0, lives = 3, liberated = 0, totalLiberated = 0;
    var buildings = [], foes = [], shots = [], parts = [], pops = [], freed = [];
    var worldW = VW, camX = 0, shake = 0, flash = 0, hurtTint = 0;
    var spawnT = 0, clearT = 0, deadT = 0, tick = 0, bannerT = 0, banner = '';
    var stars = [], palms = [], clouds = [];

    var P = {
      x: 60, y: GROUND, vx: 0, vy: 0, facing: 1,
      mode: 'ground',           // ground | air | climb
      climb: null,
      walk: 0, atk: 0, atkCool: 0,
      jumps: 2, launch: 0,
      hp: 100, maxHp: 100, inv: 0,
      rage: 0, rageT: 0,
      alive: true, roarT: 0
    };

    /* ---------- scenery ----------------------------------------------*/
    function buildScenery() {
      stars = [];
      for (var i = 0; i < 90; i++) {
        stars.push({ x: Math.random() * VW, y: Math.random() * 140, s: Math.random() < 0.2 ? 2 : 1, t: Math.random() * 100 });
      }
      clouds = [];
      for (var c = 0; c < 6; c++) {
        clouds.push({ x: Math.random() * VW, y: 30 + Math.random() * 70, w: 40 + Math.random() * 70, sp: 0.04 + Math.random() * 0.06 });
      }
    }

    function buildPalms() {
      palms = [];
      for (var i = 0; i < Math.floor(worldW / 90); i++) {
        palms.push({ x: rnd(0, worldW), h: irnd(16, 30), lean: Math.random() < 0.5 ? -1 : 1, back: Math.random() < 0.5 });
      }
    }

    /* ---------- buildings ---------------------------------------------*/
    function makeBuilding(x, key) {
      var def = TYPES[key];
      var pal = PALETTES[def.pal % PALETTES.length];
      var cols = def.cols, rowsN = def.rows;
      var b = {
        key: key, def: def, pal: pal, x: x, cols: cols, w: cols * CELL,
        rows: [], alive: 0, startCells: 0, state: 'alive',
        dirty: true, cv: null, ctx: null, fallT: 0, seed: Math.random() * 999,
        sign: def.name
      };

      for (var r = 0; r < rowsN; r++) {
        var row = new Uint8Array(cols);
        for (var c = 0; c < cols; c++) {
          var v = 1;
          if (r === 0) v = 5;                                  // roof trim / razor wire
          else if (r === 1) v = 4;                             // sign band
          else if (r === rowsN - 1 && c === (cols >> 1)) v = 6; // barred door
          else if (r >= 3 && r % 2 === 1 && c % 2 === 1) {
            // a cell window: most hold someone about to have a very good day
            v = Math.random() < 0.62 ? 3 : 2;
          }
          row[c] = v;
        }
        b.rows.push(row);
        b.alive += cols;
      }
      b.startCells = b.alive;
      return b;
    }

    function buildLevel(n) {
      var L = LEVELS[n % LEVELS.length];
      var loops = Math.floor(n / LEVELS.length);
      buildings = [];
      var x = 90;
      for (var i = 0; i < L.layout.length; i++) {
        var b = makeBuilding(x, L.layout[i]);
        // Later loops stack the island a little taller.
        if (loops > 0) {
          var extra = Math.max(0, Math.min(6, loops * 2, MAX_ROWS - b.rows.length));
          for (var e = 0; e < extra; e++) {
            var row = new Uint8Array(b.cols);
            for (var c = 0; c < b.cols; c++) row[c] = (c % 2 === 1) ? (Math.random() < 0.62 ? 3 : 2) : 1;
            b.rows.splice(2, 0, row);
            b.alive += b.cols;
          }
          b.startCells = b.alive;
        }
        buildings.push(b);
        x += b.w + irnd(34, 62);
      }
      worldW = Math.max(VW + 40, x + 90);
      buildPalms();

      foes = []; shots = []; parts = []; pops = []; freed = [];
      spawnT = 120;
      camX = 0;
      P.x = 50; P.y = GROUND; P.vx = 0; P.vy = 0; P.mode = 'ground'; P.climb = null;
      P.hp = P.maxHp; P.inv = 90; P.atk = 0; P.rage = 0; P.rageT = 0; P.alive = true;
      P.jumps = 2; P.launch = 0;
      liberated = 0;

      // Turrets on top of watchtowers.
      for (var t = 0; t < buildings.length; t++) {
        if (buildings[t].def.turret) spawnTurret(buildings[t]);
      }
      if (L.gunship || loops > 0) {
        // Mini-boss arrives once you've done real damage.
        gunshipPending = true;
      } else {
        gunshipPending = false;
      }
    }

    var gunshipPending = false;

    function levelCfg() {
      var L = LEVELS[level % LEVELS.length];
      var loops = Math.floor(level / LEVELS.length);
      return {
        name: L.name + (loops ? ' ' + (loops + 1) : ''),
        spawn: Math.max(55, L.spawn - loops * 25),
        kinds: L.kinds,
        maxFoes: Math.min(8, L.maxFoes + loops)
      };
    }

    function topOf(b) { return BASE_Y - b.rows.length * CELL; }

    function rowAlive(row) {
      var n = 0;
      for (var i = 0; i < row.length; i++) if (row[i]) n++;
      return n;
    }

    function killCell(b, r, c) {
      var v = b.rows[r][c];
      if (!v) return false;
      b.rows[r][c] = 0;
      b.alive--;
      b.dirty = true;
      var wx = b.x + c * CELL + CELL / 2;
      var wy = topOf(b) + r * CELL + CELL / 2;
      addScore(10, null);
      debris(wx, wy, b.pal, 2);
      if (v === 3) freePrisoner(wx, wy);
      return true;
    }

    function settle(b) {
      // A floor that has lost most of its structure gives way, and everything
      // above it drops. That's the whole fantasy of the genre.
      var guard = 0;
      while (guard++ < 40 && b.rows.length > 0) {
        var found = -1;
        for (var r = b.rows.length - 1; r >= 0; r--) {
          var n = rowAlive(b.rows[r]);
          if (n > 0 && n <= Math.max(1, Math.floor(b.cols * 0.34))) { found = r; break; }
          if (n === 0) { found = r; break; }
        }
        if (found < 0) break;

        var row = b.rows[found];
        for (var c = 0; c < b.cols; c++) {
          if (row[c]) {
            b.alive--;
            if (row[c] === 3) freePrisoner(b.x + c * CELL + 4, topOf(b) + found * CELL);
          }
        }
        b.rows.splice(found, 1);
        b.dirty = true;
        shakeIt(3.5);
        if (audio.isOn()) audio.smash();
        var ty = topOf(b);
        for (var d = 0; d < 12; d++) {
          debris(b.x + rnd(0, b.w), ty + rnd(0, 20), b.pal, 1);
        }
        addScore(120, null);
      }

      // Enough of the structure gone and the rest can't hold itself up.
      if (b.state === 'alive' &&
          (b.rows.length <= 2 || b.alive <= Math.max(4, b.startCells * 0.4))) collapse(b);
    }

    function collapse(b) {
      b.state = 'falling';
      b.fallT = 34;
      var ty = topOf(b);
      for (var r = 0; r < b.rows.length; r++) {
        for (var c = 0; c < b.cols; c++) {
          if (b.rows[r][c] === 3) freePrisoner(b.x + c * CELL + 4, ty + r * CELL);
        }
      }
      for (var i = 0; i < 46; i++) {
        debris(b.x + rnd(0, b.w), rnd(ty, BASE_Y), b.pal, 3);
      }
      for (var s = 0; s < 16; s++) {
        smoke(b.x + rnd(0, b.w), rnd(ty, BASE_Y));
      }
      shakeIt(9);
      flash = Math.max(flash, 0.22);
      audio.collapse();
      addScore(2000, { x: b.x + b.w / 2, y: ty - 8, txt: 'LEVELLED! +2000' });

      // Turrets go down with the tower.
      for (var f = foes.length - 1; f >= 0; f--) {
        if (foes[f].host === b) { boom(foes[f].x, foes[f].y); foes.splice(f, 1); }
      }
    }

    function damageArea(wx, wy, radius, opts) {
      opts = opts || {};
      var any = 0;
      for (var i = 0; i < buildings.length; i++) {
        var b = buildings[i];
        var mine = 0;
        if (b.state !== 'alive') continue;
        if (wx + radius < b.x || wx - radius > b.x + b.w) continue;
        var ty = topOf(b);
        if (wy + radius < ty || wy - radius > BASE_Y) continue;

        var c0 = clamp(Math.floor((wx - radius - b.x) / CELL), 0, b.cols - 1);
        var c1 = clamp(Math.floor((wx + radius - b.x) / CELL), 0, b.cols - 1);
        var r0 = clamp(Math.floor((wy - radius - ty) / CELL), 0, b.rows.length - 1);
        var r1 = clamp(Math.floor((wy + radius - ty) / CELL), 0, b.rows.length - 1);
        var rr = radius * radius;

        for (var r = r0; r <= r1; r++) {
          for (var c = c0; c <= c1; c++) {
            var cx = b.x + c * CELL + CELL / 2;
            var cy = ty + r * CELL + CELL / 2;
            var dx = cx - wx, dy = cy - wy;
            if (dx * dx + dy * dy <= rr) {
              if (killCell(b, r, c)) { any++; mine++; }
            }
          }
        }
        if (mine) settle(b);
      }
      if (any) {
        P.rage = Math.min(100, P.rage + any * 1.1);
        if (opts.sfx !== false) audio.smash();
        shakeIt(Math.min(5, 1 + any * 0.25));
      }
      return any;
    }

    /* ---------- particles & bits ---------------------------------------*/
    function push(arr, o) {
      arr.push(o);
      if (arr.length > MAX_PARTICLES) arr.shift();
    }

    function debris(x, y, pal, n) {
      if (reduceMotion) n = Math.min(n, 1);
      for (var i = 0; i < n; i++) {
        push(parts, {
          x: x, y: y, vx: rnd(-1.6, 1.6), vy: rnd(-2.6, -0.4),
          g: 0.16, life: irnd(28, 60), max: 60, s: irnd(1, 3),
          col: pick([pal.a, pal.b, pal.c, pal.d]), kind: 'rock'
        });
      }
    }

    function smoke(x, y) {
      if (reduceMotion) return;
      push(parts, {
        x: x, y: y, vx: rnd(-0.35, 0.35), vy: rnd(-0.6, -0.2),
        g: -0.005, life: irnd(40, 80), max: 80, s: irnd(3, 6),
        col: '#6b7280', kind: 'smoke'
      });
    }

    function spark(x, y, col, n) {
      for (var i = 0; i < (reduceMotion ? 2 : n); i++) {
        push(parts, {
          x: x, y: y, vx: rnd(-2.4, 2.4), vy: rnd(-2.4, 1.2),
          g: 0.09, life: irnd(12, 26), max: 26, s: irnd(1, 2),
          col: col || C.fire2, kind: 'spark'
        });
      }
    }

    function boom(x, y) {
      spark(x, y, C.fire1, 14);
      spark(x, y, C.fire3, 10);
      for (var i = 0; i < 5; i++) smoke(x + rnd(-6, 6), y + rnd(-6, 6));
      audio.boom();
      shakeIt(4);
    }

    function fire(x, y, dir) {
      push(parts, {
        x: x, y: y, vx: dir * rnd(2.2, 4.2), vy: rnd(-0.9, 0.9),
        g: -0.012, life: irnd(16, 30), max: 30, s: irnd(3, 6),
        col: pick([C.fire1, C.fire2, C.fire3]), kind: 'fire'
      });
    }

    function shakeIt(v) { if (!reduceMotion) shake = Math.min(14, shake + v); }

    function addScore(n, pop) {
      score += n;
      if (pop) pops.push({ x: pop.x, y: pop.y, txt: pop.txt, life: 70, col: pop.col || C.gold });
    }

    var lastFreeSfx = -99;

    function freePrisoner(x, y) {
      freed.push({
        x: x, y: y, vy: 0, onGround: false,
        dir: x < camX + VW / 2 ? -1 : 1, t: 0, cheer: irnd(0, 30)
      });
      // A whole floor can open at once — don't stack the jingle on itself.
      if (tick - lastFreeSfx > 10) { audio.free(); lastFreeSfx = tick; }
    }

    /* ---------- enemies ------------------------------------------------*/
    function spawnTurret(b) {
      foes.push({
        type: 'turret', host: b, x: b.x + b.w / 2, y: topOf(b) - 6,
        w: 14, h: 10, hp: 4, t: irnd(0, 60), fire: 0, vx: 0, vy: 0
      });
    }

    function spawnFoe(kind) {
      var side = P.x < camX + VW / 2 ? 1 : -1;
      var ex = side > 0 ? camX + VW + 24 : camX - 24;
      if (kind === 'chopper') {
        foes.push({ type: 'chopper', x: ex, y: rnd(56, 110), w: 26, h: 12, hp: 2,
          vx: 0, vy: 0, t: 0, fire: irnd(70, 140), aim: 0, rot: 0 });
      } else if (kind === 'van') {
        foes.push({ type: 'van', x: ex, y: GROUND, w: 28, h: 15, hp: 4, vx: 0, vy: 0, t: 0, fire: irnd(50, 110) });
      } else if (kind === 'jet') {
        var d = side > 0 ? -1 : 1;
        foes.push({ type: 'jet', x: ex, y: rnd(40, 80), w: 30, h: 9, hp: 2, vx: d * 3.1, vy: 0, t: 0, fire: 30 });
      } else if (kind === 'gunship') {
        foes.push({ type: 'gunship', x: ex, y: 64, w: 46, h: 20, hp: 20,
          vx: 0, vy: 0, t: 0, fire: 110, aim: 0, burst: 0, boss: true });
        banner = 'WARDEN GUNSHIP INBOUND';
        bannerT = 150;
        audio.levelUp();
      }
    }

    function shoot(x, y, tx, ty, sp, kind) {
      var dx = tx - x, dy = ty - y;
      var d = Math.sqrt(dx * dx + dy * dy) || 1;
      shots.push({ x: x, y: y, vx: dx / d * sp, vy: dy / d * sp, life: 190, kind: kind || 'bolt' });
      audio.shoot();
    }

    /* ---------- player -------------------------------------------------*/
    function playerBox() { return { x: P.x - 15, y: P.y - 46, w: 30, h: 46 }; }

    function buildingAt(x) {
      for (var i = 0; i < buildings.length; i++) {
        var b = buildings[i];
        if (b.state !== 'alive') continue;
        if (x >= b.x - 10 && x <= b.x + b.w + 10) return b;
      }
      return null;
    }

    function updatePlayer() {
      if (!P.alive) return;

      var speed = P.rageT > 0 ? 2.7 : 2.0;
      var wantL = K.left, wantR = K.right;

      if (P.mode === 'climb') {
        var b = P.climb;
        if (!b || b.state !== 'alive') { P.mode = 'air'; P.climb = null; P.vy = 0; }
        else {
          var cs = P.rageT > 0 ? 2.4 : 1.9;
          if (K.up) P.y -= cs;
          if (K.down) P.y += cs;
          if (wantL) { P.facing = -1; P.x -= 0.9; }
          if (wantR) { P.facing = 1; P.x += 0.9; }
          P.walk += 0.19;

          var ty = topOf(b);
          if (P.y <= ty) {           // over the parapet — stand on the roof
            P.y = ty; P.mode = 'air'; P.vy = 0; P.climb = null;
          } else if (P.y >= GROUND) {
            P.y = GROUND; P.mode = 'ground'; P.climb = null;
          }
          // stepped off the side of the tower
          if (P.x < b.x - 14 || P.x > b.x + b.w + 14) { P.mode = 'air'; P.climb = null; P.vy = 0; }

          // Kick off the wall: away from the building, with height.
          if (consume('jump')) {
            var away = (P.x < b.x + b.w / 2) ? -1 : 1;
            P.mode = 'air'; P.climb = null;
            P.vy = -5.6; P.vx = away * 3.4; P.facing = away;
            P.launch = 11;
            P.jumps = 1;          // still one mid-air jump left
            audio.jump();
            spark(P.x - away * 8, P.y - 24, '#cfe9ff', 5);
          }
        }
      }

      if (P.mode === 'ground' || P.mode === 'air') {
        if (P.launch > 0) {
          // Preserve the wall kick for a few frames so it actually reads.
          P.launch--;
          P.vx *= 0.96;
          if (wantL) P.facing = -1; else if (wantR) P.facing = 1;
        } else if (wantL) { P.vx = -speed; P.facing = -1; }
        else if (wantR) { P.vx = speed; P.facing = 1; }
        else P.vx *= 0.6;

        P.x += P.vx;
        if (Math.abs(P.vx) > 0.2 && P.mode === 'ground') P.walk += Math.abs(P.vx) * 0.14;

        if (P.mode === 'ground') {
          P.jumps = 2;            // refilled on any solid footing
          // You can only grab a wall from the street. On a roof, up means jump.
          var onStreet = P.y >= GROUND - 2;
          var bb = onStreet ? buildingAt(P.x) : null;
          if (bb && K.up) {
            P.mode = 'climb'; P.climb = bb; P.y = GROUND - 4;
            consume('up');
          } else if (consume('jump') || consume('up')) {
            P.jumps--; P.vy = JUMP_V; P.mode = 'air'; audio.jump();
          }
        } else {
          // Cutting the jump short gives fine control over height.
          if (P.vy < -1.4 && !K.jump && !K.up) P.vy *= 0.82;
          P.vy += P.vy < 0 ? 0.30 : 0.44;
          P.y += P.vy;

          // Grabbing a wall wins over spending the mid-air jump.
          var b2 = buildingAt(P.x);
          if (K.up && b2 && P.y > topOf(b2) + 4) {
            P.mode = 'climb'; P.climb = b2; P.vy = 0; P.launch = 0;
            consume('up'); consume('jump');
          } else if ((consume('jump') || consume('up')) && P.jumps > 0) {
            P.jumps--;
            P.vy = JUMP_V * 0.9;
            P.launch = 0;
            audio.jump();
            for (var dj = 0; dj < 6; dj++) spark(P.x + rnd(-9, 9), P.y - 2, '#bff0d0', 1);
          }
        }
      }

      // Landing: ground line and building roofs are both platforms.
      if (P.mode === 'air' && P.vy >= 0) {
        var prevY = P.y - P.vy;
        for (var i = 0; i < buildings.length; i++) {
          var bd = buildings[i];
          if (bd.state !== 'alive') continue;
          var t = topOf(bd);
          if (P.x > bd.x - 8 && P.x < bd.x + bd.w + 8 && prevY <= t + 2 && P.y >= t) {
            P.y = t; P.vy = 0; P.mode = 'ground'; shakeIt(1.2);
            break;
          }
        }
        if (P.y >= GROUND) { P.y = GROUND; P.vy = 0; P.mode = 'ground'; }
      }

      // Walking off a roof edge
      if (P.mode === 'ground' && P.y < GROUND) {
        var still = null;
        for (var j = 0; j < buildings.length; j++) {
          var bj = buildings[j];
          if (bj.state !== 'alive') continue;
          if (P.x > bj.x - 8 && P.x < bj.x + bj.w + 8 && Math.abs(topOf(bj) - P.y) < 10) { still = bj; break; }
        }
        if (!still) { P.mode = 'air'; }
        else P.y = topOf(still);
      }

      P.x = clamp(P.x, 16, worldW - 16);

      /* attacks */
      if (P.atkCool > 0) P.atkCool--;
      if (P.atk > 0) P.atk--;

      if (P.rageT > 0) {
        P.rageT--;
        if (K.hit) {
          var mx = P.x + P.facing * 26, my = P.y - 40;
          for (var f = 0; f < 3; f++) fire(mx, my + rnd(-3, 3), P.facing);
          if (tick % 3 === 0) {
            damageArea(mx + P.facing * 20, my, 16, { sfx: false });
            hurtFoes(mx + P.facing * 22, my, 22, 2);
          }
        }
        if (P.rageT === 0) P.rage = 0;
      } else if (consume('hit') && P.atkCool === 0) {
        P.atk = 14; P.atkCool = 12;
        audio.punch();
      }

      if (P.atk === 10) {
        // Clinging to a wall, you tear into whatever is right in front of you;
        // on the street you swing out ahead.
        var climbing2 = P.mode === 'climb';
        var fx = climbing2 ? P.x + P.facing * 6 : P.x + P.facing * 26;
        var fy = P.y - (climbing2 ? 26 : 30);
        var n = damageArea(fx, fy, climbing2 ? 15 : 13);
        hurtFoes(fx, fy, 18, 2);
        if (!n) audio.punch();
      }

      // rage
      if (consume('rage') && P.rage >= 100 && P.rageT === 0) {
        P.rageT = 420; P.roarT = 40;
        audio.roar();
        flash = Math.max(flash, 0.3);
        shakeIt(7);
        pops.push({ x: P.x, y: P.y - 60, txt: 'RAAAGH!', life: 60, col: C.fire2 });
        // the roar clears nearby bullets
        for (var s = shots.length - 1; s >= 0; s--) {
          if (Math.abs(shots[s].x - P.x) < 90) shots.splice(s, 1);
        }
      }
      if (P.roarT > 0) P.roarT--;
      if (P.inv > 0) P.inv--;
      if (hurtTint > 0) hurtTint -= 0.04;
    }

    function hurtFoes(x, y, r, dmg) {
      for (var i = foes.length - 1; i >= 0; i--) {
        var f = foes[i];
        var cx = f.x, cy = f.y - (f.type === 'van' ? f.h / 2 : 0);
        if (Math.abs(cx - x) < r + f.w / 2 && Math.abs(cy - y) < r + f.h) {
          f.hp -= dmg;
          f.flash = 6;
          spark(cx, cy, C.fire1, 4);
          if (f.hp <= 0) {
            boom(cx, cy);
            var pts = f.boss ? 6000 : f.type === 'turret' ? 600 : 400;
            addScore(pts, { x: cx, y: cy - 10, txt: '+' + pts });
            foes.splice(i, 1);
            P.rage = Math.min(100, P.rage + (f.boss ? 40 : 8));
            if (f.boss) { flash = 0.4; shakeIt(10); }
          }
        }
      }
    }

    function damagePlayer(n) {
      if (P.inv > 0 || !P.alive || P.rageT > 0) return;
      P.hp -= n;
      P.inv = 48;
      hurtTint = 0.5;
      audio.hurt();
      shakeIt(3);
      if (P.hp <= 0) {
        P.hp = 0; P.alive = false;
        lives--;
        boom(P.x, P.y - 24);
        deadT = 100;
        state = lives > 0 ? 'dead' : 'over';
        if (state === 'over') endGame();
      }
    }

    /* ---------- enemy update -------------------------------------------*/
    function updateFoes() {
      var cfgL = levelCfg();

      // spawning
      if (state === 'play') {
        spawnT--;
        if (spawnT <= 0 && foes.length < cfgL.maxFoes) {
          spawnFoe(pick(cfgL.kinds));
          spawnT = cfgL.spawn + irnd(-30, 40);
        }
        if (gunshipPending) {
          var destroyed = 0;
          for (var q = 0; q < buildings.length; q++) if (buildings[q].state !== 'alive') destroyed++;
          if (destroyed >= Math.ceil(buildings.length / 2)) {
            gunshipPending = false;
            spawnFoe('gunship');
          }
        }
      }

      for (var i = foes.length - 1; i >= 0; i--) {
        var f = foes[i];
        f.t++;
        if (f.flash > 0) f.flash--;

        if (f.type === 'chopper' || f.type === 'gunship') {
          var boss = f.type === 'gunship';
          var tx = P.x + (boss ? 0 : Math.sin(f.t * 0.02) * 60);
          // Choppers stand off well above head height, so they no longer
          // park themselves on top of you.
          var ty = boss ? 60 + Math.sin(f.t * 0.02) * 14
                        : clamp(P.y - 96, 40, 132) + Math.sin(f.t * 0.05) * 8;
          f.vx += clamp((tx - f.x) * 0.0035, -0.09, 0.09);
          f.vy += clamp((ty - f.y) * 0.006, -0.12, 0.12);
          f.vx *= 0.965; f.vy *= 0.93;
          f.x += f.vx; f.y += f.vy;
          f.rot = (f.rot || 0) + 0.6;

          // Every shot is telegraphed first: the gun light blinks and a tracer
          // line paints the target, giving you time to move.
          f.fire--;
          if (f.fire <= 0 && f.aim <= 0 && Math.abs(f.x - P.x) < (boss ? 260 : 150)) {
            f.aim = boss ? 44 : 38;
          }
          if (f.aim > 0) {
            f.aim--;
            if (f.aim === 0) {
              if (boss) {
                f.burst = 3;
                f.fire = 170;
              } else {
                shoot(f.x, f.y + 6, P.x, P.y - 24, 1.75);
                f.fire = 170 + irnd(0, 80);
              }
            }
          }
          if (f.burst > 0 && f.t % 12 === 0) {
            shoot(f.x + rnd(-14, 14), f.y + 10, P.x + rnd(-20, 20), P.y - 20, 2.15, 'shell');
            f.burst--;
          }

          // rotor wash, only if you jump right into it
          if (hit(f.x - f.w / 2, f.y - f.h / 2, f.w, f.h, P.x - 15, P.y - 46, 30, 46)) {
            damagePlayer(boss ? 10 : 5);
          }

        } else if (f.type === 'van') {
          var dx = P.x - f.x;
          if (Math.abs(dx) > 92) f.x += Math.sign(dx) * 0.9;
          f.fire--;
          if (f.fire <= 0 && Math.abs(dx) < 190) {
            shoot(f.x + Math.sign(dx) * 14, f.y - 9, P.x, P.y - 26, 2.1);
            f.fire = 95 + irnd(0, 40);
          }
          if (hit(f.x - f.w / 2, f.y - f.h, f.w, f.h, P.x - 15, P.y - 46, 30, 46) && f.t % 30 === 0) damagePlayer(6);

        } else if (f.type === 'jet') {
          f.x += f.vx;
          f.fire--;
          if (f.fire <= 0 && Math.abs(f.x - P.x) < 130) {
            shots.push({ x: f.x, y: f.y + 6, vx: f.vx * 0.3, vy: 1.4, life: 200, kind: 'bomb' });
            f.fire = 55;
          }
          if (f.x < camX - 80 || f.x > camX + VW + 80) { foes.splice(i, 1); continue; }

        } else if (f.type === 'turret') {
          if (!f.host || f.host.state !== 'alive') { foes.splice(i, 1); continue; }
          f.y = topOf(f.host) - 6;
          f.fire--;
          if (f.fire <= 0 && Math.abs(f.x - P.x) < 210) {
            shoot(f.x, f.y, P.x, P.y - 26, 2.4);
            f.fire = 80 + irnd(0, 40);
          }
        }

        // wandered far off-camera and lost interest
        if (f.type !== 'turret' && (f.x < camX - 200 || f.x > camX + VW + 200) && f.t > 400) foes.splice(i, 1);
      }

      // bullets
      for (var s = shots.length - 1; s >= 0; s--) {
        var sh = shots[s];
        sh.x += sh.vx;
        if (sh.kind === 'bomb') sh.vy += 0.06;
        sh.y += sh.vy;
        sh.life--;
        var hitPlayer = P.alive && P.inv <= 0 && P.rageT <= 0 &&
          hit(sh.x - 2, sh.y - 2, 4, 4, P.x - 13, P.y - 44, 26, 44);
        if (hitPlayer) {
          damagePlayer(sh.kind === 'shell' ? 12 : sh.kind === 'bomb' ? 14 : 8);
          spark(sh.x, sh.y, C.red, 5);
          shots.splice(s, 1); continue;
        }
        if (sh.y > GROUND + 6 || sh.life <= 0 || sh.x < camX - 60 || sh.x > camX + VW + 60) {
          if (sh.kind === 'bomb') { spark(sh.x, sh.y, C.fire2, 8); audio.boom(); }
          shots.splice(s, 1);
        }
      }
    }

    /* ---------- freed people -------------------------------------------*/
    function updateFreed() {
      for (var i = freed.length - 1; i >= 0; i--) {
        var p = freed[i];
        p.t++;
        if (!p.onGround) {
          p.vy += 0.3;
          p.y += p.vy;
          if (p.y >= GROUND) { p.y = GROUND; p.onGround = true; }
        } else {
          if (p.t < p.cheer + 40) {
            // a moment to look up at the sky
          } else {
            p.x += p.dir * 1.15;
          }
        }
        if (p.x < camX - 60 || p.x > camX + VW + 60 || p.t > 900) {
          liberated++; totalLiberated++;
          addScore(250, null);
          audio.point();
          freed.splice(i, 1);
        }
      }
    }

    /* ---------- particles ----------------------------------------------*/
    function updateParts() {
      for (var i = parts.length - 1; i >= 0; i--) {
        var p = parts[i];
        p.vy += p.g;
        p.x += p.vx; p.y += p.vy;
        if (p.kind === 'rock' && p.y > GROUND) { p.y = GROUND; p.vy *= -0.32; p.vx *= 0.6; }
        if (p.kind === 'fire') { p.vx *= 0.94; p.s *= 0.97; }
        p.life--;
        if (p.life <= 0) parts.splice(i, 1);
      }
      for (var j = pops.length - 1; j >= 0; j--) {
        pops[j].y -= 0.35;
        if (--pops[j].life <= 0) pops.splice(j, 1);
      }
    }

    /* ---------- main step ----------------------------------------------*/
    function step() {
      tick++;
      if (shake > 0) shake *= 0.88;
      if (flash > 0) flash -= 0.03;
      if (bannerT > 0) bannerT--;

      if (state === 'play') {
        updatePlayer();
        updateFoes();
        updateFreed();
        updateParts();

        // camera
        var target = clamp(P.x - VW / 2, 0, Math.max(0, worldW - VW));
        camX += (target - camX) * 0.12;

        // buildings falling animation
        var standing = 0;
        for (var i = 0; i < buildings.length; i++) {
          var b = buildings[i];
          if (b.state === 'falling') {
            b.fallT--;
            if (b.fallT % 4 === 0) smoke(b.x + rnd(0, b.w), BASE_Y - rnd(0, 14));
            if (b.fallT <= 0) b.state = 'rubble';
          }
          if (b.state !== 'rubble') standing++;
        }

        if (standing === 0 && freed.length === 0) {
          state = 'clear';
          clearT = 190;
          audio.levelUp();
          var bonus = 1000 + P.hp * 25 + liberated * 100;
          addScore(bonus, null);
          lastBonus = bonus;
          emit('levelclear', { level: level + 1, score: score, freed: liberated, bonus: bonus });
        }
      } else if (state === 'clear') {
        updateParts();
        updateFreed();
        clearT--;
        if (clearT <= 0 || consume('hit')) {
          level++;
          buildLevel(level);
          state = 'play';
          banner = levelCfg().name;
          bannerT = 140;
        }
      } else if (state === 'dead') {
        updateParts(); updateFoes(); updateFreed();
        deadT--;
        if (deadT <= 0) {
          P.alive = true; P.hp = P.maxHp; P.inv = 110;
          P.x = clamp(camX + VW / 2, 20, worldW - 20);
          P.y = GROUND - 40; P.vy = 0; P.mode = 'air'; P.climb = null;
          P.rage = 0; P.rageT = 0; P.jumps = 2; P.launch = 0;
          state = 'play';
        }
      } else if (state === 'attract' || state === 'over') {
        updateParts();
      }

      // clear one-frame edges that nothing consumed
      for (var k in pressed) pressed[k] = false;
    }

    var lastBonus = 0;

    /* ------------------------------------------------------------------ */
    /* Drawing                                                             */
    /* ------------------------------------------------------------------ */

    function renderBuilding(b) {
      var h = Math.max(1, b.rows.length * CELL);
      if (!b.cv) { b.cv = document.createElement('canvas'); b.ctx = null; }
      if (b.cv.width !== b.w || b.cv.height !== h) {
        b.cv.width = b.w; b.cv.height = h; b.ctx = b.cv.getContext('2d');
      }
      var c = b.ctx || (b.ctx = b.cv.getContext('2d'));
      c.clearRect(0, 0, b.w, h);
      var pal = b.pal;

      for (var r = 0; r < b.rows.length; r++) {
        var row = b.rows[r];
        var above = b.rows[r - 1], below = b.rows[r + 1];
        for (var col = 0; col < b.cols; col++) {
          var v = row[col];
          if (!v) continue;
          var x = col * CELL, y = r * CELL;
          c.fillStyle = v === 5 ? pal.c : v === 4 ? pal.c : pal.b;
          c.fillRect(x, y, CELL, CELL);

          if (!above || !above[col]) { c.fillStyle = pal.a; c.fillRect(x, y, CELL, 1); }
          if (!row[col - 1]) { c.fillStyle = pal.a; c.fillRect(x, y, 1, CELL); }
          if (!row[col + 1]) { c.fillStyle = pal.d; c.fillRect(x + CELL - 1, y, 1, CELL); }
          if (below && !below[col]) { c.fillStyle = pal.d; c.fillRect(x, y + CELL - 1, CELL, 1); }

          if (v === 2 || v === 3) {
            c.fillStyle = v === 3 ? pal.lit : pal.win;
            c.fillRect(x + 2, y + 2, 4, 5);
            if (v === 3) { c.fillStyle = '#2a1c08'; c.fillRect(x + 3, y + 3, 2, 3); }
            c.fillStyle = pal.d;
            c.fillRect(x + 3, y + 2, 1, 5);          // the bar
          } else if (v === 6) {
            c.fillStyle = '#171a22'; c.fillRect(x + 1, y + 1, 6, 7);
            c.fillStyle = pal.d;
            c.fillRect(x + 2, y + 1, 1, 7); c.fillRect(x + 5, y + 1, 1, 7);
          } else if (v === 5) {
            // razor wire coils along the roofline
            c.fillStyle = pal.trim;
            for (var w = 0; w < CELL; w += 3) c.fillRect(x + w, y + 1 + ((w >> 1) % 2), 2, 1);
          }
        }
      }

      // Facility sign, so long as the band that carries it is mostly intact.
      if (b.rows.length > 3) {
        var band = b.rows[1];
        if (band && rowAlive(band) > b.cols * 0.7) {
          var tw = textW(b.sign, 1);
          if (tw <= b.w - 4) {
            c.fillStyle = 'rgba(0,0,0,0.45)';
            c.fillRect((b.w - tw) / 2 - 2, CELL + 1, tw + 4, 9);
            text(c, b.sign, b.w / 2, CELL + 2, { scale: 1, color: pal.trim, align: 'center' });
          }
        }
      }
      b.dirty = false;
    }

    function drawSky() {
      var grd = g.createLinearGradient(0, 0, 0, LAND_Y);
      grd.addColorStop(0, C.skyTop);
      grd.addColorStop(0.45, C.skyMid);
      grd.addColorStop(0.82, C.skyLow);
      grd.addColorStop(1, C.haze);
      g.fillStyle = grd;
      g.fillRect(0, 0, VW, LAND_Y);

      // stars
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        var tw = 0.55 + 0.45 * Math.sin((tick + s.t) * 0.05);
        g.globalAlpha = tw * (1 - s.y / SEA_Y);
        g.fillStyle = C.star;
        g.fillRect(Math.round(s.x - camX * 0.05 + VW) % VW, s.y, s.s, s.s);
      }
      g.globalAlpha = 1;

      // moon
      var mx = 336 - camX * 0.04, my = 52;
      g.fillStyle = C.moon;
      g.beginPath(); g.arc(mx, my, 17, 0, Math.PI * 2); g.fill();
      g.fillStyle = C.moonDim;
      g.beginPath(); g.arc(mx - 5, my - 4, 3.5, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(mx + 6, my + 3, 2.5, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(mx + 1, my + 9, 2, 0, Math.PI * 2); g.fill();

      // clouds
      g.globalAlpha = 0.16;
      g.fillStyle = '#ffd9f0';
      for (var c = 0; c < clouds.length; c++) {
        var cl = clouds[c];
        var x = ((cl.x - camX * 0.08 - tick * cl.sp) % (VW + 160) + VW + 160) % (VW + 160) - 80;
        g.fillRect(x, cl.y, cl.w, 4);
        g.fillRect(x + 10, cl.y - 3, cl.w * 0.6, 3);
      }
      g.globalAlpha = 1;
    }

    function drawSea() {
      g.fillStyle = C.sea;
      g.fillRect(0, SEA_Y, VW, LAND_Y - SEA_Y + 6);
      // moonlight shimmering on the water
      g.fillStyle = C.seaLite;
      for (var i = 0; i < 18; i++) {
        var y = SEA_Y + 2 + i * 2.4;
        var w = 6 + Math.sin(tick * 0.04 + i * 1.7) * 7 + i * 1.9;
        g.globalAlpha = 0.16 + 0.3 * Math.abs(Math.sin(tick * 0.03 + i));
        g.fillRect(336 - camX * 0.04 - w / 2, y, w, 2);
      }
      g.globalAlpha = 1;

      // far ridge line of the island
      g.fillStyle = C.ridge;
      g.beginPath();
      g.moveTo(0, LAND_Y + 4);
      for (var x = 0; x <= VW; x += 16) {
        var h = LAND_Y - 22 + Math.sin((x + camX * 0.15) * 0.02) * 8 +
                Math.sin((x + camX * 0.15) * 0.007) * 11;
        g.lineTo(x, h);
      }
      g.lineTo(VW, LAND_Y + 4);
      g.closePath();
      g.fill();

      // island floor
      g.fillStyle = C.land;
      g.fillRect(0, LAND_Y, VW, HUD_Y - LAND_Y);
      g.fillStyle = C.landLite;
      g.fillRect(0, LAND_Y, VW, 3);
    }

    function drawPalm(p, par) {
      var x = Math.round(p.x - camX * par);
      if (x < -34 || x > VW + 34) return;
      var baseY = p.back ? BASE_Y - 2 : GROUND + 5;
      var trunk = p.back ? C.tree : '#0c2116';
      var frond = p.back ? C.tree : '#123a24';

      // trunk, curving with the lean
      g.fillStyle = trunk;
      for (var i = 0; i < p.h; i++) {
        var t = i / p.h;
        g.fillRect(x + Math.round(t * t * p.lean * 5), baseY - i, t > 0.6 ? 2 : 3, 1);
      }

      var tx = x + Math.round(p.lean * 5), ty = baseY - p.h;
      var sway = Math.sin(tick * 0.018 + p.x) * 1.4;

      // seven drooping fronds
      g.fillStyle = frond;
      for (var a = 0; a < 7; a++) {
        var ang = Math.PI + 0.12 + (a / 6) * (Math.PI - 0.24);
        var len = 9 + (a % 2) * 3;
        for (var l = 1; l <= len; l++) {
          var d = l / len;
          var px = tx + Math.cos(ang) * l;
          // fronds start out flat then fall away at the tips
          var py = ty + Math.sin(ang) * l * 0.4 + d * d * 6 + sway * d;
          g.fillRect(Math.round(px), Math.round(py), 2, d > 0.7 ? 1 : 2);
        }
      }
      // coconuts
      g.fillStyle = trunk;
      g.fillRect(tx - 2, ty + 1, 2, 2);
      g.fillRect(tx + 1, ty + 2, 2, 2);
    }

    function drawGroundStrip() {
      // the yard the facilities stand on
      g.fillStyle = C.pave;
      g.fillRect(0, BASE_Y, VW, HUD_Y - BASE_Y);
      g.fillStyle = C.paveLite;
      g.fillRect(0, BASE_Y, VW, 2);

      // perimeter fence along the back of the yard
      var fx0 = -Math.round(camX) % 32;
      g.fillStyle = '#39415a';
      for (var fx = fx0; fx < VW; fx += 32) {
        g.fillRect(fx, BASE_Y - 11, 1, 11);
        g.fillRect(fx + 16, BASE_Y - 9, 1, 9);
      }
      g.fillStyle = '#2f3750';
      g.fillRect(0, BASE_Y - 11, VW, 1);
      g.fillRect(0, BASE_Y - 6, VW, 1);

      // dashed yard marking behind the walk line
      g.fillStyle = '#4c5468';
      for (var x = -Math.round(camX) % 24; x < VW; x += 24) g.fillRect(x, GROUND - 5, 10, 1);

      // kerb, then sand down to the water
      g.fillStyle = C.curb;
      g.fillRect(0, GROUND + 1, VW, 1);
      g.fillStyle = '#2f2b1e';
      g.fillRect(0, GROUND + 2, VW, SURF_Y - GROUND - 2);

      // foreground surf — runs to the bottom edge so the menus, which draw no
      // HUD band, don't show a bare strip.
      g.fillStyle = C.sea;
      g.fillRect(0, SURF_Y, VW, VH - SURF_Y);
      g.fillStyle = C.foam;
      for (var i = 0; i < VW; i += 6) {
        var yy = SURF_Y + Math.round(Math.sin((i + tick * 1.4) * 0.08) * 1.4);
        g.fillRect(i, yy, 4, 1);
      }
    }

    function drawRubble(b) {
      var x = b.x - camX;
      if (x + b.w < -20 || x > VW + 20) return;
      var seed = b.seed;
      g.fillStyle = b.pal.d;
      for (var i = 0; i < b.cols * 2; i++) {
        var rx = x + ((Math.sin(seed + i * 7.1) * 0.5 + 0.5) * b.w);
        var h = 3 + (Math.sin(seed + i * 3.3) * 0.5 + 0.5) * 12;
        g.fillRect(Math.round(rx), BASE_Y - h, 5, h);
      }
      g.fillStyle = b.pal.c;
      for (var j = 0; j < b.cols; j++) {
        var rx2 = x + ((Math.sin(seed + 11 + j * 5.7) * 0.5 + 0.5) * b.w);
        var h2 = 2 + (Math.sin(seed + 5 + j * 2.9) * 0.5 + 0.5) * 8;
        g.fillRect(Math.round(rx2), BASE_Y - h2, 4, h2);
      }
      // a small flag of victory
      g.fillStyle = C.green;
      g.fillRect(Math.round(x + b.w / 2), BASE_Y - 22, 1, 12);
      g.fillRect(Math.round(x + b.w / 2) + 1, BASE_Y - 22, 7, 5);
    }

    function drawBuildings() {
      for (var i = 0; i < buildings.length; i++) {
        var b = buildings[i];
        if (b.state === 'rubble') { drawRubble(b); continue; }
        if (b.dirty) renderBuilding(b);
        var h = b.rows.length * CELL;
        var ox = 0, oy = 0;
        if (b.state === 'falling') {
          ox = rnd(-2, 2);
          oy = (34 - b.fallT) * 0.9;
          g.globalAlpha = clamp(b.fallT / 34, 0, 1);
        }
        var dx = Math.round(b.x - camX + ox);
        if (dx + b.w >= -8 && dx <= VW + 8) {
          g.drawImage(b.cv, dx, Math.round(BASE_Y - h + oy));
          // lit window bloom
          if (!reduceMotion && b.state === 'alive') {
            g.globalAlpha = 0.10 + 0.03 * Math.sin(tick * 0.06 + b.seed);
            g.fillStyle = b.pal.lit;
            g.fillRect(dx, Math.round(BASE_Y - h), b.w, h);
            g.globalAlpha = 1;
          }
        }
        g.globalAlpha = 1;
      }
    }

    function drawSearchlights() {
      for (var i = 0; i < buildings.length; i++) {
        var b = buildings[i];
        if (b.state !== 'alive' || !b.def.turret) continue;
        var x = b.x + b.w / 2 - camX, y = topOf(b) - 6;
        if (x < -60 || x > VW + 60) continue;
        var ang = Math.sin(tick * 0.01 + b.seed) * 0.7 + Math.PI / 2;
        var grd = g.createLinearGradient(x, y, x + Math.cos(ang) * 200, y + Math.sin(ang) * 200);
        grd.addColorStop(0, 'rgba(255,244,190,0.22)');
        grd.addColorStop(1, 'rgba(255,244,190,0)');
        g.fillStyle = grd;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + Math.cos(ang - 0.12) * 220, y + Math.sin(ang - 0.12) * 220);
        g.lineTo(x + Math.cos(ang + 0.12) * 220, y + Math.sin(ang + 0.12) * 220);
        g.closePath();
        g.fill();
      }
    }

    /* ---------- Kwadzilla ---------------------------------------------- */
    function drawKwad() {
      if (!P.alive) return;
      if (P.inv > 0 && Math.floor(tick / 3) % 2 === 0 && P.rageT === 0) return;

      var x = Math.round(P.x - camX), y = Math.round(P.y);

      // shadow
      g.globalAlpha = 0.3;
      g.fillStyle = '#000';
      g.fillRect(x - 14, GROUND + 1, 28, 3);
      g.globalAlpha = 1;

      drawKwadPose(x, y, P.facing, {
        walk: P.walk,
        moving: Math.abs(P.vx) >= 0.2 || P.mode !== 'ground',
        atk: P.atk,
        climb: P.mode === 'climb',
        rage: P.rageT > 0,
        jaw: P.roarT > 0 || (P.rageT > 0 && K.hit),
        scale: 1
      });

      if (P.rageT > 0) {
        g.globalAlpha = 0.18 + 0.08 * Math.sin(tick * 0.3);
        g.fillStyle = C.fire2;
        g.fillRect(x - 24, y - 58, 48, 60);
        g.globalAlpha = 1;
      }
    }

    // Pose-driven so the attract screen can render a much bigger one.
    function drawKwadPose(x, y, facing, pose) {
      var sc = pose.scale || 1;
      g.save();
      g.translate(x, y);
      g.scale(facing * sc, sc);

      var rage = pose.rage;
      var body = rage ? '#f2a13a' : C.body;
      var lite = rage ? '#ffd06a' : C.bodyLite;
      var dark = rage ? '#a3541c' : C.bodyDark;
      var belly = rage ? '#ffe9a0' : C.belly;

      var climbing = pose.climb;
      var bob = climbing ? 0 : Math.round(Math.sin(pose.walk) * 1);
      var sw = Math.sin(pose.walk) * 5;
      var sw2 = Math.sin(pose.walk + Math.PI) * 5;
      if (!pose.moving) { sw = 0; sw2 = 0; }

      function px(bx, by, bw, bh, col) { g.fillStyle = col; g.fillRect(Math.round(bx), Math.round(by + bob), Math.round(bw), Math.round(bh)); }

      // tail — long enough to read as a silhouette from across the room
      var tw = Math.sin(pose.walk * 0.5) * 2;
      px(-11, -23, 10, 10, body);
      px(-19, -22 + tw * 0.3, 9, 9, body);
      px(-26, -22 + tw * 0.7, 8, 8, dark);
      px(-33, -24 + tw, 7, 7, dark);
      px(-39, -27 + tw * 1.4, 6, 6, dark);
      px(-44, -31 + tw * 1.8, 5, 5, dark);

      // back leg
      px(-7 + sw, -16, 9, 10, dark);
      px(-5 + sw, -8, 8, 8, dark);
      px(-9 + sw, -4, 12, 4, dark);

      // torso
      px(-9, -36, 19, 22, body);
      px(-4, -26, 13, 12, belly);
      px(1, -40, 11, 14, body);
      px(2, -30, 8, 8, belly);

      // dorsal spines
      g.fillStyle = C.spine;
      var spineY = [-26, -30, -34, -38, -41];
      var spineX = [-14, -9, -4, 1, 5];
      for (var s = 0; s < spineX.length; s++) {
        g.fillRect(Math.round(spineX[s]), Math.round(spineY[s] + bob), 4, 4);
        g.fillRect(Math.round(spineX[s] + 1), Math.round(spineY[s] - 2 + bob), 2, 2);
      }

      // front leg
      px(-1 + sw2, -16, 9, 10, body);
      px(1 + sw2, -8, 8, 8, body);
      px(-1 + sw2, -4, 12, 4, lite);

      // arms
      var atk = pose.atk;
      var punchExt = atk > 6 ? (14 - atk) * 3 : 0;
      if (atk > 0 && atk <= 6) punchExt = atk * 2.6;
      if (climbing) {
        var ca = Math.sin(pose.walk * 1.4) * 4;
        px(4, -42 + ca, 7, 12, lite);
        px(3, -34 - ca, 7, 11, dark);
      } else {
        px(5, -34, 8, 7, lite);
        px(11 + punchExt, -33, 8 + punchExt * 0.2, 6, lite);
        px(17 + punchExt * 1.3, -35, 8, 8, rage ? '#ffe9a0' : C.bodyLite);  // fist
        if (atk > 4 && atk < 12) {
          g.globalAlpha = 0.5;
          g.fillStyle = '#fff';
          g.fillRect(Math.round(20 + punchExt * 1.3), Math.round(-40 + bob), 3, 18);
          g.globalAlpha = 1;
        }
      }

      // head
      var jaw = pose.jaw ? 4 : 0;
      px(9, -52, 17, 12, body);
      px(24, -49, 8, 7, body);
      px(9, -41 + jaw, 20, 4, dark);       // lower jaw
      px(26, -43 + jaw, 5, 3, dark);
      if (jaw) { px(11, -41, 18, 1, '#4a1414'); }

      // teeth
      g.fillStyle = C.tooth;
      for (var t = 0; t < 5; t++) g.fillRect(Math.round(13 + t * 4), Math.round(-42 + bob), 2, 2);

      // brow + eye
      px(15, -53, 12, 3, dark);
      px(18, -49, 6, 5, '#fff');
      g.fillStyle = rage ? C.fire3 : C.eye;
      g.fillRect(Math.round(20), Math.round(-48 + bob), 4, 4);
      g.fillStyle = '#101010';
      g.fillRect(Math.round(21), Math.round(-47 + bob), 2, 3);

      // nostril
      px(29, -48, 2, 2, dark);

      g.restore();
    }

    function drawFreed() {
      for (var i = 0; i < freed.length; i++) {
        var p = freed[i];
        var x = Math.round(p.x - camX), y = Math.round(p.y);
        if (x < -12 || x > VW + 12) continue;
        var cheering = p.onGround && p.t < p.cheer + 40;
        var stepf = Math.floor(p.t / 5) % 2;
        var hop = cheering ? -Math.abs(Math.round(Math.sin(p.t * 0.25))) : 0;
        y += hop;

        g.fillStyle = '#1b1d26';                     // legs
        if (cheering || stepf) { g.fillRect(x - 2, y - 4, 2, 4); g.fillRect(x + 1, y - 4, 2, 4); }
        else { g.fillRect(x - 4, y - 4, 3, 4); g.fillRect(x + 2, y - 4, 3, 4); }

        g.fillStyle = '#f4813f';                     // jumpsuit
        g.fillRect(x - 3, y - 11, 6, 7);
        g.fillStyle = '#ffa463';                     // lit side
        g.fillRect(x - 3, y - 11, 2, 7);

        g.fillStyle = '#f4813f';                     // arms
        if (cheering) {
          g.fillRect(x - 5, y - 16, 2, 6);
          g.fillRect(x + 4, y - 16, 2, 6);
        } else {
          g.fillRect(x - 5, y - 11, 2, 5);
          g.fillRect(x + 4, y - 11, 2, 5);
        }

        g.fillStyle = '#e0a479';                     // head
        g.fillRect(x - 2, y - 16, 5, 5);
        g.fillStyle = '#3a2a1c';                     // hair
        g.fillRect(x - 2, y - 17, 5, 2);
      }
    }

    function drawFoes() {
      for (var i = 0; i < foes.length; i++) {
        var f = foes[i];
        var x = Math.round(f.x - camX), y = Math.round(f.y);
        if (x < -60 || x > VW + 60) continue;
        var fl = f.flash > 0 && Math.floor(f.flash / 2) % 2 === 0;

        if (f.type === 'chopper' || f.type === 'gunship') {
          var big = f.type === 'gunship';
          var w = big ? 46 : 26, h = big ? 18 : 11;
          g.fillStyle = fl ? '#fff' : (big ? '#454b5e' : '#39404f');
          g.fillRect(x - w / 2, y - h / 2, w, h);
          g.fillStyle = fl ? '#fff' : '#252a36';
          g.fillRect(x - w / 2 - (big ? 16 : 10), y - 2, big ? 16 : 10, big ? 5 : 4);   // tail boom
          g.fillStyle = C.cyan;
          g.fillRect(x + w / 2 - 8, y - h / 2 + 2, 6, 4);                                // cockpit
          // rotor
          g.fillStyle = '#8b93a6';
          var rw = Math.abs(Math.cos(f.rot || 0)) * (big ? 34 : 22) + 4;
          g.fillRect(x - rw, y - h / 2 - 3, rw * 2, 1);
          g.fillRect(x - 1, y - h / 2 - 3, 2, 4);
          // belly light — blinks fast while it lines up a shot
          var lining = f.aim > 0;
          var blink = lining ? Math.floor(f.aim / 4) % 2 === 0 : Math.floor(tick / 12) % 2 === 1;
          g.fillStyle = blink ? C.red : '#511';
          g.fillRect(x - 2, y + h / 2 - 1, 3, 2);

          // …and paints a dotted tracer at where it is about to fire
          if (lining) {
            var px0 = x, py0 = y + h / 2 + 2;
            var px1 = Math.round(P.x - camX), py1 = Math.round(P.y) - 24;
            var seg = Math.max(1, Math.round(Math.hypot(px1 - px0, py1 - py0) / 7));
            g.globalAlpha = 0.55;
            g.fillStyle = C.red;
            for (var d = 1; d < seg; d++) {
              if ((d + Math.floor(tick / 3)) % 2) continue;
              g.fillRect(
                Math.round(px0 + (px1 - px0) * (d / seg)),
                Math.round(py0 + (py1 - py0) * (d / seg)), 2, 2
              );
            }
            g.globalAlpha = 1;
            if (f.aim < 14 && Math.floor(f.aim / 3) % 2 === 0) {
              g.fillStyle = C.red;
              g.fillRect(px1 - 5, py1 - 1, 4, 2);
              g.fillRect(px1 + 2, py1 - 1, 4, 2);
              g.fillRect(px1 - 1, py1 - 6, 2, 4);
              g.fillRect(px1 - 1, py1 + 3, 2, 4);
            }
          }
          if (big) {
            g.fillStyle = '#2b3040';
            g.fillRect(x - 16, y + h / 2, 32, 4);
            // boss health pip
            g.fillStyle = '#000'; g.fillRect(x - 20, y - h / 2 - 10, 40, 4);
            g.fillStyle = C.red; g.fillRect(x - 19, y - h / 2 - 9, 38 * clamp(f.hp / 20, 0, 1), 2);
          }

        } else if (f.type === 'van') {
          g.fillStyle = fl ? '#fff' : '#3d4454';
          g.fillRect(x - 14, y - 15, 28, 13);
          g.fillStyle = fl ? '#fff' : '#2a3040';
          g.fillRect(x - 14, y - 15, 10, 8);
          g.fillStyle = '#5b6478';
          g.fillRect(x - 12, y - 13, 5, 4);                 // windscreen (meshed)
          g.fillStyle = '#16181f';
          g.fillRect(x - 11, y - 3, 6, 4);
          g.fillRect(x + 5, y - 3, 6, 4);                   // wheels
          g.fillStyle = Math.floor(tick / 8) % 2 ? C.red : C.cyan;
          g.fillRect(x - 3, y - 18, 7, 3);                  // light bar
          g.fillStyle = '#6a7488';
          for (var b = 0; b < 4; b++) g.fillRect(x - 2 + b * 4, y - 13, 1, 6);

        } else if (f.type === 'jet') {
          g.fillStyle = fl ? '#fff' : '#59627a';
          g.fillRect(x - 15, y - 3, 30, 6);
          g.fillStyle = '#3c4356';
          g.fillRect(x - 4, y - 8, 12, 5);
          g.fillStyle = C.cyan;
          g.fillRect(x + 8, y - 2, 5, 3);
          g.fillStyle = C.fire2;
          g.fillRect(f.vx > 0 ? x - 17 : x + 13, y - 1, 4, 2);

        } else if (f.type === 'turret') {
          g.fillStyle = fl ? '#fff' : '#4a5162';
          g.fillRect(x - 7, y - 2, 14, 8);
          g.fillStyle = '#2f3542';
          g.fillRect(x - 4, y - 7, 8, 6);
          g.fillStyle = C.gold;
          g.fillRect(x - 2, y - 6, 4, 3);
          var aim = Math.atan2((P.y - 26) - y, P.x - f.x);
          g.fillStyle = '#6b7488';
          g.fillRect(x + Math.cos(aim) * 5 - 1, y - 5 + Math.sin(aim) * 5, 6, 2);
        }
      }
    }

    function drawShots() {
      for (var i = 0; i < shots.length; i++) {
        var s = shots[i];
        var x = Math.round(s.x - camX), y = Math.round(s.y);
        if (s.kind === 'bomb') {
          g.fillStyle = '#c8ccd8'; g.fillRect(x - 2, y - 3, 4, 6);
          g.fillStyle = C.red; g.fillRect(x - 1, y + 2, 2, 2);
        } else if (s.kind === 'shell') {
          g.fillStyle = C.fire2; g.fillRect(x - 2, y - 2, 5, 4);
          g.fillStyle = C.fire1; g.fillRect(x - 1, y - 1, 3, 2);
        } else {
          g.fillStyle = C.cyan; g.fillRect(x - 2, y - 1, 5, 2);
          g.fillStyle = '#fff'; g.fillRect(x - 1, y, 2, 1);
        }
      }
    }

    function drawParts() {
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        var a = p.kind === 'smoke' ? (p.life / p.max) * 0.5 : clamp(p.life / p.max + 0.25, 0, 1);
        g.globalAlpha = a;
        g.fillStyle = p.col;
        var s = Math.max(1, Math.round(p.s));
        g.fillRect(Math.round(p.x - camX), Math.round(p.y), s, s);
      }
      g.globalAlpha = 1;
    }

    function drawPops() {
      for (var i = 0; i < pops.length; i++) {
        var p = pops[i];
        g.globalAlpha = clamp(p.life / 40, 0, 1);
        text(g, p.txt, p.x - camX, p.y, { scale: 1, color: p.col, align: 'center', shadow: '#000' });
      }
      g.globalAlpha = 1;
    }

    /* ---------- HUD ------------------------------------------------------*/
    function drawHUD() {
      // --- top band: readable over whatever sky happens to be behind it
      var tg = g.createLinearGradient(0, 0, 0, 30);
      tg.addColorStop(0, 'rgba(4,7,18,0.72)');
      tg.addColorStop(1, 'rgba(4,7,18,0)');
      g.fillStyle = tg;
      g.fillRect(0, 0, VW, 30);

      text(g, 'SCORE', 8, 5, { scale: 1, color: C.hudDim });
      text(g, pad(score, 7), 8, 14, { scale: 2, color: C.hud, shadow: '#0a0f22' });

      text(g, 'HI', VW - 8, 5, { scale: 1, color: C.hudDim, align: 'right' });
      text(g, pad(Math.max(hiScore, score), 7), VW - 8, 14, {
        scale: 2, color: C.gold, align: 'right', shadow: '#0a0f22'
      });

      var standing = 0;
      for (var i = 0; i < buildings.length; i++) if (buildings[i].state !== 'rubble') standing++;
      text(g, levelCfg().name, VW / 2, 5, { scale: 1, color: C.green, align: 'center', shadow: '#0a0f22' });
      text(g, standing + ' LEFT STANDING', VW / 2, 15, { scale: 1, color: C.hudDim, align: 'center' });

      // --- bottom band
      g.fillStyle = '#080b18';
      g.fillRect(0, HUD_Y, VW, VH - HUD_Y);
      g.fillStyle = '#1d2740';
      g.fillRect(0, HUD_Y, VW, 1);

      var by = HUD_Y + 7;

      // health
      text(g, 'HP', 6, by, { scale: 1, color: C.hudDim });
      g.fillStyle = '#0d1224'; g.fillRect(20, by - 1, 74, 8);
      g.fillStyle = P.hp > 40 ? C.green : C.red;
      g.fillRect(21, by, Math.round(72 * clamp(P.hp / P.maxHp, 0, 1)), 6);

      // spare lives
      for (var l = 0; l < Math.max(0, lives - 1); l++) {
        var lx = 100 + l * 12;
        g.fillStyle = C.body; g.fillRect(lx, by, 8, 6);
        g.fillStyle = C.bodyLite; g.fillRect(lx + 5, by - 3, 5, 5);
        g.fillStyle = C.eye; g.fillRect(lx + 7, by - 2, 2, 2);
      }

      // liberated
      text(g, 'FREED ' + pad(liberated, 3), VW / 2, by, { scale: 1, color: C.gold, align: 'center' });

      // rage
      var rx = VW - 102;
      var ready = P.rage >= 100 && P.rageT === 0;
      g.fillStyle = '#0d1224'; g.fillRect(rx, by - 1, 74, 8);
      var rw = P.rageT > 0 ? (P.rageT / 420) : (P.rage / 100);
      g.fillStyle = P.rageT > 0 ? C.fire3 : (ready ? C.fire2 : C.cyan);
      g.fillRect(rx + 1, by, Math.round(72 * clamp(rw, 0, 1)), 6);
      if (ready && Math.floor(tick / 14) % 2 === 0) {
        text(g, 'READY', rx + 37, by, { scale: 1, color: '#0b0d18', align: 'center' });
      }
      text(g, 'RAGE', VW - 25, by, {
        scale: 1, color: P.rageT > 0 ? C.fire3 : (ready ? C.fire2 : C.hudDim)
      });

      if (bannerT > 0) {
        var a = clamp(bannerT / 40, 0, 1);
        g.globalAlpha = a;
        g.fillStyle = 'rgba(4,8,20,0.72)';
        g.fillRect(0, 108, VW, 26);
        text(g, banner, VW / 2, 116, { scale: 2, color: C.fire2, align: 'center', shadow: '#000' });
        g.globalAlpha = 1;
      }
    }

    function drawClearScreen() {
      g.fillStyle = 'rgba(4,8,20,0.7)';
      g.fillRect(0, 0, VW, VH);
      text(g, 'SECTOR LIBERATED', VW / 2, 84, { scale: 3, color: C.green, align: 'center', shadow: '#04121a' });
      text(g, levelCfg().name, VW / 2, 114, { scale: 1, color: C.hudDim, align: 'center' });
      text(g, 'FREED THIS SECTOR: ' + liberated, VW / 2, 136, { scale: 1, color: C.hud, align: 'center' });
      text(g, 'BONUS +' + lastBonus, VW / 2, 150, { scale: 2, color: C.gold, align: 'center', shadow: '#000' });
      if (Math.floor(tick / 22) % 2 === 0) {
        text(g, 'NEXT ISLAND SECTOR...', VW / 2, 184, { scale: 1, color: C.cyan, align: 'center' });
      }
    }

    function drawAttractArt() {
      // A slow beauty-shot of the island for the menus.
      camX = (camX + 0.22) % Math.max(1, worldW - VW);
      drawSky();
      drawSea();
      for (var i = 0; i < palms.length; i++) if (palms[i].back) drawPalm(palms[i], 0.55);
      drawGroundStrip();
      drawBuildings();
      drawSearchlights();
      for (var j = 0; j < palms.length; j++) if (!palms[j].back) drawPalm(palms[j], 1);

      // The star of the show, twice life size, pacing the shoreline.
      var roar = Math.sin(tick * 0.017) > 0.72;
      var ax = Math.round(VW * 0.80 + Math.sin(tick * 0.008) * 10);
      var ay = GROUND + 8;
      // At scale 2 the mouth sits ~60px ahead of centre and ~92px up.
      if (roar) {
        for (var r = 0; r < 5; r++) {
          fire(ax - 56 + rnd(-4, 4), ay - 90 + rnd(-6, 6), -1);
        }
      }
      drawParts();

      g.globalAlpha = 0.32;
      g.fillStyle = '#000';
      g.fillRect(ax - 34, ay + 2, 68, 5);
      g.globalAlpha = 1;

      drawKwadPose(ax, ay, -1, {
        walk: tick * 0.05, moving: true, atk: 0, climb: false,
        rage: false, jaw: roar, scale: 2
      });
    }

    function render() {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = '#04060f';
      g.fillRect(0, 0, VW, VH);

      if (state === 'attract' || state === 'over') {
        drawAttractArt();
      } else {
        var sx = 0, sy = 0;
        if (shake > 0.2) { sx = rnd(-shake, shake); sy = rnd(-shake, shake); }
        g.save();
        g.translate(Math.round(sx), Math.round(sy));

        drawSky();
        drawSea();
        for (var i = 0; i < palms.length; i++) if (palms[i].back) drawPalm(palms[i], 0.55);
        drawGroundStrip();
        drawBuildings();
        drawSearchlights();
        drawFreed();
        drawKwad();
        drawFoes();
        drawShots();
        for (var j = 0; j < palms.length; j++) if (!palms[j].back) drawPalm(palms[j], 1);
        drawParts();
        drawPops();

        g.restore();
        drawHUD();
        if (state === 'clear') drawClearScreen();
        if (state === 'pause') {
          g.fillStyle = 'rgba(4,8,20,0.72)';
          g.fillRect(0, 0, VW, VH);
        }
      }

      if (hurtTint > 0) {
        g.fillStyle = 'rgba(255,40,60,' + (hurtTint * 0.4).toFixed(3) + ')';
        g.fillRect(0, 0, VW, VH);
      }
      if (flash > 0) {
        g.fillStyle = 'rgba(255,240,210,' + (flash * 0.7).toFixed(3) + ')';
        g.fillRect(0, 0, VW, VH);
      }

      // vignette
      var vg = g.createRadialGradient(VW / 2, VH / 2, 90, VW / 2, VH / 2, 300);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.55)');
      g.fillStyle = vg;
      g.fillRect(0, 0, VW, VH);
    }

    /* ------------------------------------------------------------------ */
    /* Overlay UI                                                          */
    /* ------------------------------------------------------------------ */

    function esc(s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    function ctaHtml() {
      var out = '';
      if (cfg.cta1Url && cfg.cta1Label) {
        out += '<a class="kwad-btn kwad-btn--go" href="' + esc(cfg.cta1Url) + '">' + esc(cfg.cta1Label) + '</a>';
      }
      if (cfg.cta2Url && cfg.cta2Label) {
        out += '<a class="kwad-btn kwad-btn--ghost" href="' + esc(cfg.cta2Url) + '">' + esc(cfg.cta2Label) + '</a>';
      }
      return out ? '<div class="kwad-cta">' + out + '</div>' : '';
    }

    function showAttract() {
      ui.hidden = false;
      ui.innerHTML =
        '<div class="kwad-panel kwad-panel--title">' +
          '<p class="kwad-kicker">Insert nothing. It&rsquo;s free.</p>' +
          '<h3 class="kwad-logo"><span>KWADZILLA</span></h3>' +
          '<p class="kwad-tag">The biggest lizard breaks out</p>' +
          '<div class="kwad-actions">' +
            '<button type="button" class="kwad-btn kwad-btn--go" data-do="start">START</button>' +
            '<button type="button" class="kwad-btn kwad-btn--ghost" data-do="how">HOW TO PLAY</button>' +
          '</div>' +
          (hiScore ? '<p class="kwad-meta">BEST ' + pad(hiScore, 7) + '</p>' : '') +
        '</div>';
      wireUI();
    }

    function showHow() {
      ui.hidden = false;
      ui.innerHTML =
        '<div class="kwad-panel kwad-panel--how">' +
          '<h3 class="kwad-h">HOW TO PLAY</h3>' +
          '<ul class="kwad-list">' +
            '<li><b>&larr; &rarr;</b> stomp along the shoreline</li>' +
            '<li><b>&uarr;</b> climb a wall &middot; <b>&darr;</b> climb down</li>' +
            '<li><b>Space</b> smash concrete &middot; <b>Z</b> jump (again in mid-air for a second one)</li>' +
            '<li><b>Z</b> on a wall kicks off it &mdash; chain kicks to cross a rooftop</li>' +
            '<li><b>Shift</b> unleash RAGE when the meter fills &mdash; hold <b>Space</b> to breathe fire</li>' +
          '</ul>' +
          '<p class="kwad-note">Every barred window you break frees somebody. Get them off the island, ' +
            'flatten every facility, and don&rsquo;t let the gunships put you down.</p>' +
          '<div class="kwad-actions">' +
            '<button type="button" class="kwad-btn kwad-btn--go" data-do="start">LET&rsquo;S GO</button>' +
            '<button type="button" class="kwad-btn kwad-btn--ghost" data-do="back">BACK</button>' +
          '</div>' +
        '</div>';
      wireUI();
    }

    function showPause() {
      ui.hidden = false;
      ui.innerHTML =
        '<div class="kwad-panel">' +
          '<h3 class="kwad-h">PAUSED</h3>' +
          '<div class="kwad-actions">' +
            '<button type="button" class="kwad-btn kwad-btn--go" data-do="resume">RESUME</button>' +
            '<button type="button" class="kwad-btn kwad-btn--ghost" data-do="restart">RESTART</button>' +
          '</div>' +
        '</div>';
      wireUI();
    }

    function showOver() {
      var won = cfg.rewardCode && score >= cfg.rewardScore;
      ui.hidden = false;
      ui.innerHTML =
        '<div class="kwad-panel kwad-panel--over">' +
          '<h3 class="kwad-h kwad-h--red">GAME OVER</h3>' +
          '<dl class="kwad-stats">' +
            '<div><dt>Score</dt><dd>' + pad(score, 7) + '</dd></div>' +
            '<div><dt>Freed</dt><dd>' + totalLiberated + '</dd></div>' +
            '<div><dt>Best</dt><dd>' + pad(hiScore, 7) + '</dd></div>' +
          '</dl>' +
          (won
            ? '<div class="kwad-reward">' +
                '<p class="kwad-reward__label">' + esc(cfg.rewardLabel) + '</p>' +
                '<button type="button" class="kwad-code" data-do="copy" data-code="' + esc(cfg.rewardCode) + '">' +
                  '<span>' + esc(cfg.rewardCode) + '</span><em>copy</em>' +
                '</button>' +
                (cfg.rewardNote ? '<p class="kwad-reward__note">' + esc(cfg.rewardNote) + '</p>' : '') +
              '</div>'
            : (cfg.rewardCode
                ? '<p class="kwad-note">Reach <b>' + pad(cfg.rewardScore, 6) + '</b> to unlock a discount code.</p>'
                : '')) +
          '<div class="kwad-actions">' +
            '<button type="button" class="kwad-btn kwad-btn--go" data-do="start">PLAY AGAIN</button>' +
          '</div>' +
          ctaHtml() +
        '</div>';
      wireUI();
    }

    function hideUI() { ui.hidden = true; ui.innerHTML = ''; }

    function wireUI() {
      Array.prototype.forEach.call(ui.querySelectorAll('[data-do]'), function (b) {
        b.addEventListener('click', function () {
          var act = b.getAttribute('data-do');
          audio.unlock();
          if (act === 'start') startRun();
          else if (act === 'how') showHow();
          else if (act === 'back') showAttract();
          else if (act === 'resume') togglePause();
          else if (act === 'restart') startRun();
          else if (act === 'copy') copyCode(b);
        });
      });
      var first = ui.querySelector('.kwad-btn');
      if (first) first.focus();
    }

    function copyCode(btn) {
      var code = btn.getAttribute('data-code');
      var done = function () {
        var em = btn.querySelector('em');
        if (em) { em.textContent = 'copied!'; setTimeout(function () { em.textContent = 'copy'; }, 1800); }
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(done, function () { fallbackCopy(code, done); });
      } else fallbackCopy(code, done);
    }

    function fallbackCopy(code, done) {
      var ta = document.createElement('textarea');
      ta.value = code;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:absolute;left:-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { /* user can select it manually */ }
      document.body.removeChild(ta);
    }

    /* ---------- flow -----------------------------------------------------*/
    // Lifecycle events, so a store can hook analytics without forking the game:
    //   root.addEventListener('kwadzilla:gameover', e => console.log(e.detail))
    function emit(name, detail) {
      root.dispatchEvent(new CustomEvent('kwadzilla:' + name, {
        detail: detail, bubbles: true
      }));
    }

    function startRun() {
      score = 0; lives = 3; level = 0; totalLiberated = 0;
      buildLevel(0);
      banner = levelCfg().name;
      bannerT = 150;
      state = 'play';
      hideUI();
      canvas.focus();
      if (soundOn) { audio.unlock(); audio.setOn(true); }
      emit('start', { level: level });
    }

    function endGame() {
      if (score > hiScore) { hiScore = score; store('hi', hiScore); }
      audio.gameOver();
      emit('gameover', { score: score, freed: totalLiberated, level: level + 1, best: hiScore });
      setTimeout(function () {
        state = 'over';
        showOver();
      }, 900);
    }

    function togglePause() {
      if (state === 'play') { state = 'pause'; showPause(); audio.stopMusic(); }
      else if (state === 'pause') { state = 'play'; hideUI(); canvas.focus(); if (soundOn) audio.startMusic(); }
    }

    function primaryAction() {
      if (state === 'attract' || state === 'over') startRun();
      else if (state === 'pause') togglePause();
    }

    pauseBtn.addEventListener('click', function () {
      if (state === 'attract' || state === 'over') startRun();
      else togglePause();
    });

    function syncSoundBtn() {
      soundBtn.textContent = 'SOUND: ' + (soundOn ? 'ON' : 'OFF');
      soundBtn.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
      soundBtn.classList.toggle('is-off', !soundOn);
    }
    soundBtn.addEventListener('click', function () {
      soundOn = !soundOn;
      store('sound', soundOn);
      audio.setOn(soundOn);
      if (soundOn && state === 'play') audio.startMusic();
      syncSoundBtn();
    });
    syncSoundBtn();

    /* ---------- loop ------------------------------------------------------*/
    var acc = 0, last = 0, running = true, visible = true, raf = 0;

    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (!last) last = now;
      var dt = Math.min(100, now - last);
      last = now;
      if (!running || !visible) { return; }
      acc += dt;
      var steps = 0;
      while (acc >= STEP && steps < 4) { step(); acc -= STEP; steps++; }
      if (acc > STEP * 6) acc = 0;
      render();
    }

    document.addEventListener('visibilitychange', function () {
      visible = !document.hidden;
      if (document.hidden) {
        if (state === 'play') togglePause();
        audio.stopMusic();
      } else { last = 0; }
    });

    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        running = entries[0].isIntersecting;
        if (!running && state === 'play') togglePause();
        if (running) last = 0;
      }, { threshold: 0.15 });
      io.observe(root);
    }

    // coarse pointer? show the touch pad.
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
      touchWrap.hidden = false;
      touchWrap.removeAttribute('aria-hidden');
      root.classList.add('is-touch');
    }

    /* ---------- boot -------------------------------------------------------*/
    buildScenery();
    buildLevel(0);
    showAttract();
    raf = requestAnimationFrame(frame);

    return {
      start: startRun,
      getState: function () {
        return {
          phase: state, score: score, best: hiScore, lives: lives,
          level: level + 1, freed: totalLiberated,
          standing: buildings.filter(function (b) { return b.state !== 'rubble'; }).length,
          hp: P.hp, x: P.x, y: P.y, mode: P.mode
        };
      },
      destroy: function () {
        cancelAnimationFrame(raf);
        audio.stopMusic();
        root.innerHTML = '';
        delete root.__kwad;
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Mount                                                               */
  /* ------------------------------------------------------------------ */

  function mountAll(scope) {
    var nodes = (scope || document).querySelectorAll('[data-kwadzilla]');
    for (var i = 0; i < nodes.length; i++) {
      if (!nodes[i].__kwad) nodes[i].__kwad = createGame(nodes[i]);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { mountAll(); });
  } else {
    mountAll();
  }

  // Shopify theme editor: sections get re-rendered on the fly.
  document.addEventListener('shopify:section:load', function (e) { mountAll(e.target); });
  document.addEventListener('shopify:section:unload', function (e) {
    var n = e.target.querySelector('[data-kwadzilla]');
    if (n && n.__kwad) n.__kwad.destroy();
  });

  window.Kwadzilla = { mount: mountAll };
})();
