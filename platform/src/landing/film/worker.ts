// Builds the particle formations and the terrain off the main thread.
import { COVERAGE, MAST, excavatorParts, route, routeAt, sampleSurface, terrainMesh, torusPart, rng } from './gl/geometry';

export interface BuildRequest {
  count: number;
  terrainRes: number;
  torusScale: number;
}

export interface BuildResult {
  instances: Float32Array;
  count: number;
  size: number;
  terrain: Float32Array;
  index: Uint32Array;
  coverU: number;
  routeLen: number;
}

// film-thickness bias per excavator part (nm): tracks and bucket run blue, the house gold, the boom bronze-purple
const PART_FILM = [58, 58, 0, 18, 8, -16, 30, 34, 42, 62];
const STRIDE = 19;

self.onmessage = (e: MessageEvent<BuildRequest>) => {
  const { count, terrainRes, torusScale } = e.data;
  const exc = sampleSurface(excavatorParts(), count, 7);
  const tor = sampleSurface([torusPart(0.62 * torusScale, 0.1327 * torusScale)], count, 11);
  const r = rng(29);
  const beacon = [0.33, 1.53, 0.31];
  // flight wave starts at the dot (12 o'clock) and runs round the ring both ways
  const torusOrder = tor.points.map((s, i) => ({ i, k: Math.abs(Math.atan2(s.p[0], s.p[1])) / Math.PI + r() * 0.04 }));
  torusOrder.sort((a, b) => a.k - b.k);
  // the machine assembles from the cab outward
  const excOrder = exc.points.map((s, i) => ({ i, k: Math.hypot(s.p[0] - beacon[0], (s.p[1] - beacon[1]) * 0.8, s.p[2] - beacon[2]) }));
  excOrder.sort((a, b) => a.k - b.k);
  const n = Math.min(tor.points.length, exc.points.length);
  const out = new Float32Array(n * STRIDE);
  for (let j = 0; j < n; j++) {
    const a = tor.points[torusOrder[j].i];
    const b = exc.points[excOrder[j].i];
    const o = j * STRIDE;
    out.set([a.p[0] / torusScale, a.p[1] / torusScale, a.p[2] / torusScale], o);
    out.set(a.n, o + 3);
    out.set(b.p, o + 6);
    out.set(b.n, o + 9);
    out.set([r() * 2 - 1, r() * 2 - 1, r() * 2 - 1, r()], o + 12);
    // dispersal travels from the bucket tip to the counterweight
    const dis = Math.min(1, Math.max(0, (2.25 - b.p[0]) / 3.35 + (r() - 0.5) * 0.12 + (1.7 - b.p[1]) * 0.05));
    out.set([j / Math.max(1, n - 1), dis, PART_FILM[b.k ?? 2] ?? 0], o + 16);
  }
  // circumradius under half the Poisson spacing: neighbouring facets never touch
  const size = 0.44 * Math.min(exc.spacing, tor.spacing);
  const rt = route();
  const terr = terrainMesh(terrainRes, rt, 4.0, -1.0, 22);
  let coverU = 1;
  for (let k = 0; k <= 400; k++) {
    const [x, z] = routeAt(rt, k / 400);
    if (Math.hypot(x - MAST[0], z - MAST[2]) < COVERAGE) {
      coverU = k / 400;
      break;
    }
  }
  const res: BuildResult = { instances: out, count: n, size, terrain: terr.data, index: terr.index, coverU, routeLen: rt.length };
  (self as unknown as Worker).postMessage(res, [out.buffer, terr.data.buffer, terr.index.buffer]);
};
