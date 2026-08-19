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
  return matches('(prefers-reduced-motion: reduce)');
}

/** `scrollIntoView` options that honour the user's motion preference. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}

/**
 * Whether the user asked for less see-through UI.
 *
 * This app puts `backdrop-blur` behind the tab bar, the dashboard header, the
 * install banner and the sheet scrims -- fourteen places. Blur is a legibility
 * cost paid for depth, and some people cannot afford it: low vision, or simply a
 * cheap panel where a blurred card and its background converge to the same grey.
 *
 * The CSS in `index.css` answers the same query and is what actually restyles
 * those surfaces. This reader exists for the cases CSS cannot express -- deciding
 * whether to MOUNT a translucent layer at all, rather than restyling one that is
 * already there.
 */
export function prefersReducedTransparency(): boolean {
  return matches('(prefers-reduced-transparency: reduce)');
}

/** Whether the user asked for higher contrast. Pairs with the CSS of the same query. */
export function prefersHighContrast(): boolean {
  return matches('(prefers-contrast: more)');
}

function matches(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  /*
   * `matchMedia` throws on a query the engine does not parse, and
   * `prefers-reduced-transparency` is younger than the browsers this app still
   * runs on. An unsupported preference must read as "not requested", never as a
   * crash on first paint.
   */
  try {
    return window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

/**
 * A spring, described the way a designer thinks about one.
 *
 * Not stiffness and damping -- those are two numbers you tune by guessing. The
 * two below are the pair Apple's fluid-interface work uses, and each means
 * something on its own:
 *
 * - `response`: seconds to reach the target. Lower is snappier. This is NOT a
 *   duration; the spring is still allowed to be interrupted before it elapses.
 * - `dampingRatio`: 1 stops dead on arrival, below 1 overshoots and comes back.
 *
 * The reason this exists at all, rather than a CSS transition: a transition
 * animates from wherever it was told to start, toward a fixed target, over a
 * fixed time. Interrupt it and it restarts, which is the "brick wall" you feel
 * when you flick a sheet, change your mind, and the sheet refuses to come with
 * you. A spring carries position AND velocity, so an interruption is just a new
 * target applied to the state already in flight.
 */
export interface SpringConfig {
  /** Seconds to reach the target. */
  response: number;
  /** 1 = critically damped (no overshoot). Below 1 overshoots. */
  dampingRatio: number;
}

/**
 * Everything not driven by the user's momentum.
 *
 * Critically damped on purpose. A bounce on a privacy toggle, a cycle state or an
 * error reads as playfulness, and none of those are playful -- 곰신로그 asks people
 * about their health and their relationship, and the interface should feel steady
 * when it answers.
 */
export const SPRING_DEFAULT: SpringConfig = { response: 0.35, dampingRatio: 1 };

/**
 * For motion the user's own hand started: a flick, a drag release, a snap.
 *
 * The slight overshoot is legible here precisely because the user supplied the
 * momentum -- it reads as the object having weight, not as the app being cute.
 */
export const SPRING_MOMENTUM: SpringConfig = { response: 0.35, dampingRatio: 0.8 };

export interface SpringState {
  value: number;
  velocity: number;
}

/**
 * Advance a spring by `dt` seconds toward `target`.
 *
 * Solved analytically rather than integrated step by step. A naive Euler
 * integrator is stable at 60Hz and visibly wrong at 120Hz, and a dropped frame
 * makes it worse -- the error scales with the timestep, so the one moment the
 * device is struggling is the moment the animation misbehaves. The closed form
 * below is exact for any `dt`, which means a 4-frame stall resumes in the right
 * place instead of overshooting.
 */
export function springStep(
  state: SpringState,
  target: number,
  dt: number,
  config: SpringConfig = SPRING_DEFAULT,
): SpringState {
  const { response, dampingRatio: zeta } = config;
  if (dt <= 0 || response <= 0) return state;

  const omega = (2 * Math.PI) / response;
  // Solve in displacement-from-target space; the target is then added back.
  const x0 = state.value - target;
  const v0 = state.velocity;

  let x: number;
  let v: number;

  if (Math.abs(zeta - 1) < 1e-6) {
    // Critically damped. The common case, and the only one with no sin/cos.
    const decay = Math.exp(-omega * dt);
    const c = v0 + omega * x0;
    x = (x0 + c * dt) * decay;
    v = (v0 - omega * c * dt) * decay;
  } else if (zeta < 1) {
    // Under-damped: overshoots, then rings down.
    const omegaD = omega * Math.sqrt(1 - zeta * zeta);
    const decay = Math.exp(-zeta * omega * dt);
    const cos = Math.cos(omegaD * dt);
    const sin = Math.sin(omegaD * dt);
    const b = (v0 + zeta * omega * x0) / omegaD;
    x = decay * (x0 * cos + b * sin);
    v = decay * ((b * omegaD - zeta * omega * x0) * cos - (zeta * omega * b + x0 * omegaD) * sin);
  } else {
    // Over-damped: crawls in without ever crossing the target.
    const root = omega * Math.sqrt(zeta * zeta - 1);
    const r1 = -zeta * omega + root;
    const r2 = -zeta * omega - root;
    const c1 = (v0 - r2 * x0) / (r1 - r2);
    const c2 = x0 - c1;
    const e1 = Math.exp(r1 * dt);
    const e2 = Math.exp(r2 * dt);
    x = c1 * e1 + c2 * e2;
    v = c1 * r1 * e1 + c2 * r2 * e2;
  }

  return { value: x + target, velocity: v };
}

/**
 * Whether a spring has arrived closely enough to stop paying for frames.
 *
 * The position tolerance is in the same unit as `value` -- for these sheets that
 * is CSS pixels, and a third of one is below what a display can resolve.
 */
export function springAtRest(
  state: SpringState,
  target: number,
  positionTolerance = 0.3,
  velocityTolerance = 3,
): boolean {
  return (
    Math.abs(state.value - target) < positionTolerance &&
    Math.abs(state.velocity) < velocityTolerance
  );
}

/**
 * Where a flick would come to rest if nothing stopped it.
 *
 * Used to decide a gesture's OUTCOME at the instant the finger leaves, rather
 * than from how far it happened to travel. Someone who flicks a sheet two
 * centimetres and lets go fast means to dismiss it; someone who drags it the same
 * two centimetres and stops does not. Distance cannot tell those apart. This can.
 *
 * Exponential decay, not the `v^2 / (2a)` from constant-deceleration physics:
 * scroll surfaces decay proportionally to speed, so the constant-deceleration
 * form lands short on slow flicks and far past on fast ones.
 *
 * @param velocity px per second, signed.
 * @param decay per-frame retention. 0.998 is the standard scroll feel.
 */
export function projectMomentum(position: number, velocity: number, decay = 0.998): number {
  return position + (velocity / 1000) * (decay / (1 - decay));
}

/**
 * Progressive resistance past a boundary, instead of a hard stop.
 *
 * Dragging a sheet DOWN is free; dragging it up past its open position must not
 * be, or the sheet detaches from the top of the screen and the illusion that you
 * are holding an object dies. Resistance grows with the overshoot, so the edge
 * announces itself by feel before it is reached.
 *
 * Returns the distance actually travelled for a given `overshoot` of pull.
 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  if (dimension <= 0) return 0;
  const sign = Math.sign(overshoot);
  const magnitude = Math.abs(overshoot);
  return (sign * (magnitude * dimension * constant)) / (dimension + constant * magnitude);
}
