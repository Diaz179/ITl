import './landing.css';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { symbolSvg, wordmarkSvg } from '../brand/logo';
import type { Stage } from './gl/scene';

gsap.registerPlugin(ScrollTrigger, SplitText);

const root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobile = matchMedia('(max-width: 759px)').matches;
const $ = <T extends Element = HTMLElement>(s: string, el: ParentNode = document) => el.querySelector<T>(s);
const $$ = <T extends Element = HTMLElement>(s: string, el: ParentNode = document) => Array.from(el.querySelectorAll<T>(s));
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ru = (v: number, digits: number) =>
  v.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace(/\u202f/g, '\u00a0');

// ── brand marks ───────────────────────────────────────────
for (const el of $$('[data-logo]')) el.innerHTML = symbolSvg({ className: 'logo-symbol' }) + wordmarkSvg({ className: 'logo-word' });
for (const el of $$('[data-year]')) el.textContent = String(new Date().getFullYear());

// ── theme: same storage key and semantics as the cabinet ──
let stage: Stage | null = null;
function applyTheme(theme: 'dark' | 'light') {
  try {
    localStorage.setItem('itles_theme', theme);
  } catch {
    // private mode: in-memory only
  }
  root.classList.toggle('dark', theme === 'dark');
  $('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0b0c0a' : '#f3f1ea');
  stage?.setTheme({ dark: theme === 'dark' });
}
for (const b of $$('[data-theme-toggle]')) {
  const label = () => b.setAttribute('title', root.classList.contains('dark') ? 'Дневная тема' : 'Ночная тема');
  label();
  b.addEventListener('click', () => {
    applyTheme(root.classList.contains('dark') ? 'light' : 'dark');
    label();
  });
}

// ── header: solid after the fold edge, hides while reading down ──
const bar = $('[data-bar]');
let lastY = scrollY;
addEventListener(
  'scroll',
  () => {
    const y = scrollY;
    bar?.classList.toggle('is-solid', y > 24);
    const hide = y > 480 && y > lastY + 4 && !bar?.contains(document.activeElement);
    if (hide) bar?.classList.add('is-hidden');
    else if (y < lastY - 4 || y < 480) bar?.classList.remove('is-hidden');
    lastY = y;
  },
  { passive: true },
);

// ── manifesto words ───────────────────────────────────────
const manifesto = $('[data-words]');
const words: HTMLElement[] = [];
if (manifesto) {
  const nodes = Array.from(manifesto.childNodes);
  manifesto.textContent = '';
  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      // regular spaces separate words; no-break spaces keep prepositions glued to their word
      for (const part of (node.textContent ?? '').split(/( +)/)) {
        if (!part) continue;
        if (/^ +$/.test(part)) manifesto.append(part);
        else {
          const w = document.createElement('span');
          w.className = 'w';
          w.textContent = part;
          manifesto.append(w);
          words.push(w);
        }
      }
    } else if (node instanceof HTMLElement) {
      node.classList.add('w');
      manifesto.append(node);
      words.push(node);
    }
  }
}

// ── moto-hour drum ────────────────────────────────────────
interface Drum {
  set: (tenths: number) => void;
  from: number;
  to: number;
}
function buildDrum(el: HTMLElement): Drum {
  const from = Math.round(Number(el.dataset.drum) * 10);
  const to = Math.round(Number(el.dataset.drumTo ?? el.dataset.drum) * 10);
  const digits = (el.dataset.drum ?? '0').replace('.', '').length;
  const stat = $('.drum__static', el);
  stat?.classList.add('visually-hidden');
  const unit = $('.drum__unit', el);
  const strips: HTMLElement[] = [];
  for (let i = 0; i < digits; i++) {
    if (i === digits - 1) {
      const sep = document.createElement('span');
      sep.className = 'drum__sep';
      sep.setAttribute('aria-hidden', 'true');
      sep.textContent = ',';
      el.insertBefore(sep, unit);
    }
    const cell = document.createElement('span');
    cell.className = 'drum__cell' + (i === digits - 1 ? ' drum__cell--tenth' : '');
    cell.setAttribute('aria-hidden', 'true');
    const strip = document.createElement('span');
    strip.className = 'drum__strip';
    for (let d = 0; d <= 10; d++) {
      const s = document.createElement('span');
      s.textContent = String(d % 10);
      strip.append(s);
    }
    cell.append(strip);
    el.insertBefore(cell, unit);
    strips.push(strip);
  }
  const set = (v: number) => {
    for (let i = 0; i < digits; i++) {
      const k = digits - 1 - i;
      const place = 10 ** k;
      let d: number;
      if (k === 0) d = v % 10;
      else {
        const lower = (v / 10 ** (k - 1)) % 10;
        d = (Math.floor(v / place) % 10) + Math.max(0, lower - 9);
      }
      strips[i].style.transform = `translateY(${(-d * 100) / 11}%)`;
    }
    if (stat) stat.textContent = `${ru(v / 10, 1)} ч`;
  };
  set(from);
  return { set, from, to };
}
const drumEl = $('[data-drum]');
const drum = drumEl ? buildDrum(drumEl) : null;

// ── ticker: two copies for a seamless run ────────────────
const ticker = $('[data-ticker]');
if (ticker) {
  const dup = document.createElement('span');
  dup.className = 'dup';
  dup.setAttribute('aria-hidden', 'true');
  dup.textContent = ' ' + ticker.textContent;
  ticker.append(dup);
}

// ── odometry: deterministic GNSS jitter around a parked machine ──
const odoPath = $<SVGPathElement>('.odo__naive');
const odoGrid = $<SVGGElement>('.odo__grid');
let odoLength = 0;
if (odoPath && odoGrid) {
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  let x = 300,
    y = 180;
  const pts: string[] = [];
  for (let i = 0; i < 520; i++) {
    const jump = i % 97 === 0 ? 5 : 1;
    x += (rnd() * 14 + (300 - x) * 0.07) * jump;
    y += (rnd() * 12 + (180 - y) * 0.07) * jump;
    pts.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  odoPath.setAttribute('d', 'M' + pts.join('L'));
  odoLength = odoPath.getTotalLength();
  const ns = 'http://www.w3.org/2000/svg';
  for (let gx = 0; gx <= 600; gx += 40) {
    const l = document.createElementNS(ns, 'line');
    l.setAttribute('x1', String(gx));
    l.setAttribute('x2', String(gx));
    l.setAttribute('y1', '0');
    l.setAttribute('y2', '360');
    odoGrid.append(l);
  }
  for (let gy = 0; gy <= 360; gy += 40) {
    const l = document.createElementNS(ns, 'line');
    l.setAttribute('x1', '0');
    l.setAttribute('x2', '600');
    l.setAttribute('y1', String(gy));
    l.setAttribute('y2', String(gy));
    odoGrid.append(l);
  }
}
const odoKm = $('[data-odo-km]');

// ── oil tube: level from scroll, surface from a damped spring ──
const tube = $('[data-tube]');
const oilPath = $<SVGPathElement>('[data-oil-path]');
const oilLevelEl = $('[data-oil-level]');
const topup = $('[data-topup]');
const oil = { level: 0.7, tilt: 0, vel: 0, target: 0, phase: 0, running: false };
function drawOil() {
  if (!oilPath) return;
  const top = 520 * (1 - oil.level);
  const amp = 4 + Math.abs(oil.vel) * 60;
  let d = `M0 ${top + oil.tilt * -60}`;
  for (let x = 0; x <= 200; x += 10) {
    const y = top + oil.tilt * ((x - 100) / 100) * 60 + Math.sin(x / 26 + oil.phase) * amp * 0.5 + Math.sin(x / 11 - oil.phase * 1.7) * amp * 0.2;
    d += ` L${x} ${y.toFixed(2)}`;
  }
  oilPath.setAttribute('d', d + ' L200 520 L0 520 Z');
}
function oilLoop() {
  if (!oil.running) return;
  const k = 0.06;
  oil.vel += (oil.target - oil.tilt) * k;
  oil.vel *= 0.9;
  oil.tilt += oil.vel;
  oil.phase += 0.045;
  drawOil();
  requestAnimationFrame(oilLoop);
}
function setOilLevel(p: number) {
  const topped = p > 0.56;
  const level = topped ? 0.7 : 0.7 - 0.12 * clamp01(p / 0.56);
  if (topped !== topup?.classList.contains('is-on')) {
    topup?.classList.toggle('is-on', topped);
    if (topped) oil.vel -= 0.08;
  }
  oil.level = level;
  if (oilLevelEl) oilLevelEl.textContent = String(Math.round(level * 100));
  if (!oil.running) drawOil();
}
drawOil();

// ── static fallbacks for reduced motion ───────────────────
if (reduced) {
  drum?.set(drum.to);
  if (odoKm) odoKm.textContent = '59,6';
  topup?.classList.add('is-on');
}

// ── motion ────────────────────────────────────────────────
if (!reduced) {
  root.classList.add('motion-ready');
  const intro = gsap.timeline({ defaults: { ease: 'expo.out' } });
  const word = $$<SVGPathElement>('.bar .logo-word path');
  for (const p of word) {
    const len = p.getTotalLength();
    p.style.setProperty('--len', String(len));
    p.style.strokeDashoffset = String(len);
  }
  intro
    .to(word, { strokeDashoffset: 0, duration: 1.3, ease: 'power2.inOut', stagger: 0.12 }, 0.1)
    .from('.bar .logo-word circle', { scale: 0, transformOrigin: '50% 50%', duration: 0.6, ease: 'back.out(3)', stagger: 0.14 }, 0.9)
    .from('.bar .logo-symbol', { rotate: -120, scale: 0.6, opacity: 0, transformOrigin: '50% 50%', duration: 1.2 }, 0)
    .to('[data-intro-lines] .line > span', { y: 0, duration: 1.2, stagger: 0.09 }, 0.15)
    .to('[data-intro]', { opacity: 1, y: 0, duration: 1, stagger: 0.1 }, 0.35)
    .to('.hero__strip', { opacity: 1, y: 0, duration: 1 }, 0.7);

  // hero text drifts up and away as the scene takes over
  gsap.to('.hero__grid', {
    yPercent: -12,
    opacity: 0.2,
    ease: 'none',
    scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true },
  });

  // section headings: line masks, re-split on resize
  for (const h of $$('[data-reveal]')) {
    gsap.set(h, { opacity: 1 });
    SplitText.create(h, {
      type: 'lines',
      mask: 'lines',
      autoSplit: true,
      // keep no-break spaces: short prepositions must stay with their word
      reduceWhiteSpace: false,
      onSplit: (self) =>
        gsap.from(self.lines, {
          yPercent: 110,
          duration: 1,
          ease: 'expo.out',
          stagger: 0.08,
          scrollTrigger: { trigger: h, start: 'top 88%', once: true },
        }),
    });
  }

  // manifesto: words light up with the scroll
  if (manifesto && words.length) {
    ScrollTrigger.create({
      trigger: '.manifesto',
      start: 'top 70%',
      end: 'bottom 110%',
      onUpdate: (st) => {
        const lit = st.progress * (words.length + 6);
        words.forEach((w, i) => w.style.setProperty('--o', String(0.16 + 0.84 * clamp01(lit - i))));
      },
    });
  }

  // ticker
  if (ticker) gsap.fromTo(ticker, { xPercent: 0 }, { xPercent: -38, ease: 'none', scrollTrigger: { trigger: '.ticker', start: 'top bottom', end: 'bottom top', scrub: 0.3 } });

  // drum rolls through one shift while the cluster passes
  if (drum) {
    ScrollTrigger.create({
      trigger: '[data-cluster]',
      start: 'top 85%',
      end: 'bottom 30%',
      scrub: 0.4,
      onUpdate: (st) => drum.set(drum.from + (drum.to - drum.from) * st.progress),
    });
  }
  for (const el of $$('[data-count]')) {
    const target = Number(el.dataset.count);
    const digits = Number(el.dataset.decimals ?? 0);
    const o = { v: 0 };
    gsap.to(o, {
      v: target,
      duration: 1.4,
      ease: 'expo.out',
      scrollTrigger: { trigger: el, start: 'top 90%', once: true },
      onUpdate: () => (el.textContent = ru(o.v, digits)),
    });
  }

  // sources: the wire is drawn and each stop lights up
  const wire = $<SVGPathElement>('.paths__wire path');
  if (wire) gsap.fromTo(wire, { strokeDashoffset: 1000 }, { strokeDashoffset: 0, ease: 'none', scrollTrigger: { trigger: '[data-paths]', start: 'top 70%', end: 'bottom 70%', scrub: 0.3 } });
  for (const p of $$('.path')) {
    ScrollTrigger.create({ trigger: p, start: 'top 68%', onToggle: (st) => p.classList.toggle('is-lit', st.isActive || st.progress > 0), end: 'max' });
  }

  // odometry: the naive track keeps adding kilometres while the true point stays put
  if (odoPath && odoLength) {
    odoPath.style.strokeDasharray = String(odoLength);
    gsap.fromTo(
      odoPath,
      { strokeDashoffset: odoLength },
      {
        strokeDashoffset: 0,
        ease: 'none',
        scrollTrigger: {
          trigger: '.odo__plot',
          start: 'top 80%',
          end: 'bottom 35%',
          scrub: 0.3,
          onUpdate: (st) => odoKm && (odoKm.textContent = ru(59.6 * st.progress, 1)),
        },
      },
    );
  }
  for (const s of $$('.versus__nums s')) {
    gsap.fromTo(s, { '--strike': 0 }, { '--strike': 1, duration: 0.7, ease: 'power3.inOut', scrollTrigger: { trigger: s, start: 'top 85%', once: true } });
  }

  // oil
  if (tube) {
    ScrollTrigger.create({ trigger: '.oil', start: 'top 70%', end: 'bottom 60%', scrub: true, onUpdate: (st) => setOilLevel(st.progress) });
    ScrollTrigger.create({
      trigger: '.oil',
      start: 'top bottom',
      end: 'bottom top',
      onToggle: (st) => {
        oil.running = st.isActive;
        if (st.isActive) requestAnimationFrame(oilLoop);
      },
      onUpdate: (st) => (oil.vel += st.getVelocity() / -400000),
    });
    const glass = $('.tube__glass', tube);
    tube.addEventListener('pointermove', (e) => {
      const r = (glass ?? tube).getBoundingClientRect();
      oil.target = clamp01((e.clientX - r.left) / r.width) * 0.9 - 0.45;
    });
    tube.addEventListener('pointerleave', () => (oil.target = 0));
  }

  // entrance reveals: CSS `translate` + IntersectionObserver, so hover `transform`s stay free and
  // anchor jumps can never leave visible content stuck mid-animation
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      }
    },
    { rootMargin: '0px 0px -6% 0px', threshold: 0.08 },
  );
  for (const group of ['.gauge', '.path', '.stats > div', '.versus li', '.ring', '.platform', '.qa details', '.tube', '.final__title']) {
    $$(group).forEach((el, i) => {
      el.classList.add('rv');
      el.style.setProperty('--rv-i', String(i % 6));
      io.observe(el);
    });
  }

  document.fonts?.ready.then(() => ScrollTrigger.refresh());
}

// ── WebGL stage (loaded after first paint) ────────────────
const canvas = $<HTMLCanvasElement>('#stage');
const probe = document.createElement('canvas').getContext('webgl2');
if (!canvas || !probe) {
  root.classList.add('no-webgl');
  const hero = $('.hero');
  if (hero && !reduced) hero.insertAdjacentHTML('afterbegin', `<div class="hero__fallback" aria-hidden="true">${symbolSvg()}</div>`);
} else {
  const boot = () =>
    import('./gl/scene').then(({ createStage }) => {
      const lowPower = (navigator.hardwareConcurrency ?? 8) <= 4;
      stage = createStage(canvas, {
        count: mobile || lowPower ? 2600 : 5400,
        dpr: Math.min(devicePixelRatio || 1, mobile ? 1.5 : 1.75),
        mobile,
      });
      if (!stage) {
        root.classList.add('no-webgl');
        return;
      }
      stage.setTheme({ dark: root.classList.contains('dark') });
      direct(stage);
    });
  if ('requestIdleCallback' in window) requestIdleCallback(() => boot(), { timeout: 600 });
  else setTimeout(boot, 120);
}

/** Maps scroll to stage mode, morph and framing. */
function direct(s: Stage) {
  // [x, y, scale]: NDC position of the subject and its extra scale per scene
  const heroFrame = mobile ? [0, 0.58, 0.62] : [0.52, 0.2, 0.72];
  const machineFrame = mobile ? [0, -0.56, 1] : [0.3, -0.46, 0.8];
  const finalFrame = mobile ? [0, 0.56, 0.5] : [0, 0.56, 0.4];
  const scenes = { hero: true, offline: false, final: false };
  let intro = reduced ? 1 : 0;
  let m = 0;
  let f = 0;
  const captions = $$('[data-machine]');

  const apply = () => {
    const mode = scenes.offline ? 'offline' : scenes.hero || scenes.final ? 'primitives' : 'off';
    s.setMode(mode);
    if (scenes.final && !scenes.hero) {
      s.setMorph(5, 1, f);
      s.setFrame(finalFrame[0], finalFrame[1], finalFrame[2]);
      return;
    }
    // manifesto schedule: hold symbol → excavator → timber truck → tractor → scatter
    const seg: Array<[number, number, number, number]> = [
      [0.0, 0.1, 1, 2],
      [0.1, 0.32, 1, 2],
      [0.32, 0.4, 2, 3],
      [0.4, 0.6, 2, 3],
      [0.6, 0.67, 3, 4],
      [0.67, 0.87, 3, 4],
      [0.87, 1.0, 4, 5],
    ];
    if (m <= 0) s.setMorph(0, 1, intro);
    else {
      const [a, b, from, to] = seg.find(([, end]) => m <= end) ?? seg[seg.length - 1];
      const hold = a === 0 || a === 0.32 || a === 0.6;
      s.setMorph(from, to, hold ? 0 : (m - a) / (b - a));
    }
    const k = clamp01(m / 0.18);
    const e = k * k * (3 - 2 * k);
    const lerp = (i: number) => heroFrame[i] + (machineFrame[i] - heroFrame[i]) * e;
    s.setFrame(lerp(0), lerp(1), lerp(2));
    const active = m > 0.2 && m < 0.9 ? (m < 0.4 ? 0 : m < 0.67 ? 1 : 2) : -1;
    captions.forEach((c, i) => c.classList.toggle('is-on', i === active));
  };

  if (reduced) {
    apply();
    return;
  }
  gsap.to(
    { v: 0 },
    {
      v: 1,
      duration: 2.4,
      delay: 0.1,
      ease: 'power2.out',
      onUpdate(this: gsap.core.Tween) {
        intro = (this.targets()[0] as { v: number }).v;
        apply();
      },
    },
  );
  ScrollTrigger.create({
    trigger: '.manifesto',
    start: 'top 55%',
    end: 'bottom bottom',
    onUpdate: (st) => {
      m = st.progress;
      apply();
    },
  });
  ScrollTrigger.create({
    trigger: '.manifesto',
    start: 'top bottom',
    end: 'bottom 40%',
    onToggle: (st) => {
      scenes.hero = st.isActive || st.progress === 0;
      apply();
    },
  });
  ScrollTrigger.create({
    trigger: '.offline',
    start: 'top bottom',
    end: 'bottom top',
    onToggle: (st) => {
      scenes.offline = st.isActive;
      apply();
    },
  });
  const queue = $('[data-queue]');
  const queueState = $('[data-queue-state]');
  ScrollTrigger.create({
    trigger: '.offline',
    start: 'top 60%',
    end: 'bottom bottom',
    onUpdate: (st) => {
      const mx = 0.05 + 0.9 * st.progress;
      s.setOffline(st.progress);
      const edge = 0.6;
      const stored = Math.floor(Math.max(0, Math.min(mx, edge) - 0.07) / 0.021 + (mx > 0.07 ? 1 : 0)) * 21;
      const flush = clamp01((mx - edge) / 0.16);
      const left = Math.round(stored * (1 - flush));
      if (queue) queue.textContent = ru(left, 0);
      if (queueState) {
        const off = mx < edge;
        queueState.textContent = off ? 'нет сети · копим' : flush < 1 ? 'сеть есть · досылаем' : 'на связи · данные свежие';
        queueState.classList.toggle('is-off', off);
      }
    },
  });
  ScrollTrigger.create({
    trigger: '.final',
    start: 'top bottom',
    end: 'bottom top',
    onToggle: (st) => {
      scenes.final = st.isActive;
      apply();
    },
  });
  ScrollTrigger.create({
    trigger: '.final',
    start: 'top bottom',
    end: 'top 20%',
    scrub: 0.6,
    onUpdate: (st) => {
      f = st.progress;
      apply();
    },
  });
  addEventListener(
    'pointermove',
    (e) => s.setPointer((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1),
    { passive: true },
  );
}
