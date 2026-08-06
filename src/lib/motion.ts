/**
 * Motion preference, for the motion CSS cannot reach.
 *
 * `@media (prefers-reduced-motion: reduce)` in `src/styles/index.css` covers
 * animations and CSS-initiated scrolling. It does NOT cover
 * `scrollIntoView({ behavior: 'smooth' })`: that behaviour is a JavaScript
 * argument, and a `scroll-behavior: auto` declaration does not override it. The
 * scroll-to-record emphasis on the 기록 screen is exactly that call, so the
 * preference has to be read here too.
 *
 * WCAG 2.1 SC 2.3.3.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** `scrollIntoView` options that honour the user's motion preference. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}
