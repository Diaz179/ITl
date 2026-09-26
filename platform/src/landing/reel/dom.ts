/**
 * DOM overlay of the reel: the opening logo (CSS on first load, then driven by T), captions and
 * labels placed from the shared layout, the final product panel, and the film HUD.
 * Only transform and opacity change per frame; each style write is skipped when unchanged.
 */
import { BEAT, D, HOLDS, SCENES, backOut, expoIn, inOutCubic, range, sceneAt, smooth } from './time';
import { L, OUT } from './scenes';

const IT = ['моточасы', 'масло', 'местоположение', 'пробег', 'в\u00a0одном кабинете'];
const FORM = ['циферблат', 'циферблат → капля', 'капля → метка', 'метка → окно счётчика', 'окно → знак'];
const DATA = [
  'моточасы · из\u00a0ЭБУ или по\u00a0фото счётчика',
  'масло · уровень, давление, температура',
  'местоположение · по\u00a0трекеру или телефону',
  'пробег · без накрутки на\u00a0стоянке',
  'всё · в\u00a0одном кабинете',
];
/** Film windows in which each scene's DOM layer is on screen. */
const WIN: Array<[number, number]> = [
  [-1, 1.87],
  [2.6, HOLDS[1] + 0.15],
  [3.9, HOLDS[2] + 0.2],
  [6.0, HOLDS[3] + 0.25],
  [9.1, HOLDS[4] + 0.15],
  [11.2, HOLDS[5]],
  [HOLDS[5] + 1e-4, HOLDS[6]],
  [16.1, 99],
];

export class Overlay {
  private sc: HTMLElement[];
  private on: boolean[];
  private pin = new Map<string, HTMLElement>();
  private last = new Map<HTMLElement, string>();
  private lastO = new Map<HTMLElement, string>();
  private s0: { root: HTMLElement; ring: HTMLElement; dot: SVGSVGElement; knock: SVGCircleElement; orbit: HTMLElement; spin: SVGSVGElement; thin: HTMLElement };
  private spin0 = 0;
  private spinAt = 0;
  private hud: { scene: HTMLElement; tc: HTMLElement; fps: HTMLElement; beat: HTMLElement[]; hint: HTMLElement; fill: HTMLElement; chapters: HTMLButtonElement[]; live: HTMLElement };
  private text = new Map<HTMLElement, string>();
  private rises: HTMLElement[];
  // looked up once, not per frame
  private s1sub: HTMLElement | null;
  private s3form: HTMLElement | null;
  private s3a: HTMLElement | null;
  private s3b: HTMLElement | null;
  private s5state: HTMLElement | null;
  private s5n: HTMLElement | null;
  private s5mi: HTMLElement[];
  private s5mono: HTMLElement | null;
  private mi = new Map<string, HTMLElement | null>();
  private cur = -1;
  private beat = -1;
  private dark = true;
  private fpsT = 0;
  private fpsN = 0;
  onChapter: (k: number) => void = () => {};

  constructor(private reduced: boolean) {
    this.sc = Array.from(document.querySelectorAll<HTMLElement>('.sc'));
    this.on = this.sc.map(() => false);
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-p]'))) this.pin.set(el.dataset.p!, el);
    const r = document.querySelector<HTMLElement>('.s0')!;
    this.s0 = {
      root: r,
      ring: r.querySelector('.s0-ring')!,
      dot: r.querySelector('.s0-dot')!,
      knock: r.querySelector('.s0-knock')!,
      orbit: r.querySelector('.s0-orbit')!,
      spin: r.querySelector('.s0-orbit svg')!,
      thin: r.querySelector('.s0-thin')!,
    };
    const q = <T extends Element>(s: string) => document.querySelector<T>(s)!;
    const chapters = q<HTMLElement>('[data-hud-chapters]');
    this.hud = {
      scene: q('[data-hud-scene]'),
      tc: q('[data-hud-tc]'),
      fps: q('[data-hud-fps]'),
      beat: Array.from(document.querySelectorAll<HTMLElement>('[data-hud-beat] i')),
      hint: q('[data-hud-hint]'),
      fill: q('[data-hud-fill]'),
      chapters: SCENES.map((s, i) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('aria-label', `Сцена ${i + 1} из\u00a0${SCENES.length}: ${s.title}`);
        b.addEventListener('click', () => this.onChapter(i));
        li.append(b);
        chapters.append(li);
        return b;
      }),
      live: q('[data-live]'),
    };
    this.rises = Array.from(document.querySelectorAll<HTMLElement>('.s7 [data-rise]'));
    this.s1sub = this.pin.get('s1u')?.querySelector('.mono') ?? null;
    this.s3form = this.pin.get('s3form')?.querySelector('[data-s3-form]') ?? null;
    this.s3a = this.pin.get('s3word')?.querySelector('[data-w="a"]') ?? null;
    this.s3b = this.pin.get('s3word')?.querySelector('[data-w="b"]') ?? null;
    this.s5state = this.pin.get('s5tag')?.querySelector('[data-s5-state]') ?? null;
    this.s5n = this.pin.get('s5tag')?.querySelector('[data-s5-n]') ?? null;
    this.s5mi = Array.from(this.pin.get('s5big')?.querySelectorAll<HTMLElement>('.mi') ?? []);
    this.s5mono = this.pin.get('s5big')?.querySelector('.mono') ?? null;
    for (const [k, el] of this.pin) this.mi.set(k, el.querySelector<HTMLElement>('.mi'));
    if (matchMedia('(pointer: coarse)').matches) this.hud.hint.textContent = 'проведите вверх';
  }

  private tf(el: HTMLElement | SVGElement, v: string) {
    const e = el as HTMLElement;
    if (this.last.get(e) !== v) {
      this.last.set(e, v);
      e.style.transform = v;
    }
  }
  private op(el: HTMLElement | SVGElement, a: number) {
    const e = el as HTMLElement, v = a >= 0.999 ? '1' : a <= 0.001 ? '0' : a.toFixed(3);
    if (this.lastO.get(e) !== v) {
      this.lastO.set(e, v);
      e.style.opacity = v;
    }
  }
  private txt(el: HTMLElement, v: string) {
    if (this.text.get(el) !== v) {
      this.text.set(el, v);
      el.textContent = v;
    }
  }
  /** Pins an element at (x, y) with an alignment offset in % of its own box. */
  private at(key: string, x: number, y: number, ax = 0, ay = 0, a = 1) {
    const el = this.pin.get(key);
    if (!el) return;
    this.tf(el, `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(${ax}%,${ay}%)`);
    this.op(el, a);
  }
  /** Masked rise of the .mi inside an element: p 0 → hidden below, 1 → in place, >1 overshoot. */
  private rise(key: string, p: number, out = 0) {
    const el = this.mi.get(key);
    if (el) this.tf(el, `translate3d(0,${((1 - p) * 110 - out * 110).toFixed(2)}%,0)`);
  }

  /** First load: the CSS intro has played; from here the logo is driven by film time. */
  takeover(nowS: number) {
    const a = this.s0.spin.getAnimations()[0];
    if (a && typeof a.currentTime === 'number') this.spin0 = ((a.currentTime - 900) / 18000) * 360;
    this.spinAt = nowS;
    this.s0.root.classList.remove('is-css');
  }

  announce(k: number) {
    this.hud.live.textContent = `Сцена ${k + 1} из\u00a0${SCENES.length}: ${SCENES[k].title}`;
  }

  update(T: number, now: number, dt: number, K: number) {
    for (let i = 0; i < this.sc.length; i++) {
      const [a, b] = WIN[i];
      const show = (T >= a && T <= b) || (i === K && Math.abs(T - HOLDS[K]) < 1e-4);
      if (show !== this.on[i]) {
        this.on[i] = show;
        this.sc[i].classList.toggle('on', show);
      }
    }
    if (this.on[0]) this.scene0(T, now);
    if (this.on[1]) this.scene1(T);
    if (this.on[2]) this.scene2(T);
    if (this.on[3]) this.scene3(T);
    if (this.on[4]) this.scene4(T);
    if (this.on[5]) this.scene5(T);
    if (this.on[7]) this.scene7(T);
    this.hudUpdate(T, dt, K);
  }

  private scene0(T: number, now: number) {
    const s = this.s0;
    const a = range(T, HOLDS[0], 1.64), c = range(T, 1.64, 1.86);
    this.tf(s.ring, `scale(${((1 + 0.06 * smooth(a)) * (1 - expoIn(c))).toFixed(4)})`);
    const e = inOutCubic(c);
    this.tf(s.dot, `translate(${(-13.125 * e).toFixed(3)}%,${(22.73 * e).toFixed(3)}%)`);
    s.knock.setAttribute('r', (8.8 - 2.4 * c).toFixed(2));
    this.op(s.orbit, 1 - range(T, HOLDS[0], 1.62));
    this.tf(s.orbit, `translate(-50%,-50%) scale(${(1 + 0.25 * a).toFixed(4)})`);
    const ang = this.reduced ? 0 : this.spin0 + (now - this.spinAt) * 20;
    this.tf(s.spin, `rotate(${ang.toFixed(2)}deg)`);
    this.op(s.thin, 0.2 * (1 - range(T, 1.5, 1.8)));
    this.tf(s.thin, `translate(-50%,-50%) scale(${(1 + 0.12 * a).toFixed(4)})`);
  }

  private scene1(T: number) {
    const u = OUT.wmU, fade = 1 - range(T, HOLDS[1], HOLDS[1] + 0.1);
    const sc = this.sc[1];
    sc.style.setProperty('--u', u.toFixed(4));
    const lab = range(T, 2.8, 3.05) * fade;
    this.at('s1l', OUT.wmX0, OUT.ruleY - 10, 0, -100, lab);
    this.at('s1r', OUT.wmX1, OUT.ruleY - 10, -100, -100, lab);
    this.at('s1u', L.cx, OUT.wmBase + 30 * u, -50, 0, 1);
    this.rise('s1u', backOut(range(T, 2.85, 3.3), 1.4), expoIn(range(T, HOLDS[1], HOLDS[1] + 0.12)));
    if (this.s1sub) this.op(this.s1sub, range(T, 3.05, 3.35) * fade);
  }

  private scene2(T: number) {
    const fade = 1 - range(T, HOLDS[2], HOLDS[2] + 0.12);
    const x0 = L.portrait ? L.W * 0.1 : L.W * 0.06;
    this.at('s2h', x0, L.H * (L.portrait ? 0.16 : 0.15), 0, 0, fade);
    this.rise('s2h', backOut(range(T, 3.95, 4.35), 1.3));
    this.at('s2note', L.portrait ? x0 : L.W * 0.94, L.H * (L.portrait ? 0.235 : 0.16), L.portrait ? 0 : -100, 0, range(T, 4.1, 4.4) * fade);
    for (let i = 0; i < 4; i++) {
      const p = backOut(range(T, 3.98 + i * 0.05, 4.4 + i * 0.05), 1.2);
      const y = OUT.rowY[i] + (1 - p) * 14;
      if (L.portrait) this.at(`row${i}`, OUT.ax, y - 16, 0, -100, Math.min(1, p) * fade);
      else this.at(`row${i}`, x0, y, 0, -50, Math.min(1, p) * fade);
    }
    this.at('s2b', OUT.bx, OUT.rowY[0] - (L.portrait ? 44 : 22), -100, -100, range(T, 4.3, 4.55) * fade);
    this.at('s2off', OUT.offX, OUT.offY - 14, -50, -100, OUT.offOn * fade);
  }

  private scene3(T: number) {
    const vis = range(T, 6.1, 6.4) * (1 - range(T, HOLDS[3], HOLDS[3] + 0.15));
    const { s3x: x, s3y: y, s3R: R } = OUT;
    const j = Math.max(0, Math.min(4, OUT.reading));
    if (this.s3form) this.txt(this.s3form, FORM[j]);
    const data = this.pin.get('s3data');
    if (data) this.txt(data, DATA[j]);
    if (L.portrait) {
      this.at('s3form', L.W * 0.08, L.H * 0.125, 0, 0, vis);
      this.at('s3data', L.W * 0.08, L.H * 0.125 + 52, 0, 0, vis);
    } else {
      this.at('s3form', x - R * 2.45, y, -100, -50, vis);
      this.at('s3data', x + R * 2.45, y, 0, -50, vis);
    }
    this.at('s3word', x, y + R * (L.portrait ? 2.25 : 2.3), -50, 0, vis);
    // the word rolls: the previous reading leaves upwards while the new one rises in
    const a = this.s3a, b = this.s3b;
    if (a && b) {
      const t = OUT.readingT, prev = OUT.reading > 0 ? OUT.readingPrev : 0;
      this.txt(a, IT[prev]);
      this.txt(b, IT[j]);
      // the old word clears the mask before the new one arrives, so the two never overlap
      const e = backOut(range(t, 0.25, 1), 1.2);
      this.tf(a, `translate3d(0,${(-140 * (1 - (1 - Math.min(1, t * 2.6)) ** 3)).toFixed(2)}%,0)`);
      this.tf(b, `translate3d(0,${((1 - e) * 110).toFixed(2)}%,0)`);
      this.op(a, j === prev ? 0 : 1 - range(t, 0.05, 0.35));
    }
  }

  private scene4(T: number) {
    const fade = 1 - range(T, HOLDS[4], HOLDS[4] + 0.12);
    this.at('s4h', L.portrait ? L.W * 0.08 : L.W * 0.06, L.H * (L.portrait ? 0.14 : 0.15), 0, 0, fade);
    this.rise('s4h', backOut(range(T, 9.95, 10.35), 1.3));
    this.at('s4list', L.portrait ? L.W * 0.08 : L.W * 0.06, L.H * (L.portrait ? 0.14 : 0.15) + (L.portrait ? 44 : 64), 0, 0, range(T, 10.1, 10.4) * fade);
    this.at('s4stats', L.cx, L.H * (L.portrait ? 0.8 : 0.86), -50, 0, range(T, 9.3, 9.6) * fade);
  }

  private scene5(T: number) {
    const tag = this.pin.get('s5tag');
    if (tag && this.s5state && this.s5n) {
      const n = OUT.stored;
      const label = !OUT.inCover ? 'нет сети · в\u00a0памяти' : n > 0 ? 'сеть есть · досылаем' : 'на\u00a0связи';
      this.txt(this.s5state, label);
      this.txt(this.s5n, n > 0 ? String(n) : '✓');
      tag.classList.toggle('is-off', !OUT.inCover);
    }
    const flip = OUT.tagX > L.W - 200;
    this.at('s5tag', OUT.tagX + (flip ? -14 : 14), OUT.tagY - 14, flip ? -100 : 0, -100, OUT.tagOn * range(T, 11.5, 11.7));
    this.at('s5big', L.portrait ? L.W * 0.08 : L.W * 0.06, L.H * (L.portrait ? 0.14 : 0.15), 0, 0, 1);
    for (let i = 0; i < this.s5mi.length; i++)
      this.tf(this.s5mi[i], `translate3d(0,${((1 - backOut(range(T, 12.75 + i * 0.08, 13.2 + i * 0.08), 1.3)) * 110).toFixed(2)}%,0)`);
    if (this.s5mono) this.op(this.s5mono, range(T, 13.0, 13.3));
  }

  private scene7(T: number) {
    const sc = this.sc[7];
    sc.style.setProperty('--lock-bottom', `${OUT.lockBottom.toFixed(1)}px`);
    this.at('s7it', L.cx, OUT.lockBottom + 4, -50, 0, 1);
    this.rise('s7it', backOut(range(T, 16.42, 16.82), 1.3));
    for (let i = 0; i < this.rises.length; i++) {
      const el = this.rises[i];
      const p = backOut(range(T, 16.5 + i * 0.08, 16.95 + i * 0.08), 1.25);
      this.tf(el, `translate3d(0,${((1 - p) * 26).toFixed(2)}px,0)`);
      this.op(el, Math.min(1, p * 1.4));
    }
    sc.classList.toggle('is-live', T >= HOLDS[7] - 0.4);
  }

  private hudUpdate(T: number, dt: number, K: number) {
    const i = sceneAt(T);
    if (i !== this.cur) {
      this.cur = i;
      this.txt(this.hud.scene, `${String(i + 1).padStart(2, '0')}\u00a0— ${SCENES[i].title}`);
      for (let k = 0; k < this.hud.chapters.length; k++) this.hud.chapters[k].setAttribute('aria-current', String(k === i));
    }
    const s = Math.floor(T), f = Math.floor((T - s) * 60);
    this.txt(this.hud.tc, `00:00:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`);
    const beat = Math.floor(T / BEAT + 1e-4) % 4;
    if (beat !== this.beat) {
      this.beat = beat;
      for (let k = 0; k < this.hud.beat.length; k++) this.hud.beat[k].classList.toggle('on', k === beat);
    }
    this.tf(this.hud.fill, `scaleX(${(T / D).toFixed(4)})`);
    const atRest = Math.abs(T - HOLDS[K]) < 1e-4;
    this.op(this.hud.hint, atRest && K > 0 && K < SCENES.length - 1 ? 1 : 0);
    this.fpsT += dt;
    this.fpsN++;
    if (this.fpsT >= 0.5) {
      this.txt(this.hud.fps, `${Math.min(60, Math.round(this.fpsN / this.fpsT))} к/с`);
      this.fpsT = 0;
      this.fpsN = 0;
    }
  }

  /** HUD ink follows the background: dark type on bone, lime and сурик; bone on ink and синька. */
  setHudDark(bgLum: number) {
    const dark = bgLum < 0.3;
    if (dark !== this.dark) {
      this.dark = dark;
      document.documentElement.classList.toggle('hud-ink', !dark);
    }
  }
}
