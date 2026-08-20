/**
 * THE TYPE KIT — Rajdhani, the house face (SIL OFL, licence beside the
 * files). One family, three weights, everywhere text is painted onto a
 * canvas: 700 carries headlines and CTAs, 600 carries interactive labels,
 * 500 carries reading text. Weight does the hierarchy work that nine
 * hundred blackface used to shout over.
 *
 * The files load through the FontFace API at boot; until they land, every
 * font() string falls back through Arial Black so a first paint is never
 * blank — and every Panel repaints itself the moment the real glyphs
 * arrive (see onFontsReady).
 */

import rajdhani500 from '../assets/fonts/rajdhani-500.woff2';
import rajdhani600 from '../assets/fonts/rajdhani-600.woff2';
import rajdhani700 from '../assets/fonts/rajdhani-700.woff2';

export const FONT_FAMILY = 'Rajdhani';

/** Canvas font string: weight-first, with fallbacks for the load gap. */
export function font(weight: 500 | 600 | 700, px: number): string {
  return `${weight} ${px}px '${FONT_FAMILY}', 'Arial Black', system-ui, sans-serif`;
}

let ready = false;
const waiters: Array<() => void> = [];

export function fontsReady(): boolean {
  return ready;
}

/** Run `cb` once the real glyphs are in (immediately if they already are). */
export function onFontsReady(cb: () => void): void {
  if (ready) cb();
  else waiters.push(cb);
}

function settle(): void {
  ready = true;
  for (const cb of waiters.splice(0)) cb();
}

// Kick the load at module import — the menus are the first thing painted.
(() => {
  if (typeof document === 'undefined' || !('fonts' in document)) {
    settle(); // non-browser (tests): fall back silently
    return;
  }
  const faces = [
    new FontFace(FONT_FAMILY, `url(${rajdhani500})`, { weight: '500' }),
    new FontFace(FONT_FAMILY, `url(${rajdhani600})`, { weight: '600' }),
    new FontFace(FONT_FAMILY, `url(${rajdhani700})`, { weight: '700' }),
  ];
  Promise.all(
    faces.map((f) =>
      f.load().then((loaded) => {
        document.fonts.add(loaded);
      }),
    ),
  )
    .then(settle)
    .catch(settle); // a missing weight still paints via the fallback stack
})();
