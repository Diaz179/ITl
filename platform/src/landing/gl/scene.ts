/**
 * Dependency-free WebGL2 stage for the landing.
 * «primitives»: thousands of instanced cubes, square pyramids and spheres; every morph between
 * target shapes happens in the vertex shader, so the CPU only updates a handful of uniforms.
 * «offline»: one full-screen fragment shader for the no-coverage story.
 */
import { cloud, machine, mulberry32, symbol } from './shapes';

export type StageMode = 'off' | 'primitives' | 'offline';
export interface StageTheme {
  dark: boolean;
}
export interface Stage {
  setMode(mode: StageMode): void;
  /** shape indices: 0 cloud, 1 symbol, 2–4 machines, 5 scattered */
  setMorph(from: number, to: number, t: number): void;
  /** subject position in NDC (lens shift) and extra scale */
  setFrame(x: number, y: number, scale: number): void;
  setOffline(progress: number): void;
  setTheme(theme: StageTheme): void;
  setPointer(x: number, y: number): void;
  renderOnce(): void;
  destroy(): void;
}

const PRIM_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec4 aSeed;
layout(location=3) in float aTone;
layout(location=4) in vec3 aP0;
layout(location=5) in vec3 aP1;
layout(location=6) in vec3 aP2;
layout(location=7) in vec3 aP3;
layout(location=8) in vec3 aP4;
uniform mat4 uProj;
uniform mat4 uView;
uniform mat3 uModelFrom;
uniform mat3 uModelTo;
uniform int uFrom;
uniform int uTo;
uniform float uT;
uniform float uTime;
uniform float uSize;
uniform float uScaleFrom;
uniform float uScaleTo;
out vec3 vNormal;
out vec3 vWorld;
out float vTone;

vec3 shapeAt(int k) {
  if (k == 0) return aP0;
  if (k == 1) return aP1;
  if (k == 2) return aP2;
  if (k == 3) return aP3;
  if (k == 4) return aP4;
  return aP0 * vec3(1.25, 1.25, 1.0) + vec3(0.0, 0.0, -2.0);
}
mat3 axisAngle(vec3 axis, float a) {
  float s = sin(a), c = cos(a), ic = 1.0 - c;
  vec3 x = axis;
  return mat3(
    c + x.x*x.x*ic,      x.y*x.x*ic + x.z*s,  x.z*x.x*ic - x.y*s,
    x.x*x.y*ic - x.z*s,  c + x.y*x.y*ic,      x.z*x.y*ic + x.x*s,
    x.x*x.z*ic + x.y*s,  x.y*x.z*ic - x.x*s,  c + x.z*x.z*ic);
}
void main() {
  // staggered arrival: every primitive leaves at its own moment
  float delay = aSeed.w * 0.42;
  float t = clamp((uT - delay) / 0.58, 0.0, 1.0);
  t = t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
  vec3 a = uModelFrom * (shapeAt(uFrom) * uScaleFrom);
  vec3 b = uModelTo * (shapeAt(uTo) * uScaleTo);
  float d = length(b - a);
  vec3 mid = (a + b) * 0.5 + aSeed.xyz * (0.18 + d * 0.32);
  vec3 p = mix(mix(a, mid, t), mix(mid, b, t), t);
  float transit = sin(t * 3.14159265);
  p += aSeed.xyz * 0.01 * sin(uTime * 1.1 + aSeed.w * 50.0);
  vec3 axis = normalize(aSeed.xyz + vec3(0.001));
  float ang = uTime * (0.25 + aSeed.w * 0.5) + transit * 5.0 + aSeed.w * 20.0;
  mat3 r = axisAngle(axis, ang);
  float scatter = (uTo == 5) ? t : ((uFrom == 5) ? 1.0 - t : 0.0);
  float s = uSize * (0.62 + aSeed.w * 0.76) * (1.0 + transit * 0.5) * mix(uScaleFrom, uScaleTo, t) * (1.0 - scatter * 0.55);
  vec3 world = p + r * (aPos * s);
  vNormal = r * aNormal;
  vWorld = world;
  vTone = aTone;
  gl_Position = uProj * uView * vec4(world, 1.0);
}`;

const PRIM_FS = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorld;
in float vTone;
uniform vec3 uPaper;
uniform vec3 uSignal;
uniform vec3 uBg;
uniform vec3 uCam;
uniform float uDark;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 l = normalize(vec3(0.55, 0.8, 0.6));
  float diff = max(dot(n, l), 0.0);
  vec3 v = normalize(uCam - vWorld);
  float rim = pow(1.0 - max(dot(n, v), 0.0), 2.5);
  float spec = pow(max(dot(reflect(-l, n), v), 0.0), 24.0);
  vec3 base = mix(uPaper, uSignal, vTone);
  vec3 c = base * (0.42 + 0.7 * diff) + rim * base * 0.35 + spec * mix(0.25, 0.5, uDark);
  float depth = clamp((length(uCam - vWorld) - 3.2) / 3.5, 0.0, 1.0);
  c = mix(c, uBg, depth * 0.6);
  outColor = vec4(c, 1.0);
}`;

const QUAD_VS = `#version 300 es
const vec2 P[3] = vec2[3](vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));
void main() { gl_Position = vec4(P[gl_VertexID], 0.0, 1.0); }`;

const OFFLINE_FS = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uP;
uniform vec3 uBg;
uniform vec3 uFg;
uniform vec3 uSignal;
uniform vec3 uCanopy;
uniform float uDark;
out vec4 outColor;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
float routeY(float x) { return 0.12 + 0.03 * sin(x * 7.0) + 0.015 * sin(x * 17.0 + 1.3); }

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  const float edge = 0.6;
  float mx = mix(0.05, 0.95, uP);

  // canopy: layered noise crowns, denser on the left where there is no coverage
  float dens = smoothstep(edge + 0.12, edge - 0.25, uv.x);
  float n = fbm(p * 4.2 + vec2(uTime * 0.012, 0.0));
  float crowns = smoothstep(0.52 - dens * 0.14, 0.78, n) * (0.35 + 0.65 * dens);
  vec3 c = mix(uBg, uCanopy, crowns * 0.9);

  // static in the dead zone
  float grain = hash(floor(gl_FragCoord.xy / 2.0) + floor(uTime * 12.0));
  c += (grain - 0.5) * 0.05 * dens;

  // coverage rings from a mast
  vec2 mast = vec2(0.88 * aspect, 0.3);
  float dm = length(p - mast);
  float fr = fract(dm * 6.0 - uTime * 0.3);
  float rings = smoothstep(0.05, 0.0, min(fr, 1.0 - fr));
  float cover = smoothstep(edge - 0.02, edge + 0.1, uv.x);
  c = mix(c, uSignal, rings * cover * 0.55 * smoothstep(0.9, 0.05, dm));
  c = mix(c, uSignal, cover * 0.05 * smoothstep(0.7, 0.0, dm));
  c = mix(c, uFg, smoothstep(0.012, 0.0, dm - 0.012));

  // border of coverage
  float border = smoothstep(0.0025, 0.0, abs(uv.x - edge)) * step(0.5, fract(uv.y * 40.0));
  c = mix(c, uFg, border * 0.35);

  // route
  float ry = routeY(uv.x);
  float line = smoothstep(0.0028, 0.0, abs(uv.y - ry)) * step(0.45, fract(uv.x * 60.0));
  c = mix(c, uFg, line * 0.35);

  // queued points: collected in the dead zone, flushed to the mast once the machine is covered
  float spacing = 0.021;
  float flush = clamp((mx - edge) / 0.16, 0.0, 1.0);
  for (int i = 0; i < 26; i++) {
    float bx = 0.07 + float(i) * spacing;
    if (bx > min(mx, edge) - 0.01) break;
    vec2 base = vec2(bx * aspect, routeY(bx) + 0.035);
    float k = clamp(flush * 1.6 - float(i) * 0.024, 0.0, 1.0);
    k = k * k * (3.0 - 2.0 * k);
    vec2 q = mix(base, mast, k);
    vec2 dq = abs(p - q);
    float sq = step(max(dq.x, dq.y), 0.0065 * (1.0 - k * 0.6));
    c = mix(c, mix(uFg, uSignal, k), sq * (1.0 - smoothstep(0.85, 1.0, k)));
  }

  // the machine
  vec2 m = vec2(mx * aspect, routeY(mx));
  float dmac = length(p - m);
  c = mix(c, uSignal, smoothstep(0.013, 0.009, dmac));
  c = mix(c, uSignal, 0.25 * smoothstep(0.06, 0.0, dmac) * (0.6 + 0.4 * sin(uTime * 5.0)));

  // vignette
  c = mix(c, uBg, smoothstep(0.55, 1.25, length(uv - 0.5) * 1.4) * 0.6);
  outColor = vec4(c, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram()!;
  for (const [type, src] of [
    [gl.VERTEX_SHADER, vs],
    [gl.FRAGMENT_SHADER, fs],
  ] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    gl.attachShader(program, s);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link');
  return program;
}

// ── geometry: flat-shaded cube and pyramid, smooth icosphere ──
function cube(): number[] {
  const out: number[] = [];
  const f = (n: number[], u: number[], v: number[]) => {
    const c = (a: number, b: number) => [0, 1, 2].map((k) => n[k] * 0.5 + u[k] * a * 0.5 + v[k] * b * 0.5);
    for (const [a, b] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, -1],
      [1, 1],
      [-1, 1],
    ])
      out.push(...c(a, b), ...n);
  };
  f([1, 0, 0], [0, 1, 0], [0, 0, 1]);
  f([-1, 0, 0], [0, 0, 1], [0, 1, 0]);
  f([0, 1, 0], [0, 0, 1], [1, 0, 0]);
  f([0, -1, 0], [1, 0, 0], [0, 0, 1]);
  f([0, 0, 1], [1, 0, 0], [0, 1, 0]);
  f([0, 0, -1], [0, 1, 0], [1, 0, 0]);
  return out;
}
function pyramid(): number[] {
  const apex = [0, 0.62, 0];
  const b = [
    [-0.5, -0.38, -0.5],
    [0.5, -0.38, -0.5],
    [0.5, -0.38, 0.5],
    [-0.5, -0.38, 0.5],
  ];
  const out: number[] = [];
  const tri = (p: number[], q: number[], r: number[]) => {
    const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const v = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.hypot(n[0], n[1], n[2]);
    for (const P of [p, q, r]) out.push(...P, n[0] / l, n[1] / l, n[2] / l);
  };
  for (let i = 0; i < 4; i++) tri(b[(i + 1) % 4], b[i], apex);
  tri(b[0], b[1], b[2]);
  tri(b[0], b[2], b[3]);
  return out;
}
function icosphere(): number[] {
  const t = (1 + Math.sqrt(5)) / 2;
  let v = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
    [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map((p) => {
    const l = Math.hypot(p[0], p[1], p[2]);
    return p.map((x) => x / l);
  });
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  const mid = (a: number, b: number) => {
    const p = [0, 1, 2].map((k) => (v[a][k] + v[b][k]) / 2);
    const l = Math.hypot(p[0], p[1], p[2]);
    v.push(p.map((x) => x / l));
    return v.length - 1;
  };
  const next: number[][] = [];
  for (const [a, b, c] of faces) {
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
  }
  faces = next;
  const out: number[] = [];
  for (const f of faces) for (const i of f) out.push(v[i][0] * 0.5, v[i][1] * 0.5, v[i][2] * 0.5, ...v[i]);
  v = [];
  return out;
}

const hex = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];

function perspective(fovy: number, aspect: number, near: number, far: number, sx: number, sy: number): Float32Array {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  // sx/sy shift the projection centre (lens shift) so the subject can sit off-centre without skew
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, sx, sy, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}
function rotation(yaw: number, pitch: number): Float32Array {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  // column-major R = Ry(yaw) * Rx(pitch)
  return new Float32Array([cy, 0, -sy, sy * sp, cp, cy * sp, sy * cp, -sp, cy * cp]);
}

export function createStage(canvas: HTMLCanvasElement, opts: { count: number; dpr: number; mobile: boolean }): Stage | null {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
  if (!gl) return null;
  let prim: WebGLProgram, off: WebGLProgram;
  try {
    prim = compile(gl, PRIM_VS, PRIM_FS);
    off = compile(gl, QUAD_VS, OFFLINE_FS);
  } catch (e) {
    console.warn('stage disabled', e);
    return null;
  }

  const N = opts.count;
  const rng = mulberry32(20260925);
  const tone = new Uint8Array(N);
  for (let i = 0; i < N; i++) tone[i] = rng() < 0.16 ? 1 : 0;
  const seeds = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) seeds.set([rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1, rng()], i * 4);
  const targets = [cloud(N, rng), symbol(N, tone, rng), machine(0, N, tone, rng), machine(1, N, tone, rng), machine(2, N, tone, rng)];

  const buf = (data: ArrayBufferView) => {
    const b = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return b;
  };
  const seedBuf = buf(seeds);
  const toneBuf = buf(new Float32Array(tone));
  const targetBufs = targets.map(buf);

  const geos = [cube(), pyramid(), icosphere()];
  const per = Math.floor(N / geos.length);
  const draws = geos.map((g, gi) => {
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    buf(new Float32Array(g));
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    const first = gi * per;
    const inst = (loc: number, b: WebGLBuffer, size: number) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, size * 4, first * size * 4);
      gl.vertexAttribDivisor(loc, 1);
    };
    inst(2, seedBuf, 4);
    inst(3, toneBuf, 1);
    targetBufs.forEach((b, k) => inst(4 + k, b, 3));
    gl.bindVertexArray(null);
    return { vao, verts: g.length / 6, count: gi === geos.length - 1 ? N - first : per };
  });
  const quadVao = gl.createVertexArray()!;

  const U = (p: WebGLProgram, names: string[]) => Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)])) as Record<string, WebGLUniformLocation | null>;
  const pu = U(prim, ['uProj', 'uView', 'uModelFrom', 'uModelTo', 'uFrom', 'uTo', 'uT', 'uTime', 'uSize', 'uScaleFrom', 'uScaleTo', 'uPaper', 'uSignal', 'uBg', 'uCam', 'uDark']);
  const ou = U(off, ['uRes', 'uTime', 'uP', 'uBg', 'uFg', 'uSignal', 'uCanopy', 'uDark']);

  const state = {
    mode: 'off' as StageMode,
    from: 0,
    to: 1,
    t: 0,
    ox: 0,
    oy: 0,
    scale: 1,
    offline: 0,
    dark: true,
    px: 0,
    py: 0,
    spx: 0,
    spy: 0,
    width: 1,
    height: 1,
    visible: !document.hidden,
  };
  const start = performance.now();
  let raf = 0;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function resize() {
    const w = Math.max(1, Math.round(canvas.clientWidth * opts.dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * opts.dpr));
    if (w !== canvas.width || h !== canvas.height) {
      canvas.width = w;
      canvas.height = h;
    }
    state.width = w;
    state.height = h;
  }

  const palette = () =>
    state.dark
      ? { paper: hex('#f3f1ea'), signal: hex('#ff5a1f'), bg: hex('#0b0c0a'), canopy: hex('#1f2a22') }
      : { paper: hex('#262722'), signal: hex('#f0501a'), bg: hex('#f3f1ea'), canopy: hex('#d3d8c7') };

  // per-shape presentation: symbol turns gently, machines hold a three-quarter view
  const shapeScale = (k: number, aspect: number) => {
    const base = k === 1 || k === 0 || k === 5 ? Math.min(1, aspect / 0.78) : Math.min(1, aspect / 1.45) * (opts.mobile ? 1.02 : 0.9);
    return base * state.scale;
  };
  const shapeModel = (k: number, time: number) => {
    const yaw = k >= 2 && k <= 4 ? -0.3 + Math.sin(time * 0.25) * 0.07 : Math.sin(time * 0.35) * 0.35;
    const pitch = k >= 2 && k <= 4 ? 0.1 : Math.sin(time * 0.27) * 0.08;
    return rotation(yaw + state.spx * 0.3, pitch - state.spy * 0.16);
  };

  function frame() {
    raf = 0;
    resize();
    const time = (performance.now() - start) / 1000;
    gl!.viewport(0, 0, state.width, state.height);
    gl!.clearColor(0, 0, 0, 0);
    gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT);
    const pal = palette();
    state.spx += (state.px - state.spx) * 0.06;
    state.spy += (state.py - state.spy) * 0.06;
    if (state.mode === 'primitives') {
      const aspect = state.width / state.height;
      gl!.enable(gl!.DEPTH_TEST);
      gl!.useProgram(prim);
      gl!.uniformMatrix4fv(pu.uProj, false, perspective((32 * Math.PI) / 180, aspect, 0.1, 40, -state.ox, -state.oy));
      gl!.uniformMatrix4fv(pu.uView, false, new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -4.2, 1]));
      gl!.uniformMatrix3fv(pu.uModelFrom, false, shapeModel(state.from, time));
      gl!.uniformMatrix3fv(pu.uModelTo, false, shapeModel(state.to, time));
      gl!.uniform1i(pu.uFrom, state.from);
      gl!.uniform1i(pu.uTo, state.to);
      gl!.uniform1f(pu.uT, state.t);
      gl!.uniform1f(pu.uTime, time);
      gl!.uniform1f(pu.uSize, opts.mobile ? 0.034 : 0.027);
      gl!.uniform1f(pu.uScaleFrom, shapeScale(state.from, aspect));
      gl!.uniform1f(pu.uScaleTo, shapeScale(state.to, aspect));
      gl!.uniform3fv(pu.uPaper, pal.paper);
      gl!.uniform3fv(pu.uSignal, pal.signal);
      gl!.uniform3fv(pu.uBg, pal.bg);
      gl!.uniform3f(pu.uCam, 0, 0, 4.2);
      gl!.uniform1f(pu.uDark, state.dark ? 1 : 0);
      for (const d of draws) {
        gl!.bindVertexArray(d.vao);
        gl!.drawArraysInstanced(gl!.TRIANGLES, 0, d.verts, d.count);
      }
      gl!.bindVertexArray(null);
    } else if (state.mode === 'offline') {
      gl!.disable(gl!.DEPTH_TEST);
      gl!.useProgram(off);
      gl!.bindVertexArray(quadVao);
      gl!.uniform2f(ou.uRes, state.width, state.height);
      gl!.uniform1f(ou.uTime, time);
      gl!.uniform1f(ou.uP, state.offline);
      gl!.uniform3fv(ou.uBg, pal.bg);
      gl!.uniform3fv(ou.uFg, pal.paper);
      gl!.uniform3fv(ou.uSignal, pal.signal);
      gl!.uniform3fv(ou.uCanopy, pal.canopy);
      gl!.uniform1f(ou.uDark, state.dark ? 1 : 0);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      gl!.bindVertexArray(null);
    }
    if (state.mode !== 'off' && state.visible && !reduced) raf = requestAnimationFrame(frame);
  }
  const kick = () => {
    if (!raf && state.mode !== 'off' && state.visible) raf = requestAnimationFrame(frame);
  };
  const onVisibility = () => {
    state.visible = !document.hidden;
    kick();
  };
  document.addEventListener('visibilitychange', onVisibility);
  const onLost = (e: Event) => {
    e.preventDefault();
    state.mode = 'off';
    canvas.classList.remove('is-on');
  };
  canvas.addEventListener('webglcontextlost', onLost);

  return {
    setMode(mode) {
      if (state.mode === mode) return;
      state.mode = mode;
      canvas.classList.toggle('is-on', mode !== 'off');
      if (reduced) frame();
      else kick();
    },
    setMorph(from, to, t) {
      state.from = from;
      state.to = to;
      state.t = Math.min(1, Math.max(0, t));
      if (reduced) frame();
    },
    setFrame(x, y, scale) {
      state.ox = x;
      state.oy = y;
      state.scale = scale;
    },
    setOffline(p) {
      state.offline = p;
      if (reduced) frame();
    },
    setTheme(theme) {
      state.dark = theme.dark;
      if (reduced || !raf) frame();
    },
    setPointer(x, y) {
      state.px = x;
      state.py = y;
    },
    renderOnce: frame,
    destroy() {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onLost);
    },
  };
}
