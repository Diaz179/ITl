// Target point clouds for the primitive field. World units: the symbol ring is ~1.5 wide.

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Distant field behind the subject: primitives arrive from depth, not across the copy. */
export function cloud(n: number, rng: Rng): Float32Array {
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const z = -3 - rng() * 7;
    const spread = 0.55 + (-z - 3) * 0.28;
    out.set([(rng() * 2 - 1) * 3.2 * spread, (rng() * 2 - 1) * 1.9 * spread, z], i * 3);
  }
  return out;
}

// Symbol geometry mirrors src/brand/logo.ts (64-grid: ring r 16.8, stroke 7.2, dot r 6.4 + gap 2.4).
const R = 0.62;
const TUBE = (R * 3.6) / 16.8;
const DOT_R = (R * 6.4) / 16.8;
const GAP_R = (R * 8.8) / 16.8;
const DOT = [R * Math.sin(Math.PI / 6), R * Math.cos(Math.PI / 6)];

export function symbol(n: number, tone: Uint8Array, rng: Rng): Float32Array {
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let x = 0,
      y = 0,
      z = 0;
    if (tone[i]) {
      // solid sphere of the index dot
      const u = rng() * 2 - 1;
      const t = rng() * Math.PI * 2;
      const r = DOT_R * Math.cbrt(rng());
      const s = Math.sqrt(1 - u * u);
      x = DOT[0] + r * s * Math.cos(t);
      y = DOT[1] + r * u;
      z = r * s * Math.sin(t);
    } else {
      for (let k = 0; k < 20; k++) {
        const a = rng() * Math.PI * 2;
        const rr = TUBE * Math.sqrt(rng());
        const b = rng() * Math.PI * 2;
        const rad = R + rr * Math.cos(b);
        x = rad * Math.sin(a);
        y = rad * Math.cos(a);
        z = rr * Math.sin(b);
        if (Math.hypot(x - DOT[0], y - DOT[1]) > GAP_R) break;
      }
    }
    out.set([x, y, z], i * 3);
  }
  return out;
}

/** Side views on a 400×240 canvas, facing right. `beacon` is where the tracker light sits. */
interface Silhouette {
  draw: (c: CanvasRenderingContext2D) => void;
  beacon: [number, number];
}

const poly = (c: CanvasRenderingContext2D, pts: number[]) => {
  c.beginPath();
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.closePath();
  c.fill();
};
const disc = (c: CanvasRenderingContext2D, x: number, y: number, r: number) => {
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
};
const rrect = (c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
  c.fill();
};

export const SILHOUETTES: Silhouette[] = [
  {
    // excavator
    beacon: [176, 60],
    draw: (c) => {
      rrect(c, 34, 186, 222, 40, 20);
      poly(c, [112, 178, 196, 178, 190, 190, 118, 190]);
      poly(c, [56, 180, 56, 138, 78, 124, 150, 120, 214, 124, 222, 138, 222, 180]);
      poly(c, [148, 124, 148, 76, 158, 66, 204, 66, 210, 76, 210, 124]);
      poly(c, [200, 138, 276, 44, 300, 46, 312, 64, 222, 152]);
      poly(c, [288, 50, 306, 44, 356, 142, 338, 154]);
      poly(c, [330, 146, 364, 136, 382, 170, 352, 200, 322, 190]);
    },
  },
  {
    // timber truck with a load of logs
    beacon: [334, 76],
    draw: (c) => {
      poly(c, [302, 84, 352, 84, 374, 124, 378, 186, 302, 186]);
      rrect(c, 36, 178, 344, 16, 4);
      for (const x of [78, 124, 250, 340]) disc(c, x, 202, 21);
      rrect(c, 44, 112, 244, 64, 10);
      for (let i = 0; i < 5; i++) disc(c, 290, 120 + i * 12, 7);
      poly(c, [282, 52, 296, 52, 300, 112, 286, 112]);
      poly(c, [284, 118, 44, 108, 44, 112, 284, 122]);
    },
  },
  {
    // wheeled tractor
    beacon: [140, 32],
    draw: (c) => {
      disc(c, 118, 168, 58);
      disc(c, 304, 190, 36);
      poly(c, [150, 148, 338, 148, 350, 168, 340, 186, 150, 186]);
      poly(c, [176, 128, 332, 128, 342, 148, 170, 148]);
      poly(c, [94, 40, 186, 40, 192, 54, 192, 150, 94, 150]);
      rrect(c, 230, 92, 9, 38, 3);
    },
  },
];

const W = 400;
const H = 240;
let sampleCanvas: HTMLCanvasElement | null = null;

/** Paper instances fill the body; signal instances form the tracker light and its radio arcs. */
export function machine(index: number, n: number, tone: Uint8Array, rng: Rng): Float32Array {
  const sil = SILHOUETTES[index];
  sampleCanvas ??= document.createElement('canvas');
  sampleCanvas.width = W;
  sampleCanvas.height = H;
  const c = sampleCanvas.getContext('2d', { willReadFrequently: true })!;
  c.clearRect(0, 0, W, H);
  c.fillStyle = '#000';
  sil.draw(c);
  const data = c.getImageData(0, 0, W, H).data;
  const filled: number[] = [];
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (data[(y * W + x) * 4 + 3] > 127) filled.push(x, y);
  const cells = filled.length / 2;
  const scale = 2.5 / W;
  const toWorld = (x: number, y: number): [number, number] => [(x - W / 2) * scale, (H / 2 - y) * scale];
  const [bx, by] = toWorld(sil.beacon[0], sil.beacon[1]);
  const out = new Float32Array(n * 3);
  let signalIndex = 0;
  const signalCount = tone.reduce((a, b) => a + b, 0);
  for (let i = 0; i < n; i++) {
    if (tone[i]) {
      const k = signalIndex++ / Math.max(1, signalCount);
      if (k < 0.22) {
        const r = 0.035 * Math.cbrt(rng());
        const a = rng() * Math.PI * 2;
        const b = rng() * Math.PI;
        out.set([bx + r * Math.cos(a) * Math.sin(b), by + r * Math.cos(b), r * Math.sin(a) * Math.sin(b)], i * 3);
      } else {
        const ring = Math.floor(((k - 0.22) / 0.78) * 3);
        const radius = 0.11 + ring * 0.085 + (rng() - 0.5) * 0.012;
        const a = Math.PI * (0.28 + rng() * 0.44);
        out.set([bx + radius * Math.cos(a), by + radius * Math.sin(a), (rng() - 0.5) * 0.03], i * 3);
      }
    } else {
      const j = Math.floor(rng() * cells) * 2;
      const [x, y] = toWorld(filled[j] + rng() * 2, filled[j + 1] + rng() * 2);
      out.set([x, y, (rng() - 0.5) * 0.34], i * 3);
    }
  }
  return out;
}
