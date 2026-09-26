/**
 * Tempo, easing and the scene table of the reel. Every visual is a pure function of film time T,
 * so a scene plays backwards as faithfully as forwards.
 */
export const BPM = 128;
/** One beat at 128 BPM; scene lengths and cuts sit on this grid (cuts on eighth notes). */
export const BEAT = 60 / BPM;

export interface Scene {
  title: string;
  /** Film time the scene rests on after playing; the previous hold is where it starts. */
  hold: number;
}

export const SCENES: readonly Scene[] = [
  { title: 'Точка', hold: 1.41 },
  { title: 'Отсчёт', hold: 3.52 },
  { title: 'Источники', hold: 5.63 },
  { title: 'Показания', hold: 8.2 },
  { title: 'Техника', hold: 10.78 },
  { title: 'Без связи', hold: 13.36 },
  { title: 'На связи', hold: 15.23 },
  { title: 'Старт', hold: 17.34 },
];
export const HOLDS = SCENES.map((s) => s.hold);
export const D = HOLDS[HOLDS.length - 1];

/** Index of the scene on screen: segment i is (hold[i-1], hold[i]]. */
export function sceneAt(T: number): number {
  let i = 0;
  while (i < HOLDS.length - 1 && T > HOLDS[i] + 1e-4) i++;
  return i;
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const range = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
export const smooth = (t: number) => t * t * (3 - 2 * t);
export const inQuad = (t: number) => t * t;
export const inCubic = (t: number) => t * t * t;
export const outCubic = (t: number) => 1 - (1 - t) ** 3;
export const outQuart = (t: number) => 1 - (1 - t) ** 4;
export const inOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const inOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
export const expoOut = (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));
export const expoIn = (t: number) => (t <= 0 ? 0 : 2 ** (10 * t - 10));
export const expoInOut = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2);
/** Overshoots past 1 and settles back: the weight of a mass arriving. */
export const backOut = (t: number, s = 1.70158) => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const x = t - 1;
  return 1 + (s + 1) * x * x * x + s * x * x;
};
/** Pulls back first (anticipation), then goes. */
export const backIn = (t: number, s = 1.70158) => (t <= 0 ? 0 : t >= 1 ? 1 : (s + 1) * t * t * t - s * t * t);

const springs = new Map<number, { zeta: number; omega: number; wd: number; end: number }>();
/** Damped spring over a normalised duration: overshoots by `overshoot`, lands exactly on 1 at x = 1. */
export function settle(x: number, overshoot = 0.08): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let p = springs.get(overshoot);
  if (!p) {
    const ln = Math.log(Math.max(1e-4, overshoot));
    const zeta = -ln / Math.sqrt(Math.PI * Math.PI + ln * ln);
    const omega = 5.2 / zeta;
    const wd = omega * Math.sqrt(Math.max(1e-6, 1 - zeta * zeta));
    const raw = (t: number) => 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t));
    p = { zeta, omega, wd, end: raw(1) };
    springs.set(overshoot, p);
  }
  const v = 1 - Math.exp(-p.zeta * p.omega * x) * (Math.cos(p.wd * x) + ((p.zeta * p.omega) / p.wd) * Math.sin(p.wd * x));
  return v + (1 - p.end) * x * x * x;
}

/** Value of a mass dropped from `height`: bounces `count` times, rests on 0 at x = 1. */
export function bounce(x: number, height = 1, count = 2): number {
  if (x <= 0 || x >= 1) return 0;
  let t = x, h = height, len = 0.55;
  for (let i = 0; i <= count; i++) {
    if (t < len) return h * 4 * (t / len) * (1 - t / len);
    t -= len;
    h *= 0.3;
    len *= 0.55;
  }
  return 0;
}

/** Rate of change of f at T (per second), for motion blur. */
export function speed(f: (T: number) => number, T: number): number {
  return (f(T + 1 / 240) - f(T - 1 / 240)) * 120;
}
