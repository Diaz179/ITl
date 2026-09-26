/**
 * The reel's choreography: pure functions of film time T that write one Frame. The DOM overlay reads the
 * same layout (OUT), so words, shapes and 3D always agree. Ambient loops use wall time only at rest.
 */
import { WORDMARK } from '../../brand/logo';
import type { Glyph, Word } from './atlas';
import { COVERAGE, MAST, route, type Route } from './gl/geometry';
import type { Col, Frame } from './gl/renderer';
import { BEAT, HOLDS, backOut, clamp01, expoIn, expoInOut, expoOut, inOutCubic, inOutSine, lerp, outCubic, range, smooth } from './time';

export const INK: Col = [0.039, 0.035, 0.027];
export const BONE: Col = [0.949, 0.922, 0.867];
export const SURIK: Col = [1, 0.29, 0.078];
export const SINKA: Col = [0.176, 0.184, 0.941];
export const ZHILET: Col = [0.867, 1, 0.169];

const DEG = Math.PI / 180;
/** Motion-blur exposure in seconds: a touch over one frame, for the reference's smears. */
const SHUTTER = 1 / 45;
const SITE = [-0.6, -0.8, 0] as const;
const BEACON = [0.33, 1.53, 0.31] as const;
const MAST_H = 1.7;

export interface Type {
  wm: Glyph[];
  /** raster px per wordmark unit */
  wmScale: number;
  words: Record<string, Word>;
}
let TYPE: Type | null = null;
export const setType = (t: Type) => (TYPE = t);
let coverU = 0.62;
export const setCoverU = (u: number) => (coverU = u);

export const L = { W: 1, H: 1, cx: 0, cy: 0, U: 1, portrait: false, cover: 1 };
export function layout(W: number, H: number) {
  L.W = W;
  L.H = H;
  L.cx = W / 2;
  L.cy = H / 2;
  L.U = Math.min(W, H);
  L.portrait = W / H < 0.8;
  L.cover = Math.hypot(W, H) / 2 + 60;
}

/** Positions shared with the DOM overlay. */
export const OUT = {
  wmX0: 0, wmX1: 0, wmBase: 0, wmU: 1, ruleY: 0,
  rowY: new Float32Array(4), ax: 0, bx: 0, offX: 0, offY: 0, offOn: 0,
  s3x: 0, s3y: 0, s3R: 0, reading: 0, readingPrev: 0, readingT: 1,
  tagX: 0, tagY: 0, tagOn: 0, stored: 0, inCover: false,
  lockBottom: 0, lockX: 0,
};

const tmp = new Float32Array(3);
const tmp2 = new Float32Array(3);
const col: [number, number, number] = [0, 0, 0];
function mix(a: Col, b: Col, t: number): Col {
  col[0] = a[0] + (b[0] - a[0]) * t;
  col[1] = a[1] + (b[1] - a[1]) * t;
  col[2] = a[2] + (b[2] - a[2]) * t;
  return col;
}

// ── background: base colour, circle wipes that carry the dot, one diagonal wipe ──────────
const dot0 = () => 0.02857 * L.U;
const dot3 = () => 0.016 * L.U;
const wipeR = (T: number, a: number, b: number, r0: number, r1 = L.cover) => {
  const x = range(T, a, b);
  // slow in, fast middle, slow out; softer than expo so the second disc keeps up with the first
  return lerp(r0, r1, x < 0.5 ? 8 * x ** 4 : 1 - 8 * (1 - x) ** 4);
};
const wipeSoft = (T: number, a: number, b: number, r0: number, r1 = L.cover) =>
  0.7 + Math.abs(wipeR(T + 1 / 240, a, b, r0, r1) - wipeR(T - 1 / 240, a, b, r0, r1)) * 120 * SHUTTER * 0.16;

const H6 = HOLDS[5];
const CUT = BEAT / 2;
interface Cut { bg: Col; word: string; col: Col; dot?: Col; cond?: boolean; pattern?: boolean; graph?: boolean }
const CUTS: Cut[] = [
  { bg: SURIK, word: 'МОТОЧАСЫ.', col: INK, dot: INK },
  { bg: INK, word: 'ПРОБЕГ.', col: BONE, dot: SURIK },
  { bg: BONE, word: 'МЕСТОПОЛОЖЕНИЕ', col: SINKA, cond: true },
  { bg: SINKA, word: 'МАСЛО.', col: BONE, dot: SURIK },
  { bg: ZHILET, word: 'ЛЮБАЯ', col: INK },
  { bg: ZHILET, word: 'ТЕХНИКА', col: INK, pattern: true },
  { bg: INK, word: 'НА СВЯЗИ.', col: BONE, dot: SURIK, graph: true },
];
export const WORDS = CUTS.map((c) => ({ word: c.word, cond: !!c.cond }));
const cutIndex = (T: number) => Math.max(0, Math.min(CUTS.length - 1, Math.floor((T - H6) / CUT + 1e-6)));

function background(F: Frame, T: number) {
  const { cx, cy, W, H, U } = L;
  if (T <= 1.86) return F.setBase(INK);
  if (T < 2.32) {
    F.setBase(INK);
    F.addDisc(cx, cy, wipeR(T, 1.86, 2.16, dot0()), wipeSoft(T, 1.86, 2.16, dot0()), BONE);
    F.addDisc(cx, cy, wipeR(T, 1.89, 2.24, dot0()), wipeSoft(T, 1.89, 2.24, dot0()), SURIK);
    return;
  }
  if (T < 3.72) return F.setBase(SURIK);
  if (T < 4.02) {
    F.setBase(SURIK);
    const k = 1 / Math.hypot(0.55, 1), soft = 0.14 * U;
    F.setWipe(0.55, -1, lerp(-H * k - soft * 1.3, 0.55 * W * k + soft * 1.3, inOutCubic(range(T, 3.72, 4.02))), soft, BONE);
    return;
  }
  if (T < 5.9) return F.setBase(BONE);
  if (T < 6.16) {
    F.setBase(BONE);
    s3Geom();
    F.addDisc(S3.x, S3.y, wipeR(T, 5.9, 6.16, dot3()), wipeSoft(T, 5.9, 6.16, dot3()), SINKA);
    return;
  }
  if (T <= 8.45) return F.setBase(SINKA);
  if (T <= H6) return F.setBase(INK);
  if (T <= HOLDS[6]) return F.setBase(CUTS[cutIndex(T)].bg);
  if (T < 15.6) {
    F.setBase(INK);
    const x = W * 1.08, r1 = Math.hypot(x, H / 2) + 60;
    F.addDisc(x, cy, wipeR(T, 15.23, 15.5, 0, r1), wipeSoft(T, 15.23, 15.5, 0, r1), BONE);
    F.addDisc(x, cy, wipeR(T, 15.28, 15.58, 0, r1), wipeSoft(T, 15.28, 15.58, 0, r1), SURIK);
    F.clip[0] = x;
    F.clip[1] = cy;
    F.clip[2] = wipeR(T, 15.23, 15.5, 0, r1);
    return;
  }
  F.setBase(SURIK);
}

// ── 1 · ОТСЧЁТ: the dot opens a layered wipe, the wordmark rises with squash and stretch ──
const WM = { u: 1, x0: 0, base: 0 };
function wmGeom() {
  const w = L.portrait ? L.W * 0.88 : Math.min(L.W * 0.8, L.H * 2.35);
  WM.u = w / WORDMARK.width;
  WM.x0 = L.cx - w / 2;
  WM.base = L.cy + 50 * WM.u - L.H * 0.03;
  OUT.wmX0 = WM.x0;
  OUT.wmX1 = WM.x0 + w;
  OUT.wmBase = WM.base;
  OUT.wmU = WM.u;
  OUT.ruleY = WM.base - 100 * WM.u - Math.max(46 * WM.u, 0.085 * L.H);
}
const rise = (T: number, i: number) => (1 - backOut(range(T, 1.98 + i * 0.05, 2.6 + i * 0.05), 1.3)) * 118;
const collapse = (T: number, i: number) => range(T, HOLDS[1] + 0.02 + i * 0.03, HOLDS[1] + 0.19 + i * 0.03);

function letterCentre(i: number, out: Float32Array) {
  const g = TYPE!.wm[i], k = WM.u / TYPE!.wmScale;
  out[0] = WM.x0 + g.ox * k;
  out[1] = WM.base + g.oy * k;
}

function s1(F: Frame, T: number, now: number) {
  if (!TYPE || T < 1.95 || T > HOLDS[1] + 0.3) return;
  wmGeom();
  const u = WM.u, k = u / TYPE.wmScale;
  const inDisc = T < 2.26;
  if (inDisc) {
    F.clip[0] = L.cx;
    F.clip[1] = L.cy;
    F.clip[2] = wipeR(T, 1.89, 2.24, dot0());
  }
  for (let i = 0; i < 6; i++) {
    const x = range(T, 1.98 + i * 0.05, 2.6 + i * 0.05);
    if (x <= 0) continue;
    const lift = rise(T, i) * u;
    const vy = ((rise(T + 1 / 240, i) - rise(T - 1 / 240, i)) * 120 * u) * SHUTTER;
    const stretch = 1 + 0.3 * Math.sin(Math.PI * clamp01(x * 1.6));
    let sx = 1 / Math.sqrt(stretch), sy = stretch;
    const w = range(T, 2.52, 3.4);
    if (w > 0 && w < 1) sx *= 1 + 0.12 * Math.sin((T - 2.52) * 9 - i * 0.9) * Math.sin(Math.PI * w);
    const c = collapse(T, i);
    let a = 1;
    if (c > 0) {
      const e = expoIn(c);
      sx *= 1 - 0.85 * e;
      sy *= 1 - 0.85 * e;
      a = 1 - range(c, 0.6, 1);
    }
    F.glyph(TYPE.wm[i], WM.x0, WM.base + lift, k, sx, sy, INK, a, 0, vy, inDisc ? 2 : 0, WM.base + 4 * u);
  }
  // «ё»: the left dot in ink, the right one — the point of reference — in bone
  const d = WORDMARK.dots;
  const c4 = collapse(T, 4);
  letterCentre(4, tmp);
  for (let j = 0; j < 2; j++) {
    const p = backOut(range(T, 2.45 + j * 0.07, 2.77 + j * 0.07), 2.2);
    let r = d.r * u * p;
    if (j === 1 && T > 3.1) r *= 1 + 0.07 * Math.sin(now * 5.2) * range(T, 3.1, 3.4);
    const x = lerp(WM.x0 + d.x[j] * u, tmp[0], expoIn(c4));
    const y = lerp(WM.base + (d.y - 100) * u, tmp[1], expoIn(c4));
    F.disc2(x, y, r * (1 - 0.7 * expoIn(c4)), j ? BONE : INK, 1 - range(c4, 0.5, 1));
  }
  const rule = expoOut(range(T, 2.62, 3.05)) * (WORDMARK.width / 2) * u;
  F.seg(L.cx - rule, OUT.ruleY, L.cx + rule, OUT.ruleY, 0.6, INK, 0.85 * (1 - range(T, HOLDS[1], HOLDS[1] + 0.12)));
}

// ── 2 · ИСТОЧНИКИ: letters fold into dots; four ways the data reaches the cabinet ──────────
const ROWC: Col[] = [INK, SINKA, SURIK, INK];
const MAP = [0, 1, 2, 3, 2, 3];
function rows() {
  for (let i = 0; i < 4; i++) OUT.rowY[i] = L.portrait ? L.H * (0.39 + 0.12 * i) + 20 : L.H * (0.39 + 0.12 * i);
  OUT.ax = L.portrait ? L.W * 0.1 : L.W * 0.42;
  OUT.bx = L.portrait ? L.W * 0.9 : L.W * 0.92;
}
const rowR = () => Math.max(4.5, 0.0078 * L.U);
const raceT = (T: number, i: number) => range(T, 4.3 + i * 0.07, 5.28 + i * 0.05);

/** Share of the track covered at race progress t: steady stream, sync, offline-then-backlog, one photo. */
function progress(i: number, t: number) {
  if (i === 0) return t;
  if (i === 1) return inOutCubic(t);
  if (i === 2) return t < 0.42 ? 0.42 * outCubic(t / 0.42) : t < 0.68 ? 0.42 : 0.42 + 0.58 * expoOut((t - 0.68) / 0.32);
  return backOut(clamp01((t - 0.55) / 0.45), 1.3);
}

/** Position along row i at race progress t: out[0] = x, out[1] = y. */
function racer(i: number, t: number, out: Float32Array) {
  const q = clamp01((t - 0.55) / 0.45);
  out[0] = lerp(OUT.ax, OUT.bx, progress(i, t));
  out[1] = OUT.rowY[i] - (i === 3 ? 0.075 * L.H * 4 * q * (1 - q) : 0);
}

function s2(F: Frame, T: number) {
  if (!TYPE || T < HOLDS[1] || T > 5.95) return;
  rows();
  wmGeom();
  s3Geom();
  const r = rowR(), ax = OUT.ax, bx = OUT.bx;
  // letters → dots in flight to the row starts
  for (let d = 0; d < 6; d++) {
    const c = collapse(T, d);
    if (c <= 0.5) continue;
    const a = 3.66 + d * 0.025, b = 4.02 + d * 0.025;
    if (T >= b && d < 4) continue;
    if (T >= b) continue;
    letterCentre(d, tmp);
    const f = expoInOut(range(T, a, b)), f2 = expoInOut(range(T + 1 / 240, a, b));
    const ty = OUT.rowY[MAP[d]];
    const mx = lerp(tmp[0], ax, 0.5), my = Math.min(tmp[1], ty) - 0.12 * L.H;
    const x = (1 - f) * (1 - f) * tmp[0] + 2 * (1 - f) * f * mx + f * f * ax;
    const y = (1 - f) * (1 - f) * tmp[1] + 2 * (1 - f) * f * my + f * f * ty;
    const x2 = (1 - f2) * (1 - f2) * tmp[0] + 2 * (1 - f2) * f2 * mx + f2 * f2 * ax;
    const y2 = (1 - f2) * (1 - f2) * tmp[1] + 2 * (1 - f2) * f2 * my + f2 * f2 * ty;
    F.disc2(x, y, r * range(c, 0.5, 1), mix(INK, ROWC[MAP[d]], f), 1, (x2 - x) * 240 * SHUTTER, (y2 - y) * 240 * SHUTTER);
  }
  const out = range(T, HOLDS[2], HOLDS[2] + 0.15);
  OUT.offOn = 0;
  for (let i = 0; i < 4; i++) {
    const y = OUT.rowY[i];
    const vis = range(T, 3.98 + i * 0.05, 4.2 + i * 0.05) * (1 - out);
    if (vis > 0) {
      const p = expoOut(range(T, 3.98 + i * 0.05, 4.4 + i * 0.05));
      F.seg(ax, y, lerp(ax, bx, p), y, 0.6, INK, 0.28 * vis, 7, 0.4);
      F.seg(bx, y - 6, bx, y + 6, 0.6, INK, 0.55 * vis * range(p, 0.9, 1));
      if (!L.portrait) {
        // pictogram of the arrival curve, like an easing chart
        const ix = ax - 0.045 * L.W, bw = 15, bh = 8;
        F.rect(ix, y, bw + 3, bh + 3, 2, INK, 0.3 * vis, 0.5);
        for (let s = 0; s < 14; s++) {
          const y0 = y + bh - 2 * bh * progress(i, s / 14), y1 = y + bh - 2 * bh * progress(i, (s + 1) / 14);
          F.seg(ix - bw + (2 * bw * s) / 14, y0, ix - bw + (2 * bw * (s + 1)) / 14, y1, 0.75, INK, 0.85 * vis);
        }
      }
    }
    if (T < 4.02 + i * 0.025) continue;
    const t = raceT(T, i);
    if (out > 0) {
      // exit: all four fly into one blue dot at the centre of the next scene
      const f = expoInOut(range(T, HOLDS[2] + 0.01 + i * 0.03, 5.9)), f2 = expoInOut(range(T + 1 / 240, HOLDS[2] + 0.01 + i * 0.03, 5.9));
      const mx = bx + 0.04 * L.W, my = lerp(y, S3.y, 0.5) - 0.1 * L.H;
      const x = (1 - f) * (1 - f) * bx + 2 * (1 - f) * f * mx + f * f * S3.x;
      const yy = (1 - f) * (1 - f) * y + 2 * (1 - f) * f * my + f * f * S3.y;
      const x2 = (1 - f2) * (1 - f2) * bx + 2 * (1 - f2) * f2 * mx + f2 * f2 * S3.x;
      const y2 = (1 - f2) * (1 - f2) * y + 2 * (1 - f2) * f2 * my + f2 * f2 * S3.y;
      F.disc2(x, yy, lerp(r, dot3(), f), mix(ROWC[i], SINKA, f), 1, (x2 - x) * 240 * SHUTTER, (y2 - yy) * 240 * SHUTTER);
      continue;
    }
    // packets left along the track by the tracker; the phone's backlog catching up
    if (i === 0) for (let j = 1; j < 8; j++) if (t > j / 8) F.disc2(lerp(ax, bx, j / 8), y, r * 0.42, INK, 0.4);
    if (i === 2 && t > 0.68)
      for (let j = 1; j <= 4; j++) {
        const q = clamp01((t - 0.68 - j * 0.035) / 0.3);
        if (q < 1) F.disc2(lerp(lerp(ax, bx, 0.42), bx, expoOut(q)), y, r * 0.5, SURIK, 0.7 * (1 - q * q));
      }
    if (i === 3 && t > 0.3 && t < 0.58) {
      const q = range(t, 0.3, 0.58);
      F.ring(ax, y, r * (1.2 + 3 * outCubic(q)), 1, INK, 0.7 * (1 - q));
    }
    if (t > 0 && t < 1)
      for (let g = 5; g >= 1; g--) {
        racer(i, raceT(T - g * 0.028, i), tmp);
        F.disc2(tmp[0], tmp[1], r, ROWC[i], 0.28 * (1 - g / 6));
      }
    racer(i, t, tmp);
    racer(i, raceT(T + 1 / 240, i), tmp2);
    const vx = (tmp2[0] - tmp[0]) * 240 * SHUTTER, vy = (tmp2[1] - tmp[1]) * 240 * SHUTTER;
    if (i === 2 && t > 0.42 && t < 0.68) {
      F.ring(tmp[0], tmp[1], r - 0.8, 1.3, SURIK, 1);
      OUT.offOn = 1;
      OUT.offX = tmp[0];
      OUT.offY = tmp[1];
    } else F.disc2(tmp[0], tmp[1], r * (1 + (t >= 1 ? 0.06 * Math.sin(F.time * 4 + i) : 0)), ROWC[i], 1, vx, vy);
  }
}

// ── 3 · ПОКАЗАНИЯ: one shape becomes each reading in turn, with onion skins ────────────────
const S3 = { x: 0, y: 0, R: 0 };
function s3Geom() {
  S3.R = L.portrait ? L.W * 0.19 : L.U * 0.15;
  S3.x = L.cx;
  S3.y = L.cy - (L.portrait ? 0.07 : 0.035) * L.H;
  OUT.s3x = S3.x;
  OUT.s3y = S3.y;
  OUT.s3R = S3.R;
}
const MORPH_T = [6.45, 6.95, 7.45, 7.93];
const MORPH_D = 0.42;
const morphE = (T: number, j: number) => backOut(range(T, MORPH_T[j], MORPH_T[j] + MORPH_D), 1.5);

function s3(F: Frame, T: number) {
  if (T < 5.88 || T > 8.62) return;
  s3Geom();
  const { x, y } = S3;
  let j = -1;
  for (let m = 0; m < 4; m++) if (T >= MORPH_T[m]) j = m;
  const a = j < 0 ? 0 : j, b = j < 0 ? 0 : j + 1, t = j < 0 ? 0 : morphE(T, j);
  OUT.reading = j + 1;
  OUT.readingPrev = Math.max(0, j);
  OUT.readingT = j < 0 ? 1 : range(T, MORPH_T[j], MORPH_T[j] + 0.3);
  const g = backOut(range(T, 5.92, 6.3), 1.3);
  let R = lerp(dot3(), S3.R, g);
  R *= 1 - 0.06 * smooth(range(T, HOLDS[3], 8.45));
  const fade = 1 - range(T, 8.45, 8.6);
  const vis = range(T, 6.0, 6.3) * (1 - range(T, HOLDS[3], HOLDS[3] + 0.2));
  if (vis > 0) {
    F.seg(0, y, L.W, y, 0.5, BONE, 0.14 * vis);
    F.seg(x, 0, x, L.H, 0.5, BONE, 0.14 * vis);
    F.ring(x, y, S3.R * 2.3, 0.5, BONE, 0.14 * vis);
  }
  if (j >= 0 && t > 0 && range(T, MORPH_T[j], MORPH_T[j] + MORPH_D) < 1)
    for (let k = 1; k <= 4; k++) F.morph(x, y, R, a, b, morphE(T - k * 0.05, j), 0.9, SURIK, 0.6 * (1 - k / 5) * fade);
  F.morph(x, y, R, a, b, t, 0, BONE, fade);
  const small = b === 4 ? 1 - range(T, MORPH_T[3], MORPH_T[3] + 0.25) : 1;
  for (let k = 0; k < 12; k++) {
    const p = backOut(range(T, 6.02 + k * 0.022, 6.32 + k * 0.022), 1.6);
    if (p <= 0) continue;
    const an = k * 30 * DEG, rr = S3.R * (L.portrait ? 1.8 : 2.0);
    F.morph(x + Math.sin(an) * rr, y - Math.cos(an) * rr, S3.R * 0.12 * p, a, b === 4 ? 3 : b, t, 0, BONE, small * fade);
  }
  const dp = backOut(range(T, MORPH_T[3] + 0.2, MORPH_T[3] + 0.5), 1.8);
  if (dp > 0) F.disc2(x + 0.5 * R, y - 0.866 * R, 0.381 * R * dp, SURIK, fade);
}

// ── 4–5 · ТЕХНИКА → БЕЗ СВЯЗИ: the ring turns into the facet shell, the machine, then the map ─
interface Key { t: number; tx: number; ty: number; tz: number; d: number; az: number; el: number; fov: number }
const K = (t: number, tx: number, ty: number, tz: number, d: number, az: number, el: number, fov: number): Key => ({ t, tx, ty, tz, d, az: az * DEG, el: el * DEG, fov: fov * DEG });
const KEYS: Key[] = [
  K(8.45, 0, 0, 0, 6, 0, 0, 34),
  K(9.2, 0, 0.05, 0, 5.4, 20, 23, 38),
  K(10.78, 0, 0.02, 0, 4.7, 40, 15, 40),
  K(11.6, 3.0, -0.8, -0.8, 10.6, 6, 38, 36),
  K(13.36, 3.8, -0.8, -1.1, 10.2, 11, 40, 36),
];
function camera(F: Frame, T: number) {
  let i = 0;
  while (i < KEYS.length - 2 && T > KEYS[i + 1].t) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const s = inOutCubic(range(T, a.t, b.t));
  F.cam.set(lerp(a.tx, b.tx, s), lerp(a.ty, b.ty, s), lerp(a.tz, b.tz, s), lerp(a.d * pm(i), b.d * pm(i + 1), s), lerp(a.az, b.az, s), lerp(a.el, b.el, s), lerp(a.fov, b.fov, s), L.W, L.H);
}
/** Portrait framing: the machine needs a longer lens distance than the map. */
const pm = (i: number) => (L.portrait ? (i <= 2 ? 2.25 : 1.6) : 1);

function compose(out: Float32Array, tx: number, ty: number, tz: number, rx: number, ry: number, s: number) {
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry);
  // R = Ry · Rx
  out[0] = cy * s; out[1] = 0; out[2] = -sy * s; out[3] = 0;
  out[4] = sy * sx * s; out[5] = cx * s; out[6] = cy * sx * s; out[7] = 0;
  out[8] = sy * cx * s; out[9] = -sx * s; out[10] = cy * cx * s; out[11] = 0;
  out[12] = tx; out[13] = ty; out[14] = tz; out[15] = 1;
}
function apply(m: Float32Array, x: number, y: number, z: number, out: Float32Array) {
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
  out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
}

const RT: Route = route();
function routePos(u: number, out: Float32Array) {
  const s = clamp01(u) * RT.length;
  let i = 1;
  while (i < RT.cum.length - 1 && RT.cum[i] < s) i++;
  const k = (s - RT.cum[i - 1]) / Math.max(1e-6, RT.cum[i] - RT.cum[i - 1]);
  out[0] = RT.pts[i - 1][0] + (RT.pts[i][0] - RT.pts[i - 1][0]) * k;
  out[1] = RT.pts[i - 1][1] + (RT.pts[i][1] - RT.pts[i - 1][1]) * k;
}
const machineU = (T: number) =>
  T < 11.45 ? 0 : T < 12.5 ? coverU * inOutSine(range(T, 11.45, 12.5)) : lerp(coverU, Math.min(1, coverU + 0.1), outCubic(range(T, 12.5, 12.95)));
const STORE = 0.055;

const scr = new Float32Array(3);
const w3 = new Float32Array(3);
const w3b = new Float32Array(3);
export let quality = 1;
export const setQuality = (q: number) => (quality = q);

function s45(F: Frame, T: number, now: number) {
  if (T < 8.4 || T > H6 + 1e-4) return;
  s3Geom();
  camera(F, T);
  const cam = F.cam, P = F.part;
  // ring world size so the facet torus lands exactly on the flat logo ring at the cut
  const projPx = cam.projPx;
  const d0 = KEYS[0].d * pm(0);
  const r0 = (S3.R * 0.94 * d0) / projPx;
  const grow = lerp(1, 2.2, inOutCubic(range(T, 8.5, 9.2)));
  const e = inOutCubic(range(T, 8.5, 9.25));
  const ty0 = ((L.cy - S3.y) / projPx) * d0 * (1 - e);
  compose(P.ring, 0, ty0, 0, -52 * DEG * e, 78 * DEG * e + 0.12 * smooth(range(T, 8.5, 10.78)), (r0 * grow) / 0.62);
  compose(P.exc, SITE[0], SITE[1], SITE[2], 0, 0.06 * Math.sin(now * 0.35) * range(T, 10.2, 10.78), 1);
  const facets = T < 11.6;
  if (facets) {
    P.on = true;
    P.T = T;
    P.appear = lerp(-0.2, 1.2, range(T, 8.45, 8.72));
    P.fly0 = 9.1;
    P.spread = 0.55;
    P.dur = 0.9;
    P.gone = range(T, 10.84, 11.5);
    apply(P.exc, BEACON[0], BEACON[1], BEACON[2], w3);
    P.goneTo[0] = w3[0];
    P.goneTo[1] = w3[1];
    P.goneTo[2] = w3[2];
    P.count = Math.max(200, Math.floor(1e9 * quality));
  }
  // the tracker beacon: the logo's index dot, carried through the whole sequence
  const u = machineU(T);
  routePos(u, tmp);
  const gx = tmp[0] + SITE[0], gy = SITE[1] + 0.06, gz = tmp[1] + SITE[2];
  let rw: number;
  // the dot keeps logo proportions on the flat ring, then shrinks to a tracker beacon as the shell turns 3D
  const shrink = lerp(1, 0.3, inOutCubic(range(T, 8.5, 9.1)));
  if (T < 9.15) {
    apply(P.ring, 0.62 * 0.5, 0.62 * 0.866, 0, w3);
    rw = 0.381 * 0.62 * Math.hypot(P.ring[0], P.ring[1], P.ring[2]) * shrink;
  } else if (T < 9.95) {
    apply(P.ring, 0.62 * 0.5, 0.62 * 0.866, 0, w3);
    apply(P.exc, BEACON[0], BEACON[1], BEACON[2], w3b);
    const f = inOutCubic(range(T, 9.15, 9.95));
    const lift = 0.9 * 4 * f * (1 - f);
    w3[0] = lerp(w3[0], w3b[0], f);
    w3[1] = lerp(w3[1], w3b[1], f) + lift;
    w3[2] = lerp(w3[2], w3b[2], f);
    rw = lerp(0.381 * 0.62 * Math.hypot(P.ring[0], P.ring[1], P.ring[2]) * shrink, 0.075, f);
  } else {
    apply(P.exc, BEACON[0], BEACON[1], BEACON[2], w3);
    const f = inOutCubic(range(T, 10.95, 11.45));
    w3[0] = lerp(w3[0], gx, f);
    w3[1] = lerp(w3[1], gy, f);
    w3[2] = lerp(w3[2], gz, f);
    rw = 0.075;
  }
  cam.project(w3[0], w3[1], w3[2], scr);
  const sx = scr[0], sy = scr[1];
  const rpx = Math.max(3.5, (rw * projPx) / scr[2]);
  const dotIn = range(T, 8.45, 8.5);
  if (scr[2] > 0) {
    F.disc2(sx, sy, rpx, SURIK, dotIn);
    if (T > 9.95)
      for (let i = 0; i < 2; i++) {
        const ph = (now * 0.7 + i * 0.5) % 1;
        F.ring(sx, sy, rpx * (1.6 + 4.5 * ph), 0.9, SURIK, 0.55 * (1 - ph) * (1 - ph));
      }
  }
  // the map
  if (T > 10.86) {
    const Pt = F.pts;
    Pt.on = true;
    Pt.site[0] = SITE[0];
    Pt.site[1] = SITE[1];
    Pt.site[2] = SITE[2];
    Pt.rise[0] = 0;
    Pt.rise[1] = 0;
    Pt.rise[2] = 18 * inOutCubic(range(T, 10.95, 12.0));
    Pt.mast[0] = MAST[0];
    Pt.mast[1] = MAST[2];
    Pt.mast[2] = COVERAGE;
    Pt.machine[0] = tmp[0];
    Pt.machine[1] = tmp[1];
    Pt.wave = T > 12.5 ? (T - 12.5) * 7 : -1;
    Pt.alpha = 1;
    const vis = range(T, 11.1, 11.5);
    // mast with coverage pulses
    const mx = MAST[0] + SITE[0], mz = MAST[2] + SITE[2];
    cam.project(mx, SITE[1], mz, w3b);
    const bx = w3b[0], by = w3b[1];
    cam.project(mx, SITE[1] + MAST_H * range(T, 11.3, 11.8), mz, w3b);
    F.seg(bx, by, w3b[0], w3b[1], 1, BONE, 0.75 * vis);
    F.disc2(w3b[0], w3b[1], 3.5, SURIK, vis);
    for (let i = 0; i < 3; i++) {
      const ph = (now * 0.55 + i / 3) % 1;
      F.ring(w3b[0], w3b[1], 5 + 46 * ph, 0.8, BONE, 0.45 * (1 - ph) * vis);
    }
    const topX = w3b[0], topY = w3b[1];
    // points stored in the tracker while there is no network; sent to the mast on arrival
    let stored = 0;
    for (let j = 0; ; j++) {
      const uj = 0.04 + j * STORE;
      if (uj >= coverU) break;
      if (u <= uj) break;
      routePos(uj, tmp2);
      const px = tmp2[0] + SITE[0], pz = tmp2[1] + SITE[2];
      const f = expoInOut(range(T, 12.52 + j * 0.045, 12.95 + j * 0.045));
      if (f >= 1) continue;
      if (f <= 0) stored++;
      cam.project(px, SITE[1] + 0.05, pz, w3b);
      const x0 = w3b[0], y0 = w3b[1];
      const mxs = lerp(x0, topX, 0.5), mys = Math.min(y0, topY) - 0.12 * L.H;
      const x = (1 - f) * (1 - f) * x0 + 2 * (1 - f) * f * mxs + f * f * topX;
      const y = (1 - f) * (1 - f) * y0 + 2 * (1 - f) * f * mys + f * f * topY;
      F.rect(x, y, 4.4, 4.4, 1.2, SURIK, vis);
    }
    OUT.stored = stored;
    OUT.inCover = u >= coverU - 1e-4;
  }
  OUT.tagOn = T > 11.45 && T <= H6 ? 1 : 0;
  OUT.tagX = sx;
  OUT.tagY = sy;
}

// ── 6 · РИТМ: kinetic type cut on eighth notes ─────────────────────────────────────────────
function s6(F: Frame, T: number, now: number) {
  if (!TYPE || T <= H6 || T > 15.52) return;
  const j = cutIndex(T), c = CUTS[j], w = TYPE.words[c.word];
  if (!w) return;
  const lt = T - (H6 + j * CUT);
  if (c.pattern) return pattern(F, w, lt);
  let k = (L.W * (L.portrait ? 0.9 : 0.84)) / w.adv, sy = 1;
  if (c.cond) sy = Math.min(1.7, (L.H * (L.portrait ? 0.26 : 0.4)) / (w.cap * k));
  else k = Math.min(k, (L.H * 0.3) / w.cap);
  const push = 1 + 0.035 * range(lt, 0, CUT);
  k *= j === 6 ? 1 : push;
  const width = w.adv * k, cap = w.cap * k * sy;
  const x0 = L.cx - width / 2, base = L.cy + cap / 2;
  let dx = 0, vx = 0, mode = 0;
  if (j === 6 && T > HOLDS[6]) {
    const e = expoIn(range(T, HOLDS[6], HOLDS[6] + 0.22));
    dx = -e * 0.8 * L.W;
    vx = -(expoIn(range(T + 1 / 240, HOLDS[6], HOLDS[6] + 0.22)) - e) * 240 * 0.8 * L.W * SHUTTER;
    mode = 4;
  }
  if (c.graph) {
    const p = expoOut(range(lt, 0.04, 0.7)) * (1 - range(T, HOLDS[6], HOLDS[6] + 0.15));
    const n = 12, gx0 = L.W * 0.1, gx1 = L.W * 0.9, gy0 = L.H * 0.86, gy1 = L.H * 0.16;
    for (let s = 0; s < n; s++) {
      const f0 = s / n, f1 = (s + 1) / n;
      if (f0 >= p) break;
      const xa = lerp(gx0, gx1, f0), xb = lerp(gx0, gx1, Math.min(f1, p)), ya = lerp(gy0, gy1, f0), yb = lerp(gy0, gy1, f1);
      F.seg(xa, ya, xb, ya, 0.8, BONE, 0.3);
      if (f1 <= p) F.seg(xb, ya, xb, yb, 0.8, BONE, 0.3);
    }
  }
  for (let i = 0; i < w.glyphs.length; i++) {
    const g = w.glyphs[i];
    if (!g) continue;
    // on the cut the word is already there and only settles: the reference's cuts are 14 frames long
    const e = expoOut(range(lt, i * 0.006, i * 0.006 + 0.09));
    const lift = (1 - e) * cap * 0.14;
    const isDot = w.text[i] === '.';
    let s = 1;
    if (isDot && j === 6 && T >= HOLDS[6] - 1e-3) s = 1 + 0.12 * Math.max(0, Math.sin(now * 5.4));
    F.glyph(g, x0 + w.pens[i] * k + dx, base + lift, k, s, sy * s, isDot && c.dot ? c.dot : c.col, 1, vx, 0, mode);
  }
}

function pattern(F: Frame, w: Word, lt: number) {
  const cap = L.H * (L.portrait ? 0.07 : 0.105), k = cap / w.cap, rowH = cap * 1.32, gap = cap * 0.8;
  const ww = w.adv * k + gap;
  const n = Math.ceil(L.H / rowH) + 1, mid = Math.floor(n / 2);
  for (let r = 0; r < n; r++) {
    const dir = r % 2 ? -1 : 1, sp = 0.45 * L.W * dir;
    const base = (r + 0.78) * rowH - (n * rowH - L.H) / 2;
    let off = (lt * sp + r * 137) % ww;
    if (off > 0) off -= ww;
    for (let x = off - ww; x < L.W + ww; x += ww)
      for (let i = 0; i < w.glyphs.length; i++) {
        const g = w.glyphs[i];
        if (g) F.glyph(g, x + w.pens[i] * k, base, k, 1, 1, INK, 1, sp * SHUTTER, 0, r === mid ? 0 : 1);
      }
  }
}

// ── 7 · СТАРТ: the symbol counts itself in, the wordmark slides in, the product follows ─────
const S7 = { u: 1, x0: 0, base: 0, symX: 0, symY: 0, symR: 0 };
function lockGeom() {
  const lw = 734;
  const u = L.portrait ? (L.W * 0.76) / lw : Math.min((L.W * 0.44) / lw, (L.H * 0.085) / 100);
  const left = L.cx - (lw * u) / 2, mid = L.H * (L.portrait ? 0.135 : 0.185);
  S7.u = u;
  S7.symR = 40 * u;
  S7.symX = left + 48.6 * u;
  S7.symY = mid;
  S7.x0 = left + 137.2 * u;
  S7.base = mid + 50 * u;
  OUT.lockBottom = S7.base + 18 * u;
  OUT.lockX = S7.x0;
}
const CONF = Array.from({ length: 46 }, (_, i) => {
  const r = Math.sin(i * 91.7) * 43758.5453;
  const f = (n: number) => { const v = Math.sin((i + 1) * n) * 10000; return v - Math.floor(v); };
  void r;
  return { a: f(12.9898) * Math.PI * 2, d: 0.16 + f(78.233) * 0.5, s: 1.3 + f(39.35) * 2.6, c: Math.floor(f(7.1) * 4), ph: f(3.3) * 6.28 };
});
const CONF_C: Col[] = [INK, BONE, SINKA, ZHILET];

function s7(F: Frame, T: number, now: number) {
  if (!TYPE || T < 15.3) return;
  lockGeom();
  const ax = L.cx, ay = L.cy - 0.04 * L.H;
  const rp = range(T, 15.45, 16.05);
  if (rp > 0 && rp < 1) F.ring(ax, ay, lerp(0.05, 0.8, expoOut(rp)) * L.U, 1.4, BONE, 0.85 * (1 - rp));
  const burst = expoOut(range(T, 15.48, 16.5));
  for (const c of CONF) {
    const dd = c.d * L.U * burst;
    const x = ax + Math.cos(c.a) * dd + Math.sin(now * 0.4 + c.ph) * 6;
    const y = ay + Math.sin(c.a) * dd * 0.8 + Math.cos(now * 0.33 + c.ph) * 5;
    // the confetti steps back once the product panel is up
    F.disc2(x, y, c.s, CONF_C[c.c], range(T, 15.48, 15.6) * lerp(0.9, 0.3, range(T, 16.5, 16.9)));
  }
  const m = expoInOut(range(T, 16.02, 16.42));
  const R = lerp(0.1 * L.U, S7.symR, m), cx = lerp(ax, S7.symX, m), cy = lerp(ay, S7.symY, m);
  for (let k = 0; k < 12; k++) {
    const p = backOut(range(T, 15.55 + k * 0.026, 15.82 + k * 0.026), 1.8);
    if (p <= 0) continue;
    F.ring(cx, cy, R * (0.9 + 0.1 * p), 0.2143 * R, INK, clamp01(p * 2), (30 + 30 * k) * DEG, 30.6 * DEG);
  }
  const dp = backOut(range(T, 15.86, 16.16), 1.8);
  if (dp > 0) {
    const px = cx + 0.5 * R, py = cy - 0.866 * R;
    F.disc2(px, py, 0.5238 * R * Math.min(1, dp * 1.2), SURIK);
    const pulse = T >= HOLDS[7] - 1e-3 ? 1 + 0.06 * Math.sin(now * 5.2) : 1;
    F.disc2(px, py, 0.381 * R * dp * pulse, BONE);
  }
  const u = S7.u, k = u / TYPE.wmScale;
  for (let i = 0; i < 6; i++) {
    const a = 16.06 + i * 0.035;
    const e = expoOut(range(T, a, a + 0.44));
    if (e <= 0) continue;
    const dx = (1 - e) * 0.55 * L.W;
    const vx = -(expoOut(range(T + 1 / 240, a, a + 0.44)) - e) * 240 * 0.55 * L.W * SHUTTER;
    F.glyph(TYPE.wm[i], S7.x0 + dx, S7.base, k, 1, 1, INK, range(e, 0, 0.25), vx, 0);
  }
  const d = WORDMARK.dots;
  for (let j = 0; j < 2; j++) {
    const p = backOut(range(T, 16.42 + j * 0.06, 16.7 + j * 0.06), 2);
    F.disc2(S7.x0 + d.x[j] * u, S7.base + (d.y - 100) * u, d.r * u * p, j ? BONE : INK);
  }
}

export function draw(F: Frame, T: number, now: number) {
  F.time = now;
  background(F, T);
  s1(F, T, now);
  s2(F, T);
  s3(F, T);
  s45(F, T, now);
  s6(F, T, now);
  s7(F, T, now);
}
