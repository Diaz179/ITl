import { capAt, clamp, D, INTRO_END } from './time';

/**
 * The playhead behaves like a heavy mass pushed by the scroll: it accelerates with a limit,
 * cruises under a speed cap (lower inside transformations), and eases into the target without overshoot.
 * A hard flick moves the target far ahead; the film still plays every frame on the way.
 */
export class Playhead {
  t = 0;
  v = 0;
  target = INTRO_END;
  autoplay = true;
  private readonly k = 2.1;
  private readonly aDec = 3.4;
  private readonly aMax = 4.8;
  private readonly tau = 0.11;

  constructor(start = 0) {
    this.t = start;
  }

  private capAhead(dir: number): number {
    let cap = capAt(this.t);
    for (const k of [0.3, 0.6, 0.9]) cap = Math.min(cap, capAt(clamp(this.t + dir * k, 0, D)));
    return cap;
  }

  update(dtReal: number) {
    const dt = Math.min(dtReal, 1 / 20);
    if (this.autoplay && this.t < INTRO_END && this.target <= INTRO_END + 1e-6) {
      this.v = 1;
      this.t = Math.min(INTRO_END, this.t + dt);
      if (this.t >= INTRO_END) this.v = 0;
      return;
    }
    this.autoplay = false;
    const e = this.target - this.t;
    if (Math.abs(e) < 2e-4 && Math.abs(this.v) < 2e-3) {
      this.t = this.target;
      this.v = 0;
      return;
    }
    const dir = Math.sign(e);
    const cap = this.capAhead(dir);
    const vDes = dir * Math.min(cap, this.k * Math.abs(e), Math.sqrt(2 * this.aDec * Math.abs(e)));
    const a = clamp((vDes - this.v) / this.tau, -this.aMax, this.aMax);
    this.v += a * dt;
    this.t = clamp(this.t + this.v * dt, 0, D);
  }
}
