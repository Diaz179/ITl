import './film.css';
import { symbolSvg, wordmarkSvg } from '../brand/logo';
import { Playhead } from './film/clock';
import { CHAPTERS, D, INTRO_END, SCROLL_WEIGHT, filmAt, progressAt } from './film/time';
import { TypeLayer } from './film/type';
import { OIL } from './film/choreo';
import type { Stage } from './film/gl/stage';
import type { BuildResult } from './film/worker';

const root = document.documentElement;
const $ = <T extends Element = HTMLElement>(s: string, el: ParentNode = document) => el.querySelector<T>(s);
const $$ = <T extends Element = HTMLElement>(s: string, el: ParentNode = document) => Array.from(el.querySelectorAll<T>(s));

// ── brand marks ─────────────────────────────────────────
for (const el of $$('[data-logo]')) el.innerHTML = symbolSvg({ className: 'logo-symbol', knockout: '#0a0907' }) + wordmarkSvg({ className: 'logo-word' });
const still = $('[data-still-logo]');
if (still) still.innerHTML = symbolSvg({ knockout: '#0a0907' });
for (const el of $$('[data-year]')) el.textContent = String(new Date().getFullYear());

// ── details dossier ─────────────────────────────────────
const details = $('#details')!;
let lastFocus: HTMLElement | null = null;
function openDetails(section?: string) {
  if (!root.classList.contains('film')) {
    (section ? document.getElementById(section) : details)?.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  lastFocus = document.activeElement as HTMLElement | null;
  root.classList.add('details-open');
  document.body.style.overflow = 'hidden';
  for (const el of $$('main, .bar')) el.setAttribute('inert', '');
  details.setAttribute('role', 'dialog');
  details.setAttribute('aria-modal', 'true');
  const panel = $('.details__panel', details)!;
  const target = section ? document.getElementById(section) : null;
  panel.scrollTop = target ? target.offsetTop - 90 : 0;
  requestAnimationFrame(() => $<HTMLElement>('.details__close', details)?.focus({ preventScroll: true }));
}
function closeDetails() {
  if (!root.classList.contains('details-open')) return;
  root.classList.remove('details-open');
  document.body.style.overflow = '';
  for (const el of $$('main, .bar')) el.removeAttribute('inert');
  details.removeAttribute('role');
  details.removeAttribute('aria-modal');
  lastFocus?.focus({ preventScroll: true });
}
for (const b of $$('[data-open-details]')) b.addEventListener('click', () => openDetails(b.dataset.openDetails || undefined));
for (const b of $$('[data-close-details]')) b.addEventListener('click', closeDetails);
addEventListener('keydown', (e) => {
  if (!root.classList.contains('details-open')) return;
  if (e.key === 'Escape') closeDetails();
  if (e.key === 'Tab') {
    const items = $$<HTMLElement>('a[href], button, summary', details).filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
    else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
  }
});
if (/^#(download|details)$/.test(location.hash)) requestAnimationFrame(() => openDetails(location.hash === '#download' ? 'downloads' : undefined));

// ── magnetic buttons ────────────────────────────────────
if (matchMedia('(hover: hover) and (prefers-reduced-motion: no-preference)').matches) {
  for (const b of $$('[data-magnetic]')) {
    b.addEventListener('pointermove', (e) => {
      const r = b.getBoundingClientRect();
      b.style.setProperty('--mx', `${((e.clientX - r.left) / r.width - 0.5) * 10}px`);
      b.style.setProperty('--my', `${((e.clientY - r.top) / r.height - 0.5) * 8}px`);
    });
    b.addEventListener('pointerleave', () => {
      b.style.setProperty('--mx', '0px');
      b.style.setProperty('--my', '0px');
    });
  }
}

if (root.classList.contains('film')) void startFilm();

async function startFilm() {
  const reduced = root.classList.contains('film--still');
  const canvas = $<HTMLCanvasElement>('canvas.stage')!;
  const portrait = () => innerWidth / Math.max(1, innerHeight) < 0.85;
  let stage: Stage;
  try {
    const { Stage } = await import('./film/gl/stage');
    stage = new Stage(canvas, { portrait: portrait(), dpr: Math.min(devicePixelRatio || 1, portrait() ? 1.6 : 1.75), msaa: 4 });
  } catch (e) {
    console.warn('film disabled', e);
    root.classList.remove('film', 'film--still');
    return;
  }

  const worker = new Worker(new URL('./film/worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<BuildResult>) => {
    stage.setBuild(e.data);
    worker.terminate();
  };
  const lowPower = (navigator.hardwareConcurrency ?? 8) <= 4;
  worker.postMessage({ count: portrait() || lowPower ? 2000 : 3600, terrainRes: portrait() || lowPower ? 120 : 190, torusScale: 2.29 });
  document.fonts.load('620 118px "Martian Mono"').finally(() => stage.buildDigits('620 118px "Martian Mono", ui-monospace, monospace'));

  // scroll length: holds get more distance than transformations (see time.ts)
  root.style.setProperty('--len', (SCROLL_WEIGHT * 0.52).toFixed(2));
  history.scrollRestoration = 'manual';
  scrollTo(0, 0);

  const type = new TypeLayer(document, stage);
  const playhead = new Playhead(reduced ? INTRO_END : 0);
  const reel = buildReel((t) => scrollToFilm(t));
  root.classList.add('film--live');

  const maxScroll = () => Math.max(1, document.documentElement.scrollHeight - innerHeight);
  const progress = () => Math.min(1, Math.max(0, scrollY / maxScroll()));
  function scrollToFilm(t: number) {
    scrollTo({ top: progressAt(t) * maxScroll(), behavior: reduced ? 'auto' : 'smooth' });
  }
  $('[data-restart]')?.addEventListener('click', (e) => {
    e.preventDefault();
    scrollToFilm(INTRO_END);
  });
  // keyboard users: focusing a control inside a scene brings that scene on screen
  document.addEventListener('focusin', (e) => {
    const scene = (e.target as HTMLElement).closest<HTMLElement>('.scene');
    if (!scene || root.classList.contains('details-open')) return;
    const t = type.liveTime(scene);
    if (t !== null && !scene.classList.contains('is-live')) scrollToFilm(t);
  });

  addEventListener('pointermove', (e) => stage.setPointer((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1), { passive: true });

  // reduced motion: rest on chapter frames, cross-dissolve between them
  const chapterFor = (p: number) => {
    let best = 0;
    for (let i = 0; i < CHAPTERS.length; i++) if (p >= (progressAt(CHAPTERS[Math.max(0, i - 1)].t) + progressAt(CHAPTERS[i].t)) / 2 - 1e-6) best = i;
    return best;
  };
  let chapter = -1;
  let fadeStart = -1;

  let sway = 0, swayV = 0, slosh = 0, sloshV = 0, lastV = 0;
  let last = performance.now();
  let frames = 0, slow = 0, fast = 0;
  let paused = false;
  let manual: { T: number; time: number } | null = null;

  function render(now: number) {
    const dtRaw = Math.min(0.25, Math.max(0, (now - last) / 1000));
    const dt = Math.min(0.05, dtRaw);
    last = now;
    let T: number;
    let prevMix = 0;
    if (manual) T = manual.T;
    else if (reduced) {
      const c = chapterFor(progress());
      if (c !== chapter) {
        if (chapter >= 0) {
          stage.snapshot();
          fadeStart = now;
        }
        chapter = c;
      }
      T = CHAPTERS[chapter].t - (chapter === CHAPTERS.length - 1 ? 0.001 : 0);
      if (fadeStart >= 0) prevMix = Math.max(0, 1 - (now - fadeStart) / 350);
    } else {
      playhead.target = filmAt(progress());
      if (!paused) playhead.update(dtRaw);
      T = playhead.t;
    }
    // secondary motion: text leans with the playhead's speed, oil sloshes with its acceleration
    const v = reduced || manual ? 0 : playhead.v;
    swayV += (40 * (v - sway) - 7 * swayV) * dt;
    sway += swayV * dt;
    const acc = dt > 0 ? (v - lastV) / dt : 0;
    lastV = v;
    sloshV += (-30 * slosh - 3.2 * sloshV + acc * 0.9) * dt;
    slosh += sloshV * dt;

    stage.resize(portrait());
    if (T > 14.9 && T < 15.9) {
      const d = stage.dotAt(OIL.handoff);
      stage.handoff = stage.projectAt(OIL.handoff, d.pos);
    }
    const time = manual ? manual.time : reduced ? 0 : now / 1000;
    stage.frame({ T, time, sway: reduced ? 0 : sway, slosh: reduced ? 0 : slosh, pointer: [0, 0], still: reduced, prevMix });
    type.update(T, reduced ? 0 : sway);
    reel(T);

    // adaptive resolution keeps weaker GPUs near 60 fps
    if (!manual && !reduced) {
      frames++;
      if (dt > 0.026) slow++;
      else if (dt < 0.0135) fast++;
      if (frames >= 45) {
        if (slow > 18 && stage.renderScale > 0.6) stage.renderScale = Math.max(0.6, stage.renderScale - 0.1);
        else if (fast > 42 && stage.renderScale < 1) stage.renderScale = Math.min(1, stage.renderScale + 0.05);
        frames = slow = fast = 0;
      }
    }
  }

  const loop = (now: number) => {
    if (!document.hidden) render(now);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  if (new URLSearchParams(location.search).has('debug')) {
    Object.assign(window, {
      __film: {
        state: () => ({ t: playhead.t, v: playhead.v, target: playhead.target, ready: stage.ready, scale: stage.renderScale }),
        seek: (T: number, time = 1) => {
          manual = { T, time };
          render(performance.now());
        },
        free: () => {
          manual = null;
        },
        pause: (p = true) => {
          paused = p;
        },
        step: (dt: number) => {
          playhead.target = filmAt(progress());
          playhead.update(dt);
          return playhead.t;
        },
        stage,
      },
    });
  }
}

/** Chapter ticks and the timecode under the film. */
function buildReel(go: (t: number) => void) {
  const list = $('[data-chapters]')!;
  const time = $('[data-timecode]')!;
  const label = $('[data-chapter]')!;
  const buttons = CHAPTERS.map((c, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<span>${String(i + 1).padStart(2, '0')} · ${c.title}</span>`;
    b.setAttribute('aria-label', `Глава ${i + 1}: ${c.title}`);
    b.addEventListener('click', () => go(c.t));
    li.append(b);
    list.append(li);
    return b;
  });
  const starts = CHAPTERS.map((c, i) => (i === 0 ? 0 : CHAPTERS[i - 1].t));
  let lastText = '';
  return (T: number) => {
    const s = Math.floor(T);
    const text = `00:${String(s).padStart(2, '0')},${Math.floor((T - s) * 10)}`;
    if (text !== lastText) {
      time.textContent = text;
      lastText = text;
    }
    let active = 0;
    CHAPTERS.forEach((c, i) => {
      const fill = Math.min(1, Math.max(0, (T - starts[i]) / (c.t - starts[i])));
      buttons[i].style.setProperty('--fill', fill.toFixed(3));
      if (T >= starts[i]) active = i;
    });
    buttons.forEach((b, i) => b.setAttribute('aria-current', String(i === active)));
    const next = `${String(active + 1).padStart(2, '0')} · ${CHAPTERS[active].title}`;
    if (label.textContent !== next) label.textContent = next;
    void D;
  };
}
