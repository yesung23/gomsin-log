import { describe, expect, it } from 'vitest';
import {
  SPRING_DEFAULT,
  SPRING_MOMENTUM,
  projectMomentum,
  rubberband,
  springAtRest,
  springStep,
  type SpringState,
} from '@/lib/motion';

/** Run a spring to rest and report what happened on the way. */
function run(from: number, to: number, velocity = 0, config = SPRING_DEFAULT, dt = 1 / 60) {
  let state: SpringState = { value: from, velocity };
  const samples: number[] = [state.value];
  for (let i = 0; i < 600 && !springAtRest(state, to); i += 1) {
    state = springStep(state, to, dt, config);
    samples.push(state.value);
  }
  return { state, samples, frames: samples.length };
}

describe('the spring arrives, and stops', () => {
  it('reaches the target, to within the tolerance it stops at', () => {
    // Not `toBeCloseTo(100)`. `springAtRest` deliberately gives up at 0.3px rather
    // than paying for frames to close a gap no display can show, so the resting
    // value is a few hundredths short and that is the contract, not a rounding bug.
    const { state } = run(0, 100);
    expect(Math.abs(state.value - 100)).toBeLessThan(0.3);
    expect(springAtRest(state, 100)).toBe(true);
  });

  it('settles within roughly the response time it was given', () => {
    // `response` is 0.35s. At 60fps that is ~21 frames; the settle tolerance costs
    // a few more. If this ever needs 3x the budget the spring is misconfigured.
    const { frames } = run(0, 100);
    expect(frames).toBeLessThan(Math.ceil(SPRING_DEFAULT.response * 60 * 3));
  });

  it('the default never overshoots, because a bounce on a health toggle is a lie', () => {
    // Critically damped: nothing may pass the target, in either direction.
    const up = run(0, 100);
    expect(Math.max(...up.samples)).toBeLessThanOrEqual(100 + 1e-6);

    const down = run(100, 0);
    expect(Math.min(...down.samples)).toBeGreaterThanOrEqual(-1e-6);
  });

  it('the momentum spring DOES overshoot, which is the only reason it exists', () => {
    const { samples } = run(0, 100, 0, SPRING_MOMENTUM);
    expect(Math.max(...samples)).toBeGreaterThan(100);
  });

  it('carries the velocity it was handed instead of restarting from zero', () => {
    // Same start, same target; one is already moving. It must arrive sooner.
    const still = run(0, 100, 0);
    const thrown = run(0, 100, 400);
    expect(thrown.frames).toBeLessThan(still.frames);
  });

  it('a velocity pointing away from the target is not silently discarded', () => {
    const { samples } = run(0, 100, -300);
    expect(Math.min(...samples)).toBeLessThan(0);
  });
});

describe('the solution does not depend on the frame rate', () => {
  /*
   * This is the claim the closed form is there to make good on. A naive Euler
   * integrator is stable at 60Hz and visibly wrong at 120Hz, and a dropped frame
   * makes it worse -- the error scales with the timestep, so the animation
   * misbehaves at exactly the moment the device is already struggling.
   */
  it('ten small steps land where one big step lands', () => {
    const big = springStep({ value: 0, velocity: 0 }, 100, 0.1);

    let small: SpringState = { value: 0, velocity: 0 };
    for (let i = 0; i < 10; i += 1) small = springStep(small, 100, 0.01);

    expect(small.value).toBeCloseTo(big.value, 6);
    expect(small.velocity).toBeCloseTo(big.velocity, 6);
  });

  it('120Hz and 60Hz converge to the same place', () => {
    const at60 = run(0, 100, 250, SPRING_MOMENTUM, 1 / 60);
    const at120 = run(0, 100, 250, SPRING_MOMENTUM, 1 / 120);
    expect(at60.state.value).toBeCloseTo(at120.state.value, 1);
  });

  it('a long stall resumes in the right place rather than flying off', () => {
    // One 250ms hitch, against the same elapsed time at 60fps.
    const stalled = springStep({ value: 0, velocity: 0 }, 100, 0.25);
    let smooth: SpringState = { value: 0, velocity: 0 };
    for (let i = 0; i < 15; i += 1) smooth = springStep(smooth, 100, 1 / 60);

    expect(stalled.value).toBeCloseTo(smooth.value, 4);
    expect(stalled.value).toBeLessThanOrEqual(100 + 1e-6);
  });

  it('refuses to move on a zero or negative timestep', () => {
    const state = { value: 12, velocity: 5 };
    expect(springStep(state, 100, 0)).toBe(state);
    expect(springStep(state, 100, -0.016)).toBe(state);
  });
});

describe('momentum projection tells a flick apart from a drag', () => {
  /*
   * The distinction the sheet gesture is built on. Someone who flicks a sheet two
   * centimetres and lets go fast means to dismiss it; someone who drags it the same
   * two centimetres and stops does not. Travelled distance cannot tell those apart.
   */
  it('a fast flick projects far past where the finger let go', () => {
    expect(projectMomentum(20, 1200)).toBeGreaterThan(200);
  });

  it('the same distance with no speed projects nowhere', () => {
    expect(projectMomentum(20, 0)).toBe(20);
  });

  it('is signed, so an upward flick projects upward', () => {
    expect(projectMomentum(0, -800)).toBeLessThan(0);
  });

  it('is monotonic in velocity', () => {
    const slow = projectMomentum(0, 300);
    const fast = projectMomentum(0, 900);
    expect(fast).toBeGreaterThan(slow);
  });
});

describe('rubber-banding resists instead of stopping dead', () => {
  it('always travels less than it was pulled', () => {
    for (const pull of [10, 50, 200, 1000]) {
      expect(rubberband(pull, 800)).toBeLessThan(pull);
    }
  });

  it('resists harder the further it is pulled', () => {
    const dimension = 800;
    const firstTen = rubberband(10, dimension) / 10;
    const lastTen = (rubberband(210, dimension) - rubberband(200, dimension)) / 10;
    expect(lastTen).toBeLessThan(firstTen);
  });

  it('approaches a ceiling rather than growing without bound', () => {
    // The edge has to become genuinely immovable, not merely slow.
    expect(rubberband(1e6, 800)).toBeLessThan(800 / 0.55 + 1);
  });

  it('is symmetric about zero, so pulling up feels like pulling down', () => {
    expect(rubberband(-120, 800)).toBeCloseTo(-rubberband(120, 800), 10);
  });

  it('cannot divide by a zero dimension before layout has happened', () => {
    expect(rubberband(50, 0)).toBe(0);
  });
});
