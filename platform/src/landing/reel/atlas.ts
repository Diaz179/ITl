/**
 * Signed-distance glyph atlas (TinySDF algorithm): display type and the wordmark letters are rasterised
 * once, small, and stay sharp at any size, with motion blur and outlines computed in the shader.
 */
import { WORDMARK } from '../../brand/logo';

export const SDF = { radius: 16, cutoff: 0.25, buffer: 18 };
const INF = 1e20;

/** Raster box (px, with buffer) and its centre relative to the pen on the baseline. */
export interface Glyph {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  w: number;
  h: number;
  ox: number;
  oy: number;
}

export interface Word {
  text: string;
  glyphs: Array<Glyph | null>;
  pens: number[];
  adv: number;
  cap: number;
}

export class Atlas {
  readonly w = 2048;
  readonly h = 1024;
  readonly data = new Uint8Array(2048 * 1024);
  private x = 0;
  private y = 0;
  private row = 0;
  private cnv = document.createElement('canvas');
  private g = this.cnv.getContext('2d', { willReadFrequently: true })!;
  private outer = new Float64Array(0);
  private inner = new Float64Array(0);
  private f = new Float64Array(0);
  private z = new Float64Array(0);
  private v = new Uint16Array(0);
  private chars = new Map<string, Glyph>();

  private pack(inkW: number, inkH: number, draw: (g: CanvasRenderingContext2D, ox: number, oy: number) => void) {
    const b = SDF.buffer;
    const W = Math.ceil(inkW) + 2 * b, H = Math.ceil(inkH) + 2 * b;
    if (this.x + W > this.w) {
      this.x = 0;
      this.y += this.row + 1;
      this.row = 0;
    }
    if (this.y + H > this.h) throw new Error('atlas full');
    if (this.cnv.width < W || this.cnv.height < H) {
      this.cnv.width = Math.max(this.cnv.width, W);
      this.cnv.height = Math.max(this.cnv.height, H);
    }
    const g = this.g;
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#fff';
    g.strokeStyle = '#fff';
    draw(g, b, b);
    const img = g.getImageData(0, 0, W, H).data;
    const n = W * H, m = Math.max(W, H);
    if (this.outer.length < n) {
      this.outer = new Float64Array(n);
      this.inner = new Float64Array(n);
    }
    if (this.f.length < m) {
      this.f = new Float64Array(m);
      this.z = new Float64Array(m + 1);
      this.v = new Uint16Array(m);
    }
    const outer = this.outer, inner = this.inner;
    for (let i = 0; i < n; i++) {
      const a = img[i * 4 + 3] / 255;
      if (a === 0) {
        outer[i] = INF;
        inner[i] = 0;
      } else if (a === 1) {
        outer[i] = 0;
        inner[i] = INF;
      } else {
        const d = 0.5 - a;
        outer[i] = d > 0 ? d * d : 0;
        inner[i] = d < 0 ? d * d : 0;
      }
    }
    edt(outer, W, H, this.f, this.v, this.z);
    edt(inner, W, H, this.f, this.v, this.z);
    for (let yy = 0; yy < H; yy++)
      for (let xx = 0; xx < W; xx++) {
        const i = yy * W + xx;
        const d = Math.sqrt(outer[i]) - Math.sqrt(inner[i]);
        this.data[(this.y + yy) * this.w + this.x + xx] = Math.max(0, Math.min(255, Math.round(255 - 255 * (d / SDF.radius + SDF.cutoff))));
      }
    const r = { u0: this.x / this.w, v0: this.y / this.h, u1: (this.x + W) / this.w, v1: (this.y + H) / this.h, W, H };
    this.x += W + 1;
    this.row = Math.max(this.row, H);
    return r;
  }

  private setFont(font: string, stretch: CanvasFontStretch) {
    this.g.font = font;
    // the CSS shorthand ignores width in canvas; the property selects the variable width axis
    this.g.fontStretch = stretch;
  }

  char(font: string, ch: string, stretch: CanvasFontStretch = 'normal'): Glyph {
    const key = font + '|' + stretch + '|' + ch;
    let gl = this.chars.get(key);
    if (gl) return gl;
    this.setFont(font, stretch);
    const m = this.g.measureText(ch);
    const L = m.actualBoundingBoxLeft, R = m.actualBoundingBoxRight, A = m.actualBoundingBoxAscent, Dd = m.actualBoundingBoxDescent;
    const r = this.pack(L + R, A + Dd, (g, ox, oy) => {
      this.setFont(font, stretch);
      g.textBaseline = 'alphabetic';
      g.fillText(ch, ox + L, oy + A);
    });
    gl = { u0: r.u0, v0: r.v0, u1: r.u1, v1: r.v1, w: r.W, h: r.H, ox: (R - L) / 2, oy: (Dd - A) / 2 };
    this.chars.set(key, gl);
    return gl;
  }

  /** Word laid out with the font's own advances and kerning (pen positions from prefix widths). */
  word(font: string, text: string, stretch: CanvasFontStretch = 'normal'): Word {
    const g = this.g;
    const glyphs: Array<Glyph | null> = [];
    const pens: number[] = [];
    const chars = Array.from(text);
    let prefix = '';
    for (const ch of chars) {
      this.setFont(font, stretch);
      pens.push(g.measureText(prefix).width);
      glyphs.push(ch.trim() ? this.char(font, ch, stretch) : null);
      prefix += ch;
    }
    this.setFont(font, stretch);
    return { text, glyphs, pens, adv: g.measureText(text).width, cap: g.measureText('Н').actualBoundingBoxAscent };
  }

  private probe: CanvasRenderingContext2D | null = null;

  /** Wordmark letter i; `s` raster px per wordmark unit, pen = wordmark origin on the baseline (y 100). */
  wordmarkLetter(s: number, i: number): Glyph {
    if (!this.probe) {
      const c = document.createElement('canvas');
      c.width = Math.ceil(620 * s);
      c.height = Math.ceil(170 * s);
      this.probe = c.getContext('2d', { willReadFrequently: true })!;
    }
    const pg = this.probe, probe = pg.canvas;
    const drawLetter = (g: CanvasRenderingContext2D, i: number, dx: number, dy: number) => {
      const l = WORDMARK.letters[i];
      g.save();
      g.translate(dx, dy);
      g.scale(s, s);
      g.lineCap = 'butt';
      g.lineJoin = 'miter';
      g.lineWidth = WORDMARK.vertical;
      for (const d of l.v) g.stroke(new Path2D(d));
      g.lineWidth = WORDMARK.horizontal;
      for (const d of l.h) g.stroke(new Path2D(d));
      g.restore();
    };
    // ink bounds: draw with a margin and scan (units → px: origin shifted by 10 units)
    pg.clearRect(0, 0, probe.width, probe.height);
    pg.strokeStyle = '#fff';
    drawLetter(pg, i, 10 * s, 20 * s);
    const img = pg.getImageData(0, 0, probe.width, probe.height).data;
    let x0 = probe.width, y0 = probe.height, x1 = 0, y1 = 0;
    for (let y = 0; y < probe.height; y++)
      for (let x = 0; x < probe.width; x++)
        if (img[(y * probe.width + x) * 4 + 3] > 0) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    const r = this.pack(x1 - x0 + 1, y1 - y0 + 1, (g, ox, oy) => drawLetter(g, i, ox - x0 + 10 * s, oy - y0 + 20 * s));
    // box centre in wordmark px relative to (0, baseline)
    const cx = (x0 + x1 + 1) / 2 - 10 * s, cy = (y0 + y1 + 1) / 2 - 20 * s - 100 * s;
    return { u0: r.u0, v0: r.v0, u1: r.u1, v1: r.v1, w: r.W, h: r.H, ox: cx, oy: cy };
  }
}

function edt(data: Float64Array, width: number, height: number, f: Float64Array, v: Uint16Array, z: Float64Array) {
  for (let x = 0; x < width; x++) edt1d(data, x, width, height, f, v, z);
  for (let y = 0; y < height; y++) edt1d(data, y * width, 1, width, f, v, z);
}

function edt1d(grid: Float64Array, offset: number, stride: number, length: number, f: Float64Array, v: Uint16Array, z: Float64Array) {
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  f[0] = grid[offset];
  for (let q = 1, k = 0, s = 0; q < length; q++) {
    f[q] = grid[offset + q * stride];
    const q2 = q * q;
    do {
      const r = v[k];
      s = (f[q] - f[r] + q2 - r * r) / (q - r) / 2;
    } while (s <= z[k] && --k > -1);
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  for (let q = 0, k = 0; q < length; q++) {
    while (z[k + 1] < q) k++;
    const r = v[k];
    const qr = q - r;
    grid[offset + q * stride] = f[r] + qr * qr;
  }
}
