/**
 * The film's choreography as pure functions of film time T (seconds).
 * Shared by the WebGL stage and the DOM type layer so both always agree on where things are.
 */
import { m4, v3, type M4, type V3 } from './gl/core';
import { routeAt, type Route } from './gl/geometry';
import { anticipate, bounce, clamp, inCubic, inOutCubic, inOutSine, lerp, ramp, range, settle, smooth } from './time';

export const DEG = Math.PI / 180;
export const R_RING = 0.62;
export const R_DOT = 0.236;
export const R_KNOCK = 0.325;
export const TORUS_SCALE = 2.29;
/** Excavator and terrain share this offset so the machine stands on the route start. */
export const SITE: V3 = [-0.6, -0.8, 0];
export const BEACON: V3 = [0.33, 1.53, 0.31];
export const MAST_H = 1.7;

const A0 = 30 * DEG;
const TAU = Math.PI * 2;

// ── ring ────────────────────────────────────────────────
export interface RingState {
  on: boolean;
  scale: number;
  rx: number;
  ry: number;
  a0: number;
  a1: number;
  dissolve: number;
}

const orbit1 = (T: number) => A0 + TAU * settle(range(T, 1.52, 2.55), 0.035);
const orbit6 = (T: number) => A0 + TAU * settle(range(T, 17.62, 18.35), 0.035);

/** Three-quarter pose of the shell (solved against the camera keys below: n·v ≈ 0.6, diagonal on screen). */
const SHELL_RX = -52 * DEG;
const SHELL_RY = 78 * DEG;

export function ringState(T: number): RingState {
  if (T >= 17.3) {
    return { on: T >= 17.62, scale: 1, rx: 10 * DEG, ry: -22 * DEG, a0: A0, a1: orbit6(T), dissolve: -1 };
  }
  const toDial = anticipate(range(T, 3.5, 4.65), 0.15, 0.06);
  const toShell = anticipate(range(T, 6.9, 8.15), 0.07, 0.035);
  const scale = 1 + 0.35 * settle(range(T, 3.6, 4.65), 0.06) - 0.035 * Math.sin(Math.PI * range(T, 3.5, 3.72)) + (TORUS_SCALE - 1.35) * inOutCubic(range(T, 6.95, 8.15));
  return {
    on: T >= 1.52 && T < 8.4,
    scale,
    rx: lerp(10 * DEG, 0, toDial) + SHELL_RX * toShell,
    ry: lerp(-22 * DEG, 0, toDial) + SHELL_RY * toShell + 0.1 * ramp(T, 7.7, 8.7),
    a0: A0,
    a1: T < 2.6 ? orbit1(T) : A0 + TAU,
    dissolve: T < 7.3 ? -1 : lerp(-0.12, 1.05, inOutSine(range(T, 7.3, 8.35))),
  };
}

export function ringModel(s: RingState, out: M4 = m4.identity()): M4 {
  return m4.compose(out, [0, 0, 0], s.rx, s.ry, 0, s.scale);
}

// ── the index dot ───────────────────────────────────────
export interface DotState {
  on: boolean;
  pos: V3;
  axis: V3;
  stretch: number;
  radius: number;
  glow: number;
  gold: number;
  onRing: boolean;
}

interface Local {
  p: [number, number];
  ax: [number, number];
  st: number;
  pop: number;
}

function angleOnRing(T: number): number {
  let a = T < 2.6 ? orbit1(T) : A0 + TAU;
  a -= A0 * settle(range(T, 3.9, 4.7), 0.1);
  return a;
}

function dotLocal(T: number): Local {
  if (T >= 17.3) {
    const a = T < 17.62 ? A0 : orbit6(T);
    const speed = Math.abs(orbit6(T + 0.01) - orbit6(T - 0.01)) / 0.02;
    return { p: [R_RING * Math.sin(a), R_RING * Math.cos(a)], ax: [Math.cos(a), -Math.sin(a)], st: 1 + clamp(speed * 0.022, 0, 0.26), pop: settle(range(T, 17.45, 17.72), 0.25) };
  }
  const pop = settle(range(T, 0.25, 0.52), 0.22);
  if (T < 0.58) return { p: [0, 0.6 + 0.08 * Math.sin(0.5 * Math.PI * range(T, 0.4, 0.58))], ax: [0, 1], st: 1 - 0.1 * Math.sin(Math.PI * range(T, 0.4, 0.58)), pop };
  if (T < 0.92) {
    const x = range(T, 0.58, 0.92);
    return { p: [0, 0.68 * (1 - x * x)], ax: [0, 1], st: 1 + 0.3 * x, pop };
  }
  if (T < 1.32) {
    const x = range(T, 0.92, 1.32);
    return { p: [0, bounce(x, 0.17, 2)], ax: [0, 1], st: 1 - 0.36 * Math.exp(-4 * x) * Math.cos(3 * Math.PI * x), pop };
  }
  const target: [number, number] = [R_RING * Math.sin(A0), R_RING * Math.cos(A0)];
  if (T < 1.52) {
    const x = range(T, 1.32, 1.53);
    const e = anticipate(x, 0.16, 0.05);
    return { p: [target[0] * e, target[1] * e], ax: [Math.sin(A0), Math.cos(A0)], st: 1 + 0.12 * Math.sin(Math.PI * x), pop };
  }
  const a = angleOnRing(T);
  const speed = Math.abs(angleOnRing(T + 0.01) - angleOnRing(T - 0.01)) / 0.02;
  return { p: [R_RING * Math.sin(a), R_RING * Math.cos(a)], ax: [Math.cos(a), -Math.sin(a)], st: 1 + clamp(speed * 0.022, 0, 0.28), pop };
}

function bez(a: V3, b: V3, c: V3, d: V3, t: number): V3 {
  const it = 1 - t;
  const k = [it * it * it, 3 * it * it * t, 3 * it * t * t, t * t * t];
  return [0, 1, 2].map((i) => a[i] * k[0] + b[i] * k[1] + c[i] * k[2] + d[i] * k[3]) as V3;
}

export const excModel = (() => m4.compose(m4.identity(), SITE, 0, 0, 0, 1))();
export const beaconWorld = (): V3 => v3.add(BEACON, SITE);
/** The dot shrinks to tracker size while the ring turns into the shell, so it stops hiding the formation. */
const DOT_SHELL = 0.42;
const dotShrink = (T: number) => lerp(1, DOT_SHELL, inOutCubic(range(T, 7.0, 8.15)));

export function machineU(T: number) {
  return inOutSine(range(T, 12.35, 14.25));
}

/** Site-space ground point of the machine on the route (y = 0: the route runs in a flattened valley). */
export function machineSite(r: Route, u: number): V3 {
  const [x, z] = routeAt(r, u);
  return [x, 0, z];
}

export function dotState(T: number, r: Route | null): DotState {
  const off: DotState = { on: false, pos: [0, 0, 0], axis: [0, 1, 0], stretch: 1, radius: 0, glow: 0, gold: 0, onRing: false };
  if (T < 0.25 || (T >= 15.4 && T < 17.45)) return off;
  if (T < 9.05 || T >= 17.3) {
    const rs = ringState(T);
    const m = ringModel(rs);
    const l = dotLocal(T);
    const pos = m4.transform(m, [l.p[0], l.p[1], 0]);
    const tip = m4.transform(m, [l.p[0] + l.ax[0], l.p[1] + l.ax[1], 0]);
    const shrink = T < 17.3 ? dotShrink(T) : 1;
    return { on: true, pos, axis: v3.norm(v3.sub(tip, pos)), stretch: l.st, radius: R_DOT * rs.scale * l.pop * shrink, glow: 0.42 + 0.5 * (1 - shrink), gold: 0, onRing: true };
  }
  const B = beaconWorld();
  if (T < 9.9) {
    const x = range(T, 9.05, 9.9);
    const e = anticipate(x, 0.08, 0.05);
    const P0 = m4.transform(ringModel(ringState(T)), [0, R_RING, 0]);
    const p = bez(P0, v3.add(P0, [0.2, 0.9, 0.4]), v3.add(B, [0, 0.9, 0]), B, e);
    const p2 = bez(P0, v3.add(P0, [0.2, 0.9, 0.4]), v3.add(B, [0, 0.9, 0]), B, Math.min(1, e + 0.02));
    return { on: true, pos: p, axis: v3.norm(v3.sub(p2, p)), stretch: 1 + 0.25 * Math.sin(Math.PI * x), radius: lerp(R_DOT * TORUS_SCALE * DOT_SHELL, 0.085, inOutCubic(x)), glow: lerp(0.9, 2.6, x), gold: 0, onRing: false };
  }
  if (T < 11.0) {
    const x = range(T, 9.9, 10.3);
    return { on: true, pos: B, axis: [0, 1, 0], stretch: 1 - 0.3 * Math.exp(-5 * x) * Math.cos(3 * Math.PI * x) * (x > 0 ? 1 : 0), radius: 0.085, glow: 2.6, gold: 0, onRing: false };
  }
  const G = v3.add(SITE, [0, 0.075, 0]);
  if (T < 12.05) {
    const x = range(T, 11.0, 11.75);
    const land = range(T, 11.75, 12.05);
    const p: V3 = [lerp(B[0], G[0], x) + 0.12 * Math.sin(Math.PI * x), lerp(B[1], G[1], x * x) + 0.25 * Math.sin(Math.PI * x) * (1 - x), lerp(B[2], G[2], x)];
    const st = x < 1 ? 1 + 0.2 * x : 1 - 0.34 * Math.exp(-4 * land) * Math.cos(3 * Math.PI * land);
    return { on: true, pos: p, axis: [0, 1, 0], stretch: st, radius: lerp(0.085, 0.075, x), glow: 2.2, gold: 0, onRing: false };
  }
  const u = machineU(T);
  const site = r ? machineSite(r, u) : ([0, 0, 0] as V3);
  const ground = v3.add(v3.add(site, SITE), [0, 0.075, 0]);
  if (T < 14.8) {
    const ahead = r ? v3.add(machineSite(r, Math.min(1, u + 0.01)), SITE) : ground;
    const dir = v3.norm(v3.sub(v3.add(ahead, [0, 0.075, 0]), ground));
    const spd = (machineU(T + 0.01) - machineU(T - 0.01)) / 0.02;
    return { on: true, pos: ground, axis: v3.len(dir) > 0 ? dir : [1, 0, 0], stretch: 1 + clamp(spd * 0.25, 0, 0.18), radius: 0.075, glow: 2.2, gold: 0, onRing: false };
  }
  const x = range(T, 14.82, 15.4);
  return {
    on: true,
    pos: v3.add(ground, [0, -0.05 * Math.sin(Math.PI * Math.min(1, x / 0.25)) + 2.8 * inCubic(x), 0]),
    axis: [0, 1, 0],
    stretch: 1 + 0.3 * inCubic(x),
    radius: lerp(0.075, 0.12, x),
    glow: 2.2,
    gold: smooth(range(T, 14.9, 15.3)),
    onRing: false,
  };
}

// ── camera ──────────────────────────────────────────────
export interface Cam {
  target: V3;
  dist: number;
  az: number;
  el: number;
  fov: number;
  sx: number;
  sy: number;
}
/** dm, syM, azM: portrait-only distance multiplier, vertical view centre and azimuth offset (degrees). */
type Key = Cam & { t: number; dm: number; syM: number; azM: number };
const K = (t: number, target: V3, dist: number, az: number, el: number, fov: number, sx: number, sy: number, dm: number, syM: number, azM = 0): Key => ({ t, target, dist, az: az * DEG, el: el * DEG, fov: fov * DEG, sx, sy, dm, syM, azM: azM * DEG });
const KEYS: Key[] = [
  K(0, [0, 0, 0], 3.6, -7, 2, 30, 0.46, -0.02, 1.9, 0.36),
  K(2.6, [0, 0, 0], 4.2, 0, 4, 30, 0.47, -0.03, 1.95, 0.38),
  K(3.5, [0, 0, 0], 4.2, 1, 4, 30, 0.47, -0.03, 1.95, 0.38),
  // the dial: whole bezel and the index dot in frame, a slow push-in while the wheels count
  K(4.7, [0, 0, 0], 4.75, 0, 0, 30, 0.33, -0.055, 2.3, 0.42),
  K(6.8, [0, 0, 0], 4.6, 0, 0, 30, 0.33, -0.055, 2.3, 0.42),
  // the shell: wider lens and a three-quarter angle, so near and far facets differ in scale
  K(8.25, [0, 0.05, 0], 5.3, 18, 24, 38, 0.2, -0.02, 2.15, 0.34),
  K(8.9, [0, 0.05, 0], 5.15, 22, 22, 38, 0.2, -0.02, 2.15, 0.34),
  // the machine: low hero angle, slow orbit round the front quarter
  K(10.1, [0, 0.02, 0], 4.75, 33, 14, 40, 0.27, -0.05, 2.3, 0.36),
  K(11.0, [0, 0.02, 0], 4.6, 50, 16, 40, 0.27, -0.05, 2.3, 0.36),
  // on a phone the route turns into depth: the machine drives up the screen, into the coverage
  K(12.5, [3.0, -0.8, -0.5], 11, 4, 47, 34, 0.1, -0.14, 1.3, 0.4, -58),
  K(14.8, [3.8, -0.8, -0.9], 10.6, 9, 49, 34, 0.1, -0.14, 1.3, 0.4, -58),
  K(15.4, [5.8, 0.5, -1.9], 8.5, 9, 22, 34, 0.1, -0.05, 1.55, 0.2, -58),
  K(17.3, [0, 0, 0], 4.7, 0, 4, 30, 0.5, -0.02, 1.95, 0.38),
  K(19.0, [0, 0, 0], 4.7, 0, 4, 30, 0.5, -0.02, 1.95, 0.38),
];

function tangents(vals: number[], ts: number[]): number[] {
  const n = vals.length;
  const d = vals.slice(1).map((v, i) => (v - vals[i]) / (ts[i + 1] - ts[i]));
  return vals.map((_, i) => {
    if (i === 0 || i === n - 1) return 0;
    if (d[i - 1] * d[i] <= 0) return 0;
    return ((d[i - 1] + d[i]) / 2) * 0.9;
  });
}

const channels = ['dist', 'az', 'el', 'fov', 'sx', 'sy', 'dm', 'syM', 'azM', 't0', 't1', 't2'] as const;
const series: Record<string, { v: number[]; m: number[] }> = {};
{
  const ts = KEYS.map((k) => k.t);
  for (const c of channels) {
    const v = KEYS.map((k) => (c === 't0' ? k.target[0] : c === 't1' ? k.target[1] : c === 't2' ? k.target[2] : (k as any)[c]));
    series[c] = { v, m: tangents(v, ts) };
  }
}

function sample(c: string, T: number): number {
  const { v, m } = series[c];
  if (T <= KEYS[0].t) return v[0];
  const n = KEYS.length;
  if (T >= KEYS[n - 1].t) return v[n - 1];
  let i = 0;
  while (i < n - 2 && KEYS[i + 1].t <= T) i++;
  const h = KEYS[i + 1].t - KEYS[i].t;
  const s = (T - KEYS[i].t) / h;
  const s2 = s * s, s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * v[i] + (s3 - 2 * s2 + s) * h * m[i] + (-2 * s3 + 3 * s2) * v[i + 1] + (s3 - s2) * h * m[i + 1];
}

export function cameraAt(T: number, portrait: boolean): Cam {
  const dm = portrait ? sample('dm', T) : 1;
  return {
    target: [sample('t0', T), sample('t1', T), sample('t2', T)],
    dist: sample('dist', T) * dm,
    az: sample('az', T) + (portrait ? sample('azM', T) : 0),
    el: sample('el', T),
    fov: sample('fov', T),
    sx: portrait ? 0 : sample('sx', T),
    sy: portrait ? sample('syM', T) : sample('sy', T),
  };
}

// ── drum counter ────────────────────────────────────────
export const WHEEL_X = [-0.29, -0.186, -0.082, 0.022, 0.126, 0.264];
export function counterValue(T: number) {
  return 3035.2 + 8.5 * inOutCubic(range(T, 4.75, 6.15));
}
export function counterRise(T: number, i: number) {
  return settle(range(T, 4.05 + 0.06 * i, 4.8 + 0.06 * i), 0.1) * (1 - inCubic(range(T, 6.85 + 0.045 * (5 - i), 7.25 + 0.045 * (5 - i))));
}
export function panelRise(T: number) {
  return settle(range(T, 3.95, 4.6), 0.06) * (1 - inCubic(range(T, 7.0, 7.35)));
}
/** Odometer wheel positions (digits, continuous), left → right; carries click over with a settling overshoot. */
export function wheelDigits(value: number): number[] {
  const x = Math.round(value * 10 * 1e4) / 1e4;
  const out: number[] = [];
  for (let k = 5; k >= 0; k--) {
    const place = 10 ** k;
    if (k === 0) {
      out.push(x % 10);
      continue;
    }
    const base = Math.floor(x / place) % 10;
    const f = Math.max(0, (x % place) - (place - 1));
    out.push(base + settle(f, 0.12));
  }
  return out;
}

// ── scene weights for backdrop and grade ────────────────
export function sceneWeights(T: number) {
  const s1 = 1 - range(T, 3.4, 4.6);
  const s2 = range(T, 3.4, 4.6) * (1 - range(T, 6.9, 8.2));
  const s3 = range(T, 6.9, 8.2) * (1 - range(T, 11.2, 12.6));
  const s4 = range(T, 11.2, 12.6) * (1 - range(T, 14.9, 15.5));
  const s5 = range(T, 14.9, 15.5) * (1 - range(T, 17.3, 17.9));
  const s6 = range(T, 17.3, 17.9);
  return { s1, s2, s3, s4, s5, s6 };
}

export const OIL = {
  handoff: 15.4,
  // the land is gone before the vial arrives: the rising dot crosses a moment of black between them
  mix: (T: number) => range(T, 15.15, 15.55) * (1 - range(T, 17.35, 17.8)),
  level: (T: number) => 70 + 12 * settle(range(T, 16.22, 16.8), 0.1),
  impact: 16.22,
};
