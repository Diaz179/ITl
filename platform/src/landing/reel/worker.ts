// Builds the facet formations and the map points off the main thread.
import { COVERAGE, MAST, excavatorParts, route, routeAt, routeField, rng, sampleSurface, terrainHeight, torusPart } from './gl/geometry';
import type { Build } from './gl/renderer';

export interface BuildRequest {
  count: number;
  torusScale: number;
  grid: [number, number];
}

// film-thickness bias per excavator part (nm): tracks and bucket run blue, the house gold, the boom bronze-purple
const PART_FILM = [58, 58, 0, 18, 8, -16, 30, 34, 42, 62];
const STRIDE = 19;

self.onmessage = (e: MessageEvent<BuildRequest>) => {
  const { count, torusScale, grid } = e.data;
  const exc = sampleSurface(excavatorParts(), count, 7);
  const tor = sampleSurface([torusPart(0.62 * torusScale, 0.1327 * torusScale)], count, 11);
  const r = rng(29);
  const beacon = [0.33, 1.53, 0.31];
  // flight wave starts at the index dot (one o'clock) and runs round the ring both ways
  const dot = Math.PI / 6;
  const torusOrder = tor.points.map((s, i) => {
    let a = Math.atan2(s.p[0], s.p[1]) - dot;
    a = Math.atan2(Math.sin(a), Math.cos(a));
    return { i, k: Math.abs(a) / Math.PI + r() * 0.04 };
  });
  torusOrder.sort((a, b) => a.k - b.k);
  // the machine assembles from the cab outward
  const excOrder = exc.points.map((s, i) => ({ i, k: Math.hypot(s.p[0] - beacon[0], (s.p[1] - beacon[1]) * 0.8, s.p[2] - beacon[2]) }));
  excOrder.sort((a, b) => a.k - b.k);
  const n = Math.min(tor.points.length, exc.points.length);
  // buffer order is shuffled so that drawing the first N facets is a uniform subset (adaptive quality)
  const slots = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  const out = new Float32Array(n * STRIDE);
  for (let j = 0; j < n; j++) {
    const a = tor.points[torusOrder[j].i];
    const b = exc.points[excOrder[j].i];
    const o = slots[j] * STRIDE;
    out.set([a.p[0] / torusScale, a.p[1] / torusScale, a.p[2] / torusScale], o);
    out.set(a.n, o + 3);
    out.set(b.p, o + 6);
    out.set(b.n, o + 9);
    out.set([r() * 2 - 1, r() * 2 - 1, r() * 2 - 1, r()], o + 12);
    out.set([j / Math.max(1, n - 1), 0, PART_FILM[b.k ?? 2] ?? 0], o + 16);
  }
  // circumradius under half the Poisson spacing: neighbouring facets never touch
  const size = 0.44 * Math.min(exc.spacing, tor.spacing);

  const rt = route();
  const [nx, nz] = grid;
  const x0 = -4, x1 = 12.5, z0 = -8.5, z1 = 5;
  const pts: number[] = [];
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const x = x0 + ((x1 - x0) * (i + 0.5)) / nx, z = z0 + ((z1 - z0) * (j + 0.5)) / nz;
      pts.push(x, terrainHeight(x, z, routeField(rt, x, z).d), z, 0);
    }
  for (let s = 0; s <= rt.length; s += 0.07) {
    const [x, z] = routeAt(rt, s / rt.length);
    pts.push(x, 0.02, z, 1);
  }
  let coverU = 1;
  for (let k = 0; k <= 400; k++) {
    const [x, z] = routeAt(rt, k / 400);
    if (Math.hypot(x - MAST[0], z - MAST[2]) < COVERAGE) {
      coverU = k / 400;
      break;
    }
  }
  const points = new Float32Array(pts);
  const res: Build = { instances: out, count: n, size, points, pointCount: points.length / 4, coverU };
  (self as unknown as Worker).postMessage(res, [out.buffer, points.buffer]);
};
