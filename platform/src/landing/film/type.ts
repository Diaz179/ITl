/**
 * Kinetic typography: every scene uses its own technique, all driven by film time T,
 * so the words play backwards as faithfully as forwards.
 */
import { m4, type V3 } from './gl/core';
import type { Stage } from './gl/stage';
import { OIL, R_RING, machineU, ringModel, ringState } from './choreo';
import { clamp01, inCubic, lerp, outCubic, outQuart, range, settle, smooth } from './time';

interface Fx {
  el: HTMLElement;
  tin: number;
  tout: number;
  update: (T: number) => void;
}

const GLYPHS = 'АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЭЮЯ0123456789';
const ru = (v: number, digits: number) => v.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace(/\u202f/g, '\u00a0');

function seeded(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Wraps words (split on ordinary spaces only, so no-break pairs stay together) in masks. */
function splitWords(el: HTMLElement): HTMLElement[] {
  const words: HTMLElement[] = [];
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const parts = (child.textContent ?? '').split(/( +)/);
        const frag = document.createDocumentFragment();
        for (const part of parts) {
          if (!part) continue;
          if (/^ +$/.test(part)) frag.append(' ');
          else {
            const w = document.createElement('span');
            w.className = 'w';
            const i = document.createElement('span');
            i.className = 'wi';
            i.textContent = part;
            w.append(i);
            frag.append(w);
            words.push(i);
          }
        }
        child.replaceWith(frag);
      } else if (child instanceof HTMLElement && !child.classList.contains('visually-hidden')) walk(child);
    }
  };
  walk(el);
  return words;
}

function hiddenCopy(el: HTMLElement): HTMLElement {
  const text = el.textContent ?? '';
  const vis = document.createElement('span');
  vis.setAttribute('aria-hidden', 'true');
  vis.className = 'fx-vis';
  while (el.firstChild) vis.append(el.firstChild);
  const sr = document.createElement('span');
  sr.className = 'visually-hidden';
  sr.textContent = text;
  el.append(sr, vis);
  return vis;
}

export class TypeLayer {
  private fx: Fx[] = [];
  private scenes: Array<{ el: HTMLElement; copy: HTMLElement | null; a: number; b: number; liveA: number; liveB: number; shown: boolean }> = [];

  constructor(root: ParentNode, private stage: Stage | null) {
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-fx]'))) this.register(el);
    for (const s of Array.from(root.querySelectorAll<HTMLElement>('.scene'))) {
      const own = this.fx.filter((f) => f.el.closest('.scene') === s);
      const a = Math.min(...own.map((f) => f.tin)) - 0.15;
      const outs = own.map((f) => f.tout);
      const b = Math.max(...outs) + 0.9;
      const lastIn = Math.max(...own.filter((f) => f.el.matches('.cta, .get, .more, [data-fx=fade]')).map((f) => f.tin), a);
      this.scenes.push({ el: s, copy: s.querySelector('.copy'), a, b, liveA: lastIn + 0.2, liveB: Math.min(...outs), shown: true });
    }
  }

  /** Film time window in which a scene is fully on screen (for focus and chapter jumps). */
  liveTime(scene: HTMLElement): number | null {
    const s = this.scenes.find((x) => x.el === scene);
    if (!s) return null;
    return Number.isFinite(s.liveB) ? (s.liveA + s.liveB) / 2 : s.liveA + 0.3;
  }

  private register(el: HTMLElement) {
    const kind = el.dataset.fx!;
    const tin = Number(el.dataset.in ?? 0);
    const tout = el.dataset.out ? Number(el.dataset.out) : Infinity;
    const make = (update: (T: number) => void) => this.fx.push({ el, tin, tout, update });
    switch (kind) {
      case 'fade':
      case 'hint':
        make((T) => {
          const p = settle(range(T, tin, tin + 0.8), 0.05);
          const q = inCubic(range(T, tout, tout + 0.45));
          el.style.opacity = String(clamp01(Math.min(p * 1.6, 1) * (1 - q)));
          el.style.transform = `translate3d(0, ${(1 - p) * 26 - q * 18}px, 0)`;
          el.style.visibility = p <= 0 || q >= 1 ? 'hidden' : 'visible';
        });
        break;
      case 'rise': {
        const words = splitWords(el);
        make((T) => {
          let ex = 0;
          words.forEach((w, i) => {
            const a = range(T, tin + i * 0.045, tin + i * 0.045 + 0.85);
            const p = settle(a, 0.07);
            const e = inCubic(range(T, tout + i * 0.022, tout + i * 0.022 + 0.5));
            ex = Math.max(ex, e);
            w.style.transform = `translate3d(0, ${(1 - p) * 112 - e * 112}%, 0) rotate(${(1 - p) * 8}deg)`;
          });
          el.style.filter = ex > 0.01 ? `blur(${ex * 6}px)` : '';
          el.style.visibility = T < tin || ex >= 1 ? 'hidden' : 'visible';
        });
        break;
      }
      case 'roll':
        this.roll(el, tin, tout, make);
        break;
      case 'flap':
        this.flap(el, tin, tout, make);
        break;
      case 'scan': {
        const glitch = el.querySelector<HTMLElement>('.glitch');
        make((T) => {
          const p = outCubic(range(T, tin, tin + 0.7));
          const cover = this.stage ? this.stage.coverEnterT : 13.6;
          const dim = smooth(range(T, cover, cover + 0.4));
          const q = inCubic(range(T, tout, tout + 0.45));
          el.style.clipPath = `inset(-0.2em ${(1 - p) * 100}% -0.2em 0)`;
          el.style.setProperty('--scan', String(p));
          el.style.setProperty('--scan-on', String(p > 0 && p < 1 ? 1 : 0));
          el.style.opacity = String((1 - dim * 0.55) * (1 - q));
          if (glitch) {
            const dead = T > tin + 0.5 && T < cover;
            const k = Math.floor(T * 14);
            const flick = dead && seeded(k * 7919 + 13)() > 0.72;
            glitch.style.opacity = flick ? '0.35' : '1';
            glitch.style.textShadow = dead ? `${flick ? 3 : 1}px 0 rgba(255,90,31,.55), ${flick ? -3 : -1}px 0 rgba(61,220,245,.45)` : '';
          }
          el.style.visibility = T < tin || q >= 1 ? 'hidden' : 'visible';
        });
        break;
      }
      case 'tune':
        make((T) => {
          const cover = this.stage ? this.stage.coverEnterT : 13.6;
          const start = Math.max(tin, cover + 0.05);
          const p = settle(range(T, start, start + 0.75), 0.06);
          const q = inCubic(range(T, tout, tout + 0.45));
          const k = 1 - p;
          el.style.opacity = String(clamp01(p * 1.4) * (1 - q));
          el.style.filter = k > 0.01 ? `blur(${k * 9}px)` : '';
          el.style.letterSpacing = `${k * 0.32 - 0.035}em`;
          el.style.textShadow = k > 0.01 ? `${k * 7}px 0 rgba(255,90,31,.6), ${-k * 7}px 0 rgba(61,220,245,.55)` : '';
          el.style.visibility = p <= 0 || q >= 1 ? 'hidden' : 'visible';
        });
        break;
      case 'liquid':
        make((T) => {
          const rise = settle(range(T, tin, tin + 0.8), 0.06);
          const fill = 0.18 + 0.42 * smooth(range(T, tin + 0.2, OIL.impact)) + 0.26 * settle(range(T, OIL.impact, OIL.impact + 0.6), 0.1);
          const q = inCubic(range(T, tout, tout + 0.45));
          el.style.setProperty('--fill', `${(fill * 100).toFixed(2)}%`);
          el.style.setProperty('--wave', `${(performance.now() / 22) % 240}px`);
          el.style.opacity = String(clamp01(rise * 1.5) * (1 - q));
          el.style.transform = `translate3d(0, ${(1 - rise) * 40 - q * 24}px, 0)`;
          el.style.visibility = T < tin || q >= 1 ? 'hidden' : 'visible';
        });
        break;
      case 'track':
        make((T) => {
          const p = settle(range(T, tin, tin + 1.0), 0.05);
          el.style.letterSpacing = `${lerp(0.55, -0.055, p)}em`;
          el.style.filter = p < 0.99 ? `blur(${(1 - clamp01(p)) * 14}px)` : '';
          el.style.opacity = String(clamp01(p * 1.3));
          el.style.visibility = T < tin ? 'hidden' : 'visible';
        });
        break;
      case 'count': {
        const from = Number(el.dataset.from), to = Number(el.dataset.to), dur = Number(el.dataset.dur ?? 0.8), digits = Number(el.dataset.digits ?? 0);
        let last = '';
        // counters sit inside an animated parent: follow its visibility instead of the [data-fx] default
        el.style.visibility = 'inherit';
        make((T) => {
          // data never overshoots: a spring here once printed «−198 из 5 425»
          const v = lerp(from, to, outQuart(range(T, tin, tin + dur)));
          const s = ru(v, digits);
          if (s !== last) el.textContent = last = s;
        });
        break;
      }
      case 'chip':
        this.chip(el, tin, tout, make);
        break;
      case 'anchor':
        this.anchor(el, tin, tout, make);
        break;
      case 'machine':
        this.machine(el, tin, tout, make);
        break;
      case 'vial':
        make((T) => {
          const p = settle(range(T, tin, tin + 0.6), 0.2);
          const q = inCubic(range(T, tout, tout + 0.4));
          const s = this.stage;
          if (!s) return;
          const level = OIL.level(T);
          const lv = 0.12 + level * 0.0068;
          const x = s.vial.x + s.vial.w + 14;
          const y = s.vial.y + s.vial.h * (1 - lv);
          el.style.transform = `translate3d(${x}px, ${y}px, 0) translate(0, -50%) scale(${0.6 + 0.4 * p})`;
          el.style.opacity = String(clamp01(p) * (1 - q));
          el.style.visibility = p <= 0 || q >= 1 ? 'hidden' : 'visible';
        });
        break;
    }
  }

  /** Letters roll into place through a strip of glyphs, like the drum counter beside them. */
  private roll(el: HTMLElement, tin: number, tout: number, make: (u: (T: number) => void) => void) {
    const vis = hiddenCopy(el);
    const text = vis.textContent ?? '';
    vis.textContent = '';
    const strips: Array<{ s: HTMLElement; c: HTMLElement; n: number; m: string }> = [];
    const rnd = seeded(4242);
    for (const [wi, word] of text.split(' ').entries()) {
      if (wi) vis.append(' ');
      const w = document.createElement('span');
      w.className = 'rw';
      for (const ch of word) {
        const c = document.createElement('span');
        c.className = 'rc';
        const s = document.createElement('span');
        s.className = 'rs';
        const n = 5 + Math.floor(rnd() * 4);
        const glyphs = Array.from({ length: n }, () => GLYPHS[Math.floor(rnd() * GLYPHS.length)]);
        glyphs.push(ch, GLYPHS[Math.floor(rnd() * GLYPHS.length)]);
        for (const g of glyphs) {
          const gi = document.createElement('span');
          gi.textContent = g;
          s.append(gi);
        }
        c.append(s);
        w.append(c);
        strips.push({ s, c, n, m: '' });
      }
      vis.append(w);
    }
    make((T) => {
      let ex = 0;
      strips.forEach((st, i) => {
        const { s, c, n } = st;
        const p = settle(range(T, tin + i * 0.028, tin + i * 0.028 + 0.9), 0.1);
        const e = inCubic(range(T, tout + i * 0.012, tout + i * 0.012 + 0.45));
        ex = Math.max(ex, e);
        const step = p * n + e * 1.0;
        s.style.transform = `translate3d(0, ${(-step / (n + 2)) * 100}%, 0)`;
        // edge fade peaks mid-roll and is gone once the letter rests
        const q = clamp01(p);
        const m = Math.max(4 * q * (1 - q), 4 * e * (1 - e)).toFixed(2);
        if (m !== st.m) c.style.setProperty('--m', (st.m = m));
      });
      el.style.opacity = String(1 - ex);
      el.style.visibility = T < tin || ex >= 1 ? 'hidden' : 'visible';
    });
  }

  /** Split-flap board: each cell folds its upper leaf down onto the next letter, then bounces. */
  private flap(el: HTMLElement, tin: number, tout: number, make: (u: (T: number) => void) => void) {
    const words = (el.dataset.words ?? '').split('|').map((w) => w.toUpperCase());
    const at = (el.dataset.at ?? '').split('|').map(Number);
    const n = Math.max(...words.map((w) => w.length));
    const cells: Array<{ c: HTMLElement; t: HTMLElement; b: HTMLElement; lt: HTMLElement; lb: HTMLElement; lti: HTMLElement; lbi: HTMLElement; ti: HTMLElement; bi: HTMLElement; state: string }> = [];
    const mk = (cls: string) => {
      const h = document.createElement('span');
      h.className = cls;
      const i = document.createElement('i');
      h.append(i);
      return { h, i };
    };
    for (let k = 0; k < n; k++) {
      const c = document.createElement('span');
      c.className = 'fc';
      const t = mk('fc__t'), b = mk('fc__b'), lt = mk('fc__lt'), lb = mk('fc__lb');
      c.append(t.h, b.h, lt.h, lb.h);
      el.append(c);
      cells.push({ c, t: t.h, b: b.h, lt: lt.h, lb: lb.h, ti: t.i, bi: b.i, lti: lt.i, lbi: lb.i, state: '' });
    }
    const charAt = (j: number, k: number) => (j < 0 ? ' ' : words[j][k] ?? ' ');
    make((T) => {
      const p = settle(range(T, tin, tin + 0.5), 0.05);
      const q = inCubic(range(T, tout, tout + 0.45));
      el.style.opacity = String(clamp01(p * 1.5) * (1 - q));
      el.style.transform = `translate3d(0, ${(1 - p) * 18 - q * 14}px, 0)`;
      el.style.visibility = T < tin || q >= 1 ? 'hidden' : 'visible';
      cells.forEach((c, k) => {
        let j = -1;
        for (let w = 0; w < at.length; w++) if (T >= at[w] + k * 0.022) j = w;
        const prev = charAt(j - 1, k), next = charAt(j, k);
        const start = j >= 0 ? at[j] + k * 0.022 : 0;
        const f = j >= 0 ? range(T, start, start + 0.22) : 1;
        const key = `${j}|${f >= 1 ? 1 : 0}`;
        if (key !== c.state) {
          c.ti.textContent = next;
          c.bi.textContent = f >= 1 ? next : prev;
          c.lti.textContent = prev;
          c.lbi.textContent = next;
          // unused cells of the board go dark instead of showing empty tiles
          c.c.classList.toggle('is-blank', prev === ' ' && next === ' ');
          c.state = key;
        }
        if (f >= 1 || j < 0) {
          c.lt.style.transform = 'rotateX(-90deg)';
          c.lb.style.transform = 'rotateX(90deg)';
          c.lt.style.visibility = c.lb.style.visibility = 'hidden';
        } else {
          c.lt.style.visibility = c.lb.style.visibility = '';
          const a = Math.min(1, f / 0.5);
          const b = settle(clamp01((f - 0.45) / 0.55), 0.18);
          c.lt.style.transform = `rotateX(${-90 * a * a}deg)`;
          c.lb.style.transform = `rotateX(${90 * (1 - b)}deg)`;
          c.lt.style.visibility = a >= 1 ? 'hidden' : 'visible';
          c.lb.style.visibility = f < 0.45 ? 'hidden' : 'visible';
        }
      });
    });
  }

  private ringPoint(T: number, local: V3): [number, number, number] | null {
    if (!this.stage) return null;
    const m = ringModel(ringState(T));
    return this.stage.project(m4.transform(m, local));
  }

  /** Source chips swing in along an orbit round the dial and dock at four points. */
  private chip(el: HTMLElement, tin: number, tout: number, make: (u: (T: number) => void) => void) {
    const i = Number(el.dataset.i ?? 0);
    const final = [-55, 55, 125, 235][i] * (Math.PI / 180);
    make((T) => {
      const p = settle(range(T, tin, tin + 0.9), 0.08);
      const q = inCubic(range(T, tout, tout + 0.45));
      const a = final - (1 - p) * 1.9;
      const r = R_RING * (1.62 + q * 0.7);
      const pt = this.ringPoint(T, [Math.sin(a) * r, Math.cos(a) * r, 0.12]);
      if (!pt) return;
      el.style.transform = `translate3d(${pt[0]}px, ${pt[1]}px, 0) translate(-50%, -50%) scale(${0.7 + 0.3 * clamp01(p)})`;
      el.style.opacity = String(clamp01(p * 1.4) * (1 - q));
      el.style.visibility = p <= 0 || q >= 1 ? 'hidden' : 'visible';
    });
  }

  private anchor(el: HTMLElement, tin: number, tout: number, make: (u: (T: number) => void) => void) {
    const where: V3 = el.dataset.anchor === 'unit' ? [0.37, 0.0, 0.05] : [0, -0.215, 0.04];
    make((T) => {
      const p = settle(range(T, tin, tin + 0.6), 0.06);
      const q = inCubic(range(T, tout, tout + 0.4));
      const pt = this.ringPoint(T, where);
      if (!pt) return;
      el.style.transform = `translate3d(${pt[0]}px, ${pt[1]}px, 0) translate(${el.dataset.anchor === 'unit' ? '0' : '-50%'}, -50%)`;
      el.style.opacity = String(clamp01(p) * (1 - q));
      el.style.visibility = p <= 0 || q >= 1 ? 'hidden' : 'visible';
    });
  }

  /** The memory tag follows the machine: it fills while there is no network and drains on the way back. */
  private machine(el: HTMLElement, tin: number, tout: number, make: (u: (T: number) => void) => void) {
    const count = el.querySelector<HTMLElement>('[data-mem]')!;
    const state = el.querySelector<HTMLElement>('[data-mem-state]')!;
    let last = '';
    make((T) => {
      const s = this.stage;
      if (!s) return;
      const p = settle(range(T, tin, tin + 0.5), 0.1);
      const q = inCubic(range(T, tout, tout + 0.4));
      const dot = s.dotAt(T);
      const pt = s.project(dot.pos);
      el.style.transform = `translate3d(${pt[0] + 18}px, ${pt[1] - 18}px, 0) translate(0, -100%)`;
      el.style.opacity = String(clamp01(p) * (1 - q));
      el.style.visibility = p <= 0 || q >= 1 ? 'hidden' : 'visible';
      const n = s.storedAt(T);
      const inCover = T >= s.coverEnterT;
      const label = !inCover ? 'нет сети · копим' : n > 0 ? 'сеть есть · досылаем' : 'на\u00a0связи';
      const key = `${label}|${n}`;
      if (key !== last) {
        state.textContent = label;
        count.textContent = n > 0 ? `${n}` : '✓';
        el.classList.toggle('is-off', !inCover);
        last = key;
      }
      void machineU;
    });
  }

  update(T: number, sway: number) {
    for (const s of this.scenes) {
      const on = T >= s.a && T <= s.b;
      if (on !== s.shown) {
        // a jump (chapter cut, reduced motion) can skip an element's own fade-out; settle it before hiding,
        // since an inline `visible` child would otherwise show through its hidden scene
        if (!on) for (const f of this.fx) if (f.el.closest('.scene') === s.el) f.update(T);
        s.el.style.visibility = on ? 'visible' : 'hidden';
        s.shown = on;
      }
      s.el.classList.toggle('is-live', T >= s.liveA && T <= s.liveB);
      if (on && s.copy) s.copy.style.transform = `translate3d(0, ${sway * -3}px, 0) skewY(${sway * 0.55}deg)`;
    }
    for (const f of this.fx) {
      const scene = f.el.closest<HTMLElement>('.scene');
      if (scene && scene.style.visibility === 'hidden') continue;
      f.update(T);
    }
  }

  /** Reduced motion: every element shown in its final state for the current chapter. */
  still(T: number) {
    this.update(T, 0);
  }
}
