/*!
 * KWADZILLA — coming soon
 *
 * Two eyes, dead centre, set into lizard skin that fills the page. Zero
 * dependencies, one file, no network requests: the skin and the eyes are
 * generated at load and rendered in WebGL2.
 *
 * There is deliberately no lizard here. An earlier version framed a camera
 * on a whole animal's head and cropped in, which never stops being a head:
 * it has a silhouette, and a silhouette means edges, and edges mean the
 * page shows a picture of something rather than being the thing. So what
 * gets built is the part that matters — a slab of skin larger than any
 * frame, brow ridges, two sockets, two eyes — and nothing else exists.
 *
 * The only thing a visitor can touch is where the eyes are looking. On a
 * pointer they follow the cursor; on a phone they follow the phone, so
 * tilting the handset keeps them locked on you. Everything else — blinks,
 * micro-saccades, the slow drift of attention — runs on its own.
 *
 * Mount by putting an element with [data-kwadzilla-soon] on the page. The
 * canvas is injected from here, so a visitor without JS or without WebGL2
 * keeps the page and the wordmark rather than an empty box.
 *
 * Layout:
 *   1. maths          vectors, quaternions, matrices, noise
 *   2. gl helpers     shader/program/buffer/texture plumbing
 *   3. the face       the numbers that describe skin, sockets and eyes
 *   4. meshing        the skin slab, the globes, the lids
 *   5. shaders        scale bake, skin, eye, post
 *   6. behaviour      gaze, blinks, the small involuntary things
 *   7. renderer       the frame loop
 *   8. mount          DOM wiring, input, accessibility, teardown
 */
(function () {
  'use strict';

  /* ================================================================== */
  /* 1. Maths                                                            */
  /* ================================================================== */

  var PI = Math.PI;
  var TAU = PI * 2;

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function sat(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  function smoothstep(e0, e1, x) {
    var t = sat((x - e0) / (e1 - e0));
    return t * t * (3 - 2 * t);
  }

  function gauss(x, s) { return Math.exp(-(x * x) / (s * s)); }

  function v3sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function v3mul(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function v3dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function v3len(a) { return Math.sqrt(v3dot(a, a)); }

  function v3norm(a) {
    var l = v3len(a);
    return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
  }

  function v3cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0]
    ];
  }

  /* Quaternions are [x, y, z, w]. */

  function qmul(a, b) {
    return [
      a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
      a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
      a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
      a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
    ];
  }

  function qAxis(axis, ang) {
    var h = ang * 0.5, s = Math.sin(h);
    return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(h)];
  }

  /* Column-major 4x4, the layout WebGL wants. */

  function mIdent(o) {
    o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0;
    o[4] = 0; o[5] = 1; o[6] = 0; o[7] = 0;
    o[8] = 0; o[9] = 0; o[10] = 1; o[11] = 0;
    o[12] = 0; o[13] = 0; o[14] = 0; o[15] = 1;
    return o;
  }

  function mMul(o, a, b) {
    var t = new Float32Array(16), i, j, k, s;
    for (i = 0; i < 4; i++) {
      for (j = 0; j < 4; j++) {
        s = 0;
        for (k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k];
        t[i * 4 + j] = s;
      }
    }
    o.set(t);
    return o;
  }

  function mPerspective(o, fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy * 0.5), nf = 1 / (near - far);
    mIdent(o);
    o[0] = f / aspect; o[5] = f;
    o[10] = (far + near) * nf; o[11] = -1;
    o[14] = 2 * far * near * nf; o[15] = 0;
    return o;
  }

  function mLookAt(o, eye, at, up) {
    var z = v3norm(v3sub(eye, at));
    var x = v3norm(v3cross(up, z));
    var y = v3cross(z, x);
    o[0] = x[0]; o[1] = y[0]; o[2] = z[0]; o[3] = 0;
    o[4] = x[1]; o[5] = y[1]; o[6] = z[1]; o[7] = 0;
    o[8] = x[2]; o[9] = y[2]; o[10] = z[2]; o[11] = 0;
    o[12] = -v3dot(x, eye); o[13] = -v3dot(y, eye); o[14] = -v3dot(z, eye); o[15] = 1;
    return o;
  }

  function mFromRT(o, q, t) {
    var x = q[0], y = q[1], z = q[2], w = q[3];
    var x2 = x + x, y2 = y + y, z2 = z + z;
    var xx = x * x2, xy = x * y2, xz = x * z2;
    var yy = y * y2, yz = y * z2, zz = z * z2;
    var wx = w * x2, wy = w * y2, wz = w * z2;
    o[0] = 1 - (yy + zz); o[1] = xy + wz; o[2] = xz - wy; o[3] = 0;
    o[4] = xy - wz; o[5] = 1 - (xx + zz); o[6] = yz + wx; o[7] = 0;
    o[8] = xz + wy; o[9] = yz - wx; o[10] = 1 - (xx + yy); o[11] = 0;
    o[12] = t[0]; o[13] = t[1]; o[14] = t[2]; o[15] = 1;
    return o;
  }

  function mNormal3(o, m) {
    o[0] = m[0]; o[1] = m[1]; o[2] = m[2];
    o[3] = m[4]; o[4] = m[5]; o[5] = m[6];
    o[6] = m[8]; o[7] = m[9]; o[8] = m[10];
    return o;
  }

  /* Cheap deterministic value noise, for the involuntary movement and for
     the large-scale lumps in the skin. Reproducibility matters more here
     than spectral quality. */
  function hash1(n) {
    var s = Math.sin(n * 127.1) * 43758.5453123;
    return s - Math.floor(s);
  }

  function noise1(x, seed) {
    var i = Math.floor(x), f = x - i;
    var u = f * f * (3 - 2 * f);
    return lerp(hash1(i + seed * 57.31), hash1(i + 1 + seed * 57.31), u) * 2 - 1;
  }

  function fbm1(x, seed) {
    return noise1(x, seed) * 0.60 +
      noise1(x * 2.17 + 3.7, seed + 11) * 0.27 +
      noise1(x * 4.61 + 9.1, seed + 23) * 0.13;
  }

  function hash2(x, y) {
    var s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
    return s - Math.floor(s);
  }

  function noise2(x, y) {
    var ix = Math.floor(x), iy = Math.floor(y);
    var fx = x - ix, fy = y - iy;
    var ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    return lerp(
      lerp(hash2(ix, iy), hash2(ix + 1, iy), ux),
      lerp(hash2(ix, iy + 1), hash2(ix + 1, iy + 1), ux),
      uy) * 2 - 1;
  }

  function fbm2(x, y) {
    return noise2(x, y) * 0.55 + noise2(x * 2.1 + 5.2, y * 2.1 + 1.3) * 0.28 +
      noise2(x * 4.3 + 9.1, y * 4.3 + 7.7) * 0.17;
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
    /* Cache uniform locations up front — there are enough of them that
       per-frame getUniformLocation would show up in a profile. */
    pr.u = {};
    var n = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS), i, info;
    for (i = 0; i < n; i++) {
      info = gl.getActiveUniform(pr, i);
      pr.u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(pr, info.name);
    }
    return pr;
  }

  /* ================================================================== */
  /* 3. The face                                                         */
  /* ================================================================== */
  /*
   * Metres, at life size for a big monitor lizard, because the scale sizes
   * and the lighting are both tuned against real dimensions.
   *
   * Space: +X right, +Y up, +Z towards the viewer. The skin sits around
   * z = 0 and the camera looks down -Z. There is no head — the slab simply
   * runs past the edge of any frame that can be put in front of it.
   */

  var EYE_SEP = 0.0720;         // centre to centre
  var EYE_R = 0.0168;           // globe radius
  var SLAB_W = 0.34;            // skin extent, comfortably past every frame
  var SLAB_H = 0.34;
  var SLAB_NX = 176;            // grid resolution: carries the large forms
  var SLAB_NY = 176;            // only — the scales are a normal map

  /* Cells baked across one repeat of the scale map. The skin shader turns
     a scale size in metres into a repeat count through this, so it has to
     match N in the bake shader. */
  var CELLS_PER_REPEAT = 20.0;

  /*
   * Height of the skin above z = 0 at (x, y), and the whole reason the
   * page reads as an animal rather than as a tiled texture. Flat skin lit
   * from one side is wallpaper; it needs a brow to cast into the socket
   * and a ridge down the middle to catch the key.
   */
  function skinHeight(x, y) {
    var z = 0;
    var ex = Math.abs(x) - EYE_SEP * 0.5;   // distance from the eye axis

    /* The broad dome of a skull, falling away at every edge. */
    z -= x * x * 1.15 + y * y * 0.85;

    /* The ridge running down between the eyes, on towards a snout that is
       off the bottom of the frame. */
    z += 0.0125 * gauss(x, 0.034) * smoothstep(0.075, -0.02, y);

    /* Brow shelf over each socket — heavy, and overhanging enough that the
       key light has something to bite on. */
    z += 0.0150 * gauss(ex, 0.030) * gauss(y - 0.0175, 0.0135);
    /* ...carried outboard into a temporal ridge. */
    z += 0.0060 * gauss(Math.abs(x) - EYE_SEP * 0.5 - 0.030, 0.026) * gauss(y - 0.004, 0.030);

    /* The socket itself. */
    z -= 0.0160 * gauss(ex, 0.0150) * gauss(y, 0.0132);

    /* Loose folds under the eye, and the crease where the brow ends. */
    z -= 0.0028 * gauss(ex, 0.026) * gauss(y + 0.0215, 0.0052);
    z -= 0.0020 * gauss(ex, 0.030) * gauss(y - 0.0330, 0.0048);

    /* Lumps. Skin is never a mathematical surface. */
    z += fbm2(x * 26.0, y * 26.0) * 0.0022;
    z += fbm2(x * 62.0 + 11.0, y * 62.0 + 7.0) * 0.0007;
    return z;
  }

  /*
   * Blend between the shader's fine and coarse scale rates: 0 is fine, 1
   * is coarse. Small scales crowd around the eye and open out towards the
   * edges of the frame, which is the gradation a real head has.
   */
  function scaleBlendAt(x, y) {
    var ex = Math.abs(x) - EYE_SEP * 0.5;
    var d = Math.sqrt(ex * ex + y * y);
    var b = smoothstep(0.012, 0.090, d);
    /* The ring of enlarged shields monitors carry around the socket. */
    b = Math.min(1, b + 0.45 * gauss(d - 0.026, 0.011));
    return b;
  }

  /* Where a globe sits: on the socket floor, backed off far enough that it
     stands slightly proud of the rim around it. */
  function eyeCentre(side) {
    var x = side * EYE_SEP * 0.5;
    return [x, 0, skinHeight(x, 0) - EYE_R * 0.56];
  }

  /* Region ids, matched in the fragment shader. */
  var R_SKIN = 0, R_LID = 1, R_SOCKET = 2;

  /* ================================================================== */
  /* 4. Meshing                                                          */
  /* ================================================================== */

  /*
   * pos(3) nrm(3) tan(3) uv(2) size(1) region(1) = 13 floats.
   *
   * uv is in metres along the surface, so a scale is the same physical
   * size on the slab and on the lids without any per-object fiddling.
   * tan is the surface tangent the normal map is applied along.
   */
  var STRIDE = 13;

  function Soup() {
    this.v = [];
    this.idx = [];
  }

  Soup.prototype.vert = function (p, n, t, u, size, region) {
    this.v.push(p[0], p[1], p[2], n[0], n[1], n[2], t[0], t[1], t[2],
      u[0], u[1], size, region);
    return this.v.length / STRIDE - 1;
  };

  Soup.prototype.quad = function (a, b, c, d) {
    this.idx.push(a, b, c, a, c, d);
  };

  Soup.prototype.finish = function () {
    return {
      data: new Float32Array(this.v),
      index: new Uint32Array(this.idx),
      count: this.idx.length
    };
  };

  /* ---- the slab ---------------------------------------------------- */

  function buildSkin(soup) {
    var nx = SLAB_NX, ny = SLAB_NY, i, j;
    var grid = [];
    var d = 0.0006;   // step for the numerical normal

    for (j = 0; j <= ny; j++) {
      var row = [];
      var y = lerp(-SLAB_H * 0.5, SLAB_H * 0.5, j / ny);
      for (i = 0; i <= nx; i++) {
        var x = lerp(-SLAB_W * 0.5, SLAB_W * 0.5, i / nx);
        var z = skinHeight(x, y);
        /* Normal from central differences on the height field. Cheaper to
           reason about than averaging face normals, and cleaner. */
        var zx = (skinHeight(x + d, y) - skinHeight(x - d, y)) / (2 * d);
        var zy = (skinHeight(x, y + d) - skinHeight(x, y - d)) / (2 * d);
        var n = v3norm([-zx, -zy, 1]);
        var t = v3norm([1, 0, zx]);
        var ex = Math.abs(x) - EYE_SEP * 0.5;
        var inSocket = gauss(ex, 0.019) * gauss(y, 0.017);
        row.push(soup.vert([x, y, z], n, t, [x, y], scaleBlendAt(x, y),
          inSocket > 0.55 ? R_SOCKET : R_SKIN));
      }
      grid.push(row);
    }

    for (j = 0; j < ny; j++) {
      for (i = 0; i < nx; i++) {
        soup.quad(grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]);
      }
    }
  }

  /* ---- a globe ----------------------------------------------------- */
  /*
   * Built in its own space with +Z as the gaze direction, so the fragment
   * shader reads the angle straight off the local position and the
   * object's rotation is the whole of its aim.
   */
  function buildGlobe(soup) {
    var RINGS = 40, SEGS = 56, i, j;
    var grid = [];
    for (i = 0; i <= RINGS; i++) {
      var row = [];
      var polar = (i / RINGS) * PI;
      for (j = 0; j <= SEGS; j++) {
        var az = (j / SEGS) * TAU;
        var dir = [
          Math.sin(polar) * Math.cos(az),
          Math.sin(polar) * Math.sin(az),
          Math.cos(polar)
        ];
        row.push(soup.vert(v3mul(dir, EYE_R), dir, [1, 0, 0],
          [j / SEGS, i / RINGS], 0.001, 0));
      }
      grid.push(row);
    }
    /* Polar first, then azimuth: the other order winds the sphere inside
       out and the whole globe gets back-face culled, which looks exactly
       like an eye that will not light. */
    for (i = 0; i < RINGS; i++) {
      for (j = 0; j < SEGS; j++) {
        soup.quad(grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]);
      }
    }
  }

  /* ---- a lid ------------------------------------------------------- */
  /*
   * A spherical cap sitting just proud of the globe, in the globe's own
   * space. Rolling it about the lateral axis opens and closes the eye.
   * `sign` picks upper or lower.
   */
  function buildLid(soup, sign) {
    var R = EYE_R * 1.055;
    var RINGS = 18, SEGS = 44, i, j;
    var grid = [];
    for (i = 0; i <= RINGS; i++) {
      var row = [];
      var spread = (i / RINGS) * 1.34;      // radians from the lid's pole
      for (j = 0; j <= SEGS; j++) {
        var az = (j / SEGS) * TAU;
        var dir = v3norm([
          Math.sin(spread) * Math.cos(az),
          sign * Math.cos(spread),
          Math.sin(spread) * Math.sin(az)
        ]);
        /* Tangent along the sweep, so the scales run round the lid the way
           they run round a real eyelid. */
        var tan = v3cross([0, sign, 0], dir);
        tan = v3len(tan) > 0.25 ? v3norm(tan) : [1, 0, 0];
        row.push(soup.vert(v3mul(dir, R), dir, tan,
          [az * R, spread * R], 0.0, R_LID));
      }
      grid.push(row);
    }
    for (i = 0; i < RINGS; i++) {
      for (j = 0; j < SEGS; j++) {
        if (sign > 0) {
          soup.quad(grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]);
        } else {
          soup.quad(grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]);
        }
      }
    }
  }

  function buildAll() {
    var skin = new Soup(); buildSkin(skin);
    var globe = new Soup(); buildGlobe(globe);
    var lidUp = new Soup(); buildLid(lidUp, 1);
    var lidLo = new Soup(); buildLid(lidLo, -1);
    return {
      skin: skin.finish(),
      globe: globe.finish(),
      lidUp: lidUp.finish(),
      lidLo: lidLo.finish()
    };
  }

  /* ================================================================== */
  /* 5. Shaders                                                          */
  /* ================================================================== */

  var GLSL_COMMON = [
    'float hash12(vec2 p){ vec3 q = fract(vec3(p.xyx)*0.1031); q += dot(q, q.yzx+33.33); return fract((q.x+q.y)*q.z); }',
    'vec2 hash22(vec2 p){ vec3 q = fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973));',
    '  q += dot(q, q.yzx+33.33); return fract((q.xx+q.yz)*q.zy); }',
    'float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);',
    '  return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x),',
    '             mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y); }',
    'float fbm(vec2 p){ float s = 0.0, a = 0.5; for(int i=0;i<4;i++){ s += a*vnoise(p); p *= 2.03; a *= 0.5; } return s; }'
  ].join('\n');

  var FULLSCREEN_VS = [
    '#version 300 es',
    'void main(){',
    '  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);',
    '  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  /* ---- scale bake -------------------------------------------------- */
  /*
   * Rendered once into a tiling map. Storing the gradient rather than the
   * height means the skin shader gets its bump from a single tap.
   *
   *   rg = relief gradient   b = per-scale random   a = seam mask
   */
  var BAKE_FS = [
    '#version 300 es',
    'precision highp float;',
    'out vec4 fragColor;',
    'uniform vec2 uSize;',
    GLSL_COMMON,
    'const float N = 20.0;',
    /* Distance to the two nearest jittered cell centres on a grid of n
       cells, wrapped so the result tiles. Returns (f1, f2, cell id). */
    'vec3 cellF(vec2 uv, float n, float squash){',
    '  vec2 g = uv * n;',
    '  vec2 gi = floor(g), gf = fract(g);',
    '  float f1 = 8.0, f2 = 8.0; vec2 best = vec2(0.0);',
    '  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){',
    '    vec2 o = vec2(float(x), float(y));',
    '    vec2 cell = mod(gi + o, vec2(n));',
    '    vec2 j = hash22(cell);',
    '    vec2 r = o + 0.10 + j*0.80 - gf;',
    '    float d = length(r * vec2(1.0, squash));',
    '    if(d < f1){ f2 = f1; f1 = d; best = cell; }',
    '    else if(d < f2){ f2 = d; }',
    '  }',
    '  return vec3(f1, f2, hash12(best));',
    '}',
    '',
    /*
     * Scale relief. The shape matters more than the size: sharpening the
     * cell partition gives flat-topped cells with hard edges, which shades
     * like cut glass. A smoothstep is flat at the seam AND flat at the
     * centre, so each scale leaves and rejoins its neighbours with zero
     * gradient and reads as a rounded, overlapping shingle.
     *
     * Three layers — the scales, a pebbling within each, and a micro grain
     * that never resolves but keeps the specular from looking swept.
     */
    'float relief(vec2 uv){',
    '  vec3 c = cellF(uv, N, 1.22);',
    '  float t = clamp((c.y - c.x) * 1.75, 0.0, 1.0);',
    '  float h = t * t * (3.0 - 2.0 * t);',
    '  h += (c.z - 0.5) * 0.20;',
    '  vec3 p = cellF(uv, N * 3.0, 1.05);',
    '  float pt = clamp((p.y - p.x) * 2.0, 0.0, 1.0);',
    '  h += (pt * pt * (3.0 - 2.0 * pt) - 0.5) * 0.16;',
    '  h += (cellF(uv, N * 9.0, 1.0).z - 0.5) * 0.05;',
    '  return h;',
    '}',
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / uSize;',
    '  vec2 e = 1.0 / uSize;',
    '  float hx = relief(uv + vec2(e.x, 0.0)) - relief(uv - vec2(e.x, 0.0));',
    '  float hy = relief(uv + vec2(0.0, e.y)) - relief(uv - vec2(0.0, e.y));',
    '  vec2 grad = vec2(hx, hy) / (2.0 * e.x);',
    '  vec3 c = cellF(uv, N, 1.22);',
    '  float seam = 1.0 - smoothstep(0.0, 0.055, c.y - c.x);',
    /* GMAX brackets the steepest slope a scale edge produces. Encode
       tighter and every edge clips to the same value, which shades like
       polished plastic. */
    '  const float GMAX = N * 3.4;',
    '  fragColor = vec4(clamp(grad / GMAX * 0.5 + 0.5, 0.0, 1.0), c.z, seam);',
    '}'
  ].join('\n');

  /* ---- lighting, shared ------------------------------------------- */
  /*
   * One hard key from above and to the left, a cold bounce from the lower
   * right, and a cool edge from behind. Deliberately not an open studio:
   * the brow has to throw a real shadow into the socket, because that
   * shadow is most of what makes a stare read as a threat rather than as
   * a portrait.
   */
  var GLSL_LIGHT = [
    'const vec3 L_KEY  = vec3(-0.4900,  0.7300,  0.4760);',
    'const vec3 L_FILL = vec3( 0.7400, -0.3600,  0.5680);',
    'const vec3 L_RIM  = vec3( 0.2600,  0.6100, -0.7480);',
    'const vec3 C_KEY  = vec3(1.000, 0.972, 0.930) * 2.30;',
    'const vec3 C_FILL = vec3(0.760, 0.830, 1.000) * 0.260;',
    'const vec3 C_RIM  = vec3(0.840, 0.900, 1.000) * 0.420;',
    'const vec3 C_SKY  = vec3(0.780, 0.850, 1.000) * 0.200;',
    'const vec3 C_GND  = vec3(1.000, 0.940, 0.870) * 0.120;',
    '',
    'float ggx(vec3 n, vec3 v, vec3 l, float rough){',
    '  vec3 h = normalize(v + l);',
    '  float a = max(1e-3, rough*rough);',
    '  float nh = max(dot(n,h), 0.0);',
    '  float d = a*a / (3.14159265 * pow(nh*nh*(a*a-1.0)+1.0, 2.0));',
    '  float nv = max(dot(n,v), 1e-4), nl = max(dot(n,l), 1e-4);',
    '  float k = a*0.5;',
    '  float g = (nl/(nl*(1.0-k)+k)) * (nv/(nv*(1.0-k)+k));',
    '  return d * g / (4.0*nv*nl) * nl;',
    '}',
    '',
    'vec3 hemi(vec3 n){ return mix(C_GND, C_SKY, n.y*0.5+0.5); }',
    '',
    /* The scene target is 8-bit, so radiance is brought into range here
       rather than in the post pass — write raw HDR into it and everything
       above one clips to the same flat value. */
    'vec3 tonemap(vec3 x){ return 1.0 - exp(-max(x, vec3(0.0))); }'
  ].join('\n');

  /*
   * Occlusion from the two sockets, evaluated analytically.
   *
   * Everything that shades here is either in a socket, on the rim of one,
   * or on a lid inside one, and the sockets are two known pits in known
   * places. So rather than approximating geometry with spheres, ask the
   * height field directly: how far down the pit is this point, and how
   * much brow sits between it and the key.
   */
  var GLSL_SOCKET = [
    'uniform vec2 uSocket;',      // half-separation, socket radius
    '',
    'float socketDepth(vec3 p){',
    '  float ex = abs(p.x) - uSocket.x;',
    '  float d = length(vec2(ex, p.y)) / uSocket.y;',
    '  return 1.0 - smoothstep(0.55, 1.35, d);',
    '}',
    '',
    /* A pit occludes the sky in proportion to how deep in it you are. */
    'float socketAO(vec3 p, vec3 n){',
    '  float depth = socketDepth(p);',
    '  float up = n.y * 0.5 + 0.5;',
    '  return 1.0 - depth * (0.34 - 0.16 * up);',
    '}',
    '',
    /* The brow sits above and the key comes from above, so the shadow is
       deepest at the top of the socket and lifts towards the bottom. */
    'float browShadow(vec3 p){',
    '  float ex = abs(p.x) - uSocket.x;',
    '  float r = length(vec2(ex, p.y)) / uSocket.y;',
    '  float inPit = 1.0 - smoothstep(0.35, 1.45, r);',
    '  float high = smoothstep(-1.4, 1.1, p.y / uSocket.y);',
    '  return 1.0 - inPit * high * 0.50;',
    '}'
  ].join('\n');

  /* ---- skin -------------------------------------------------------- */

  var SKIN_VS = [
    '#version 300 es',
    'precision highp float;',
    'in vec3 aPos;',
    'in vec3 aNrm;',
    'in vec3 aTan;',
    'in vec2 aUV;',
    'in float aSize;',
    'in float aRegion;',
    'uniform mat4 uVP;',
    'uniform mat4 uModel;',
    'uniform mat3 uModelN;',
    'out vec3 vW;',
    'out vec3 vN;',
    'out vec3 vT;',
    'out vec2 vUV;',
    'out float vSize;',
    'flat out int vRegion;',
    'void main(){',
    '  vec4 w = uModel * vec4(aPos, 1.0);',
    '  vW = w.xyz;',
    '  vN = normalize(uModelN * aNrm);',
    '  vT = normalize(uModelN * aTan);',
    '  vUV = aUV;',
    '  vSize = aSize;',
    '  vRegion = int(aRegion + 0.5);',
    '  gl_Position = uVP * w;',
    '}'
  ].join('\n');

  var SKIN_FS = [
    '#version 300 es',
    'precision highp float;',
    'in vec3 vW;',
    'in vec3 vN;',
    'in vec3 vT;',
    'in vec2 vUV;',
    'in float vSize;',
    'flat in int vRegion;',
    'uniform vec3 uEye;',
    'uniform sampler2D uScales;',
    'uniform float uIsLid;',
    'out vec4 fragColor;',
    'const float CELLS_PER_REPEAT = 20.0;',
    'const float SCALE_FINE = 0.00230;',
    'const float SCALE_COARSE = 0.00520;',
    'const float LID_EDGE = 0.0168 * 1.055 * 1.34;',
    GLSL_COMMON,
    GLSL_LIGHT,
    GLSL_SOCKET,
    '',
    'void main(){',
    '  vec3 n = normalize(vN);',
    '  vec3 t = normalize(vT - n * dot(n, vT));',
    '  vec3 b = cross(n, t);',
    '  vec3 v = normalize(uEye - vW);',
    '',
    /*
     * Two fixed frequencies, blended.
     *
     * The obvious way to vary scale size across a surface is to vary the
     * lookup frequency with position — and it does not work: multiplying a
     * coordinate by a field that itself changes with that coordinate is
     * not a parameterisation, it is a shear, and the texture comes out
     * smeared into streaks radiating from wherever the frequency changes
     * fastest. Sampling twice at constant rates and mixing gives the same
     * gradation with none of that.
     */
    '  float fine = vRegion == 1 ? SCALE_FINE * 0.45 : SCALE_FINE;',
    '  vec2 uvF = vUV / (fine * CELLS_PER_REPEAT);',
    '  vec2 uvC = vUV / (SCALE_COARSE * CELLS_PER_REPEAT);',
    '  vec4 s = mix(texture(uScales, uvF), texture(uScales, uvC), vSize);',
    '  vec2 g = s.rg * 2.0 - 1.0;',
    '  float bump = vRegion == 1 ? 0.14 : 0.46;',
    '  n = normalize(n - bump * (t * g.x + b * g.y));',
    '',
    /* ---- colour ---- */
    /* Dark olive over charcoal, mottled, with the pale flecks a monitor
       carries and a darker wash down in the sockets. */
    '  float mott = fbm(vUV * 46.0);',
    '  float blotch = fbm(vUV * 13.0 + 21.0);',
    '  vec3 base = mix(vec3(0.052, 0.056, 0.046), vec3(0.088, 0.090, 0.072),',
    '                  smoothstep(0.35, 0.75, blotch));',
    '  base *= 0.74 + 0.52 * mott;',
    '  float fleck = smoothstep(0.62, 0.86, fbm(vUV * 120.0 + 7.0));',
    '  base = mix(base, vec3(0.190, 0.172, 0.112), fleck * 0.45);',
    /* Per-scale variation, then darken the seams between them. */
    '  base *= 0.82 + 0.36 * s.b;',
    '  base *= mix(0.42, 1.0, smoothstep(0.0, 0.6, 1.0 - s.a));',
    '',
    '  float rough = clamp(0.60 + (s.b - 0.5) * 0.26, 0.16, 0.95);',
    '  float spec = 1.0;',
    '',
    '  if(vRegion == 2){',
    /* Socket floor: darker, tighter skin. */
    '    base *= 0.62;',
    '    rough = clamp(rough - 0.10, 0.16, 0.95);',
    '  }',
    '  if(vRegion == 1){',
    '    base = mix(base, vec3(0.046, 0.048, 0.040), 0.55);',
    /* Lid. Darker still, and wet along the margin where it meets the
       globe — that thin bright line is most of what says "eye" rather
       than "hole in some skin". */
    '    base *= 0.72;',
    '    float margin = smoothstep(0.70, 1.0, vUV.y / LID_EDGE);',
    '    base *= mix(1.0, 0.16, margin);',
    '    rough = mix(rough, 0.13, margin * 0.9);',
    '    spec = mix(1.0, 3.4, margin);',
    '  }',
    '',
    /* ---- light ---- */
    '  float ao = socketAO(vW, n) * mix(1.0, 0.70, s.a);',
    '  float sh = browShadow(vW);',
    '',
    '  float wrap = 0.22;',
    '  float nlK = max(0.0, (dot(n, L_KEY) + wrap) / (1.0 + wrap));',
    '  float nlF = max(0.0, (dot(n, L_FILL) + wrap) / (1.0 + wrap));',
    '  float nlR = max(0.0, dot(n, L_RIM));',
    '',
    '  vec3 diff = C_KEY * nlK * sh + C_FILL * nlF + C_RIM * nlR * 0.5;',
    '  diff += hemi(n);',
    '  diff *= ao;',
    '',
    '  float f0 = 0.045;',
    '  float fres = f0 + (1.0 - f0) * pow(1.0 - max(dot(n, v), 0.0), 5.0);',
    '  vec3 sp = (C_KEY * ggx(n, v, L_KEY, rough) * sh',
    '           + C_FILL * ggx(n, v, L_FILL, rough) * 1.6',
    '           + C_RIM * ggx(n, v, L_RIM, rough) * 1.3) * fres * spec * 3.2;',
    '  sp *= ao;',
    '',
    '  fragColor = vec4(tonemap(base * diff + sp), 1.0);',
    '}'
  ].join('\n');

  /* ---- eye --------------------------------------------------------- */

  var EYE_VS = [
    '#version 300 es',
    'precision highp float;',
    'in vec3 aPos;',
    'in vec3 aNrm;',
    'uniform mat4 uVP;',
    'uniform mat4 uModel;',
    'uniform mat3 uModelN;',
    'out vec3 vW;',
    'out vec3 vN;',
    'out vec3 vL;',
    'void main(){',
    '  vec4 w = uModel * vec4(aPos, 1.0);',
    '  vW = w.xyz;',
    '  vN = normalize(uModelN * aNrm);',
    '  vL = aPos;',            // local, +Z is the gaze
    '  gl_Position = uVP * w;',
    '}'
  ].join('\n');

  var EYE_FS = [
    '#version 300 es',
    'precision highp float;',
    'in vec3 vW;',
    'in vec3 vN;',
    'in vec3 vL;',
    'uniform vec3 uEye;',
    'uniform mat3 uModelT;',
    'out vec4 fragColor;',
    GLSL_COMMON,
    GLSL_LIGHT,
    GLSL_SOCKET,
    '',
    'void main(){',
    '  vec3 n = normalize(vN);',
    '  vec3 v = normalize(uEye - vW);',
    '  vec3 d = normalize(vL);',
    '',
    /*
     * Corneal refraction, faked. The iris is not on the surface of the
     * eye: it sits a few millimetres behind a curved lens of clear tissue,
     * and light entering off-axis bends before it reaches it. Shifting the
     * lookup along the view direction reproduces the tell — the pupil
     * appears to swim as the eye turns.
     */
    '  vec3 vLocal = normalize(uModelT * v);',     // view, in globe space
    '  vec3 id = normalize(d - vLocal * 0.34);',
    '  float ang = acos(clamp(id.z, -1.0, 1.0));',
    '',
    '  float iris = smoothstep(1.18, 1.02, ang);',
    '  float pupil = smoothstep(0.330, 0.268, ang);',
    '',
    /* Radial striae and crypts. A flat disc of colour reads as a bead. */
    '  float th = atan(id.y, id.x);',
    '  float fib = 0.5 + 0.5 * sin(th * 74.0 + ang * 22.0);',
    '  fib = mix(fib, hash12(vec2(floor(th * 26.0), floor(ang * 22.0))), 0.42);',
    '  float crypt = smoothstep(0.45, 0.85, fbm(vec2(th * 7.0, ang * 16.0)));',
    '',
    '  vec3 irisC = mix(vec3(0.235, 0.148, 0.030), vec3(0.760, 0.582, 0.140), fib);',
    '  irisC = mix(irisC, vec3(0.115, 0.070, 0.018), crypt * 0.55);',
    /* Bright towards the rim, dark into the pupil, then a hard limbal ring
       right at the edge. */
    '  irisC *= 0.40 + 0.90 * smoothstep(0.28, 0.86, ang);',
    '  irisC *= 1.0 - smoothstep(0.94, 1.14, ang) * 0.90;',
    '',
    '  vec3 sclera = vec3(0.011, 0.011, 0.010);',
    '  vec3 albedo = mix(sclera, irisC, iris);',
    '  albedo = mix(albedo, vec3(0.004), pupil);',
    '',
    /* The cornea is glass: near-mirror over the iris, duller on the sclera
       behind the lids. */
    '  float rough = mix(0.34, 0.045, iris);',
    '  float ao = socketAO(vW, n);',
    '  float sh = mix(browShadow(vW), 1.0, 0.35);',
    '',
    '  vec3 diff = C_KEY * max(0.0, dot(n, L_KEY)) * sh',
    '            + C_FILL * max(0.0, dot(n, L_FILL))',
    '            + hemi(n) * 1.4;',
    '  diff *= ao;',
    '',
    '  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);',
    '  vec3 sp = (C_KEY * ggx(n, v, L_KEY, rough) * sh',
    '           + C_RIM * ggx(n, v, L_RIM, rough) * 0.8',
    '           + C_FILL * ggx(n, v, L_FILL, rough) * 0.35) * (0.04 + fres) * 17.0;',
    '  sp *= mix(0.55, 1.0, ao) * mix(0.28, 1.0, iris);',
    '',
    '  fragColor = vec4(tonemap(albedo * diff + sp), 1.0);',
    '}'
  ].join('\n');

  /* ---- post -------------------------------------------------------- */

  var POST_FS = [
    '#version 300 es',
    'precision highp float;',
    'uniform sampler2D uScene;',
    'uniform vec2 uTexel;',
    'uniform float uTime;',
    'uniform float uGrain;',
    'out vec4 fragColor;',
    GLSL_COMMON,
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy * uTexel;',
    /* Box-downsample the supersampled scene. It is the edge of the lids
       against the globe that gives a render away. */
    '  vec2 o = uTexel * 0.5;',
    '  vec3 c = texture(uScene, uv + vec2(-o.x, -o.y)).rgb',
    '         + texture(uScene, uv + vec2( o.x, -o.y)).rgb',
    '         + texture(uScene, uv + vec2(-o.x,  o.y)).rgb',
    '         + texture(uScene, uv + vec2( o.x,  o.y)).rgb;',
    '  c *= 0.25;',
    /* A real vignette, not a token one — this is a close, dark frame and
       the falloff is what keeps the eyes the subject. */
    '  vec2 q = uv - 0.5;',
    '  c *= 1.0 - dot(q, q) * 0.34;',
    '  float g = hash12(gl_FragCoord.xy + fract(uTime) * 431.7) - 0.5;',
    '  c += g * uGrain;',
    '  float dth = (hash12(gl_FragCoord.xy * 0.37) - 0.5) / 255.0;',
    '  fragColor = vec4(pow(max(c + dth, 0.0), vec3(1.0/2.2)), 1.0);',
    '}'
  ].join('\n');

  /* ================================================================== */
  /* 6. Behaviour                                                        */
  /* ================================================================== */

  var EYE_YAW_MAX = 0.46;
  var EYE_PITCH_MAX = 0.34;

  /*
   * An eye is never still, and almost none of what it does is voluntary.
   * The visitor drives where it points; everything else here happens
   * whether they are there or not.
   */
  function Behaviour() {
    this.t = 0;
    this.yaw = 0; this.pitch = 0;
    this.yawV = 0; this.pitchV = 0;
    this.tgtYaw = 0; this.tgtPitch = 0;
    this.blinkAt = 2.4; this.blink = 0; this.blinkPhase = 0; this.blinkQueue = 0;
    /* Lids are not synchronised in life, and that offset is one of the
       things that stops a pair of eyes reading as one object. */
    this.blinkSkew = 0.06;
    this.alert = 0;
    this.damp = 1;
  }

  Behaviour.prototype.setTarget = function (yaw, pitch) {
    var moved = Math.abs(yaw - this.tgtYaw) + Math.abs(pitch - this.tgtPitch);
    if (moved > 0.10) this.alert = Math.min(1, this.alert + moved * 1.4);
    this.tgtYaw = yaw;
    this.tgtPitch = pitch;
  };

  Behaviour.prototype.step = function (dt) {
    this.t += dt;

    /* Eyes move in jumps, not sweeps. A stiff spring gets most of the way
       there fast and settles before the overshoot reads as wobble. */
    var k = 150.0, c = 2 * Math.sqrt(k);
    this.yawV += (-(this.yaw - this.tgtYaw) * k - this.yawV * c) * dt;
    this.pitchV += (-(this.pitch - this.tgtPitch) * k - this.pitchV * c) * dt;
    this.yaw += this.yawV * dt;
    this.pitch += this.pitchV * dt;

    this.alert = Math.max(0, this.alert - dt * 0.6);

    this.blinkAt -= dt;
    if (this.blinkAt <= 0 && this.blink <= 0) {
      this.blink = 0.001;
      this.blinkPhase = 0;
      /* Something watching you blinks less. */
      this.blinkAt = lerp(2.8, 8.5, Math.random()) * lerp(1.0, 1.9, this.alert);
      this.blinkSkew = lerp(0.03, 0.10, Math.random());
      if (Math.random() < 0.22) this.blinkQueue = 1;
    }
    if (this.blink > 0) {
      this.blinkPhase += dt / 0.19;
      this.blink = this.blinkPhase < 1 ? 1 : 0;
      if (this.blinkPhase >= 1) {
        this.blink = 0;
        if (this.blinkQueue > 0) { this.blinkQueue--; this.blinkAt = 0.20; }
      }
    }
  };

  /* Blink amount for one eye, offset from the other. */
  Behaviour.prototype.blinkFor = function (side) {
    if (this.blink <= 0) return 0;
    var p = this.blinkPhase - (side > 0 ? this.blinkSkew : 0);
    if (p <= 0 || p >= 1) return 0;
    return Math.sin(p * PI);
  };

  /* Where one globe points. Both converge on the same target, which is
     what makes it read as attention rather than as two ornaments. */
  Behaviour.prototype.aimFor = function (side) {
    var d = this.damp;
    var t = this.t;
    /* Microsaccades: tiny, fast, and never the same in both eyes. */
    var jy = fbm1(t * 3.1 + side * 11.3, 13) * 0.011 * d;
    var jp = fbm1(t * 2.7 + side * 5.9, 17) * 0.009 * d;
    /* A slow drift, so a still cursor does not mean a frozen eye. */
    jy += fbm1(t * 0.23 + side * 3.1, 29) * 0.020 * d;
    jp += fbm1(t * 0.19 + side * 7.7, 31) * 0.015 * d;
    return [
      clamp(this.yaw + jy, -EYE_YAW_MAX, EYE_YAW_MAX),
      clamp(this.pitch + jp, -EYE_PITCH_MAX, EYE_PITCH_MAX)
    ];
  };

  /* ================================================================== */
  /* 7. Renderer                                                         */
  /* ================================================================== */

  var MAX_DPR = 2;
  var COARSE_DPR = 1.5;
  var SUPER = 1.3;
  var PERF_WINDOW = 50;
  var PERF_BUDGET = 24;
  var FOV = 26 * PI / 180;

  /* How far apart the eyes sit across the frame, in clip units (2.0 is the
     full width). The whole composition control. */
  var EYE_SPAN_WIDE = 1.08;
  var EYE_SPAN_TALL = 1.36;

  /* How far the gaze target travels across the plane of the screen, in
     metres. Small: at this range a little goes a long way. */
  var GAZE_REACH = 0.075;

  function Studio(host, canvas) {
    this.host = host;
    this.canvas = canvas;
    this.gl = null;
    this.beh = new Behaviour();
    this.raf = 0;
    this.last = 0;
    this.frames = 0;
    this.frameSum = 0;
    this.scale = 1;
    this.running = false;
    this.ready = false;
    this.W = 0; this.H = 0;
    this.fitAspect = -1;
    this.camDist = 0.3;
    this.mVP = new Float32Array(16);
    this.mProj = new Float32Array(16);
    this.mView = new Float32Array(16);
    this.mModel = new Float32Array(16);
    this.mNormal = new Float32Array(9);
    this.eye = [0, 0, 0.3];
    this.gaze = [0, 0];
  }

  Studio.prototype.init = function () {
    var gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: true,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false
    });
    if (!gl) return false;
    this.gl = gl;

    var mesh = buildAll();
    this.progSkin = program(gl, SKIN_VS, SKIN_FS, 'skin');
    this.progEye = program(gl, EYE_VS, EYE_FS, 'eye');
    this.progPost = program(gl, FULLSCREEN_VS, POST_FS, 'post');
    this.progBake = program(gl, FULLSCREEN_VS, BAKE_FS, 'bake');

    this.skin = this._upload(mesh.skin, this.progSkin);
    this.globe = this._upload(mesh.globe, this.progEye);
    this.lidUp = this._upload(mesh.lidUp, this.progSkin);
    this.lidLo = this._upload(mesh.lidLo, this.progSkin);

    this._bakeScales();
    this.emptyVAO = gl.createVertexArray();
    this.eyeCentres = [eyeCentre(-1), eyeCentre(1)];

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    return true;
  };

  Studio.prototype._upload = function (mesh, prog) {
    var gl = this.gl;
    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    var vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.data, gl.STATIC_DRAW);
    var S = STRIDE * 4;
    function attr(name, size, off) {
      var loc = gl.getAttribLocation(prog, name);
      if (loc < 0) return;
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, S, off * 4);
    }
    attr('aPos', 3, 0);
    attr('aNrm', 3, 3);
    attr('aTan', 3, 6);
    attr('aUV', 2, 9);
    attr('aSize', 1, 11);
    attr('aRegion', 1, 12);
    var ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.index, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao: vao, count: mesh.count };
  };

  Studio.prototype._bakeScales = function () {
    var gl = this.gl, size = 2048;
    this.scaleTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.scaleTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    var fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.scaleTex, 0);
    gl.viewport(0, 0, size, size);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.progBake);
    gl.uniform2f(this.progBake.u.uSize, size, size);
    var tmp = gl.createVertexArray();
    gl.bindVertexArray(tmp);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.deleteVertexArray(tmp);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.enable(gl.DEPTH_TEST);

    gl.bindTexture(gl.TEXTURE_2D, this.scaleTex);
    gl.generateMipmap(gl.TEXTURE_2D);
    var aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) {
      var max = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
      gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
    }
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

    var sw = Math.max(1, Math.round(w * SUPER));
    var sh = Math.max(1, Math.round(h * SUPER));
    this.SW = sw; this.SH = sh;

    if (!this.sceneTex) {
      this.sceneTex = gl.createTexture();
      this.depthRB = gl.createRenderbuffer();
      this.sceneFBO = gl.createFramebuffer();
    }
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, sw, sh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRB);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, sw, sh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRB);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.fitAspect = -1;
  };

  /* Dead on, centred, far enough back that the eye separation lands where
     the composition wants it. Tall frames get the eyes bigger, because a
     phone has width to spare on nothing else. */
  Studio.prototype.camera = function () {
    var aspect = this.W / Math.max(1, this.H);
    if (this.fitAspect === aspect) return;
    this.fitAspect = aspect;
    var tall = sat((1.0 - aspect) / 0.5);
    var span = lerp(EYE_SPAN_WIDE, EYE_SPAN_TALL, tall);
    /* Projected separation goes as 1/distance. */
    this.camDist = clamp(EYE_SEP / (span * Math.tan(FOV * 0.5) * aspect), 0.08, 1.5);
    this.eye = [0, 0, this.camDist];
    mPerspective(this.mProj, FOV, aspect, 0.01, 4);
    mLookAt(this.mView, this.eye, [0, 0, 0], [0, 1, 0]);
    mMul(this.mVP, this.mProj, this.mView);
  };

  Studio.prototype.frame = function () {
    var gl = this.gl;
    /*
     * One clock, read here. Mixing the rAF timestamp with performance.now()
     * yields a negative first delta — the frame timestamp predates the
     * moment the callback runs — and a negative dt runs every spring in
     * the behaviour backwards, which detonates them.
     */
    var now = (window.performance || Date).now();
    if (!this.last) this.last = now;
    var dt = (now - this.last) / 1000;
    this.last = now;
    dt = dt > 0.05 ? 0.05 : (dt < 0 ? 0 : dt);

    this.camera();

    /* The target sits on the plane of the screen, which is where the
       visitor is: straight down the lens when the pointer is at rest. */
    var nx = clamp(this.gaze[0], -1.6, 1.6);
    var ny = clamp(this.gaze[1], -1.4, 1.4);
    var tx = nx * GAZE_REACH, ty = -ny * GAZE_REACH, tz = this.camDist;
    var dz = tz - this.eyeCentres[0][2];
    this.beh.setTarget(Math.atan2(tx, dz),
      Math.atan2(ty, Math.sqrt(tx * tx + dz * dz)));
    this.beh.step(dt);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFBO);
    gl.viewport(0, 0, this.SW, this.SH);
    gl.clearColor(0.02, 0.02, 0.02, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    var sock = [EYE_SEP * 0.5, 0.0165];
    var i, k;

    /* ---- skin ---- */
    var ps = this.progSkin;
    gl.useProgram(ps);
    mIdent(this.mModel);
    mNormal3(this.mNormal, this.mModel);
    gl.uniformMatrix4fv(ps.u.uVP, false, this.mVP);
    gl.uniformMatrix4fv(ps.u.uModel, false, this.mModel);
    gl.uniformMatrix3fv(ps.u.uModelN, false, this.mNormal);
    gl.uniform3fv(ps.u.uEye, this.eye);
    gl.uniform2fv(ps.u.uSocket, sock);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.scaleTex);
    gl.uniform1i(ps.u.uScales, 0);
    gl.bindVertexArray(this.skin.vao);
    gl.drawElements(gl.TRIANGLES, this.skin.count, gl.UNSIGNED_INT, 0);

    /* ---- globes ---- */
    var pe = this.progEye;
    var aims = [];
    gl.useProgram(pe);
    gl.uniformMatrix4fv(pe.u.uVP, false, this.mVP);
    gl.uniform3fv(pe.u.uEye, this.eye);
    gl.uniform2fv(pe.u.uSocket, sock);
    gl.bindVertexArray(this.globe.vao);
    for (i = 0; i < 2; i++) {
      var side = i === 0 ? -1 : 1;
      var a = this.beh.aimFor(side);
      aims.push(a);
      var q = qmul(qAxis([0, 1, 0], a[0]), qAxis([1, 0, 0], -a[1]));
      mFromRT(this.mModel, q, this.eyeCentres[i]);
      mNormal3(this.mNormal, this.mModel);
      gl.uniformMatrix4fv(pe.u.uModel, false, this.mModel);
      gl.uniformMatrix3fv(pe.u.uModelN, false, this.mNormal);
      /* The fragment shader also needs the inverse rotation, to take a
         world vector back into globe space. For a pure rotation that is
         the transpose, which uniformMatrix3fv will do on the way in. */
      gl.uniformMatrix3fv(pe.u.uModelT, true, this.mNormal);
      gl.drawElements(gl.TRIANGLES, this.globe.count, gl.UNSIGNED_INT, 0);
    }

    /* ---- lids ---- */
    gl.useProgram(ps);
    for (i = 0; i < 2; i++) {
      var sd = i === 0 ? -1 : 1;
      var cl = this.beh.blinkFor(sd);
      var aim = aims[i];
      /* Lids ride the globe's aim, and open by rolling back off it. */
      var base = qmul(qAxis([0, 1, 0], aim[0] * 0.55), qAxis([1, 0, 0], -aim[1] * 0.55));
      /*
       * Signs matter here. Rotating the upper lid's pole towards +Z drags
       * it ACROSS the gaze; away from +Z rolls it off. Get it backwards
       * and the eye sits shut and blinks itself open.
       */
      /*
       * Open, but not wide open. A lid rolled right back leaves a circle
       * of sclera showing and the eye reads as a bead stuck on a surface;
       * brought down to about twenty-five degrees off the axis it leaves
       * an almond, which is both what a real one does and the whole of
       * the difference between alert and alarmed.
       */
      var pairs = [
        [this.lidUp, -0.20 + cl * 0.55 - aim[1] * 0.34],
        [this.lidLo, 0.27 - cl * 0.57 - aim[1] * 0.14]
      ];
      for (k = 0; k < 2; k++) {
        var q2 = qmul(base, qAxis([1, 0, 0], pairs[k][1]));
        mFromRT(this.mModel, q2, this.eyeCentres[i]);
        mNormal3(this.mNormal, this.mModel);
        gl.uniformMatrix4fv(ps.u.uModel, false, this.mModel);
        gl.uniformMatrix3fv(ps.u.uModelN, false, this.mNormal);
        gl.bindVertexArray(pairs[k][0].vao);
        gl.drawElements(gl.TRIANGLES, pairs[k][0].count, gl.UNSIGNED_INT, 0);
      }
    }

    /* ---- post ---- */
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.W, this.H);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(this.progPost);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.uniform1i(this.progPost.u.uScene, 0);
    gl.uniform2f(this.progPost.u.uTexel, 1 / this.W, 1 / this.H);
    gl.uniform1f(this.progPost.u.uTime, this.beh.t);
    gl.uniform1f(this.progPost.u.uGrain, 0.012);
    gl.bindVertexArray(this.emptyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.enable(gl.DEPTH_TEST);

    if (!this.ready) {
      this.ready = true;
      this.host.classList.add('is-gl', 'is-ready');
    }
  };

  /* Drop the render scale rather than the frame rate on slow hardware. */
  Studio.prototype.measure = function (ms) {
    this.frameSum += ms;
    this.frames++;
    if (this.frames < PERF_WINDOW) return;
    var avg = this.frameSum / this.frames;
    this.frames = 0; this.frameSum = 0;
    if (avg > PERF_BUDGET && this.scale > 0.55) {
      this.scale = Math.max(0.55, this.scale - 0.15);
      this.W = this.H = 0;
      this.resize();
    } else if (avg < PERF_BUDGET * 0.5 && this.scale < 1) {
      this.scale = Math.min(1, this.scale + 0.1);
      this.W = this.H = 0;
      this.resize();
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
  /* 8. Mount                                                            */
  /* ================================================================== */

  var IDLE_AFTER = 4000;        // ms of no input before the gaze wanders
  var TILT_RANGE = 30;          // degrees of tilt mapped to full deflection
  var TILT_SETTLE = 1800;

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

    var words = host.querySelectorAll('[data-kwad-split]');
    for (var wi = 0; wi < words.length; wi++) splitLetters(words[wi]);

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
         nothing looking out of it. */
      host.classList.add('is-ready');
      return;
    }

    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    function applyReduce() {
      studio.beh.damp = (reduce && reduce.matches) ? 0.25 : 1;
    }
    applyReduce();
    if (reduce && reduce.addEventListener) reduce.addEventListener('change', applyReduce);

    /* ---- pointer ---------------------------------------------------- */
    var lastInput = 0, idleSeed = Math.random() * 100;

    function setGaze(nx, ny) {
      studio.gaze[0] = nx;
      studio.gaze[1] = ny;
    }

    function onPointer(ev) {
      var rect = host.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      lastInput = (window.performance || Date).now();
      setGaze(((ev.clientX - rect.left) / rect.width) * 2 - 1,
        ((ev.clientY - rect.top) / rect.height) * 2 - 1);
    }

    window.addEventListener('pointermove', onPointer, { passive: true });
    window.addEventListener('pointerdown', onPointer, { passive: true });

    /* ---- device tilt ------------------------------------------------ */
    /*
     * On a handset the visitor moves the phone, not a cursor. Counter-
     * rotating against beta and gamma keeps the eye line on the person
     * holding it, so tilting never breaks the stare.
     */
    var tiltOn = false;
    var tiltBtn = host.querySelector('[data-kwad-tilt]');

    function onTilt(ev) {
      if (ev.beta === null && ev.gamma === null) return;
      var now = (window.performance || Date).now();
      if (now - lastInput < TILT_SETTLE) return;
      setGaze(-clamp((ev.gamma || 0) / TILT_RANGE, -1.5, 1.5),
        -clamp(((ev.beta || 0) - 48) / TILT_RANGE, -1.5, 1.5));
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

    /* ---- idle drift -------------------------------------------------- */
    /* With nobody there it stops staring down the lens and looks about,
       which is the difference between a model and an animal. */
    var idleRAF = 0;
    (function idle() {
      idleRAF = window.requestAnimationFrame(idle);
      var now = (window.performance || Date).now();
      if (now - lastInput < IDLE_AFTER) return;
      var t = now / 1000 + idleSeed;
      var k = smoothstep(0, 1, Math.min(1, (now - lastInput - IDLE_AFTER) / 2500));
      setGaze(fbm1(t * 0.15, 31) * 1.3 * k, fbm1(t * 0.12, 37) * 0.9 * k);
    })();

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

    window.addEventListener('pagehide', function () {
      studio.stop();
      if (idleRAF) window.cancelAnimationFrame(idleRAF);
    });

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
