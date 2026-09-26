import { v3, type V3 } from './core';

export type Rng = () => number;
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── meshes ───────────────────────────────────────────────
/** Regular tetrahedron, circumradius 1: position, flat normal, barycentric (for lit edges). */
export function tetrahedron(): Float32Array {
  const s = 1 / Math.sqrt(3);
  const v: V3[] = [
    [s, s, s],
    [s, -s, -s],
    [-s, s, -s],
    [-s, -s, s],
  ];
  const faces = [
    [0, 1, 2],
    [0, 3, 1],
    [0, 2, 3],
    [1, 3, 2],
  ];
  const out: number[] = [];
  const bary: V3[] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (const f of faces) {
    const [a, b, c] = f.map((i) => v[i]);
    const n = v3.norm(v3.cross(v3.sub(b, a), v3.sub(c, a)));
    [a, b, c].forEach((p, k) => out.push(...p, ...n, ...bary[k]));
  }
  return new Float32Array(out);
}

/** Unit cylinder along x (radius 1, x ∈ [-0.5, 0.5]); uv.x < 0 marks the caps. */
export function cylinder(seg = 96): Float32Array {
  const out: number[] = [];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const p = (a: number, x: number) => [x, Math.cos(a), Math.sin(a)];
    const n = (a: number) => [0, Math.cos(a), Math.sin(a)];
    const quad = [
      [a0, -0.5, 0],
      [a1, -0.5, 0],
      [a1, 0.5, 1],
      [a0, -0.5, 0],
      [a1, 0.5, 1],
      [a0, 0.5, 1],
    ];
    for (const [a, x, u] of quad) out.push(...p(a, x), ...n(a), u, a / (Math.PI * 2));
    for (const side of [-0.5, 0.5]) {
      const tri = side < 0 ? [a1, a0] : [a0, a1];
      out.push(side, 0, 0, Math.sign(side), 0, 0, -1, 0);
      for (const a of tri) out.push(side, Math.cos(a), Math.sin(a), Math.sign(side), 0, 0, -1, 0);
    }
  }
  return new Float32Array(out);
}

/** Unit cube centred at 0 (edge 1): position + flat normal. */
export function cube(): Float32Array {
  const out: number[] = [];
  const f = (n: V3, u: V3, w: V3) => {
    const c = (a: number, b: number) => [0, 1, 2].map((k) => n[k] * 0.5 + u[k] * a * 0.5 + w[k] * b * 0.5);
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
  return new Float32Array(out);
}

// ── surface sampling for hollow particle formations ──────
interface Sample {
  p: V3;
  n: V3;
}
interface Part {
  area: number;
  sample: (r: Rng) => Sample;
  inside: (p: V3) => boolean;
}

function triArea(a: V3, b: V3, c: V3) {
  return v3.len(v3.cross(v3.sub(b, a), v3.sub(c, a))) / 2;
}

/** Convex hexahedron from 8 corners (0-3 one end, 4-7 the other, same order). */
function hexahedron(c: V3[]): Part {
  const centre = v3.scale(c.reduce((s, p) => v3.add(s, p), [0, 0, 0] as V3), 1 / 8);
  const quads = [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7],
  ];
  const tris: Array<{ a: V3; b: V3; c: V3; n: V3; area: number }> = [];
  const planes: Array<{ a: V3; n: V3 }> = [];
  for (const q of quads) {
    const [a, b, cc, d] = q.map((i) => c[i]);
    let n = v3.norm(v3.cross(v3.sub(b, a), v3.sub(d, a)));
    const mid = v3.scale(v3.add(v3.add(a, b), v3.add(cc, d)), 0.25);
    if (v3.dot(n, v3.sub(mid, centre)) < 0) n = v3.scale(n, -1);
    planes.push({ a: mid, n });
    for (const [x, y, z] of [
      [a, b, cc],
      [a, cc, d],
    ])
      tris.push({ a: x, b: y, c: z, n, area: triArea(x, y, z) });
  }
  const area = tris.reduce((s, t) => s + t.area, 0);
  return {
    area,
    sample(r) {
      let k = r() * area;
      let t = tris[0];
      for (const tt of tris) {
        t = tt;
        if ((k -= tt.area) <= 0) break;
      }
      let u = r(), w = r();
      if (u + w > 1) (u = 1 - u), (w = 1 - w);
      const p = v3.add(t.a, v3.add(v3.scale(v3.sub(t.b, t.a), u), v3.scale(v3.sub(t.c, t.a), w)));
      return { p, n: t.n };
    },
    inside: (p) => planes.every((pl) => v3.dot(v3.sub(p, pl.a), pl.n) < -0.012),
  };
}

function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Part {
  return hexahedron([
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y0, z1],
    [x0, y0, z1],
    [x0, y1, z0],
    [x1, y1, z0],
    [x1, y1, z1],
    [x0, y1, z1],
  ]);
}

/** Tapered beam in the xy-plane between two centreline points. */
function beam(p0: [number, number], p1: [number, number], th0: number, th1: number, z0: number, z1: number): Part {
  const d = v3.norm([p1[0] - p0[0], p1[1] - p0[1], 0]);
  const n: [number, number] = [-d[1], d[0]];
  const at = (p: [number, number], th: number, s: number, z: number): V3 => [p[0] + n[0] * th * 0.5 * s, p[1] + n[1] * th * 0.5 * s, z];
  return hexahedron([at(p0, th0, -1, z0), at(p1, th1, -1, z0), at(p1, th1, 1, z0), at(p0, th0, 1, z0), at(p0, th0, -1, z1), at(p1, th1, -1, z1), at(p1, th1, 1, z1), at(p0, th0, 1, z1)]);
}

/** Track: stadium profile in xy extruded along z. */
function stadium(cx: number, cy: number, half: number, rad: number, z0: number, z1: number): Part {
  const width = z1 - z0;
  const per = 4 * half + 2 * Math.PI * rad;
  const side = 4 * half * rad + Math.PI * rad * rad;
  const bandArea = per * width;
  const area = bandArea + 2 * side;
  const inStadium = (x: number, y: number, m: number) => {
    const qx = Math.max(Math.abs(x - cx) - half, 0);
    return Math.hypot(qx, y - cy) < rad - m;
  };
  return {
    area,
    sample(r) {
      if (r() * area < bandArea) {
        let s = r() * per;
        const z = z0 + r() * width;
        if (s < 2 * half) return { p: [cx - half + s, cy + rad, z], n: [0, 1, 0] };
        s -= 2 * half;
        if (s < Math.PI * rad) {
          const a = Math.PI / 2 - s / rad;
          return { p: [cx + half + rad * Math.cos(a), cy + rad * Math.sin(a), z], n: [Math.cos(a), Math.sin(a), 0] };
        }
        s -= Math.PI * rad;
        if (s < 2 * half) return { p: [cx + half - s, cy - rad, z], n: [0, -1, 0] };
        s -= 2 * half;
        const a = -Math.PI / 2 - s / rad;
        return { p: [cx - half + rad * Math.cos(a), cy + rad * Math.sin(a), z], n: [Math.cos(a), Math.sin(a), 0] };
      }
      const z = r() < 0.5 ? z0 : z1;
      for (;;) {
        const x = cx - half - rad + r() * (2 * half + 2 * rad);
        const y = cy - rad + r() * 2 * rad;
        if (inStadium(x, y, 0)) return { p: [x, y, z], n: [0, 0, z === z0 ? -1 : 1] };
      }
    },
    inside: (p) => p[2] > z0 + 0.012 && p[2] < z1 - 0.012 && inStadium(p[0], p[1], 0.012),
  };
}

/** Partial cylinder around an axis (x, y or z), angle measured in the plane of the other two axes. */
function cylinderPart(axis: 0 | 1 | 2, centre: V3, rad: number, a0: number, a1: number, h0: number, h1: number, solid: boolean): Part {
  const [iu, iv] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
  const span = a1 - a0;
  const curved = rad * span * (h1 - h0);
  const cap = 0.5 * rad * rad * span;
  const area = curved + 2 * cap;
  const make = (a: number, rr: number, h: number): V3 => {
    const p: V3 = [0, 0, 0];
    p[axis] = centre[axis] + h;
    p[iu] = centre[iu] + rr * Math.cos(a);
    p[iv] = centre[iv] + rr * Math.sin(a);
    return p;
  };
  return {
    area,
    sample(r) {
      const a = a0 + r() * span;
      if (r() * area < curved) {
        const n: V3 = [0, 0, 0];
        n[iu] = Math.cos(a);
        n[iv] = Math.sin(a);
        return { p: make(a, rad, h0 + r() * (h1 - h0)), n };
      }
      const top = r() < 0.5;
      const n: V3 = [0, 0, 0];
      n[axis] = top ? 1 : -1;
      return { p: make(a, rad * Math.sqrt(r()), top ? h1 : h0), n };
    },
    inside(p) {
      if (!solid) return false;
      const h = p[axis] - centre[axis];
      if (h < h0 + 0.012 || h > h1 - 0.012) return false;
      const du = p[iu] - centre[iu], dv = p[iv] - centre[iv];
      if (Math.hypot(du, dv) > rad - 0.012) return false;
      let a = Math.atan2(dv, du);
      while (a < a0) a += Math.PI * 2;
      return a < a1;
    },
  };
}

/** Excavator facing +x, left side +z, tracks on y = 0. Roughly 3.3 × 1.7 × 1.3 units. */
export function excavatorParts(): Part[] {
  return [
    stadium(0, 0.19, 0.74, 0.19, 0.3, 0.66),
    stadium(0, 0.19, 0.74, 0.19, -0.66, -0.3),
    box(-0.78, 0.6, 0.42, 0.92, -0.54, 0.54),
    cylinderPart(1, [-0.5, 0, 0], 0.56, Math.PI / 2, (Math.PI * 3) / 2, 0.44, 0.88, true),
    box(-0.72, -0.1, 0.92, 1.06, -0.5, -0.04),
    hexahedron([
      [0.02, 0.92, 0.08],
      [0.6, 0.92, 0.08],
      [0.6, 0.92, 0.52],
      [0.02, 0.92, 0.52],
      [0.04, 1.46, 0.1],
      [0.46, 1.46, 0.1],
      [0.46, 1.46, 0.5],
      [0.04, 1.46, 0.5],
    ]),
    beam([0.5, 0.78], [1.12, 1.58], 0.25, 0.2, -0.22, 0),
    beam([1.1, 1.6], [1.7, 1.46], 0.2, 0.16, -0.22, 0),
    beam([1.68, 1.5], [2.05, 0.66], 0.16, 0.12, -0.19, -0.03),
    cylinderPart(2, [2.02, 0.5, 0], 0.21, (-100 * Math.PI) / 180, (130 * Math.PI) / 180, -0.25, 0.05, false),
  ];
}

export function torusPart(R: number, r: number): Part {
  const area = 4 * Math.PI * Math.PI * R * r;
  return {
    area,
    sample(rand) {
      for (;;) {
        const u = rand() * Math.PI * 2, v = rand() * Math.PI * 2;
        if (rand() * (R + r) > R + r * Math.cos(v)) continue;
        const n: V3 = [Math.cos(v) * Math.sin(u), Math.cos(v) * Math.cos(u), Math.sin(v)];
        return { p: [(R + r * Math.cos(v)) * Math.sin(u), (R + r * Math.cos(v)) * Math.cos(u), r * Math.sin(v)], n };
      }
    },
    inside: () => false,
  };
}

/**
 * Blue-noise samples on the union surface of `parts`: points inside another part are dropped,
 * and no two accepted points are closer than the returned spacing.
 */
export function sampleSurface(parts: Part[], count: number, seed: number): { points: Sample[]; spacing: number } {
  const r = rng(seed);
  const total = parts.reduce((s, p) => s + p.area, 0);
  const cands: Sample[] = [];
  const want = count * 14;
  for (let pi = 0; pi < parts.length; pi++) {
    const part = parts[pi];
    const n = Math.round((part.area / total) * want);
    for (let i = 0; i < n; i++) {
      const s = part.sample(r);
      if (parts.some((o, oi) => oi !== pi && o.inside(s.p))) continue;
      cands.push(s);
    }
  }
  for (let i = cands.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [cands[i], cands[j]] = [cands[j], cands[i]];
  }
  let d = Math.sqrt(total / (count * 0.62));
  for (let attempt = 0; attempt < 24; attempt++) {
    const cell = d;
    const grid = new Map<string, V3[]>();
    const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
    const accepted: Sample[] = [];
    for (const s of cands) {
      const gx = Math.floor(s.p[0] / cell), gy = Math.floor(s.p[1] / cell), gz = Math.floor(s.p[2] / cell);
      let ok = true;
      for (let x = gx - 1; x <= gx + 1 && ok; x++)
        for (let y = gy - 1; y <= gy + 1 && ok; y++)
          for (let z = gz - 1; z <= gz + 1 && ok; z++) {
            const list = grid.get(key(x, y, z));
            if (list) for (const q of list) if ((q[0] - s.p[0]) ** 2 + (q[1] - s.p[1]) ** 2 + (q[2] - s.p[2]) ** 2 < d * d) { ok = false; break; }
          }
      if (!ok) continue;
      accepted.push(s);
      const k = key(gx, gy, gz);
      const list = grid.get(k);
      if (list) list.push(s.p);
      else grid.set(k, [s.p]);
    }
    if (accepted.length >= count) return { points: accepted.slice(0, count), spacing: d };
    d *= Math.max(0.9, Math.sqrt(accepted.length / count) * 0.99);
  }
  return { points: cands.slice(0, count), spacing: d * 0.5 };
}

// ── terrain and route for the «Без связи» scene ──────────
export const MAST: V3 = [8.1, 0, -2.9];
export const COVERAGE = 3.3;
const ROUTE_CTRL: Array<[number, number]> = [
  [0, 0],
  [1.3, 0.9],
  [2.8, 0.7],
  [3.9, -0.4],
  [5.0, -1.2],
  [6.2, -1.6],
  [7.3, -1.9],
];

export interface Route {
  pts: Array<[number, number]>;
  cum: number[];
  length: number;
}

export function route(): Route {
  const c = [ROUTE_CTRL[0], ...ROUTE_CTRL, ROUTE_CTRL[ROUTE_CTRL.length - 1]];
  const pts: Array<[number, number]> = [];
  for (let i = 1; i < c.length - 2; i++) {
    const [p0, p1, p2, p3] = [c[i - 1], c[i], c[i + 1], c[i + 2]];
    for (let k = 0; k < 24; k++) {
      const t = k / 24, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, cc: number, dd: number) => 0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - dd) * t2 + (-a + 3 * b - 3 * cc + dd) * t3);
      pts.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  pts.push(ROUTE_CTRL[ROUTE_CTRL.length - 1]);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, length: cum[cum.length - 1] };
}

export function routeAt(r: Route, u: number): [number, number] {
  const s = Math.min(Math.max(u, 0), 1) * r.length;
  let i = 1;
  while (i < r.cum.length - 1 && r.cum[i] < s) i++;
  const k = (s - r.cum[i - 1]) / Math.max(1e-6, r.cum[i] - r.cum[i - 1]);
  return [r.pts[i - 1][0] + (r.pts[i][0] - r.pts[i - 1][0]) * k, r.pts[i - 1][1] + (r.pts[i][1] - r.pts[i - 1][1]) * k];
}

/** Signed distance to the route and the route parameter of the closest point. */
export function routeField(r: Route, x: number, z: number): { d: number; u: number } {
  let best = Infinity, bu = 0, sign = 1;
  for (let i = 1; i < r.pts.length; i++) {
    const [ax, az] = r.pts[i - 1], [bx, bz] = r.pts[i];
    const ex = bx - ax, ez = bz - az;
    const l2 = ex * ex + ez * ez || 1e-9;
    const t = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / l2));
    const px = ax + ex * t, pz = az + ez * t;
    const dd = Math.hypot(x - px, z - pz);
    if (dd < best) {
      best = dd;
      bu = (r.cum[i - 1] + Math.sqrt(l2) * t) / r.length;
      sign = ex * (z - az) - ez * (x - ax) >= 0 ? 1 : -1;
    }
  }
  return { d: best * sign, u: bu };
}

function hash2(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
export function terrainHeight(x: number, z: number, dRoute: number): number {
  let h = 0, amp = 1, f = 0.16;
  for (let i = 0; i < 5; i++) {
    h += amp * (vnoise(x * f + 11.3, z * f - 4.7) - 0.45);
    amp *= 0.5;
    f *= 2.07;
  }
  const ridge = Math.max(0, h) * 1.35 + h * 0.35;
  const valley = Math.min(1, Math.max(0, (Math.abs(dRoute) - 0.28) / 1.3));
  const site = Math.min(1, Math.hypot(x, z) / 1.4);
  const mast = Math.min(1, Math.hypot(x - MAST[0], z - MAST[2]) / 1.1);
  return ridge * valley * valley * (3 - 2 * valley) * site * mast * 1.15;
}

/** Terrain grid: position, route signed distance, route parameter. */
export function terrainMesh(res: number, r: Route, cx: number, cz: number, size: number): { data: Float32Array; index: Uint32Array } {
  const n = res + 1;
  const data = new Float32Array(n * n * 5);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = cx + (i / res - 0.5) * size, z = cz + (j / res - 0.5) * size;
      const f = routeField(r, x, z);
      const o = (j * n + i) * 5;
      data[o] = x;
      data[o + 1] = terrainHeight(x, z, f.d);
      data[o + 2] = z;
      data[o + 3] = f.d;
      data[o + 4] = f.u;
    }
  const index = new Uint32Array(res * res * 6);
  let k = 0;
  for (let j = 0; j < res; j++)
    for (let i = 0; i < res; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      index.set([a, c, b, b, c, d], k);
      k += 6;
    }
  return { data, index };
}
