/**
 * Film clock vocabulary: timings (film seconds), easing, springs and the scroll ↔ film mapping.
 * Every visual is a pure function of film time T, so the film plays backwards as cleanly as forwards.
 */
export const D = 19;
export const INTRO_END = 2.6;

/** Composed frames the film rests on. Scroll gives them more distance, the playhead may cross them faster. */
export const HOLDS: ReadonlyArray<readonly [number, number]> = [
  [2.6, 3.4],
  [6.0, 6.7],
  [8.3, 8.75],
  [10.1, 10.9],
  [14.2, 14.8],
  [16.8, 17.4],
  [18.3, 19.0],
];

export const CHAPTERS = [
  { title: 'Точка', t: 3.0 },
  { title: 'Счёт', t: 6.35 },
  { title: 'Техника', t: 10.5 },
  { title: 'Без связи', t: 14.5 },
  { title: 'Масло', t: 17.1 },
  { title: 'Финал', t: 19.0 },
] as const;

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const clamp01 = (v: number) => clamp(v, 0, 1);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const range = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
export const smooth = (t: number) => t * t * (3 - 2 * t);

/** Integral of smoothstep: 0 before a, eases into slope 1 over [a, b], then grows linearly (C1 drift). */
export function ramp(t: number, a: number, b: number): number {
  if (t <= a) return 0;
  const w = b - a;
  if (t >= b) return w * 0.5 + (t - b);
  const x = (t - a) / w;
  return w * (x * x * x - 0.5 * x * x * x * x);
}
export const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
export const inQuad = (t: number) => t * t;
export const inCubic = (t: number) => t * t * t;
export const outCubic = (t: number) => 1 - (1 - t) ** 3;
export const outQuart = (t: number) => 1 - (1 - t) ** 4;
export const inOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const inOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
export const inOutQuint = (t: number) => (t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2);

const springCache = new Map<number, { zeta: number; omega: number; wd: number; end: number }>();
function springParams(overshoot: number) {
  let p = springCache.get(overshoot);
  if (!p) {
    const ln = Math.log(Math.max(1e-4, overshoot));
    const zeta = overshoot <= 0 ? 1 : -ln / Math.sqrt(Math.PI * Math.PI + ln * ln);
    const omega = 5.2 / zeta;
    const wd = omega * Math.sqrt(Math.max(1e-6, 1 - zeta * zeta));
    const raw = (x: number) => 1 - Math.exp(-zeta * omega * x) * (Math.cos(wd * x) + ((zeta * omega) / wd) * Math.sin(wd * x));
    p = { zeta, omega, wd, end: raw(1) };
    springCache.set(overshoot, p);
  }
  return p;
}

/** Damped spring over a normalised duration: overshoots by `overshoot`, lands exactly on 1 at x = 1. */
export function settle(x: number, overshoot = 0.08): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const { zeta, omega, wd, end } = springParams(overshoot);
  const v = 1 - Math.exp(-zeta * omega * x) * (Math.cos(wd * x) + ((zeta * omega) / wd) * Math.sin(wd * x));
  return v + (1 - end) * x * x * x;
}

/** Anticipation: a small pull the other way, then the move, then a settling overshoot. */
export function anticipate(x: number, pull = 0.1, overshoot = 0.07): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const dip = -pull * Math.sin(Math.PI * clamp01(x / 0.34)) * (1 - smooth(clamp01((x - 0.1) / 0.3)) * 0.35);
  return settle(clamp01((x - 0.16) / 0.84), overshoot) + dip;
}

/** Value that bounces like a dropped mass: ends at rest on 0. `x` is normalised to the bounce window. */
export function bounce(x: number, height = 1, count = 2): number {
  if (x <= 0 || x >= 1) return 0;
  let t = x;
  let h = height;
  let len = 0.55;
  for (let i = 0; i < count; i++) {
    if (t < len) return h * 4 * (t / len) * (1 - t / len);
    t -= len;
    h *= 0.35;
    len *= 0.6;
  }
  return 0;
}

// ── scroll ↔ film ──────────────────────────────────────────
const W_HOLD = 2.2;
const W_BEAT = 1;
const segments: Array<{ a: number; b: number; w: number }> = [];
{
  let t = INTRO_END;
  for (const [a, b] of HOLDS) {
    if (a > t) segments.push({ a: t, b: a, w: W_BEAT });
    segments.push({ a: Math.max(a, t), b, w: W_HOLD });
    t = b;
  }
  if (t < D) segments.push({ a: t, b: D, w: W_BEAT });
}
const weightTotal = segments.reduce((s, g) => s + (g.b - g.a) * g.w, 0);
/** Weighted length of the scroll-driven part, in film seconds. */
export const SCROLL_WEIGHT = weightTotal;

export function filmAt(progress: number): number {
  let acc = clamp01(progress) * weightTotal;
  for (const g of segments) {
    const len = (g.b - g.a) * g.w;
    if (acc <= len) return g.a + acc / g.w;
    acc -= len;
  }
  return D;
}

export function progressAt(t: number): number {
  let acc = 0;
  for (const g of segments) {
    if (t <= g.b) return clamp01((acc + (Math.max(t, g.a) - g.a) * g.w) / weightTotal);
    acc += (g.b - g.a) * g.w;
  }
  return 1;
}

export const inHold = (t: number) => HOLDS.some(([a, b]) => t >= a && t <= b);

/** Speed limit of the playhead (film seconds per second): transformations are always seen in full. */
export const CAP_BEAT = 1.3;
export const CAP_HOLD = 3;
export function capAt(t: number): number {
  for (const [a, b] of HOLDS) if (t > a + 0.08 && t < b - 0.08) return CAP_HOLD;
  return CAP_BEAT;
}
