import { attribs, buffer, hexLinear, m4, program, v3, type M4, type Program, type V3 } from './core';
import { cube, cylinder, route, tetrahedron, MAST, COVERAGE, type Route } from './geometry';
import { Post, type Grade } from './post';
import * as S from './shaders';
import {
  BEACON,
  MAST_H,
  OIL,
  R_KNOCK,
  SITE,
  WHEEL_X,
  cameraAt,
  counterRise,
  counterValue,
  dotState,
  excModel,
  machineSite,
  machineU,
  panelRise,
  ringModel,
  ringState,
  sceneWeights,
  wheelDigits,
  type DotState,
} from '../choreo';
import { clamp, inQuad, inOutCubic, lerp, range, smooth } from '../time';
import type { BuildResult } from '../worker';

/** «Чёрное золото»: мазут, кость, сурик, золото; the iridescence («плёнка») is computed in the shaders. */
export const PALETTE = {
  ink: '#0a0907',
  inkHigh: '#17130e',
  paper: '#f2ebdd',
  signal: '#ff4a14',
  gold: '#f0b85a',
  amber: '#d9871c',
  oilDeep: '#4a2104',
  taiga: '#1b1d15',
  taigaDeep: '#0b0b08',
  contour: '#62dccf',
};

const L = {
  ink: hexLinear(PALETTE.ink),
  inkHigh: hexLinear(PALETTE.inkHigh),
  paper: hexLinear(PALETTE.paper),
  signal: hexLinear(PALETTE.signal),
  gold: hexLinear(PALETTE.gold),
  amber: hexLinear(PALETTE.amber),
  oilDeep: hexLinear(PALETTE.oilDeep),
  taiga: hexLinear(PALETTE.taiga),
  taigaDeep: hexLinear(PALETTE.taigaDeep),
  contour: hexLinear(PALETTE.contour),
};

export interface StageOptions {
  portrait: boolean;
  dpr: number;
  msaa: number;
}

export interface FrameInput {
  T: number;
  time: number;
  sway: number;
  slosh: number;
  pointer: [number, number];
  still?: boolean;
  prevMix?: number;
}

interface Mesh {
  vao: WebGLVertexArrayObject;
  count: number;
}

export class Stage {
  readonly gl: WebGL2RenderingContext;
  private post: Post;
  private p: Record<string, Program> = {};
  private tetra!: Mesh;
  private wheel!: Mesh;
  private quad!: Mesh;
  private box!: Mesh;
  private empty: WebGLVertexArrayObject;
  private particles: { vao: WebGLVertexArrayObject; count: number; size: number } | null = null;
  private terrain: { vao: WebGLVertexArrayObject; count: number; coverU: number; routeLen: number } | null = null;
  private markers: { vao: WebGLVertexArrayObject; count: number; enterT: number } | null = null;
  private digits: WebGLTexture | null = null;
  private route: Route = route();
  private ribbon!: { vao: WebGLVertexArrayObject; count: number };
  private view = m4.identity();
  private proj = m4.identity();
  viewProj = m4.identity();
  private invViewProj = m4.identity();
  private eye: V3 = [0, 0, 4];
  private right: V3 = [1, 0, 0];
  private up: V3 = [0, 1, 0];
  private pointer: [number, number] = [0, 0];
  width = 1;
  height = 1;
  cssW = 1;
  cssH = 1;
  renderScale = 1;
  portrait: boolean;
  /** Oil vial in CSS pixels (x, y from top-left, w, h) for the DOM readouts. */
  vial = { x: 0, y: 0, w: 0, h: 0 };

  constructor(private canvas: HTMLCanvasElement, private opts: StageOptions) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) throw new Error('webgl2');
    this.gl = gl;
    this.portrait = opts.portrait;
    this.post = new Post(gl, opts.msaa);
    this.p.ring = program(gl, S.RECT_VS, S.RING_FS, 'ring');
    this.p.mesh = program(gl, S.MESH_VS, S.MESH_FS, 'mesh');
    this.p.particle = program(gl, S.PARTICLE_VS, S.PARTICLE_FS, 'particle');
    this.p.terrain = program(gl, S.TERRAIN_VS, S.TERRAIN_FS, 'terrain');
    this.p.marker = program(gl, S.MARKER_VS, S.MARKER_FS, 'marker');
    this.p.sprite = program(gl, S.SPRITE_VS, S.SPRITE_FS, 'sprite');
    this.p.backdrop = program(gl, S.TRI_VS, S.BACKDROP_FS, 'backdrop');
    this.p.oil = program(gl, S.TRI_VS, S.OIL_FS, 'oil');
    this.p.route = program(gl, S.ROUTE_VS, S.ROUTE_FS, 'route');
    this.empty = gl.createVertexArray()!;
    this.tetra = this.mesh(tetrahedron(), [[0, 3], [1, 3], [2, 3]]);
    this.wheel = this.mesh(cylinder(96), [[0, 3], [1, 3], [2, 2]]);
    this.box = this.mesh(cube(), [[0, 3], [1, 3]]);
    const q: number[] = [];
    for (const [x, y] of [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]) q.push(x - 0.5, y - 0.5, 0, 0, 0, 1, x, y);
    this.quad = this.mesh(new Float32Array(q), [[0, 3], [1, 3], [2, 2]]);
    this.ribbon = this.buildRibbon(0.03);
  }

  /** Route as a flat triangle strip in site space: (x, z, u, side) per vertex. */
  private buildRibbon(halfWidth: number) {
    const { pts, cum, length } = this.route;
    const data: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const tx = b[0] - a[0], tz = b[1] - a[1];
      const l = Math.hypot(tx, tz) || 1;
      const nx = -tz / l, nz = tx / l;
      const u = cum[i] / length;
      for (const side of [-1, 1]) data.push(pts[i][0] + nx * halfWidth * side, pts[i][1] + nz * halfWidth * side, u, side);
    }
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    attribs(gl, buffer(gl, new Float32Array(data)), [[0, 2], [1, 2]]);
    gl.bindVertexArray(null);
    return { vao, count: data.length / 4 };
  }

  private mesh(data: Float32Array, layout: Array<[number, number]>): Mesh {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    attribs(gl, buffer(gl, data), layout);
    gl.bindVertexArray(null);
    const floats = layout.reduce((s, [, n]) => s + n, 0);
    return { vao, count: data.length / floats };
  }

  /** Digit strip for the drum wheels, drawn with the brand mono once the font is ready. */
  buildDigits(font: string) {
    const gl = this.gl;
    const cw = 256, ch = 148;
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch * 10;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = font;
    for (let d = 0; d < 10; d++) g.fillText(String(d), cw / 2, ch * d + ch / 2 + 4);
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    this.digits = t;
  }

  setBuild(b: BuildResult) {
    const gl = this.gl;
    const pvao = gl.createVertexArray()!;
    gl.bindVertexArray(pvao);
    attribs(gl, buffer(gl, tetrahedron()), [[0, 3], [1, 3], [2, 3]]);
    attribs(gl, buffer(gl, b.instances), [[3, 3], [4, 3], [5, 3], [6, 3], [7, 4], [8, 3]], 1);
    gl.bindVertexArray(null);
    this.particles = { vao: pvao, count: b.count, size: b.size };

    const tvao = gl.createVertexArray()!;
    gl.bindVertexArray(tvao);
    attribs(gl, buffer(gl, b.terrain), [[0, 3], [1, 2]]);
    buffer(gl, b.index, gl.STATIC_DRAW, gl.ELEMENT_ARRAY_BUFFER);
    gl.bindVertexArray(null);
    this.terrain = { vao: tvao, count: b.index.length, coverU: b.coverU, routeLen: b.routeLen };

    // stored points: one marker per stretch of route driven without coverage
    const store: number[] = [];
    const n = Math.max(2, Math.floor((b.coverU - 0.03) / 0.034));
    for (let k = 0; k < n; k++) {
      const u = 0.03 + k * 0.034;
      const s = machineSite(this.route, u);
      store.push(s[0] + SITE[0], 0.06 + SITE[1], s[2] + SITE[2], u, k / (n - 1));
    }
    const mvao = gl.createVertexArray()!;
    gl.bindVertexArray(mvao);
    attribs(gl, buffer(gl, cube()), [[0, 3], [1, 3]]);
    attribs(gl, buffer(gl, new Float32Array(store)), [[2, 4], [3, 1]], 1);
    gl.bindVertexArray(null);
    // film time when the machine reaches coverage (machineU is monotone)
    let lo = 12.35, hi = 14.25;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (machineU(mid) < b.coverU) lo = mid;
      else hi = mid;
    }
    this.markers = { vao: mvao, count: n, enterT: hi };
  }

  get ready() {
    return !!this.particles;
  }

  get coverEnterT() {
    return this.markers?.enterT ?? 13.6;
  }

  storedAt(T: number): number {
    if (!this.markers) return 0;
    const u = machineU(T);
    const n = this.markers.count;
    const stored = Math.min(n, Math.max(0, Math.floor((u - 0.03) / 0.034) + 1));
    const flushT = T - this.markers.enterT;
    if (flushT <= 0) return stored;
    const flown = Math.min(n, Math.floor(clamp((flushT - 0.3) / 0.5, 0, 1) * n + (flushT > 1.1 ? n : 0)));
    return Math.max(0, stored - flown);
  }

  resize(portrait: boolean) {
    const cssW = this.canvas.clientWidth || innerWidth;
    const cssH = this.canvas.clientHeight || innerHeight;
    let scale = this.opts.dpr * this.renderScale;
    // pixel budget: a huge or very tall surface (a 5K screen, a full-page capture) must not allocate a giant HDR + MSAA target
    const budget = 5e6;
    const px = cssW * cssH * scale * scale;
    if (px > budget) scale *= Math.sqrt(budget / px);
    const w = Math.max(2, Math.round(cssW * scale));
    const h = Math.max(2, Math.round(cssH * scale));
    this.portrait = portrait;
    this.cssW = cssW;
    this.cssH = cssH;
    if (w !== this.canvas.width || h !== this.canvas.height) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.width = w;
    this.height = h;
    this.post.resize(w, h);
  }

  private camera(T: number, time: number, still: boolean) {
    const c = cameraAt(T, this.portrait);
    const drift = still ? 0 : 1;
    this.pointer[0] += (this.pointerTarget[0] - this.pointer[0]) * 0.05;
    this.pointer[1] += (this.pointerTarget[1] - this.pointer[1]) * 0.05;
    const az = c.az + drift * (Math.sin(time * 0.13) * 0.028 + this.pointer[0] * 0.035);
    const el = c.el + drift * (Math.sin(time * 0.11 + 1.3) * 0.016 - this.pointer[1] * 0.022);
    const ce = Math.cos(el);
    this.eye = [c.target[0] + c.dist * ce * Math.sin(az), c.target[1] + c.dist * Math.sin(el), c.target[2] + c.dist * ce * Math.cos(az)];
    m4.lookAt(this.view, this.eye, c.target);
    const aspect = this.width / this.height;
    const fov = this.portrait ? 2 * Math.atan(Math.tan(c.fov / 2) * 1.12) : c.fov;
    m4.perspective(this.proj, fov, aspect, 0.05, 80, c.sx, c.sy);
    m4.mul(this.viewProj, this.proj, this.view);
    m4.invert(this.invViewProj, this.viewProj);
    this.right = [this.view[0], this.view[4], this.view[8]];
    this.up = [this.view[1], this.view[5], this.view[9]];
  }

  private pointerTarget: [number, number] = [0, 0];
  setPointer(x: number, y: number) {
    this.pointerTarget = [x, y];
  }

  /** CSS pixel position of a world point, with depth sign (> 0 when in front). */
  project(p: V3): [number, number, number] {
    const m = this.viewProj;
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    return [((x / w) * 0.5 + 0.5) * this.cssW, (1 - ((y / w) * 0.5 + 0.5)) * this.cssH, w];
  }

  private light(pr: Program, T: number, time: number) {
    const gl = this.gl;
    const u = pr.u;
    const w = sceneWeights(T);
    const k = v3.norm([0.55 + this.pointer[0] * 0.25, 0.78 - this.pointer[1] * 0.18, 0.45]);
    gl.uniform3fv(u.uCam, this.eye);
    gl.uniform3fv(u.uKeyDir, k);
    const key = 1.7 + w.s5 * 0.2;
    gl.uniform3f(u.uKeyCol, 1.0 * key, 0.93 * key, 0.84 * key);
    gl.uniform3fv(u.uRimDir, v3.norm([-0.7, 0.35, -0.6]));
    // warm gold rim instead of the stock teal: the black-and-gold livery
    gl.uniform3f(u.uRimCol, 0.56, 0.4, 0.2);
    gl.uniform3f(u.uSky, 0.062, 0.056, 0.05);
    gl.uniform3f(u.uGround, 0.012, 0.01, 0.008);
    gl.uniform1f(u.uTime, time);
    gl.uniform3fv(u.uFog, L.ink);
    const near = lerp(6.5, 11, w.s4), far = lerp(15, 24, w.s4);
    gl.uniform2f(u.uFogRange, near, far);
  }

  private rect(centres: Array<[V3, number]>): [number, number, number, number] | null {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const m = this.viewProj;
    for (const [c, r] of centres)
      for (let i = 0; i < 8; i++) {
        const p: V3 = [c[0] + (i & 1 ? r : -r), c[1] + (i & 2 ? r : -r), c[2] + (i & 4 ? r : -r)];
        const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
        if (w <= 0.05) return [-1, -1, 1, 1];
        const x = (m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / w;
        const y = (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / w;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    if (x1 < -1 || y1 < -1 || x0 > 1 || y0 > 1) return null;
    return [Math.max(-1, x0 - 0.02), Math.max(-1, y0 - 0.02), Math.min(1, x1 + 0.02), Math.min(1, y1 + 0.02)];
  }

  frame(f: FrameInput) {
    const gl = this.gl;
    const { T, time } = f;
    const still = !!f.still;
    this.camera(T, time, still);
    const w = sceneWeights(T);
    this.post.begin(L.ink);

    this.drawBackdrop(T, time, w);
    this.drawTerrain(T, time);
    this.drawOil(T, time, f.slosh);
    const dot = dotState(T, this.route);
    this.drawRing(T, time, dot);
    this.drawCounter(T, time);
    this.drawParticles(T, time, f.sway);
    this.drawSprites(T, time, dot);

    const grade: Grade = {
      exposure: 1.02 - w.s5 * 0.04,
      bloom: 0.55 * w.s1 + 0.45 * w.s2 + 0.36 * w.s3 + 0.55 * w.s4 + 0.42 * w.s5 + 0.55 * w.s6,
      threshold: 1.05,
      vignette: 0.55 + 0.1 * w.s4,
      grain: 0.03,
      ca: 0.004,
      saturation: 1 + 0.08 * w.s3,
      shadowTint: [0.53, 0.5, 0.46],
      highTint: [1.0, 0.88, 0.7],
      fade: smooth(range(T, 0, 0.3)) * (still ? 1 : 1),
      time: still ? 0 : time,
      prevMix: f.prevMix ?? 0,
    };
    this.post.finish(grade, this.width, this.height);
    gl.bindVertexArray(null);
  }

  snapshot() {
    this.post.snapshot(this.width, this.height);
  }

  private drawBackdrop(T: number, time: number, w: ReturnType<typeof sceneWeights>) {
    const gl = this.gl;
    const pr = this.p.backdrop;
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.useProgram(pr.p);
    gl.bindVertexArray(this.empty);
    const u = pr.u;
    gl.uniform2f(u.uRes, this.width, this.height);
    gl.uniform1f(u.uTime, time);
    gl.uniform3fv(u.uLow, L.ink);
    gl.uniform3fv(u.uHigh, L.inkHigh);
    gl.uniform3f(u.uBeamCol, 0.66, 0.56, 0.42);
    gl.uniform1f(u.uBeam, 0.075 * w.s1 + 0.045 * w.s2 + 0.02 * w.s3 + 0.075 * w.s6);
    const bx = this.portrait ? 0.5 : 0.71;
    gl.uniform2f(u.uBeamPos, bx, this.portrait ? 0.68 : 0.5);
    gl.uniform3fv(u.uGlowCol, w.s5 > 0.01 ? L.amber : L.gold);
    gl.uniform1f(u.uGlow, 0.018 * w.s2 + 0.07 * w.s5);
    gl.uniform2f(u.uGlowPos, bx, this.portrait ? 0.66 : 0.5);
    gl.uniform1f(u.uHorizon, 0.04 * w.s3);
    gl.uniform3fv(u.uHorizonCol, L.contour);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);
  }

  private drawTerrain(T: number, time: number) {
    if (!this.terrain || T < 11.2 || T > 15.6) return;
    const gl = this.gl;
    const pr = this.p.terrain;
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(pr.p);
    this.light(pr, T, time);
    const u = pr.u;
    // the land's mesh is in site space; the model offset is folded into the view-projection
    const model = m4.compose(m4.identity(), SITE, 0, 0, 0, 1);
    gl.uniformMatrix4fv(u.uViewProj, false, m4.mul(m4.identity(), this.viewProj, model));
    gl.uniform1f(u.uRise, 1.45 * range(T, 11.3, 13.0));
    gl.uniform2f(u.uRiseCentre, 0, 0);
    gl.uniform3f(u.uMast, MAST[0], 0, MAST[2]);
    gl.uniform1f(u.uCover, COVERAGE);
    gl.uniform1f(u.uMachineU, machineU(T));
    gl.uniform1f(u.uRouteLen, this.terrain.routeLen);
    const landAlpha = 1 - range(T, 14.8, 15.2);
    gl.uniform1f(u.uAlpha, landAlpha);
    gl.uniform3fv(u.uTaiga, L.taiga);
    gl.uniform3fv(u.uTaigaDeep, L.taigaDeep);
    gl.uniform3fv(u.uContour, L.contour);
    gl.uniform3fv(u.uPaper, L.paper);
    gl.uniform3fv(u.uSignal, L.signal);
    // shading uses world coordinates offset by SITE; keep the camera in site space for lighting
    gl.uniform3fv(u.uCam, v3.sub(this.eye, SITE));
    gl.bindVertexArray(this.terrain.vao);
    gl.drawElements(gl.TRIANGLES, this.terrain.count, gl.UNSIGNED_INT, 0);

    // route ribbon on the valley floor
    const rp = this.p.route;
    gl.useProgram(rp.p);
    gl.uniformMatrix4fv(rp.u.uViewProj, false, m4.mul(m4.identity(), this.viewProj, model));
    gl.uniform1f(rp.u.uRise, 1.45 * range(T, 11.3, 13.0));
    gl.uniform2f(rp.u.uRiseCentre, 0, 0);
    gl.uniform1f(rp.u.uMachineU, machineU(T));
    gl.uniform1f(rp.u.uRouteLen, this.terrain.routeLen);
    gl.uniform1f(rp.u.uAlpha, landAlpha);
    gl.uniform3fv(rp.u.uPaper, L.paper);
    gl.uniform3fv(rp.u.uCam, v3.sub(this.eye, SITE));
    gl.uniform3fv(rp.u.uFog, L.ink);
    gl.uniform2f(rp.u.uFogRange, lerp(6.5, 11, sceneWeights(T).s4), lerp(15, 24, sceneWeights(T).s4));
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.bindVertexArray(this.ribbon.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, this.ribbon.count);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // mast and stored points
    const mesh = this.p.mesh;
    gl.useProgram(mesh.p);
    this.light(mesh, T, time);
    const mu = mesh.u;
    gl.uniformMatrix4fv(mu.uViewProj, false, this.viewProj);
    const mastBase = v3.add([MAST[0], 0, MAST[2]], SITE);
    const rise = smooth(range(T, 12.0, 12.9));
    const mm = m4.compose(m4.identity(), v3.add(mastBase, [0, (MAST_H * rise) / 2, 0]), 0, 0, Math.PI / 2, [MAST_H * rise, 0.018, 0.018]);
    gl.uniformMatrix4fv(mu.uModel, false, mm);
    gl.uniform1i(mu.uMode, 0);
    gl.uniform3f(mu.uBase, 0.2, 0.21, 0.23);
    gl.uniform3f(mu.uEmit, 0.0, 0.0, 0.0);
    gl.uniform1f(mu.uRough, 0.5);
    gl.uniform1f(mu.uAlpha, landAlpha);
    gl.bindVertexArray(this.wheel.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.wheel.count);

    if (this.markers) {
      const mk = this.p.marker;
      gl.useProgram(mk.p);
      this.light(mk, T, time);
      gl.uniformMatrix4fv(mk.u.uViewProj, false, this.viewProj);
      gl.uniform1f(mk.u.uMachineU, machineU(T));
      gl.uniform1f(mk.u.uFlushT, T - this.markers.enterT - 0.15);
      gl.uniform3fv(mk.u.uMastTop, v3.add(mastBase, [0, MAST_H, 0]));
      gl.uniform1f(mk.u.uSize, 0.075 * (1 - range(T, 14.9, 15.3)));
      gl.uniform3fv(mk.u.uPaper, L.paper);
      gl.uniform3fv(mk.u.uSignal, L.signal);
      gl.bindVertexArray(this.markers.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, this.markers.count);
    }
  }

  /** Pixel geometry of the oil vial and the falling drop. */
  private oilLayout(T: number) {
    const W = this.width, H = this.height;
    const vw = this.portrait ? H * 0.105 : H * 0.17;
    const vh = this.portrait ? H * 0.29 : H * 0.62;
    const cx = this.portrait ? W * 0.5 : W * 0.71;
    const cy = this.portrait ? H * 0.715 : H * 0.47;
    const s = this.width / Math.max(1, this.cssW);
    this.vial = { x: (cx - vw / 2) / s, y: (H - cy - vh / 2) / s, w: vw / s, h: vh / s };
    return { vw, vh, cx, cy };
  }

  private drawOil(T: number, time: number, slosh: number) {
    const mix = OIL.mix(T);
    const lay = this.oilLayout(T);
    if (mix <= 0.001) return;
    const gl = this.gl;
    const pr = this.p.oil;
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(pr.p);
    gl.bindVertexArray(this.empty);
    const u = pr.u;
    const { vw, vh, cx, cy } = lay;
    gl.uniform2f(u.uRes, this.width, this.height);
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uMix, mix);
    gl.uniform4f(u.uVial, cx, cy, vw, vh);
    const level = OIL.level(T);
    const lv = 0.12 + level * 0.0068;
    gl.uniform1f(u.uLevel, lv);
    const since = T - OIL.impact;
    const amp = 0.004 + (since > 0 ? 0.03 * Math.exp(-since * 2.4) : 0) + Math.min(0.03, Math.abs(slosh) * 0.02);
    gl.uniform1f(u.uSlosh, amp);
    gl.uniform1f(u.uSloshPhase, time * 2.2 + slosh * 2.0);
    gl.uniform1f(u.uImpact, since > 0 ? since : -1);
    gl.uniform1f(u.uImpactX, 0.08);
    // the drop: hand-off from the 3D dot, arc to the vial, hang, fall
    const top = cy + vh / 2;
    const hang: [number, number] = [cx + 0.08 * vw * 0.5, top + vh * 0.12];
    const start = this.handoff ?? hang;
    let dx = hang[0], dy = hang[1], sx = 1, sy = 1, on = 1;
    const rr = vw * 0.12;
    if (T < 15.72) {
      const x = inOutCubic(range(T, OIL.handoff, 15.72));
      const mid: [number, number] = [(start[0] + hang[0]) / 2, Math.max(start[1], hang[1]) + this.height * 0.08];
      dx = (1 - x) * (1 - x) * start[0] + 2 * (1 - x) * x * mid[0] + x * x * hang[0];
      dy = (1 - x) * (1 - x) * start[1] + 2 * (1 - x) * x * mid[1] + x * x * hang[1];
    } else if (T < 15.95) {
      const x = range(T, 15.72, 15.95);
      sy = 1 + 0.32 * smooth(x);
      sx = 1 - 0.14 * smooth(x);
      dy = hang[1] - rr * 0.3 * smooth(x);
    } else if (T < OIL.impact) {
      const x = range(T, 15.95, OIL.impact);
      const surf = cy - vh / 2 + lv * vh;
      dy = lerp(hang[1] - rr * 0.3, surf + rr * 0.6, inQuad(x));
      sy = 1.32 - 0.1 * x;
      sx = 0.86;
    } else on = 0;
    gl.uniform3f(u.uDrop, dx, dy, rr);
    gl.uniform2f(u.uDropStretch, sx, sy);
    gl.uniform1f(u.uDropOn, T >= OIL.handoff && on ? 1 : 0);
    gl.uniform3fv(u.uInk, L.ink);
    gl.uniform3fv(u.uGold, L.gold);
    gl.uniform3fv(u.uAmber, L.amber);
    gl.uniform3fv(u.uDeep, L.oilDeep);
    gl.uniform3fv(u.uPaper, L.paper);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }

  /** Pixel position of the dot at the oil hand-off, set by the film when it projects the dot. */
  handoff: [number, number] | null = null;

  private drawRing(T: number, time: number, dot: DotState) {
    const rs = ringState(T);
    if (!rs.on && !dot.on) return;
    const gl = this.gl;
    const model = ringModel(rs);
    const centres: Array<[V3, number]> = [];
    if (rs.on) centres.push([[0, 0, 0], (0.62 + 0.14) * rs.scale]);
    if (dot.on) centres.push([dot.pos, dot.radius * Math.max(1, dot.stretch) * 1.1]);
    const rect = this.rect(centres);
    if (!rect) return;
    const pr = this.p.ring;
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(pr.p);
    this.light(pr, T, time);
    const u = pr.u;
    gl.uniform4f(u.uRect, rect[0], rect[1], rect[2], rect[3]);
    gl.uniformMatrix4fv(u.uInvViewProj, false, this.invViewProj);
    gl.uniformMatrix4fv(u.uViewProj, false, this.viewProj);
    gl.uniformMatrix4fv(u.uRingInv, false, m4.invert(m4.identity(), model));
    gl.uniform1f(u.uRingScale, rs.scale);
    gl.uniform1f(u.uRingOn, rs.on ? 1 : 0);
    gl.uniform1f(u.uA0, rs.a0);
    gl.uniform1f(u.uA1, rs.a1);
    gl.uniform3fv(u.uDot, dot.pos);
    const a = v3.norm(dot.axis);
    let p1 = v3.cross(a, [0, 0, 1]);
    if (v3.len(p1) < 0.1) p1 = v3.cross(a, [1, 0, 0]);
    p1 = v3.norm(p1);
    const p2 = v3.cross(a, p1);
    gl.uniformMatrix3fv(u.uDotBasis, false, new Float32Array([...a, ...p1, ...p2]));
    const st = Math.max(0.3, dot.stretch);
    gl.uniform3f(u.uDotRadii, dot.radius * st, dot.radius / Math.sqrt(st), dot.radius / Math.sqrt(st));
    gl.uniform1f(u.uDotOn, dot.on && dot.radius > 1e-4 ? 1 : 0);
    gl.uniform1f(u.uKnock, dot.onRing ? R_KNOCK * rs.scale * Math.min(1, dot.radius / (0.236 * rs.scale + 1e-6)) : 0);
    gl.uniform1f(u.uDissolve, rs.dissolve);
    gl.uniform3fv(u.uPaper, L.paper);
    gl.uniform3fv(u.uSignal, L.signal);
    gl.uniform3fv(u.uGold, L.gold);
    gl.uniform1f(u.uDotGlow, dot.glow * (1 + 0.12 * Math.sin(time * 2.1)));
    gl.uniform1f(u.uDotGold, dot.gold);
    gl.bindVertexArray(this.empty);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private drawCounter(T: number, time: number) {
    if (T < 3.95 || T > 7.4 || !this.digits) return;
    const gl = this.gl;
    const pr = this.p.mesh;
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(pr.p);
    this.light(pr, T, time);
    const u = pr.u;
    gl.uniformMatrix4fv(u.uViewProj, false, this.viewProj);
    const ring = ringModel(ringState(T));
    const pr0 = panelRise(T);
    // instrument window behind the wheels
    if (pr0 > 0.001) {
      const local = m4.compose(m4.identity(), [0, 0, -0.06 - (1 - pr0) * 0.2], 0, 0, 0, [0.8 * pr0, 0.27 * pr0, 1]);
      gl.uniformMatrix4fv(u.uModel, false, m4.mul(m4.identity(), ring, local));
      gl.uniform1i(u.uMode, 2);
      gl.uniform3f(u.uBase, 0.02, 0.022, 0.028);
      gl.uniform3f(u.uEmit, 0, 0, 0);
      gl.uniform1f(u.uRough, 0.45);
      gl.uniform1f(u.uAlpha, 1);
      gl.bindVertexArray(this.quad.vao);
      gl.drawArrays(gl.TRIANGLES, 0, this.quad.count);
    }
    const val = counterValue(T);
    const digits = wheelDigits(val);
    const ahead = wheelDigits(counterValue(T + 1 / 60));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.digits);
    gl.uniform1i(u.uDigits, 0);
    gl.uniform1i(u.uMode, 1);
    gl.uniform1f(u.uRough, 0.36);
    gl.bindVertexArray(this.wheel.vao);
    for (let i = 0; i < 6; i++) {
      const r = counterRise(T, i);
      if (r <= 0.001) continue;
      const pos = digits[i];
      const delta = Math.PI / 2 - Math.PI * 2 * (pos / 10 + 0.05);
      const local = m4.compose(m4.identity(), [WHEEL_X[i], 0, 0.02 - (1 - r) * 0.45], delta, 0, 0, [0.094 * r, 0.086 * r, 0.086 * r]);
      gl.uniformMatrix4fv(u.uModel, false, m4.mul(m4.identity(), ring, local));
      const tenth = i === 5;
      if (tenth) {
        gl.uniform3fv(u.uBase, L.signal);
        gl.uniform3fv(u.uInk, L.ink);
        gl.uniform3f(u.uEmit, L.signal[0] * 0.25, L.signal[1] * 0.25, L.signal[2] * 0.25);
      } else {
        gl.uniform3f(u.uBase, 0.035, 0.038, 0.046);
        gl.uniform3fv(u.uInk, L.paper);
        gl.uniform3f(u.uEmit, 0, 0, 0);
      }
      const vel = Math.abs(ahead[i] - pos);
      gl.uniform1f(u.uBlur, clamp(vel * 0.1, 0, 0.09));
      gl.uniform1f(u.uAlpha, 1);
      gl.drawArrays(gl.TRIANGLES, 0, this.wheel.count);
    }
  }

  private drawParticles(T: number, time: number, sway: number) {
    if (!this.particles || T < 7.25 || T > 13.4) return;
    const gl = this.gl;
    const pr = this.p.particle;
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(pr.p);
    this.light(pr, T, time);
    const u = pr.u;
    gl.uniformMatrix4fv(u.uViewProj, false, this.viewProj);
    gl.uniformMatrix4fv(u.uRingModel, false, ringModel(ringState(Math.min(T, 10.6))));
    gl.uniformMatrix4fv(u.uExcModel, false, excModel);
    gl.uniform1f(u.uT, T);
    gl.uniform1f(u.uDissolve, ringState(Math.min(T, 10.6)).dissolve);
    gl.uniform1f(u.uFly0, 8.8);
    gl.uniform1f(u.uFlySpread, 0.5);
    gl.uniform1f(u.uFlyDur, 0.95);
    gl.uniform1f(u.uDis0, 10.95);
    gl.uniform1f(u.uDisSpread, 0.8);
    gl.uniform1f(u.uDisDur, 1.25);
    gl.uniform1f(u.uSize, this.particles.size);
    gl.uniform3fv(u.uWind, v3.norm([-0.62, 0.5, 0.42]));
    gl.uniform1f(u.uSway, sway);
    gl.uniform3fv(u.uPaper, L.paper);
    gl.bindVertexArray(this.particles.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 12, this.particles.count);
  }

  private sprite(centre: V3, size: number, color: V3, radius: number, width: number, core: number) {
    const gl = this.gl;
    const u = this.p.sprite.u;
    gl.uniform3fv(u.uCentre, centre);
    gl.uniform1f(u.uSize, size);
    gl.uniform3fv(u.uColor, color);
    gl.uniform1f(u.uRadius, radius);
    gl.uniform1f(u.uWidth, width);
    gl.uniform1f(u.uCore, core);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private drawSprites(T: number, time: number, dot: DotState) {
    const gl = this.gl;
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.p.sprite.p);
    gl.bindVertexArray(this.empty);
    const u = this.p.sprite.u;
    gl.uniformMatrix4fv(u.uViewProj, false, this.viewProj);
    gl.uniform3fv(u.uRight, this.right);
    gl.uniform3fv(u.uUp, this.up);
    const sig = L.signal;
    // impact shockwave when the dot lands in the intro
    const k = range(T, 0.92, 1.45);
    if (k > 0 && k < 1 && dot.on) {
      const c = v3.scale(sig, 0.8 * (1 - k) * (1 - k));
      this.sprite(dot.pos, 0.25 + 1.2 * k, c, 0.74, 0.035, 0);
    }
    // tracker beacon pulses
    if (dot.on && T > 9.9 && T < 14.9) {
      for (let i = 0; i < 2; i++) {
        const ph = (time * 0.7 + i * 0.5) % 1;
        const c = v3.scale(sig, 0.5 * (1 - ph) * (1 - ph));
        this.sprite(dot.pos, dot.radius * (1.8 + 4.2 * ph), c, 0.75, 0.045, 0);
      }
    }
    // coverage mast
    if (this.terrain && T > 12.2 && T < 15.3) {
      const mastTop = v3.add(v3.add([MAST[0], MAST_H, MAST[2]], SITE), [0, 0, 0]);
      const fade = smooth(range(T, 12.4, 12.9)) * (1 - range(T, 14.9, 15.3));
      this.sprite(mastTop, 0.35, v3.scale(sig, 2.2 * fade), 0.0, 0.01, 1.0);
      for (let i = 0; i < 3; i++) {
        const ph = (time * 0.45 + i / 3) % 1;
        this.sprite(mastTop, 0.4 + 2.4 * ph, v3.scale(L.contour, 0.35 * fade * (1 - ph)), 0.8, 0.04, 0);
      }
    }
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }

  dotAt(T: number) {
    return dotState(T, this.route);
  }

  /** Projects a world point through the choreographed camera at time T, without drift. */
  projectAt(T: number, p: V3): [number, number] {
    const saveView = this.view.slice() as M4, saveProj = this.proj.slice() as M4, saveVP = this.viewProj.slice() as M4, saveEye = this.eye;
    const c = cameraAt(T, this.portrait);
    const ce = Math.cos(c.el);
    const eye: V3 = [c.target[0] + c.dist * ce * Math.sin(c.az), c.target[1] + c.dist * Math.sin(c.el), c.target[2] + c.dist * ce * Math.cos(c.az)];
    const view = m4.lookAt(m4.identity(), eye, c.target);
    const fov = this.portrait ? 2 * Math.atan(Math.tan(c.fov / 2) * 1.12) : c.fov;
    const proj = m4.perspective(m4.identity(), fov, this.width / this.height, 0.05, 80, c.sx, c.sy);
    const vp = m4.mul(m4.identity(), proj, view);
    const x = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12];
    const y = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13];
    const w = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
    this.view.set(saveView);
    this.proj.set(saveProj);
    this.viewProj.set(saveVP);
    this.eye = saveEye;
    return [((x / w) * 0.5 + 0.5) * this.width, ((y / w) * 0.5 + 0.5) * this.height];
  }

  beaconSite(): V3 {
    return BEACON;
  }
}
