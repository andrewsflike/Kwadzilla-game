/*!
 * KWADZILLA — coming soon
 *
 * Fire, filling the viewport. Zero dependencies, one file, no network
 * requests: a volumetric flame front raymarched in WebGL2 against a 3D
 * noise volume generated at load.
 *
 * It is genuinely volumetric rather than a scrolling texture — rays march
 * through a slab of density, so near tongues occlude far ones, the fire
 * has depth to look into, and the light falls off through its own smoke.
 * That is what a flat fire shader can never do and it is most of why this
 * reads as fire rather than as an animation of fire.
 *
 * The visitor pushes it around. On a pointer the flames lean towards the
 * cursor and flare under it; on a touchscreen a drag does the same and a
 * tap throws a burst, with the phone's own tilt pushing the whole front
 * sideways like wind on a torch.
 *
 * Mount by putting an element with [data-kwadzilla-soon] on the page. The
 * canvas is injected from here, so a visitor without JS or without WebGL2
 * keeps the page and the wordmark rather than an empty box.
 *
 * ------------------------------------------------------------------
 * WORDMARK
 * ------------------------------------------------------------------
 * The words live in .kwad-soon__words as real DOM, above the canvas.
 * Drop an <svg> into the empty slot at [data-kwad-mark] and that is the
 * whole swap: this file spots the element, adds .has-mark, and the text
 * lines take themselves out. Nothing in the fire depends on either.
 *
 * Layout:
 *   1. maths          the small amount of it this needs
 *   2. gl helpers     shader/program plumbing
 *   3. noise volume   the 3D field the fire is carved out of
 *   4. shaders        fire raymarch, embers, composite
 *   5. interaction    pointer, taps, tilt — the forces on the fire
 *   6. renderer       the frame loop
 *   7. mount          DOM wiring, input, accessibility, teardown
 */
(function () {
  'use strict';

  /* ================================================================== */
  /* 1. Maths                                                            */
  /* ================================================================== */

  var PI = Math.PI;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sat(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  function smoothstep(e0, e1, x) {
    var t = sat((x - e0) / (e1 - e0));
    return t * t * (3 - 2 * t);
  }

  /* ================================================================== */
  /* 2. GL helpers                                                       */
  /* ================================================================== */

  function compile(gl, type, src, label) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('kwadzilla: ' + label + ' failed to compile\n' + log);
    }
    return sh;
  }

  function program(gl, vsSrc, fsSrc, label) {
    var vs = compile(gl, gl.VERTEX_SHADER, vsSrc, label + ' vertex');
    var fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc, label + ' fragment');
    var pr = gl.createProgram();
    gl.attachShader(pr, vs);
    gl.attachShader(pr, fs);
    gl.linkProgram(pr);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) {
      var log = gl.getProgramInfoLog(pr);
      gl.deleteProgram(pr);
      throw new Error('kwadzilla: ' + label + ' failed to link\n' + log);
    }
    pr.u = {};
    var n = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS), i, info;
    for (i = 0; i < n; i++) {
      info = gl.getActiveUniform(pr, i);
      pr.u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(pr, info.name);
    }
    return pr;
  }

  /* ================================================================== */
  /* 3. Noise volume                                                     */
  /* ================================================================== */

  var VOL_N = 48;   // 48³ RGBA — small enough to build in a few ms

  /*
   * The field the fire is carved out of.
   *
   * Computing noise in the shader is the obvious way and the wrong one:
   * a raymarch evaluates density tens of times per pixel and each
   * evaluation would want a couple of dozen hashes, which is thousands of
   * hashes per pixel per frame. A 3D texture turns each octave into a
   * single filtered fetch, and the hardware does the interpolation.
   *
   * RGB carry three independent fields, used together as a warp vector so
   * the domain distortion costs one fetch rather than three. A holds the
   * field the density itself is built from.
   *
   * Wrap-around smoothing on each axis, because trilinear filtering of raw
   * white noise leaves axis-aligned creases that survive the warp.
   */
  function buildVolume(N) {
    var n = N * N * N, data = new Uint8Array(n * 4), i;
    var s = 0x9e3779b9;
    function rnd() {
      s ^= s << 13; s >>>= 0;
      s ^= s >> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    }
    for (i = 0; i < n * 4; i++) data[i] = (rnd() * 256) | 0;

    var tmp = new Uint8Array(n * 4);
    var strides = [4, N * 4, N * N * 4];
    var src = data, dst = tmp, axis, c, x, y, z, idx, k;
    for (axis = 0; axis < 3; axis++) {
      var st = strides[axis];
      var wrap = st * N;
      for (z = 0; z < N; z++) {
        for (y = 0; y < N; y++) {
          for (x = 0; x < N; x++) {
            idx = (z * N * N + y * N + x) * 4;
            /* Position along this axis, for the wrap. */
            var a = axis === 0 ? x : (axis === 1 ? y : z);
            var base = idx - a * st;
            var prev = base + ((a + N - 1) % N) * st;
            var next = base + ((a + 1) % N) * st;
            for (c = 0; c < 4; c++) {
              dst[idx + c] = (src[prev + c] + 2 * src[idx + c] + src[next + c]) >> 2;
            }
          }
        }
      }
      k = src; src = dst; dst = k;
      if (wrap) { /* keeps the closure honest about `wrap` being used */ }
    }
    return src;
  }

  /* ================================================================== */
  /* 4. Shaders                                                          */
  /* ================================================================== */

  var FULLSCREEN_VS = [
    '#version 300 es',
    'void main(){',
    '  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);',
    '  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  var MAX_BURSTS = 4;

  /* ---- the fire --------------------------------------------------- */

  var FIRE_FS = [
    '#version 300 es',
    'precision highp float;',
    'precision highp sampler3D;',
    'uniform sampler3D uVol;',
    'uniform vec2 uRes;',
    'uniform float uTime;',
    'uniform float uAspect;',
    'uniform float uTanH;',
    'uniform float uCamY;',
    'uniform float uCamZ;',
    'uniform float uBaseY;',
    'uniform float uTopY;',
    'uniform vec3 uPointer;',        // world xy on z=0, z = strength
    'uniform float uWind;',          // global lateral push
    'uniform float uDraft;',         // extra rise under the pointer
    'uniform vec4 uBursts[4];',      // xy world, z = age 0..1, w = strength
    'uniform int uSteps;',
    'uniform float uCalm;',          // 1 normally, lower under reduced motion
    'out vec4 fragColor;',
    '',
    'float hash12(vec2 p){ vec3 q = fract(vec3(p.xyx)*0.1031); q += dot(q, q.yzx+33.33); return fract((q.x+q.y)*q.z); }',
    '',
    'float vnoise(vec3 p){ return texture(uVol, p).a; }',
    'vec3 vwarp(vec3 p){ return texture(uVol, p).rgb * 2.0 - 1.0; }',
    '',
    'float fbm(vec3 p){',
    '  float f = 0.5000 * vnoise(p * 0.50);',
    '  f += 0.2500 * vnoise(p * 1.03);',
    '  f += 0.1250 * vnoise(p * 2.11);',
    '  f += 0.0625 * vnoise(p * 4.07);',
    '  return f * 1.0667;',
    '}',
    '',
    /* Blackbody-ish, hand-tuned rather than physical: real Planck colours
       go magenta at the top end and fire never looks like that. */
    'vec3 fireColour(float t){',
    '  vec3 c = vec3(0.62, 0.055, 0.010);',
    '  c = mix(c, vec3(1.00, 0.230, 0.030), smoothstep(0.06, 0.34, t));',
    '  c = mix(c, vec3(1.00, 0.520, 0.090), smoothstep(0.30, 0.58, t));',
    '  c = mix(c, vec3(1.00, 0.820, 0.330), smoothstep(0.55, 0.82, t));',
    '  c = mix(c, vec3(1.00, 0.965, 0.840), smoothstep(0.80, 1.00, t));',
    '  return c;',
    '}',
    '',
    /*
     * Density and temperature at a point.
     *
     * The shape is a threshold that climbs with height: subtracting more
     * of the noise the higher you go is what turns a cloud into tongues
     * that taper and break off, and it costs nothing.
     */
    'float density(vec3 p, out float temp){',
    '  float hn = clamp((p.y - uBaseY) / (uTopY - uBaseY), 0.0, 1.4);',
    '',
    '  vec3 q = p;',
    '  q.y -= uTime * 0.78 * uCalm;',
    /* Squash the sampling domain vertically. Isotropic noise makes clouds;
       fire is drawn upward by its own draft, and stretching the features
       along that axis is most of the difference between smoke and flame. */
    '  q.y *= 0.40;',
    '',
    /* Curl-ish domain warp — one fetch, three fields — growing with height
       because the tips of a fire are the part that is free to thrash. */
    '  vec3 w = vwarp(p * vec3(0.50, 0.21, 0.50) + vec3(0.0, uTime * -0.17 * uCalm, 0.0));',
    '  q += w * (0.20 + 0.62 * hn);',
    '',
    /* Forces. The pointer drags the fire towards itself and the whole
       front leans on the wind; both scale with height, because the base
       of a fire is anchored and only the tips are free to move. */
    '  vec2 dp = uPointer.xy - p.xy;',
    '  float inf = exp(-dot(dp, dp) * 2.10) * uPointer.z;',
    '  q.x -= dp.x * inf * 1.15 * hn;',
    '  q.y -= inf * uDraft * 0.70;',
    '  q.x += uWind * hn * hn * 1.15;',
    '',
    '  float n = fbm(q * 1.10);',
    '',
    /* Threshold rises with height: tongues, not fog. Gently, or the front
       burns out halfway up and leaves the top of the frame empty. */
    '  float thr = 0.375 + 0.200 * hn;',
    '  float d = max(n - thr, 0.0) / max(0.10, 1.0 - thr);',
    '  d = pow(d, 0.88) * 1.30;',
    '',
    /* Envelope: anchored at the base, thinning out past the frame top. */
    '  d *= smoothstep(-0.05, 0.13, hn);',
    '  d *= 1.0 - smoothstep(0.92, 1.50, hn);',
    '  d *= exp(-p.z * p.z * 1.05);',
    '',
    /* Heat: hottest low and dense, plus whatever the visitor is doing. */
    '  temp = d * 1.55 * (1.28 - 0.80 * smoothstep(0.0, 0.92, hn));',
    '  temp += inf * 0.26;',
    '  d *= 1.0 + inf * 0.42;',
    '',
    '  for(int i = 0; i < 4; i++){',
    '    vec4 b = uBursts[i];',
    '    if(b.w <= 0.0) continue;',
    '    float life = 1.0 - b.z;',
    '    vec2 db = p.xy - b.xy;',
    '    float r = b.z * 1.55;',
    '    float ring = exp(-pow(length(db) - r, 2.0) * 15.0);',
    '    temp += ring * life * b.w * 0.70;',
    '    d += ring * life * b.w * 0.30 * smoothstep(-0.12, 0.18, hn);',
    '  }',
    '',
    '  temp = clamp(temp, 0.0, 1.0);',
    '  return d;',
    '}',
    '',
    'void main(){',
    '  vec2 ndc = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;',
    '  vec3 ro = vec3(0.0, uCamY, uCamZ);',
    '  vec3 rd = normalize(vec3(ndc.x * uTanH * uAspect, ndc.y * uTanH, -1.0));',
    '',
    /* Two slabs is all the volume needs: it is unbounded across, which is
       what lets one wall of fire fill any aspect ratio without a seam. */
    '  float t0 = 0.0, t1 = 1e9;',
    '  float loY = uBaseY - 0.35, hiY = uTopY + 0.55;',
    '  if(abs(rd.y) > 1e-5){',
    '    float a = (loY - ro.y) / rd.y, b = (hiY - ro.y) / rd.y;',
    '    t0 = max(t0, min(a, b)); t1 = min(t1, max(a, b));',
    '  } else if(ro.y < loY || ro.y > hiY){ fragColor = vec4(0.0); return; }',
    '  if(abs(rd.z) > 1e-5){',
    '    float a = (-1.45 - ro.z) / rd.z, b = (1.45 - ro.z) / rd.z;',
    '    t0 = max(t0, min(a, b)); t1 = min(t1, max(a, b));',
    '  }',
    '  if(t1 <= t0){ fragColor = vec4(0.0); return; }',
    '',
    '  float dt = (t1 - t0) / float(uSteps);',
    /* Jitter the entry point per pixel: without it the fixed step size
       lays visible shells through the smoke. */
    '  float jit = hash12(gl_FragCoord.xy + fract(uTime) * 57.0);',
    '',
    '  vec3 col = vec3(0.0);',
    '  float trans = 1.0;',
    '  for(int i = 0; i < 96; i++){',
    '    if(i >= uSteps) break;',
    '    vec3 p = ro + rd * (t0 + (float(i) + jit) * dt);',
    '    float temp;',
    '    float d = density(p, temp);',
    '    if(d > 0.0015){',
    '      vec3 em = fireColour(temp) * (temp * temp * 6.2 + temp * 0.80) * d;',
    '      col += em * trans * dt * 3.6;',
    /* Absorption has to be high enough that the front of the fire hides
       what is behind it. Too low and every tongue in the slab sums into
       one flat sheet of white at the base. */
    '      trans *= exp(-d * 3.6 * dt);',
    '      if(trans < 0.012) break;',
    '    }',
    '  }',
    '',
    '  fragColor = vec4(col, 1.0 - trans);',
    '}'
  ].join('\n');

  /* ---- embers ------------------------------------------------------ */

  var EMBER_VS = [
    '#version 300 es',
    'precision highp float;',
    'in float aSeed;',
    'uniform float uTime;',
    'uniform float uAspect;',
    'uniform float uTanH;',
    'uniform float uCamY;',
    'uniform float uCamZ;',
    'uniform float uBaseY;',
    'uniform float uTopY;',
    'uniform vec2 uRes;',
    'uniform float uWind;',
    'uniform vec3 uPointer;',
    'uniform float uCalm;',
    'out float vLife;',
    'out float vHeat;',
    '',
    'float h1(float n){ return fract(sin(n * 127.1) * 43758.5); }',
    '',
    'void main(){',
    '  float s = aSeed;',
    '  float speed = 0.30 + 0.55 * h1(s + 3.1);',
    '  float span = uTopY - uBaseY;',
    /* Each ember runs its own loop, offset so they do not pulse together. */
    '  float phase = fract(h1(s) + uTime * speed * 0.14 * uCalm);',
    '  vLife = phase;',
    '',
    '  float x = (h1(s + 7.7) - 0.5) * 3.4 * max(uAspect, 1.0);',
    '  float y = uBaseY + phase * span * 1.05;',
    '  float z = (h1(s + 11.3) - 0.5) * 1.9;',
    '',
    /* Sway, and the same wind the fire feels. */
    '  x += sin(uTime * (0.7 + h1(s + 5.2)) + s * 6.0) * 0.16 * phase;',
    '  x += uWind * phase * phase * 1.6;',
    '  vec2 dp = uPointer.xy - vec2(x, y);',
    '  float inf = exp(-dot(dp, dp) * 1.1) * uPointer.z;',
    '  x -= dp.x * inf * 0.5;',
    '  y += inf * 0.28;',
    '',
    '  vec3 p = vec3(x, y, z) - vec3(0.0, uCamY, uCamZ);',
    '  float w = -p.z;',
    '  if(w < 0.05){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }',
    '  vec2 sp = vec2(p.x / (uTanH * uAspect), p.y / uTanH) / w;',
    '  gl_Position = vec4(sp, 0.0, 1.0);',
    '  gl_PointSize = clamp((1.4 + 3.4 * h1(s + 13.9)) / w * (uRes.y / 900.0), 1.0, 9.0);',
    '  vHeat = h1(s + 17.3);',
    '}'
  ].join('\n');

  var EMBER_FS = [
    '#version 300 es',
    'precision highp float;',
    'in float vLife;',
    'in float vHeat;',
    'out vec4 fragColor;',
    'void main(){',
    '  vec2 d = gl_PointCoord - 0.5;',
    '  float r = dot(d, d) * 4.0;',
    '  if(r > 1.0) discard;',
    '  float a = pow(1.0 - r, 2.2);',
    /* Born bright, dies cool and dim. */
    '  float cool = 1.0 - vLife;',
    '  vec3 c = mix(vec3(0.85, 0.12, 0.02), vec3(1.0, 0.86, 0.52), cool * (0.35 + 0.65 * vHeat));',
    '  float fade = smoothstep(0.0, 0.08, vLife) * (1.0 - smoothstep(0.45, 1.0, vLife));',
    '  fragColor = vec4(c * a * fade * 1.5, 1.0);',
    '}'
  ].join('\n');

  /* ---- composite --------------------------------------------------- */

  var POST_FS = [
    '#version 300 es',
    'precision highp float;',
    'uniform sampler2D uFire;',
    'uniform vec2 uTexel;',
    'uniform float uTime;',
    'uniform float uGrain;',
    'out vec4 fragColor;',
    'float hash12(vec2 p){ vec3 q = fract(vec3(p.xyx)*0.1031); q += dot(q, q.yzx+33.33); return fract((q.x+q.y)*q.z); }',
    'vec3 tonemap(vec3 x){ return 1.0 - exp(-max(x, vec3(0.0))); }',
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy * uTexel;',
    /* The fire is rendered at half resolution — it is all soft gradients,
       so the only thing full resolution would buy is cost. Four taps to
       lift it back up without the blockiness a single tap leaves. */
    '  vec2 o = uTexel * 0.5;',
    '  vec4 f = texture(uFire, uv + vec2(-o.x, -o.y))',
    '        + texture(uFire, uv + vec2( o.x, -o.y))',
    '        + texture(uFire, uv + vec2(-o.x,  o.y))',
    '        + texture(uFire, uv + vec2( o.x,  o.y));',
    '  f *= 0.25;',
    '',
    '  vec3 c = f.rgb;',
    /* The room the fire is in. Kept low and kept near the base: spread it
       up the frame and the whole page goes brown, which is the difference
       between a fire in the dark and a photograph of rust. */
    '  float glow = smoothstep(0.45, 0.0, uv.y);',
    '  c += vec3(0.070, 0.017, 0.003) * glow * glow;',
    '  c += vec3(0.008, 0.003, 0.001);',
    '',
    '  c = tonemap(c * 1.10);',
    '',
    '  vec2 q = uv - 0.5;',
    '  c *= 1.0 - dot(q, q) * 0.24;',
    '  c += (hash12(gl_FragCoord.xy + fract(uTime) * 431.7) - 0.5) * uGrain;',
    '  float dth = (hash12(gl_FragCoord.xy * 0.37) - 0.5) / 255.0;',
    '  fragColor = vec4(pow(max(c + dth, 0.0), vec3(1.0 / 2.2)), 1.0);',
    '}'
  ].join('\n');

  /* ================================================================== */
  /* 5. Interaction                                                      */
  /* ================================================================== */

  /*
   * The forces the visitor applies, and how they decay.
   *
   * Everything is smoothed: a pointer that jumps a hundred pixels between
   * frames would otherwise snap the whole flame front sideways, and fire
   * has mass.
   */
  function Forces() {
    this.px = 0; this.py = 0;        // pointer, world
    this.tx = 0; this.ty = 0;        // target
    this.strength = 0;
    this.wind = 0; this.windT = 0;
    this.draft = 0;
    this.tilt = 0;
    this.bursts = [];
    this.calm = 1;
  }

  Forces.prototype.point = function (wx, wy) {
    this.tx = wx; this.ty = wy;
    this.strength = 1;
  };

  Forces.prototype.burst = function (wx, wy, power) {
    if (this.bursts.length >= MAX_BURSTS) this.bursts.shift();
    this.bursts.push({ x: wx, y: wy, age: 0, power: power });
  };

  Forces.prototype.step = function (dt, idle) {
    var k = Math.min(1, dt * 7.5);
    this.px += (this.tx - this.px) * k;
    this.py += (this.ty - this.py) * k;

    /* Attention fades if nobody is doing anything. */
    if (idle) this.strength = Math.max(0, this.strength - dt * 0.55);

    /* Wind follows the pointer's side of the frame, plus the phone's own
       tilt, and lags well behind both. */
    var target = clamp(this.px * 0.30, -0.75, 0.75) * this.strength + this.tilt;
    this.wind += (target - this.wind) * Math.min(1, dt * 1.9);
    this.draft += ((idle ? 0 : 1) - this.draft) * Math.min(1, dt * 3.0);

    var i;
    for (i = this.bursts.length - 1; i >= 0; i--) {
      this.bursts[i].age += dt / 0.95;
      if (this.bursts[i].age >= 1) this.bursts.splice(i, 1);
    }
  };

  Forces.prototype.writeBursts = function (out) {
    var i;
    for (i = 0; i < MAX_BURSTS; i++) {
      var b = this.bursts[i];
      if (b) {
        out[i * 4] = b.x; out[i * 4 + 1] = b.y;
        out[i * 4 + 2] = b.age; out[i * 4 + 3] = b.power;
      } else {
        out[i * 4] = 0; out[i * 4 + 1] = 0; out[i * 4 + 2] = 0; out[i * 4 + 3] = 0;
      }
    }
  };

  /* ================================================================== */
  /* 6. Renderer                                                         */
  /* ================================================================== */

  var MAX_DPR = 2;
  var COARSE_DPR = 1.5;
  var FIRE_SCALE = 0.5;         // the raymarch runs at half the display
  var PERF_WINDOW = 45;
  var PERF_BUDGET = 22;
  var EMBER_COUNT = 520;

  var FOV_Y = 45 * PI / 180;
  var CAM_Y = 1.00;
  var CAM_Z = 3.00;

  function Studio(host, canvas) {
    this.host = host;
    this.canvas = canvas;
    this.gl = null;
    this.forces = new Forces();
    this.raf = 0;
    this.last = 0;
    this.time = 0;
    this.frames = 0;
    this.frameSum = 0;
    this.scale = 1;
    this.steps = 56;
    this.running = false;
    this.ready = false;
    this.W = 0; this.H = 0;
    this.gaze = [0, 0];
    this.lastInput = 0;
    this.burstBuf = new Float32Array(MAX_BURSTS * 4);
  }

  Studio.prototype.init = function () {
    var gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false
    });
    if (!gl) return false;
    this.gl = gl;

    this.progFire = program(gl, FULLSCREEN_VS, FIRE_FS, 'fire');
    this.progEmber = program(gl, EMBER_VS, EMBER_FS, 'embers');
    this.progPost = program(gl, FULLSCREEN_VS, POST_FS, 'post');

    /* Volume. */
    this.volTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, this.volTex);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, VOL_N, VOL_N, VOL_N, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, buildVolume(VOL_N));
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.REPEAT);

    /* Embers. */
    var seeds = new Float32Array(EMBER_COUNT), i;
    for (i = 0; i < EMBER_COUNT; i++) seeds[i] = i * 0.7351 + 1.0;
    this.emberVAO = gl.createVertexArray();
    gl.bindVertexArray(this.emberVAO);
    var vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(this.progEmber, 'aSeed');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 1, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.emptyVAO = gl.createVertexArray();
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    return true;
  };

  Studio.prototype.resize = function () {
    var gl = this.gl;
    var rect = this.host.getBoundingClientRect();
    var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    var dpr = Math.min(window.devicePixelRatio || 1, coarse ? COARSE_DPR : MAX_DPR);
    var w = Math.max(1, Math.round(rect.width * dpr * this.scale));
    var h = Math.max(1, Math.round(rect.height * dpr * this.scale));
    if (w === this.W && h === this.H) return;
    this.W = w; this.H = h;
    this.canvas.width = w;
    this.canvas.height = h;

    var fw = Math.max(1, Math.round(w * FIRE_SCALE));
    var fh = Math.max(1, Math.round(h * FIRE_SCALE));
    this.FW = fw; this.FH = fh;

    if (!this.fireTex) {
      this.fireTex = gl.createTexture();
      this.fireFBO = gl.createFramebuffer();
    }
    gl.bindTexture(gl.TEXTURE_2D, this.fireTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, fw, fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fireFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fireTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  /* Screen position to a point on the z = 0 plane, which is where the fire
     front sits — the plane the visitor is effectively touching. */
  Studio.prototype.toWorld = function (nx, ny) {
    var aspect = this.W / Math.max(1, this.H);
    var tanH = Math.tan(FOV_Y * 0.5);
    return [CAM_Z * nx * tanH * aspect, CAM_Y + CAM_Z * ny * tanH];
  };

  Studio.prototype.frame = function () {
    var gl = this.gl;
    /*
     * One clock, read here. Mixing the rAF timestamp with performance.now()
     * yields a negative first delta — the frame timestamp predates the
     * moment the callback runs — and a negative dt runs the forces
     * backwards.
     */
    var now = (window.performance || Date).now();
    if (!this.last) this.last = now;
    var dt = (now - this.last) / 1000;
    this.last = now;
    dt = dt > 0.05 ? 0.05 : (dt < 0 ? 0 : dt);
    this.time += dt * this.forces.calm;

    var aspect = this.W / Math.max(1, this.H);
    var tanH = Math.tan(FOV_Y * 0.5);
    var hv = CAM_Z * tanH;
    var baseY = CAM_Y - hv - 0.10;
    var topY = CAM_Y + hv;

    var idle = (now - this.lastInput) > 2600;
    this.forces.step(dt, idle);
    this.forces.writeBursts(this.burstBuf);

    /* ---- fire, at half resolution ---- */
    var pf = this.progFire;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fireFBO);
    gl.viewport(0, 0, this.FW, this.FH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(pf);
    gl.uniform2f(pf.u.uRes, this.FW, this.FH);
    gl.uniform1f(pf.u.uTime, this.time);
    gl.uniform1f(pf.u.uAspect, aspect);
    gl.uniform1f(pf.u.uTanH, tanH);
    gl.uniform1f(pf.u.uCamY, CAM_Y);
    gl.uniform1f(pf.u.uCamZ, CAM_Z);
    gl.uniform1f(pf.u.uBaseY, baseY);
    gl.uniform1f(pf.u.uTopY, topY);
    gl.uniform3f(pf.u.uPointer, this.forces.px, this.forces.py, this.forces.strength);
    gl.uniform1f(pf.u.uWind, this.forces.wind);
    gl.uniform1f(pf.u.uDraft, this.forces.draft);
    gl.uniform4fv(pf.u.uBursts, this.burstBuf);
    gl.uniform1i(pf.u.uSteps, this.steps);
    gl.uniform1f(pf.u.uCalm, this.forces.calm);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_3D, this.volTex);
    gl.uniform1i(pf.u.uVol, 0);
    gl.bindVertexArray(this.emptyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    /* ---- composite ---- */
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.W, this.H);
    gl.useProgram(this.progPost);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fireTex);
    gl.uniform1i(this.progPost.u.uFire, 0);
    gl.uniform2f(this.progPost.u.uTexel, 1 / this.W, 1 / this.H);
    gl.uniform1f(this.progPost.u.uTime, this.time);
    gl.uniform1f(this.progPost.u.uGrain, 0.016);
    gl.bindVertexArray(this.emptyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    /* ---- embers, additive over the graded frame ---- */
    var pe = this.progEmber;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.useProgram(pe);
    gl.uniform1f(pe.u.uTime, this.time);
    gl.uniform1f(pe.u.uAspect, aspect);
    gl.uniform1f(pe.u.uTanH, tanH);
    gl.uniform1f(pe.u.uCamY, CAM_Y);
    gl.uniform1f(pe.u.uCamZ, CAM_Z);
    gl.uniform1f(pe.u.uBaseY, baseY);
    gl.uniform1f(pe.u.uTopY, topY);
    gl.uniform2f(pe.u.uRes, this.W, this.H);
    gl.uniform1f(pe.u.uWind, this.forces.wind);
    gl.uniform3f(pe.u.uPointer, this.forces.px, this.forces.py, this.forces.strength);
    gl.uniform1f(pe.u.uCalm, this.forces.calm);
    gl.bindVertexArray(this.emberVAO);
    gl.drawArrays(gl.POINTS, 0, EMBER_COUNT);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);

    if (!this.ready) {
      this.ready = true;
      this.host.classList.add('is-gl', 'is-ready');
    }
  };

  /* Trade march steps first, then resolution: a raymarch degrades far more
     gracefully by taking fewer samples than by going blocky. */
  Studio.prototype.measure = function (ms) {
    this.frameSum += ms;
    this.frames++;
    if (this.frames < PERF_WINDOW) return;
    var avg = this.frameSum / this.frames;
    this.frames = 0; this.frameSum = 0;
    if (avg > PERF_BUDGET) {
      if (this.steps > 24) this.steps = Math.max(24, this.steps - 10);
      else if (this.scale > 0.55) {
        this.scale = Math.max(0.55, this.scale - 0.15);
        this.W = this.H = 0;
        this.resize();
      }
    } else if (avg < PERF_BUDGET * 0.5) {
      if (this.scale < 1) {
        this.scale = Math.min(1, this.scale + 0.1);
        this.W = this.H = 0;
        this.resize();
      } else if (this.steps < 64) this.steps = Math.min(64, this.steps + 6);
    }
  };

  Studio.prototype.start = function () {
    if (this.running) return;
    this.running = true;
    this.last = 0;   // re-baselined next frame, so a long pause never
                     // arrives as one enormous time step
    var self = this;
    (function loop() {
      if (!self.running) return;
      self.raf = window.requestAnimationFrame(loop);
      var t0 = (window.performance || Date).now();
      self.resize();
      try {
        self.frame();
      } catch (e) {
        self.stop();
        return;
      }
      self.measure((window.performance || Date).now() - t0);
    })();
  };

  Studio.prototype.stop = function () {
    this.running = false;
    if (this.raf) window.cancelAnimationFrame(this.raf);
    this.raf = 0;
  };

  /* ================================================================== */
  /* 7. Mount                                                            */
  /* ================================================================== */

  var TILT_RANGE = 34;          // degrees of roll mapped to full wind
  var TILT_SETTLE = 1500;

  function splitLetters(el) {
    if (!el || el.dataset.kwadSplit === '1') return;
    var text = el.textContent;
    var frag = document.createDocumentFragment();
    var chars = Array.prototype.slice.call(text);
    var i, n = chars.length;
    for (i = 0; i < n; i++) {
      var span = document.createElement('span');
      span.className = 'kwad-soon__ch';
      span.textContent = chars[i];
      span.style.setProperty('--i', String(i));
      span.style.setProperty('--n', String(n));
      span.setAttribute('aria-hidden', 'true');
      frag.appendChild(span);
    }
    /* Keep the original string for anything that reads the page rather
       than looks at it. */
    var sr = document.createElement('span');
    sr.className = 'visually-hidden';
    sr.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;' +
      'clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap';
    sr.textContent = text;
    el.textContent = '';
    el.appendChild(sr);
    el.appendChild(frag);
    el.dataset.kwadSplit = '1';
  }

  function mount(host) {
    if (host.dataset.kwadMounted === '1') return;
    host.dataset.kwadMounted = '1';

    /*
     * If an SVG wordmark has been dropped into the slot, it wins and the
     * text lines stand down. Checking for an element child rather than
     * any content means stray whitespace in the markup does not count as
     * a wordmark.
     */
    var slot = host.querySelector('[data-kwad-mark]');
    if (slot && slot.firstElementChild) {
      host.classList.add('has-mark');
      var svg = slot.querySelector('svg');
      if (svg && !svg.getAttribute('role')) {
        /* It is the page's title, so it should read as one. */
        svg.setAttribute('role', 'img');
        if (!svg.getAttribute('aria-label') && !svg.querySelector('title')) {
          svg.setAttribute('aria-label', host.getAttribute('data-kwad-mark-label') || '2072 — Soundboy Kwad');
        }
      }
    } else {
      var words = host.querySelectorAll('[data-kwad-split]');
      for (var wi = 0; wi < words.length; wi++) splitLetters(words[wi]);
    }

    var canvas = document.createElement('canvas');
    canvas.className = 'kwad-soon__gl';
    canvas.setAttribute('aria-hidden', 'true');
    var floor = host.querySelector('.kwad-soon__floor');
    if (floor) host.insertBefore(canvas, floor.nextSibling);
    else host.insertBefore(canvas, host.firstChild);

    var studio = new Studio(host, canvas);
    var ok = false;
    try {
      ok = studio.init();
    } catch (e) {
      ok = false;
      if (window.console && window.console.warn) window.console.warn(e.message);
    }
    if (!ok) {
      canvas.parentNode.removeChild(canvas);
      /* Still animate the wordmark — the page is not broken, it just has
         no fire in it. */
      host.classList.add('is-ready');
      return;
    }

    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    function applyReduce() {
      /* Fire that does not move is not fire, so this slows it rather than
         stopping it, and drops the embers to a crawl. */
      studio.forces.calm = (reduce && reduce.matches) ? 0.32 : 1;
    }
    applyReduce();
    if (reduce && reduce.addEventListener) reduce.addEventListener('change', applyReduce);

    /* ---- pointer and touch ------------------------------------------ */

    function mark() { studio.lastInput = (window.performance || Date).now(); }

    function toNdc(ev) {
      var rect = host.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      return [
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((ev.clientY - rect.top) / rect.height) * 2
      ];
    }

    function onMove(ev) {
      var n = toNdc(ev);
      if (!n) return;
      mark();
      var w = studio.toWorld(n[0], n[1]);
      studio.forces.point(w[0], w[1]);
    }

    function onDown(ev) {
      var n = toNdc(ev);
      if (!n) return;
      mark();
      var w = studio.toWorld(n[0], n[1]);
      studio.forces.point(w[0], w[1]);
      studio.forces.burst(w[0], w[1], 1.0);
    }

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });

    /* ---- device tilt ------------------------------------------------ */
    /*
     * On a handset the visitor moves the phone, not a cursor. Roll pushes
     * the whole flame front sideways, the way wind moves a torch — and it
     * yields to a finger the moment one lands, because a deliberate touch
     * should always beat the hand's own wobble.
     */
    var tiltOn = false;
    var tiltBtn = host.querySelector('[data-kwad-tilt]');

    function onTilt(ev) {
      if (ev.beta === null && ev.gamma === null) return;
      var now = (window.performance || Date).now();
      if (now - studio.lastInput < TILT_SETTLE) return;
      studio.forces.tilt = clamp((ev.gamma || 0) / TILT_RANGE, -1, 1) * 0.55;
      if (tiltBtn) tiltBtn.classList.remove('is-visible');
    }

    function enableTilt() {
      if (tiltOn) return;
      tiltOn = true;
      window.addEventListener('deviceorientation', onTilt, { passive: true });
    }

    var needsGesture = typeof window.DeviceOrientationEvent !== 'undefined' &&
      typeof window.DeviceOrientationEvent.requestPermission === 'function';

    if (typeof window.DeviceOrientationEvent !== 'undefined') {
      if (needsGesture) {
        if (tiltBtn) {
          tiltBtn.classList.add('is-visible');
          tiltBtn.addEventListener('click', function () {
            window.DeviceOrientationEvent.requestPermission().then(function (state) {
              if (state === 'granted') enableTilt();
              tiltBtn.classList.remove('is-visible');
            })['catch'](function () {
              tiltBtn.classList.remove('is-visible');
            });
          });
        }
      } else if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
        enableTilt();
      }
    }

    /* ---- lifecycle --------------------------------------------------- */
    var visible = true, onScreen = true;

    function sync() {
      if (visible && onScreen) studio.start(); else studio.stop();
    }

    document.addEventListener('visibilitychange', function () {
      visible = !document.hidden;
      sync();
    });

    if (window.IntersectionObserver) {
      var io = new IntersectionObserver(function (entries) {
        onScreen = entries[0].isIntersecting;
        sync();
      }, { threshold: 0.01 });
      io.observe(host);
    }

    canvas.addEventListener('webglcontextlost', function (e) {
      e.preventDefault();
      studio.stop();
    });

    window.addEventListener('pagehide', function () { studio.stop(); });

    studio.start();
  }

  function boot() {
    var hosts = document.querySelectorAll('[data-kwadzilla-soon]');
    for (var i = 0; i < hosts.length; i++) mount(hosts[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* Shopify's theme editor tears sections down and rebuilds them. */
  document.addEventListener('shopify:section:load', boot);
}());
