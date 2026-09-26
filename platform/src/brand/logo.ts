/**
 * «Отсчёт» identity, drawn by hand on a 100-unit x-height grid.
 * Symbol «риска»: a dial ring with the index dot at one o'clock — the point the count starts from.
 * Wordmark: monoline lowercase «отсчёт»; verticals 22, horizontals 19 (optical contrast),
 * the «ё» keeps both dots — the right one in «сурик».
 */
export const BRAND = 'Отсчёт';

export const WORDMARK = {
  width: 597.13,
  vertical: 22,
  horizontal: 19,
  letters: [
    { v: ['M9.5 50a40.5 40.5 0 1 0 81 0a40.5 40.5 0 1 0 -81 0'], h: [] as string[] },
    { v: ['M155 9.5V100'], h: ['M115 9.5H195'] },
    { v: ['M284.13 20.87A40.5 40.5 0 1 0 284.13 79.13'], h: [] },
    { v: ['M315.13 0V33A28 28 0 0 0 343.13 61H379.13', 'M379.13 0V100'], h: [] },
    { v: ['M495.63 50A40.5 40.5 0 1 0 486.16 76.03'], h: ['M415.63 50H494.63'] },
    { v: ['M557.13 9.5V100'], h: ['M517.13 9.5H597.13'] },
  ],
  dots: { x: [436.13, 474.13], y: -31, r: 12 },
  viewBox: '-4 -47 605.13 152',
} as const;

/** Symbol on a 64-unit grid. */
export const SYMBOL = { cx: 32, cy: 32, r: 16.8, stroke: 7.2, dot: { cx: 40.4, cy: 17.45, r: 6.4, gap: 2.4 } } as const;

const verticals = WORDMARK.letters.flatMap((l) => l.v).join('');
const horizontals = WORDMARK.letters.flatMap((l) => l.h).join('');

export function wordmarkSvg(opts: { className?: string; title?: string } = {}): string {
  const { dots } = WORDMARK;
  const label = opts.title ? `role="img" aria-label="${opts.title}"` : 'aria-hidden="true"';
  return (
    `<svg class="${opts.className ?? ''}" viewBox="${WORDMARK.viewBox}" ${label} focusable="false">` +
    `<g fill="none" stroke="currentColor"><path d="${verticals}" stroke-width="22"/><path d="${horizontals}" stroke-width="19"/></g>` +
    `<circle cx="${dots.x[0]}" cy="${dots.y}" r="${dots.r}" fill="currentColor"/>` +
    `<circle cx="${dots.x[1]}" cy="${dots.y}" r="${dots.r}" fill="var(--signal-graphic, #ff5a1f)"/></svg>`
  );
}

export function symbolSvg(opts: { className?: string; title?: string; knockout?: string } = {}): string {
  const s = SYMBOL;
  const label = opts.title ? `role="img" aria-label="${opts.title}"` : 'aria-hidden="true"';
  return (
    `<svg class="${opts.className ?? ''}" viewBox="0 0 64 64" ${label} focusable="false">` +
    `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="none" stroke="currentColor" stroke-width="${s.stroke}"/>` +
    `<g class="dot-group"><circle cx="${s.dot.cx}" cy="${s.dot.cy}" r="${s.dot.r + s.dot.gap}" fill="${opts.knockout ?? 'var(--bg, #0b0c0a)'}"/>` +
    `<circle cx="${s.dot.cx}" cy="${s.dot.cy}" r="${s.dot.r}" fill="var(--signal-graphic, #ff5a1f)"/></g></svg>`
  );
}
