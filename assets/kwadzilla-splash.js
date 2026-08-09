/*!
 * KWADZILLA — 2072 / SOUNDBOY KWAD
 * Coming-soon splash. Zero dependencies, single file, no network requests.
 *
 * One fullscreen triangle, one fragment shader. It draws procedural monitor
 * lizard hide, two eyes that track the cursor (or the phone's tilt), and the
 * wordmark as red smoke. The letterforms are hand-authored vector strokes,
 * rasterised once to an offscreen canvas and uploaded as a texture.
 *
 * Mount by putting an element with [data-kwadzilla-soon] on the page.
 * The canvas is injected here so a visitor with JS off never sees an empty
 * box — they get the CSS fallback that ships in kwadzilla-splash.css.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Constants                                                           */
  /* ------------------------------------------------------------------ */

  var STEP = 1000 / 60;        // fixed simulation tick, same as the game
  var MAX_DPR = 2;             // hard ceiling on device pixel ratio
  var COARSE_DPR = 1.5;        // ...and a lower one for touch screens
  var IDLE_AFTER = 3500;       // ms of no input before the idle drift starts
  var IDLE_FADE = 1200;        // ms to cross-fade into the idle drift
  var LOOK_OMEGA = 9;          // critically-damped spring rate for `look`
  var TILT_RANGE = 35;         // degrees of tilt that map to full deflection
  var TILT_SETTLE = 2000;      // ms after a touch before tilt takes over again
  var SACCADE_MS = 90;         // how long the eyes take to jump to a new target
  var SACCADE_EPS = 0.035;     // how far the target must move to trigger a jump
  var GAZE_MAX = 0.30;         // bound on pupil travel, in globe radii
  var BLINK_MIN = 2600;
  var BLINK_MAX = 7000;
  var BLINK_CLOSE = 130;
  var BLINK_OPEN = 180;
  var PERF_WINDOW = 45;        // frames averaged before dropping render scale
  var PERF_BUDGET = 22;        // ms per frame above which we scale down
  var TEXT_MAX = 2048;         // largest text atlas edge
  var STORE_KEY = 'kwadzilla.soon.v1';

  /* ------------------------------------------------------------------ */
  /* Small helpers                                                       */
  /* ------------------------------------------------------------------ */

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function ease3(t) { return 1 - Math.pow(1 - t, 3); }

  function store(key, val) {
    try {
      if (val === undefined) return window.localStorage.getItem(key);
      window.localStorage.setItem(key, val);
    } catch (e) { /* private mode, quota, disabled — never fatal */ }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Glyph outlines                                                      */
  /* ------------------------------------------------------------------ */

  /* Letterforms are stored as *centreline strokes with per-point width*
     rather than as filled outlines. Authoring outlines by hand for 13
     glyphs is unwieldy and gives uniform stem weight; a weighted skeleton
     gets the thick/thin modulation and the tapered, pointed terminals the
     horror face needs, out of a third of the data.

     Each glyph is a list of strokes. A stroke is [closed, x,y,w, x,y,w, ...]
     on a 100 x 140 em box, y down, origin top left. `w` is the half-width
     at that point — drop it near 3 at a terminal and the stroke ends in a
     spike. buildGlyphPath() interpolates the skeleton with Catmull-Rom and
     offsets it into a fillable polygon. */
  var GLYPHS = {
    '2': [[0, 6,46,3, 14,20,7, 38,6,9, 66,8,9, 84,28,8, 78,54,9, 50,86,10, 18,124,7, 54,127,8, 92,122,3]],
    '0': [[1, 50,6,5, 78,20,10, 86,70,12, 78,120,10, 50,134,5, 22,120,10, 14,70,12, 22,20,10]],
    '7': [[0, 6,12,4, 46,7,9, 88,10,8, 66,56,9, 46,96,8, 34,134,3]],
    'S': [[0, 86,26,4, 62,8,8, 30,12,9, 20,34,9, 44,58,9, 72,72,10, 82,98,9, 60,130,8, 24,128,7, 10,108,3]],
    'O': [[1, 50,5,5, 80,19,10, 89,70,12, 80,121,10, 50,135,5, 20,121,10, 11,70,12, 20,19,10]],
    'U': [[0, 10,8,4, 12,60,9, 18,104,10, 40,130,9, 66,128,9, 86,100,10, 90,54,9, 92,8,4]],
    'N': [[0, 12,136,4, 12,74,9, 13,12,9, 20,26,9, 64,96,9, 87,132,9, 88,70,9, 89,8,4]],
    'D': [[1, 16,134,8, 16,74,9, 16,10,8, 52,12,9, 82,42,10, 84,74,11, 76,112,10, 48,132,9]],
    'B': [
      [0, 16,8,8, 16,70,9, 16,134,8],
      [0, 18,10,7, 54,10,8, 76,32,9, 58,66,8, 20,68,7],
      [0, 18,70,7, 60,70,9, 82,98,10, 62,132,9, 18,134,7]
    ],
    'Y': [
      [0, 8,8,4, 28,40,8, 48,70,9],
      [0, 90,8,4, 70,40,8, 50,70,9],
      [0, 49,66,9, 50,100,9, 51,136,4]
    ],
    'K': [
      [0, 16,8,8, 16,72,9, 16,136,7],
      [0, 88,8,4, 54,42,8, 20,72,9],
      [0, 20,72,9, 56,100,8, 92,136,4]
    ],
    'W': [[0, 4,8,4, 14,60,9, 26,128,8, 40,72,8, 50,44,8, 60,72,8, 74,128,8, 86,60,9, 96,8,4]],
    'A': [
      [0, 8,136,4, 24,74,8, 48,10,8],
      [0, 50,10,8, 74,74,8, 92,136,4],
      [0, 26,92,5, 50,94,6, 74,92,5]
    ]
  };

  /* Advance width per glyph, on the same 100-unit em. */
  var ADVANCE = {
    '2': 96, '0': 98, '7': 92, 'S': 94, 'O': 100, 'U': 100, 'N': 98,
    'D': 96, 'B': 92, 'Y': 96, 'K': 100, 'W': 104, 'A': 100, ' ': 46
  };

  /* Per-glyph baseline jitter so a row never reads as mechanically even:
     [dx, dy, rotation in degrees]. */
  var JITTER = {
    '2': [0, 1.5, -0.9], '0': [-1, -1.0, 0.7], '7': [1, 0.8, 1.1],
    'S': [0, -1.2, -1.3], 'O': [-1, 1.0, 0.6], 'U': [1, -0.6, -0.5],
    'N': [0, 1.3, 0.9], 'D': [-1, -0.9, -0.8], 'B': [1, 0.6, 1.2],
    'Y': [0, -1.4, -0.6], 'K': [-1, 1.1, 0.8], 'W': [1, -0.7, -1.1],
    'A': [0, 1.2, 0.5], ' ': [0, 0, 0]
  };

  /* Catmull-Rom through the skeleton points, carrying width along. */
  function sampleStroke(pts, closed, steps) {
    var n = pts.length / 3;
    var out = [];
    var segs = closed ? n : n - 1;
    var i, s, k, t, tt, ttt, a, b, c, d, i0, i1, i2, i3;

    function at(idx) {
      if (closed) { idx = ((idx % n) + n) % n; }
      else { idx = clamp(idx, 0, n - 1); }
      return idx * 3;
    }

    for (s = 0; s < segs; s++) {
      i0 = at(s - 1); i1 = at(s); i2 = at(s + 1); i3 = at(s + 2);
      for (k = 0; k < steps; k++) {
        t = k / steps; tt = t * t; ttt = tt * t;
        for (i = 0; i < 3; i++) {
          a = pts[i0 + i]; b = pts[i1 + i]; c = pts[i2 + i]; d = pts[i3 + i];
          out.push(0.5 * ((2 * b) + (-a + c) * t +
            (2 * a - 5 * b + 4 * c - d) * tt +
            (-a + 3 * b - 3 * c + d) * ttt));
        }
      }
    }
    if (!closed) {
      out.push(pts[(n - 1) * 3], pts[(n - 1) * 3 + 1], pts[(n - 1) * 3 + 2]);
    }
    return out;
  }

  /* Offset a sampled skeleton into a closed polygon and add it to the path.
     Open strokes become one loop (up one side, back down the other); closed
     strokes become two loops filled even-odd, which leaves the counter. */
  function addStroke(ctx, stroke) {
    var closed = stroke[0] === 1;
    var pts = stroke.slice(1);
    var s = sampleStroke(pts, closed, 14);
    var m = s.length / 3;
    var left = [], right = [];
    var i, px, py, nx, ny, dx, dy, len, w;

    for (i = 0; i < m; i++) {
      px = s[i * 3]; py = s[i * 3 + 1]; w = s[i * 3 + 2];
      // Central difference tangent, wrapping when the stroke is a loop.
      var ia = closed ? (i - 1 + m) % m : Math.max(0, i - 1);
      var ib = closed ? (i + 1) % m : Math.min(m - 1, i + 1);
      dx = s[ib * 3] - s[ia * 3];
      dy = s[ib * 3 + 1] - s[ia * 3 + 1];
      len = Math.sqrt(dx * dx + dy * dy) || 1;
      nx = -dy / len; ny = dx / len;
      left.push(px + nx * w, py + ny * w);
      right.push(px - nx * w, py - ny * w);
    }

    ctx.moveTo(left[0], left[1]);
    for (i = 1; i < m; i++) ctx.lineTo(left[i * 2], left[i * 2 + 1]);
    if (closed) {
      ctx.closePath();
      ctx.moveTo(right[0], right[1]);
      for (i = 1; i < m; i++) ctx.lineTo(right[i * 2], right[i * 2 + 1]);
      ctx.closePath();
    } else {
      for (i = m - 1; i >= 0; i--) ctx.lineTo(right[i * 2], right[i * 2 + 1]);
      ctx.closePath();
    }
    return closed;
  }

  /* Draw one glyph at the current transform origin, on the 100x140 em. */
  function drawGlyph(ctx, ch) {
    var g = GLYPHS[ch];
    if (!g) return;
    var i, closed;
    for (i = 0; i < g.length; i++) {
      ctx.beginPath();
      closed = addStroke(ctx, g[i]);
      ctx.fill(closed ? 'evenodd' : 'nonzero');
    }
  }

  function lineWidthEm(text) {
    var w = 0, i, ch;
    for (i = 0; i < text.length; i++) {
      ch = text.charAt(i);
      w += (ADVANCE[ch] || 90);
    }
    return w;
  }

  /* Run one pass of a whole line through drawGlyph, honouring tracking. */
  function drawLine(ctx, text, x, y, scale, track) {
    var i, ch, j, adv;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    for (i = 0; i < text.length; i++) {
      ch = text.charAt(i);
      adv = ADVANCE[ch] || 90;
      if (ch !== ' ') {
        j = JITTER[ch] || [0, 0, 0];
        ctx.save();
        ctx.translate(j[0], j[1]);
        ctx.rotate(j[2] * Math.PI / 180);
        drawGlyph(ctx, ch);
        ctx.restore();
      }
      ctx.translate(adv + track, 0);
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------ */
  /* Text atlas                                                          */
  /* ------------------------------------------------------------------ */

  var LINE_1 = '2072';
  var LINE_2 = 'SOUNDBOY KWAD';

  /* Three fields packed into RGB, so the shader gets all of them in one
     upload: R = hard coverage, G = blurred (halo and smoke density),
     B = dilated (extrusion depth). */
  function buildTextAtlas(cssW, dpr) {
    var w = Math.min(TEXT_MAX, Math.max(256, Math.round(cssW * dpr)));
    var pad = Math.round(w * 0.10);

    // Line 1 fills ~62% of the block. Line 2 is then sized by *width* to
    // ~86% of line 1 — with 13 glyphs against 4, matching optical weight is
    // a width problem, not a point-size one. Cap height falls out at about
    // a third of line 1, which is the "few points smaller" the brief wants.
    var inner = w - pad * 2;
    var w1 = inner * 0.62;
    var track2 = 22;
    var s1 = w1 / lineWidthEm(LINE_1);
    var em2 = lineWidthEm(LINE_2) + track2 * (LINE_2.length - 1);
    var s2 = (w1 * 0.86) / em2;

    var h1 = 140 * s1;
    var h2 = 140 * s2;
    var gap = h1 * 0.20;
    var h = Math.round(pad * 2 + h1 + gap + h2);

    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var ctx = cv.getContext('2d');

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';

    var x1 = (w - w1) / 2;
    var x2 = (w - em2 * s2) / 2;
    var y1 = pad;
    var y2 = pad + h1 + gap;

    function paint() {
      drawLine(ctx, LINE_1, x1, y1, s1, 0);
      drawLine(ctx, LINE_2, x2, y2, s2, track2);
    }

    // R — hard coverage.
    ctx.fillStyle = '#ff0000';
    paint();

    // G — blurred. ctx.filter is unavailable on older Safari, so fall back
    // to a handful of jittered low-alpha passes.
    ctx.fillStyle = '#00ff00';
    var blur = Math.max(2, w * 0.010);
    if (typeof ctx.filter === 'string') {
      ctx.filter = 'blur(' + blur.toFixed(1) + 'px)';
      paint();
      ctx.filter = 'none';
    } else {
      ctx.globalAlpha = 0.22;
      var k, ang;
      for (k = 0; k < 6; k++) {
        ang = k / 6 * Math.PI * 2;
        ctx.save();
        ctx.translate(Math.cos(ang) * blur, Math.sin(ang) * blur);
        paint();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    // B — dilated, for the extrusion depth ramp.
    ctx.fillStyle = '#0000ff';
    ctx.strokeStyle = '#0000ff';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, w * 0.006);
    ctx.save();
    paint();
    ctx.restore();

    return cv;
  }

  /* ------------------------------------------------------------------ */
  /* Shader source                                                       */
  /* ------------------------------------------------------------------ */

  /* No template literals in this codebase, so the shaders are string
     arrays. Keep one GLSL statement per entry — it makes compiler error
     line numbers line up with what you see here. */
  var VERT = [
    'attribute vec2 aPos;',
    'void main() { gl_Position = vec4(aPos, 0.0, 1.0); }'
  ].join('\n');

  /* fwidth() lives behind OES_standard_derivatives in WebGL1, so the
     extension directive is prepended at link time only when the context
     actually grants it — see buildFrag(). */
  var FRAG = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',

    'uniform vec2  uRes;',
    'uniform float uT;',          // motion time, frozen under reduced-motion
    'uniform vec2  uLook;',
    'uniform vec2  uGazeL;',
    'uniform vec2  uGazeR;',
    'uniform float uBlink;',
    'uniform float uPupil;',
    'uniform float uQuality;',
    'uniform float uIntro;',
    'uniform sampler2D uText;',
    'uniform vec4  uTextRect;',

    'const float DENSITY = 21.0;',
    'const float HEIGHT  = 0.85;',
    'const float JIT     = 0.36;',

    /* -------- hashes. fract-only (Dave Hoskins style): the classic
       fract(sin(dot(...))) loses precision on mediump and bands badly
       across a surface this large. -------- */
    'float hash11(float p) {',
    '  p = fract(p * 0.1031);',
    '  p *= p + 33.33;',
    '  p *= p + p;',
    '  return fract(p);',
    '}',

    'float hash12(vec2 p) {',
    '  vec3 p3 = fract(vec3(p.xyx) * 0.1031);',
    '  p3 += dot(p3, p3.yzx + 33.33);',
    '  return fract((p3.x + p3.y) * p3.z);',
    '}',

    'vec2 hash22(vec2 p) {',
    '  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));',
    '  p3 += dot(p3, p3.yzx + 33.33);',
    '  return fract((p3.xx + p3.yz) * p3.zy);',
    '}',

    'float vnoise(vec2 p) {',
    '  vec2 i = floor(p), f = fract(p);',
    '  vec2 u = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),',
    '             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);',
    '}',

    'float fbm2(vec2 p) {',
    '  float a = 0.5, s = 0.0;',
    '  for (int i = 0; i < 2; i++) { s += a * vnoise(p); p *= 2.02; a *= 0.5; }',
    '  return s / 0.75;',
    '}',

    'float fbm4(vec2 p) {',
    '  float a = 0.5, s = 0.0;',
    '  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.02; a *= 0.5; }',
    '  return s / 0.9375;',
    '}',

    /* -------- Voronoi. One call is ~9 hash evaluations and it is the most
       expensive thing in the shader, so the skin makes exactly one, plus a
       second low-density one for the ocelli on the full-quality path. */
    'float cells(vec2 x, float jit, out vec2 toSeed, out vec2 id, out float f2) {',
    '  vec2 n = floor(x);',
    '  vec2 f = fract(x);',
    '  float f1 = 8.0;',
    '  f2 = 8.0; toSeed = vec2(0.0); id = n;',
    '  for (int j = -1; j <= 1; j++) {',
    '    for (int i = -1; i <= 1; i++) {',
    '      vec2 g = vec2(float(i), float(j));',
    '      vec2 o = hash22(n + g);',
    '      vec2 r = g + 0.5 + (o - 0.5) * jit * 2.0 - f;',
    '      float d = dot(r, r);',
    '      if (d < f1) { f2 = f1; f1 = d; toSeed = r; id = n + g; }',
    '      else if (d < f2) { f2 = d; }',
    '    }',
    '  }',
    '  f2 = sqrt(f2);',
    '  return sqrt(f1);',
    '}',

    /* -------- lizard hide -------- */
    'vec3 skin(vec2 p, out float NoLout, out vec3 Nout) {',
    '  vec2 pMacro = p - uLook * 0.026 * (fbm2(p * 3.0) - 0.5);',
    '  vec2 pBead  = p - uLook * 0.007;',

    // Bead rows bend along body contours, and bead size drifts by region.
    '  vec2 q = pBead * DENSITY;',
    '  q += 0.22 * vec2(fbm2(pBead * 1.7), fbm2(pBead * 1.7 + 5.2));',
    '  q *= mix(0.78, 1.35, fbm2(pBead * 0.6));',
    '  q.y *= 1.14;',

    '  vec2 toSeed, id; float f2;',
    '  float f1 = cells(q, JIT, toSeed, id, f2);',
    '  float idf = id.x * 57.0 + id.y * 131.0;',

    // f1/f2 is 0 at the seed and exactly 1 on the cell boundary, whatever
    // that cell's size or shape. A fixed radius instead either clamps early
    // — flat plateau, hard crease at the edge, the mosaic look — or falls
    // short of the boundary and leaves loose pebbles on a dark ground. This
    // makes each bead a dome that fills its own cell and meets its
    // neighbours, which is how beaded hide actually packs.
    // Ending the dome at 85% of the way to the boundary keeps the bead's
    // iso-contours circular (f1 is a radius) instead of polygonal, and the
    // remainder becomes the groove. Going all the way to 1.0 gives crazy
    // paving; a fixed radius gives loose pebbles.
    '  float rc = clamp(f1 / max(0.80 * f2, 1e-4), 0.0, 1.0);',
    // A paraboloid cap, not a hemisphere: the hemisphere's dh/dr blows up at
    // the rim. The paraboloid's gradient is linear in r, so the bead stays
    // round all the way out to the groove.
    '  float dome = max(0.0, 1.0 - rc * rc);',
    '  float grv  = smoothstep(1.0, 0.90, rc);',            // groove at the cell edge

    // Analytic normal: dh/dr = -2r for the cap above. Finite differences
    // would mean three more cells() calls.
    '  vec2 n2 = -normalize(toSeed + 1e-5) * (2.0 * rc) * HEIGHT;',
    '  n2 += 0.12 * (hash22(id) - 0.5);',                    // per-bead tilt
    '  if (uQuality > 0.5) {',
    '    n2 += 0.055 * vec2(vnoise(q * 9.0) - vnoise(q * 9.0 + 3.1),',
    '                       vnoise(q * 9.0 + 7.7) - vnoise(q * 9.0 + 1.3));',
    '  }',
    '  vec3 N = normalize(vec3(n2, 1.0));',
    '  Nout = N;',

    '  vec3 L = normalize(vec3(uLook * 1.1 + vec2(0.18, 0.42), 0.58));',
    '  vec3 V = normalize(vec3(-p * 0.35, 1.4));',
    '  vec3 H = normalize(L + V);',
    '  H.x /= 1.35;',                                        // row anisotropy
    '  H = normalize(H);',
    '  float NoL = max(dot(N, L), 0.0);',
    '  float NoH = max(dot(N, H), 0.0);',
    '  float NoV = max(dot(N, V), 1e-4);',
    '  float VoH = max(dot(V, H), 0.0);',
    '  NoLout = NoL;',

    // GGX, with roughness varying per scale. That variance is the shimmer.
    '  float rough = 0.17 + 0.24 * hash11(idf + 3.7);',
    '  float a = rough * rough, a2 = a * a;',
    '  float dd = NoH * NoH * (a2 - 1.0) + 1.0;',
    '  float D = a2 / (3.14159265 * dd * dd);',
    '  float F = 0.045 + 0.955 * pow(1.0 - VoH, 5.0);',
    '  float spec = min(D * F * NoL / (4.0 * NoV + 0.02), 5.0);',

    '  vec3 specCol = vec3(1.0);',
    '  if (uQuality > 0.5) {',
    '    float irMask = smoothstep(0.52, 0.78, fbm2(pMacro * 1.9 + 11.0));',
    '    vec3 tint = 0.5 + 0.5 * cos(6.2831853 * (vec3(0.0, 0.33, 0.67)',
    '                + hash11(idf) * 0.4 + 2.1 * NoH));',
    '    specCol = mix(vec3(1.0), tint, 0.32 * irMask);',
    '  }',

    /* Colour is sampled at the bead's seed, not at the fragment, so every
       bead takes one flat colour the way real beaded skin does. Sampling
       per-fragment makes it look like a photo stretched over bumps. */
    '  vec2 pc = pMacro + toSeed / DENSITY;',

    '  vec3 base = mix(vec3(0.052, 0.062, 0.043), vec3(0.108, 0.132, 0.076),',
    '                  fbm4(pc * 2.2));',
    '  float band = 0.5 + 0.5 * sin(pc.y * 4.1 + 2.0 * fbm2(pc * 1.1));',

    // A second, sparse Voronoi. An ocellus is a ring of pale beads around a
    // dark centre, so take a band at a fixed radius from the seed rather
    // than the whole cell edge — and give only some cells one, or the
    // pattern turns into a uniform net.
    '  vec2 ts2, id2; float g2;',
    '  float g1 = cells(pc * 5.0, 0.45, ts2, id2, g2);',
    '  float has = step(0.48, hash11(id2.x * 57.0 + id2.y * 131.0 + 4.2));',
    '  float oc = smoothstep(0.15, 0.21, g1) * smoothstep(0.33, 0.26, g1) * has;',
    '  float dark = smoothstep(0.16, 0.05, g1) * has;',
    '  oc *= mix(0.30, 1.0, band);',
    '  base = mix(base, vec3(0.038, 0.042, 0.030), dark * 0.75);',
    '  base = mix(base, mix(vec3(0.620, 0.440, 0.140), vec3(0.815, 0.735, 0.470),',
    '             hash11(idf + 8.1)), oc * 0.92);',
    '  base = mix(base, vec3(0.760, 0.690, 0.440), step(0.975, hash11(idf + 19.0)) * 0.5);',

    // Dirt collects between beads: darken and desaturate in the grooves.
    '  base *= mix(0.28, 1.0, grv);',
    '  base = mix(vec3(dot(base, vec3(0.299, 0.587, 0.114))), base, mix(0.45, 1.0, grv));',

    // Gate the subsurface on `grv` as well as the dome. Without it the term
    // is at full strength everywhere between the beads, and the grooves
    // turn into warm brown mud that swamps the whole surface.
    '  float wrap = clamp((NoL + 0.42) / 1.42, 0.0, 1.0);',
    '  vec3 sss = vec3(0.42, 0.20, 0.09) * pow(wrap, 2.2) * (1.0 - dome) * grv * 0.30;',

    '  vec3 col = base * (0.19 + 1.28 * NoL) + sss + specCol * spec * grv * 1.35;',
    '  col += base * 0.12 * (0.5 + 0.5 * N.y);',                 // sky bounce
    '  return col;',
    '}',

    /* -------- one eye -------- */
    /* Returns rgb, and writes aperture coverage to cov. `side` is -1 for the
       left eye and +1 for the right so the outer canthus can droop. */
    'vec3 eye(vec2 p, vec2 c, float R, vec2 gaze, float side, out float cov) {',
    '  vec2 ae = vec2(0.166, 0.111);',
    '  vec2 el = (p - c) / ae;',
    '  el.y += side * el.x * 0.10;',                            // droop outward

    '  float xx = clamp(el.x, -1.0, 1.0);',
    '  float hh = pow(max(0.0, 1.0 - xx * xx), 0.9);',           // near-pointed canthi
    '  float upper =  0.98 * hh;',
    '  float lower = -0.86 * hh;',
    '  upper = mix(upper, lower + 0.02, uBlink);',

    '  float d = max(el.y - upper, lower - el.y);',
    '  d = max(d, abs(el.x) - 1.0);',
    '#ifdef HAS_DERIV',
    '  float aa = max(fwidth(d), 1e-4);',
    '#else',
    // Without derivatives, size the edge by hand: one device pixel in
    // p-space, expressed in the aperture's normalised units.
    '  float aa = clamp(2.0 / (min(uRes.x, uRes.y) * ae.y), 1e-4, 0.2);',
    '#endif',
    '  cov = 1.0 - smoothstep(-aa, aa, d);',
    '  if (cov <= 0.001) return vec3(0.0);',

    '  vec2 e = (p - c) / R;',
    '  float r2 = dot(e, e);',
    '  float z = sqrt(max(0.0, 1.0 - min(r2, 1.0)));',
    '  vec3 Ne = vec3(e, z);',

    // Corneal refraction into the iris plane. The ~8% limbal magnification
    // and the bend near the rim is the wet-eye cue; without it the iris
    // reads as a flat decal.
    '  vec3 Vd = normalize(vec3(e * 0.30, -1.0));',
    '  vec3 rd = refract(Vd, Ne, 1.0 / 1.34);',
    '  float tt = (z - 0.58) / max(1e-3, -rd.z);',
    '  vec2 irisUV = e + rd.xy * clamp(tt, 0.0, 1.2);',

    '  vec2 iv = irisUV - gaze;',
    '  float ir = length(iv) / 0.62;',

    // Fibres sampled on the direction vector — sampling atan() directly
    // leaves a seam at +/-pi that is instantly recognisable.
    '  vec2 dir = iv / max(1e-4, length(iv));',
    '  float fib = vnoise(dir * 26.0 + ir * 3.0) * 0.62',
    '            + vnoise(dir * 61.0 + ir * 7.0) * 0.38;',
    '  float collar = smoothstep(0.40, 0.52, ir);',
    '  fib = mix(fib * 0.7, fib, collar);',

    '  vec3 iris = mix(vec3(0.80, 0.44, 0.05), vec3(1.00, 0.76, 0.18),',
    '                  smoothstep(0.30, 1.0, ir));',
    '  iris *= 0.62 + 0.72 * fib;',
    '  iris = mix(iris, iris * vec3(0.82, 1.0, 0.72), 0.25 * fib);',
    '  iris *= mix(0.42, 1.0, smoothstep(0.20, 0.46, ir));',      // contraction folds
    '  iris += vec3(0.9, 0.75, 0.35) * step(0.965, hash12(dir * 40.0 + ir * 9.0)) * 0.5;',

    '  float pupR = 0.21 * uPupil;',
    '  float pup = smoothstep(pupR, pupR + 0.018, ir);',
    '  vec3 col = mix(vec3(0.012, 0.010, 0.014), iris, pup);',

    // Limbal ring. This is what makes an eye read as piercing.
    '  col = mix(col, vec3(0.02, 0.016, 0.012), smoothstep(0.90, 1.0, ir));',
    '  col *= mix(1.0, 0.55, smoothstep(1.0, 1.22, ir));',

    // Varanids show almost no sclera — dark ochre-grey, not human white.
    '  col = mix(col, vec3(0.100, 0.086, 0.062), smoothstep(1.16, 1.42, ir));',

    // Lid cast shadow + contact AO, strongest under the upper lid.
    '  float lidD = clamp((upper - el.y) / max(0.001, upper - lower), 0.0, 1.0);',
    '  col *= mix(0.28, 1.0, smoothstep(0.0, 0.42, lidD));',
    '  col *= mix(0.55, 1.0, smoothstep(0.0, 0.20, 1.0 - abs(el.x)));',

    // Wet catchlight, tracking the same light as the skin.
    '  vec3 L = normalize(vec3(uLook * 1.1 + vec2(0.18, 0.42), 0.58));',
    '  vec3 V = normalize(vec3(-p * 0.35, 1.4));',
    '  vec3 Rr = reflect(-L, Ne);',
    '  float sp = max(dot(Rr, V), 0.0);',
    '  float cat = pow(sp, 240.0) * 1.6 + pow(sp, 28.0) * 0.22;',
    '  vec2 off = e - vec2(0.34, 0.30);',
    '  cat += smoothstep(0.20, 0.0, length(off)) * 0.16;',        // fake window glint
    '  col += vec3(1.0, 0.97, 0.92) * cat * step(r2, 1.0) * (1.0 - uBlink);',

    // Tear film along the lower lid.
    '  col += vec3(0.7, 0.62, 0.5) * smoothstep(0.14, 0.0, abs(el.y - lower)) * 0.12;',

    '  return col;',
    '}',

    /* -------- red smoke wordmark -------- */
    'vec3 smoke(vec2 p, out float glow) {',
    '  vec2 uv = (p - uTextRect.xy) / uTextRect.zw * 0.5 + 0.5;',
    '  glow = 0.0;',
    '  if (uv.x < -0.35 || uv.x > 1.35 || uv.y < -0.35 || uv.y > 1.35) return vec3(0.0);',

    '  float t = uT;',
    '  vec2 w1 = vec2(fbm2(uv * 3.0 + vec2(0.0, -t * 0.09)),',
    '                 fbm2(uv * 3.0 + vec2(5.3, -t * 0.11) + 17.0));',
    '  vec2 w2 = vec2(fbm2(uv * 7.5 + w1 * 1.4 - vec2(0.0, t * 0.22)),',
    '                 fbm2(uv * 7.5 + w1 * 1.4 + vec2(9.1, -t * 0.26)));',
    '  vec2 warp = (w1 - 0.5) * 0.022 + (w2 - 0.5) * 0.008;',
    '  warp.y *= 1.0 + 1.8 * (1.0 - uv.y);',                      // disperses upward
    // A coherent wave on top of the boil. Noise alone reads as slow static.
    '  warp.x += 0.006 * sin(uv.y * 6.0 - t * 1.1);',

    // Fake 3D: taps along an extrusion vector that swings with the look
    // direction, darkening with depth to give the side walls.
    '  vec2 ext = normalize(vec2(uLook.x * 0.6 + 0.12, 0.55)) * 0.014;',
    '  vec3 body = vec3(0.0);',
    '  for (int i = 1; i <= 8; i++) {',
    '    float f = float(i) / 8.0;',
    '    float cB = texture2D(uText, uv + warp * (0.35 + 0.65 * f) + ext * f).b;',
    '    body += cB * mix(vec3(0.55, 0.05, 0.02), vec3(0.10, 0.005, 0.0), f) * (1.0 - f);',
    '  }',

    '  float core = texture2D(uText, uv + warp).r;',
    '  float g0 = texture2D(uText, uv + warp * 1.6).g;',
    '  float g1 = texture2D(uText, uv + warp * 2.6 + vec2(0.0, -0.010)).g;',
    '  float g2 = texture2D(uText, uv + warp * 4.0 + vec2(0.0, -0.026)).g;',

    // Erosion, with a floor. Full erosion looks great on a desktop and
    // destroys legibility on a phone, and the words are the whole point.
    '  core *= mix(0.70, 1.0, smoothstep(0.25, 0.75, fbm2(uv * 14.0 + vec2(0.0, t * 0.35))));',

    '  float flick = 1.0 + 0.06 * sin(t * 3.1) + 0.03 * (vnoise(vec2(t * 11.0, 0.0)) - 0.5);',

    // Keep green low. The tonemap compresses the red channel hard, so any
    // appreciable green survives it and the whole wordmark turns pink.
    '  vec3 col = vec3(1.00, 0.055, 0.020) * pow(core, 0.65) * 3.4',
    '           + vec3(1.00, 0.42, 0.30) * pow(core, 8.0) * 0.22',      // white-hot centre
    '           + vec3(1.00, 0.030, 0.010) * (g0 * 1.4 + g1 * 0.75 + g2 * 0.40)',
    '           + body * 1.3;',
    '  col *= flick;',

    // The warp pushes uv past the atlas edge, where CLAMP_TO_EDGE would
    // smear the border texels into a visible rectangle. Fade them out.
    '  vec2 fd = smoothstep(vec2(0.0), vec2(0.05), uv) * smoothstep(vec2(1.0), vec2(0.95), uv);',
    '  float edge = fd.x * fd.y;',
    '  col *= edge;',

    '  glow = clamp(core * 1.4 + g0 * 1.0 + g1 * 0.5, 0.0, 2.5) * edge;',
    '  return col;',
    '}',

    'void main() {',
    '  float mn = min(uRes.x, uRes.y);',
    // Normalise by the SHORT axis. Dividing by height squeezes the wordmark
    // into x in [-0.23, 0.23] on a 390x844 phone and it stops being legible.
    '  vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / mn;',
    '  p += uLook * 0.010;',                                      // scene breathes as one

    '  float R = 0.150;',
    '  vec2 cL = vec2(-0.225, 0.16);',
    '  vec2 cR = vec2( 0.225, 0.16);',

    '  float NoL; vec3 N;',
    '  vec3 col = skin(p, NoL, N);',

    // Raised rim of enlarged supraocular scales, so the eyes sit *in* the
    // hide instead of on top of it.
    '  float rim = max(smoothstep(1.55, 1.0, length((p - cL) / vec2(0.166, 0.111))),',
    '                  smoothstep(1.55, 1.0, length((p - cR) / vec2(0.166, 0.111))));',
    '  col *= mix(1.0, 0.62, rim);',
    '  col += col * rim * 0.35 * max(N.y, 0.0);',

    '  float covL, covR;',
    '  vec3 eL = eye(p, cL, R, uGazeL, -1.0, covL);',
    '  vec3 eR = eye(p, cR, R, uGazeR,  1.0, covR);',
    '  col = mix(col, eL, covL);',
    '  col = mix(col, eR, covR);',

    '  float glow;',
    '  vec3 txt = smoke(p, glow);',
    // Bleed red light onto the hide before compositing, so the beads under
    // the words are genuinely lit rather than having a decal laid over them.
    '  col += glow * vec3(0.5, 0.06, 0.03) * NoL * 0.6;',
    '  col += txt;',

    // Vignette, filmic-ish curve, and a little dither to kill banding.
    '  col *= 1.0 - 0.44 * smoothstep(0.38, 1.20, length(p * vec2(1.0, 0.85)));',
    '  col = col / (col + 0.72) * 1.35;',
    '  col = pow(max(col, 0.0), vec3(0.4545));',
    '  col += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;',
    '  col *= uIntro;',

    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  /* ------------------------------------------------------------------ */
  /* GL helpers                                                          */
  /* ------------------------------------------------------------------ */

  function getContext(canvas) {
    var opts = {
      alpha: false, antialias: false, depth: false, stencil: false,
      preserveDrawingBuffer: false, powerPreference: 'high-performance',
      desynchronized: true, failIfMajorPerformanceCaveat: false
    };
    var gl = null, i, names = ['webgl', 'experimental-webgl'];
    for (i = 0; i < names.length && !gl; i++) {
      // Some browsers throw here rather than returning null.
      try { gl = canvas.getContext(names[i], opts); } catch (e) { gl = null; }
    }
    return gl;
  }

  /* Extension directives must precede every non-preprocessor token, so the
     prefix goes on ahead of the precision block rather than inside it. */
  function buildFrag(gl) {
    var prefix = '';
    if (gl.getExtension('OES_standard_derivatives')) {
      prefix = '#extension GL_OES_standard_derivatives : enable\n#define HAS_DERIV 1\n';
    }
    return prefix + FRAG;
  }

  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      if (window.console) console.warn('kwadzilla-splash: ' + gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  function link(gl, vsSrc, fsSrc) {
    var vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
    var fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    var prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      if (window.console) console.warn('kwadzilla-splash: ' + gl.getProgramInfoLog(prog));
      gl.deleteProgram(prog);
      return null;
    }
    return prog;
  }

  /* ------------------------------------------------------------------ */
  /* Input                                                               */
  /* ------------------------------------------------------------------ */

  /* One normalised `look` vector drives everything downstream: the light
     direction, both parallax layers, the text extrusion, the scene breathe
     and the point the eyes verge on. */
  function createInput(root, onFirstTilt) {
    var S = {
      raw: { x: 0, y: 0 },
      look: { x: 0, y: 0 },
      vel: { x: 0, y: 0 },
      mode: 'idle',
      lastInput: 0,
      lastTouch: -1e9,
      tiltOK: false,
      restBeta: null,
      idleMix: 1
    };

    var btn = null;

    function setRaw(x, y, mode) {
      S.raw.x = clamp(x, -1, 1);
      S.raw.y = clamp(y, -1, 1);
      S.mode = mode;
      S.lastInput = Date.now();
    }

    function onPointer(ev) {
      var w = window.innerWidth || 1;
      var h = window.innerHeight || 1;
      if (ev.pointerType === 'touch') S.lastTouch = Date.now();
      setRaw(ev.clientX / w * 2 - 1, -(ev.clientY / h * 2 - 1),
        ev.pointerType === 'touch' ? 'touch' : 'pointer');
    }

    function onOrient(ev) {
      if (ev.gamma === null || ev.gamma === undefined) return;
      // A finger drag and the gyro fighting each other looks broken, so a
      // recent touch wins.
      if (Date.now() - S.lastTouch < TILT_SETTLE) return;
      if (S.restBeta === null) S.restBeta = ev.beta || 0;

      var gx = clamp(ev.gamma / TILT_RANGE, -1, 1);
      var gy = clamp(((ev.beta || 0) - S.restBeta) / TILT_RANGE, -1, 1);

      // Correct for screen rotation, so tilting "right" is right whichever
      // way the phone is held.
      var ang = 0;
      if (window.screen && window.screen.orientation &&
          typeof window.screen.orientation.angle === 'number') {
        ang = window.screen.orientation.angle;
      } else if (typeof window.orientation === 'number') {
        ang = window.orientation;
      }
      var r = -ang * Math.PI / 180;
      var cs = Math.cos(r), sn = Math.sin(r);
      setRaw(gx * cs - gy * sn, -(gx * sn + gy * cs), 'tilt');

      if (!S.tiltOK) { S.tiltOK = true; if (onFirstTilt) onFirstTilt(); }
    }

    function attachOrient() {
      window.addEventListener('deviceorientation', onOrient, false);
    }

    function recalibrate() { S.restBeta = null; }

    /* iOS gates the sensor behind a permission call that only works inside a
       user gesture, so it needs a real button. Android just works. */
    function setupTilt() {
      var DOE = window.DeviceOrientationEvent;
      if (!DOE) return;

      if (typeof DOE.requestPermission !== 'function') {
        attachOrient();
        return;
      }

      if (store(STORE_KEY) === 'granted') {
        DOE.requestPermission().then(function (res) {
          if (res === 'granted') attachOrient();
          else showButton();
        })['catch'](showButton);
        return;
      }
      showButton();

      function showButton() {
        if (btn) { btn.hidden = false; return; }
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'kwad-soon__tilt';
        btn.textContent = 'Tap to let it watch you';
        btn.addEventListener('click', function () {
          DOE.requestPermission().then(function (res) {
            if (res !== 'granted') return;
            store(STORE_KEY, 'granted');
            attachOrient();
            btn.hidden = true;
            // Safari has been known to grant and then send nothing. If no
            // event lands, put the prompt back rather than silently failing.
            window.setTimeout(function () {
              if (!S.tiltOK && btn) btn.hidden = false;
            }, 1500);
          })['catch'](function () { /* denied — the touch path still works */ });
        }, false);
        root.appendChild(btn);
      }
    }

    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('pointerdown', onPointer, { passive: true });
    window.addEventListener('orientationchange', recalibrate, false);
    setupTilt();

    S.hideButton = function () { if (btn) btn.hidden = true; };
    S.destroy = function () {
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('orientationchange', recalibrate);
      window.removeEventListener('deviceorientation', onOrient);
      if (btn && btn.parentNode) btn.parentNode.removeChild(btn);
    };
    return S;
  }

  /* ------------------------------------------------------------------ */
  /* The splash                                                          */
  /* ------------------------------------------------------------------ */

  function createSplash(root) {
    var canvas = document.createElement('canvas');
    canvas.className = 'kwad-soon__gl';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.setAttribute('role', 'presentation');

    var gl = getContext(canvas);
    if (!gl) return null;

    var prog = link(gl, VERT, buildFrag(gl));
    if (!prog) return null;

    root.insertBefore(canvas, root.firstChild);
    root.classList.add('is-gl');

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    // One triangle, not a quad: no diagonal seam in the derivatives.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    var U = {};
    ['uRes', 'uT', 'uLook', 'uGazeL', 'uGazeR', 'uBlink', 'uPupil',
     'uQuality', 'uIntro', 'uText', 'uTextRect'].forEach(function (n) {
      U[n] = gl.getUniformLocation(prog, n);
    });

    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // NPOT is legal in WebGL1 with CLAMP_TO_EDGE, LINEAR and no mipmaps,
    // which saves padding the atlas out to a power of two.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    var reduceQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var coarseQ = window.matchMedia ? window.matchMedia('(pointer: coarse)') : null;
    var reduced = !!(reduceQ && reduceQ.matches);
    var coarse = !!(coarseQ && coarseQ.matches);

    var input = createInput(root, function () { /* first tilt event */ });

    var G = {
      w: 0, h: 0, dpr: 1, scale: 1,
      textDirty: true, textAspect: 1,
      time: 0, motion: reduced ? 12 : 0, intro: 0,
      gazeL: { x: 0, y: 0 }, gazeR: { x: 0, y: 0 },
      held: { x: 0, y: 0 }, from: { x: 0, y: 0 }, sacT: 1,
      blinkAt: Date.now() + rnd(BLINK_MIN, BLINK_MAX), blink: 0, blinkPhase: 0,
      pupil: 1, wander: { x: 0, y: 0, at: 0 },
      frames: 0, acc: 0, lost: false
    };

    /* ---------- sizing ------------------------------------------------ */

    function measure() {
      var r = root.getBoundingClientRect();
      G.w = Math.max(1, Math.round(r.width));
      G.h = Math.max(1, Math.round(r.height));
      G.dpr = Math.min(window.devicePixelRatio || 1, coarse ? COARSE_DPR : MAX_DPR);
    }

    function applySize() {
      var bw = Math.max(1, Math.round(G.w * G.dpr * G.scale));
      var bh = Math.max(1, Math.round(G.h * G.dpr * G.scale));
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      gl.viewport(0, 0, bw, bh);
    }

    function uploadText() {
      var cv = buildTextAtlas(G.w, G.dpr);
      G.textAspect = cv.width / cv.height;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
      G.textDirty = false;
    }

    /* ---------- gaze --------------------------------------------------- */

    /* Per-eye vergence: each eye aims at the cursor independently, which is
       free and reads as much more alive than one shared direction. */
    function gazeFor(tx, ty, ex, ey) {
      var dx = tx - ex, dy = ty - ey;
      var d = Math.sqrt(dx * dx + dy * dy) + 1e-4;
      var s = GAZE_MAX / (1 + d) * Math.min(1, d * 3);
      return { x: dx / d * s, y: dy / d * s };
    }

    function updateGaze(dt) {
      var now = Date.now();
      var k = clamp(Math.min(G.w, G.h) / Math.max(G.w, G.h) * 1.6, 0.62, 1);
      var idle = now - input.lastInput > IDLE_AFTER;

      // Where the eyes want to look, in the shader's p-space.
      var aspect = G.w / Math.max(1, G.h);
      var tx, ty;
      if (idle) {
        if (now > G.wander.at) {
          G.wander.x = rnd(-0.5, 0.5) * aspect;
          G.wander.y = rnd(-0.4, 0.4);
          G.wander.at = now + rnd(800, 2200);
        }
        tx = G.wander.x; ty = G.wander.y;
      } else {
        tx = input.raw.x * 0.5 * (aspect > 1 ? aspect : 1);
        ty = input.raw.y * 0.5 * (aspect > 1 ? 1 : 1 / aspect);
      }

      // Real eyes hold, then jump. Tracking continuously is instant
      // googly-eyes, so only re-aim once the target has moved enough.
      var dx = tx - G.held.x, dy = ty - G.held.y;
      if (dx * dx + dy * dy > SACCADE_EPS * SACCADE_EPS) {
        G.from.x = G.gazeL.x; G.from.y = G.gazeL.y;
        G.held.x = tx; G.held.y = ty;
        G.sacT = 0;
      }
      G.sacT = Math.min(1, G.sacT + dt / SACCADE_MS);

      var u = ease3(G.sacT);
      var tL = gazeFor(G.held.x, G.held.y, -0.225, 0.16);
      var tR = gazeFor(G.held.x, G.held.y, 0.225, 0.16);

      // Micro-saccades: two decorrelated slow walks, always on.
      var mx = 0, my = 0;
      if (!reduced) {
        mx = Math.sin(G.time * 4.3) * Math.sin(G.time * 1.7) * 0.012;
        my = Math.sin(G.time * 3.9 + 2.1) * Math.sin(G.time * 1.3) * 0.010;
      }

      G.gazeL.x = lerp(G.from.x, tL.x, u) + mx;
      G.gazeL.y = lerp(G.from.y, tL.y, u) + my;
      G.gazeR.x = lerp(G.from.x, tR.x, u) + mx;
      G.gazeR.y = lerp(G.from.y, tR.y, u) + my;

      // Pupil constricts when the light is head-on, plus a slow breath.
      var lit = 1 - clamp(Math.sqrt(input.look.x * input.look.x + input.look.y * input.look.y), 0, 1);
      G.pupil = lerp(G.pupil, 0.82 + 0.34 * (1 - lit) + (reduced ? 0 : 0.04 * Math.sin(G.time * 0.7)), 0.05);

      // Blinks.
      if (reduced) { G.blink = 0; return; }
      if (G.blinkPhase === 0 && now > G.blinkAt) { G.blinkPhase = 1; G.blinkAt = now; }
      if (G.blinkPhase === 1) {
        G.blink = clamp((now - G.blinkAt) / BLINK_CLOSE, 0, 1);
        if (G.blink >= 1) { G.blinkPhase = 2; G.blinkAt = now; }
      } else if (G.blinkPhase === 2) {
        G.blink = 1 - clamp((now - G.blinkAt) / BLINK_OPEN, 0, 1);
        if (G.blink <= 0) {
          G.blinkPhase = 0;
          // ~15% of blinks come in pairs.
          G.blinkAt = now + (Math.random() < 0.15 ? 140 : rnd(BLINK_MIN, BLINK_MAX));
        }
      }
    }

    /* ---------- simulation --------------------------------------------- */

    function tick(dt) {
      G.time += dt / 1000;
      if (!reduced) G.motion += dt / 1000;
      G.intro = Math.min(1, G.intro + dt / 1200);

      var now = Date.now();
      var since = now - input.lastInput;
      var target = { x: input.raw.x, y: input.raw.y };

      // After a while with no input, drift on a slow Lissajous, cross-faded
      // in so it never snaps.
      if (!reduced) {
        var want = since > IDLE_AFTER ? 1 : 0;
        input.idleMix = clamp(input.idleMix + (want ? dt : -dt) / IDLE_FADE, 0, 1);
        if (input.idleMix > 0) {
          var ix = 0.42 * Math.sin(G.time * 0.21);
          var iy = 0.30 * Math.sin(G.time * 0.17 + 1.3);
          target.x = lerp(target.x, ix, input.idleMix);
          target.y = lerp(target.y, iy, input.idleMix);
        }
      }

      // Critically damped spring, inside the fixed step so it is framerate
      // independent.
      var h = dt / 1000;
      var w = LOOK_OMEGA;
      var ax = (target.x - input.look.x) * w * w - input.vel.x * 2 * w;
      var ay = (target.y - input.look.y) * w * w - input.vel.y * 2 * w;
      input.vel.x += ax * h; input.vel.y += ay * h;
      input.look.x += input.vel.x * h; input.look.y += input.vel.y * h;

      updateGaze(dt);

      // The CSS fallback eyes read these, so they track too.
      root.style.setProperty('--kwad-gaze-x', input.look.x.toFixed(3));
      root.style.setProperty('--kwad-gaze-y', input.look.y.toFixed(3));
    }

    function draw() {
      if (G.textDirty) uploadText();

      gl.useProgram(prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(U.uText, 0);

      gl.uniform2f(U.uRes, canvas.width, canvas.height);
      gl.uniform1f(U.uT, G.motion % 600);
      gl.uniform2f(U.uLook, input.look.x, input.look.y);
      gl.uniform2f(U.uGazeL, G.gazeL.x, G.gazeL.y);
      gl.uniform2f(U.uGazeR, G.gazeR.x, G.gazeR.y);
      gl.uniform1f(U.uBlink, G.blink);
      gl.uniform1f(U.uPupil, G.pupil);
      gl.uniform1f(U.uQuality, G.scale >= 1 && !coarse ? 1 : 0);
      gl.uniform1f(U.uIntro, G.intro);

      // Text block: hung from just under the lower lids and fitted to
      // whatever room is left above the bottom edge. Deriving it rather than
      // hard-coding is what keeps it clear of the eyes in portrait and off
      // the bottom edge in landscape.
      var mn = Math.min(G.w, G.h);
      var edgeY = (G.h / 2) / mn;                 // bottom of the screen, in p-space
      var topY = 0.16 - 0.111 - 0.04;             // just below the eye aperture
      var halfW = (G.w / 2) / mn * 0.88;
      var halfH = halfW / Math.max(0.001, G.textAspect);
      var maxH = Math.max(0.04, (topY + edgeY - 0.05) / 2);
      if (halfH > maxH) { halfH = maxH; halfW = halfH * G.textAspect; }
      gl.uniform4f(U.uTextRect, 0, topY - halfH, halfW, halfH);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    /* ---------- loop --------------------------------------------------- */

    var last = 0, running = true, visible = true, raf = 0, perf = 0, perfN = 0;

    function frame(now) {
      raf = 0;
      if (!running || !visible || G.lost) return;
      if (!last) last = now;
      var delta = Math.min(100, now - last);
      last = now;

      G.acc += delta;
      var steps = 0;
      while (G.acc >= STEP && steps < 4) { tick(STEP); G.acc -= STEP; steps++; }
      if (steps === 4) G.acc = 0;

      draw();

      // Adaptive render scale. Everything here is smooth shading with no
      // hard edges, so dropping the buffer is nearly invisible and buys far
      // more than trimming the shader would.
      perf += delta; perfN++;
      if (perfN >= PERF_WINDOW) {
        if (perf / perfN > PERF_BUDGET && G.scale > 0.6) {
          G.scale = G.scale > 0.75 ? 0.75 : 0.6;
          applySize();
        }
        perf = 0; perfN = 0;
      }

      raf = window.requestAnimationFrame(frame);
    }

    function start() {
      if (raf || !running || !visible || G.lost) return;
      last = 0;
      raf = window.requestAnimationFrame(frame);
    }

    function stop() {
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
    }

    /* ---------- wiring -------------------------------------------------- */

    function resize() {
      var oldW = G.w;
      var oldDpr = G.dpr;
      measure();
      applySize();
      if (Math.abs(G.w - oldW) > 1 || G.dpr !== oldDpr) G.textDirty = true;
      start();
    }

    var resizeTimer = 0;
    function onResize() {
      if (resizeTimer) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(resize, 120);
    }

    function onVisibility() {
      visible = !document.hidden;
      if (visible) {
        // Don't fire a blink the instant the tab comes back.
        G.blinkAt = Date.now() + rnd(BLINK_MIN, BLINK_MAX);
        start();
      } else {
        stop();
      }
    }

    function onReduceChange(ev) {
      reduced = ev.matches;
      if (reduced) G.motion = 12;
    }

    // Mobile Safari drops contexts under memory pressure. Without this the
    // page goes black and stays black.
    function onLost(ev) { ev.preventDefault(); G.lost = true; stop(); }
    function onRestored() {
      G.lost = false;
      root.classList.remove('is-gl');
      // Simplest correct recovery: tear down and mount again.
      api.destroy();
      window.setTimeout(function () { mountAll(document); }, 0);
    }

    canvas.addEventListener('webglcontextlost', onLost, false);
    canvas.addEventListener('webglcontextrestored', onRestored, false);
    document.addEventListener('visibilitychange', onVisibility, false);

    var ro = null;
    if (window.ResizeObserver) {
      ro = new window.ResizeObserver(onResize);
      ro.observe(root);
    } else {
      window.addEventListener('resize', onResize, false);
    }

    if (reduceQ) {
      if (reduceQ.addEventListener) reduceQ.addEventListener('change', onReduceChange);
      else if (reduceQ.addListener) reduceQ.addListener(onReduceChange);
    }

    var io = null;
    if (window.IntersectionObserver) {
      io = new window.IntersectionObserver(function (entries) {
        var vis = entries[entries.length - 1].isIntersecting;
        running = vis;
        if (vis) start(); else stop();
      }, { threshold: 0.15 });
      io.observe(root);
    }

    var api = {
      destroy: function () {
        stop();
        if (ro) ro.disconnect();
        else window.removeEventListener('resize', onResize);
        if (io) io.disconnect();
        document.removeEventListener('visibilitychange', onVisibility);
        canvas.removeEventListener('webglcontextlost', onLost);
        canvas.removeEventListener('webglcontextrestored', onRestored);
        if (reduceQ) {
          if (reduceQ.removeEventListener) reduceQ.removeEventListener('change', onReduceChange);
          else if (reduceQ.removeListener) reduceQ.removeListener(onReduceChange);
        }
        input.destroy();
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        root.classList.remove('is-gl');
        root.__kwadSoon = null;
      }
    };

    measure();
    applySize();
    start();
    return api;
  }

  /* ------------------------------------------------------------------ */
  /* Mount                                                               */
  /* ------------------------------------------------------------------ */

  function mountAll(scope) {
    var nodes = (scope || document).querySelectorAll('[data-kwadzilla-soon]');
    var i, api;
    for (i = 0; i < nodes.length; i++) {
      if (nodes[i].__kwadSoon) continue;
      api = createSplash(nodes[i]);
      // No API means no WebGL — the CSS fallback is already on screen.
      if (api) nodes[i].__kwadSoon = api;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { mountAll(document); });
  } else {
    mountAll(document);
  }

  // Shopify's theme editor tears sections down and rebuilds them in place.
  document.addEventListener('shopify:section:load', function (ev) { mountAll(ev.target); });
  document.addEventListener('shopify:section:unload', function (ev) {
    var nodes = ev.target.querySelectorAll('[data-kwadzilla-soon]');
    var i;
    for (i = 0; i < nodes.length; i++) {
      if (nodes[i].__kwadSoon) nodes[i].__kwadSoon.destroy();
    }
  });

  window.KwadzillaSplash = { mount: mountAll };
})();
