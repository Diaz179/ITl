import { HOLDS, clamp } from './time';

/** Fast-forward rate when the viewer keeps asking for the next scene while one still plays. */
const FF = 3.4;
/** Going back replays the transition in reverse, a little quicker than forwards. */
const BACK = 1.8;

/**
 * Scenes, not scroll. The film rests on hold points; a gesture only sets which hold to go to,
 * and the film plays there at its authored timing (or fast-forwards, never cuts).
 */
export class Navigator {
  T: number;
  K: number;
  rate = 1;
  private ff = false;
  private queued = 0;
  /** Called when the target scene changes. */
  onTarget: (k: number) => void = () => {};

  constructor(T: number, K: number, public reduced = false) {
    this.T = T;
    this.K = K;
  }

  get moving() {
    return Math.abs(HOLDS[this.K] - this.T) > 1e-6;
  }

  private setK(k: number) {
    k = clamp(k, 0, HOLDS.length - 1);
    if (k === this.K) return;
    this.K = k;
    if (this.reduced) this.T = HOLDS[k];
    this.onTarget(k);
  }

  step(dir: 1 | -1) {
    if (this.reduced || !this.moving) {
      this.ff = false;
      this.setK(this.K + dir);
      return;
    }
    const movingDir = Math.sign(HOLDS[this.K] - this.T);
    if (dir === movingDir) {
      // keeps scrolling while a scene plays: speed it up to its end, then flow into the next (one step max)
      this.ff = true;
      if (!this.queued) this.queued = dir;
    } else {
      this.queued = 0;
      this.ff = false;
      this.setK(this.K + dir);
    }
  }

  /** Chapter jump: plays through the scenes in between at fast-forward. */
  goTo(k: number) {
    this.queued = 0;
    this.ff = Math.abs(k - this.K) > 1 || this.moving;
    this.setK(k);
  }

  update(dt: number) {
    const target = HOLDS[this.K];
    const d = target - this.T;
    if (Math.abs(d) < 1e-6) {
      this.T = target;
      this.rate += (1 - this.rate) * (1 - Math.exp(-dt * 6));
      if (this.queued) {
        const q = this.queued;
        this.queued = 0;
        this.setK(this.K + q);
      }
      return;
    }
    const dir = Math.sign(d);
    // a hold strictly between here and the target means a chapter jump: fast-forward through it
    let far = false;
    for (const h of HOLDS) if ((h - this.T) * dir > 1e-4 && (target - h) * dir > 1e-4) far = true;
    const want = this.ff || far ? FF : dir > 0 ? 1 : BACK;
    this.rate += (want - this.rate) * (1 - Math.exp(-dt * 7));
    const step = this.rate * dt;
    if (step >= Math.abs(d)) {
      this.T = target;
      if (this.queued === dir) {
        this.queued = 0;
        // flow into the next scene; the rate eases back to normal on its own
        this.ff = false;
        this.setK(this.K + dir);
      } else if (!far) this.ff = false;
    } else this.T += step * dir;
  }
}

/**
 * Wheel, trackpad, touch and keys → one step per gesture. Trailing inertia is ignored; a fresh push
 * inside the inertia tail, or scrolling that keeps going without decaying, counts as a new request.
 */
export function bindInput(root: HTMLElement, go: (dir: 1 | -1) => void, blocked: () => boolean) {
  let last = -1e9, fireAt = -1e9, fired = false, acc = 0, burstDir = 0;
  const recent: number[] = [];
  addEventListener(
    'wheel',
    (e) => {
      if (blocked()) return;
      let dy = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (e.deltaMode === 1) dy *= 16;
      else if (e.deltaMode === 2) dy *= innerHeight;
      const a = Math.abs(dy);
      if (a < 0.5) return;
      const t = e.timeStamp;
      const dir = dy > 0 ? 1 : -1;
      if (t - last > 200 || dir !== burstDir) {
        fired = false;
        acc = 0;
        recent.length = 0;
        burstDir = dir;
      }
      last = t;
      let peak = 0;
      for (const r of recent) peak = Math.max(peak, r);
      recent.push(a);
      if (recent.length > 6) recent.shift();
      acc += a;
      if (!fired) {
        if (acc >= 12) {
          fired = true;
          fireAt = t;
          go(dir);
        }
        return;
      }
      const fresh = a > peak * 1.6 + 6 && t - fireAt > 260;
      // inertia tails decay to a trickle of 1–2 px; real continued scrolling keeps its magnitude
      const sustained = t - fireAt > 650 && recent.length >= 6 && a >= 10 && a >= 0.8 * (recent[0] + recent[1]) * 0.5;
      if (fresh || sustained) {
        fireAt = t;
        go(dir);
      }
    },
    { passive: true },
  );

  let y0 = 0, x0 = 0, touchFired = false;
  root.addEventListener(
    'touchstart',
    (e) => {
      y0 = e.touches[0].clientY;
      x0 = e.touches[0].clientX;
      touchFired = false;
    },
    { passive: true },
  );
  root.addEventListener(
    'touchmove',
    (e) => {
      if (touchFired || blocked()) return;
      const dy = y0 - e.touches[0].clientY, dx = x0 - e.touches[0].clientX;
      if (Math.abs(dy) > 34 && Math.abs(dy) > Math.abs(dx) * 1.2) {
        touchFired = true;
        go(dy > 0 ? 1 : -1);
      }
    },
    { passive: true },
  );

  addEventListener('keydown', (e) => {
    if (blocked() || e.altKey || e.ctrlKey || e.metaKey) return;
    const el = e.target instanceof Element ? e.target : null;
    if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    const onControl = !!el?.closest('a, button, summary');
    if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === 'ArrowRight' || (e.key === ' ' && !onControl)) {
      e.preventDefault();
      go(1);
    } else if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      go(-1);
    }
  });
}
