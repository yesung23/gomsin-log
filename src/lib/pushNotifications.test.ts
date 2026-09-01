import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The native push adapter, and the payload surface it refuses to have.
 *
 * The delivery itself cannot be tested here or on any machine without two phones
 * and a credential. What CAN be pinned is everything around it: that web is left
 * alone, that a denied permission is not retried into a loop, that a missing
 * token fails quietly instead of blocking a connection flow, and -- the one that
 * matters most -- that a tapped notification cannot be steered by its payload.
 */

let native = true;
vi.mock('@/lib/platform', () => ({ isNativePlatform: () => native }));

const registerPushToken = vi.fn(async () => ({ ok: true }));
vi.mock('@/lib/pushTokens', () => ({
  registerPushToken: (...args: unknown[]) => registerPushToken(...(args as [never, never])),
}));

const checkPermissions = vi.fn();
const requestPermissions = vi.fn();
const register = vi.fn(async () => {});
const listeners = new Map<string, (payload: never) => void>();
const removed: string[] = [];
const addListener = vi.fn(async (event: string, cb: (payload: never) => void) => {
  listeners.set(event, cb);
  return { remove: async () => { removed.push(event); } };
});

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    checkPermissions: () => checkPermissions(),
    requestPermissions: () => requestPermissions(),
    register: () => register(),
    addListener: (event: string, cb: (payload: never) => void) => addListener(event, cb),
  },
}));

const { setUpPushNotifications, listenForPushTaps, pushSupported } =
  await import('@/lib/pushNotifications');

/** Deliver the token the way the OS does: asynchronously, after `register()`. */
function emitToken(value: string) {
  (listeners.get('registration') as unknown as (p: { value: string }) => void)({ value });
}

beforeEach(() => {
  vi.stubEnv('VITE_PUSH_NOTIFICATIONS_ENABLED', 'true');
  native = true;
  listeners.clear();
  removed.length = 0;
  registerPushToken.mockClear().mockResolvedValue({ ok: true });
  checkPermissions.mockReset().mockResolvedValue({ receive: 'granted' });
  requestPermissions.mockReset().mockResolvedValue({ receive: 'granted' });
  register.mockClear();
  addListener.mockClear();
});

describe('product kill switch', () => {
  it('stays fail-closed and never touches native push when disabled', async () => {
    vi.stubEnv('VITE_PUSH_NOTIFICATIONS_ENABLED', 'false');
    expect(pushSupported()).toBe(false);
    await expect(setUpPushNotifications()).resolves.toEqual({ registered: false, reason: 'unsupported' });
    await expect(listenForPushTaps(vi.fn())).resolves.toBeUndefined();
    expect(checkPermissions).not.toHaveBeenCalled();
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
    expect(addListener).not.toHaveBeenCalled();
    expect(registerPushToken).not.toHaveBeenCalled();
  });
});

describe('web is left entirely alone', () => {
  it('reports push as unsupported', () => {
    native = false;
    expect(pushSupported()).toBe(false);
  });

  it('never touches the plugin or asks for permission', async () => {
    // §10.3: PWA push is out for LV. Web push has a different permission model, a
    // different delivery guarantee and a different iOS story, and validating the
    // loop against both at once would tell us nothing about either.
    native = false;
    const result = await setUpPushNotifications();

    expect(result).toEqual({ registered: false, reason: 'unsupported' });
    expect(checkPermissions).not.toHaveBeenCalled();
    expect(registerPushToken).not.toHaveBeenCalled();
  });
});

describe('asking, once', () => {
  it('registers the token the OS hands back', async () => {
    const pending = setUpPushNotifications();
    await vi.waitFor(() => expect(listeners.has('registration')).toBe(true));
    emitToken('token-from-os');

    await expect(pending).resolves.toEqual({ registered: true });
    expect(registerPushToken).toHaveBeenCalledWith(expect.stringMatching(/^(ios|android)$/), 'token-from-os');
  });

  it('does not re-prompt when permission was already decided', async () => {
    // iOS gives an app exactly one chance to ask. Asking again when the answer is
    // already recorded spends nothing and gains nothing.
    checkPermissions.mockResolvedValue({ receive: 'granted' });
    const pending = setUpPushNotifications();
    await vi.waitFor(() => expect(listeners.has('registration')).toBe(true));
    emitToken('t');
    await pending;

    expect(requestPermissions).not.toHaveBeenCalled();
  });

  it('prompts when the OS has not been asked yet', async () => {
    checkPermissions.mockResolvedValue({ receive: 'prompt' });
    const pending = setUpPushNotifications();
    await vi.waitFor(() => expect(listeners.has('registration')).toBe(true));
    emitToken('t');
    await pending;

    expect(requestPermissions).toHaveBeenCalledTimes(1);
  });

  it('stops at a refusal instead of registering anything', async () => {
    checkPermissions.mockResolvedValue({ receive: 'prompt' });
    requestPermissions.mockResolvedValue({ receive: 'denied' });

    await expect(setUpPushNotifications()).resolves.toEqual({
      registered: false,
      reason: 'denied',
    });
    expect(register).not.toHaveBeenCalled();
    expect(registerPushToken).not.toHaveBeenCalled();
  });

  it('gives up quietly when the OS never returns a token', async () => {
    // A device with no network gets neither event. Blocking the connection flow
    // on a notification token is the wrong thing to make someone wait for; the
    // next launch tries again.
    vi.useFakeTimers();
    const pending = setUpPushNotifications();
    await vi.waitFor(() => expect(listeners.has('registration')).toBe(true));
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(pending).resolves.toEqual({ registered: false, reason: 'failed' });
    vi.useRealTimers();
  });

  it('reports a rejected server registration as a failure, not a success', async () => {
    registerPushToken.mockResolvedValue({ ok: false });
    const pending = setUpPushNotifications();
    await vi.waitFor(() => expect(listeners.has('registration')).toBe(true));
    emitToken('t');

    await expect(pending).resolves.toEqual({ registered: false, reason: 'failed' });
  });
});

describe('a tapped notification cannot be steered by its payload', () => {
  async function tap(data: Record<string, unknown> | undefined) {
    const navigate = vi.fn();
    await listenForPushTaps(navigate);
    (listeners.get('pushNotificationActionPerformed') as unknown as
      (p: { notification: { data?: Record<string, unknown> } }) => void)({ notification: { data } });
    return navigate;
  }

  it('lands on home for the route the sender actually sends', async () => {
    expect((await tap({ route: '/' })).mock.calls).toEqual([['/']]);
  });

  it('lands on home for a route nobody should be able to send', async () => {
    /*
      IA §3.1: the payload carries no per-record destination, because a
      notification that can point at one record has already said which one it was
      about. This is the guard that a payload cannot become one -- an unrecognised
      route is not passed to the router.
    */
    expect((await tap({ route: '/record?record=rec-secret' })).mock.calls).toEqual([['/']]);
    expect((await tap({ route: 'https://evil.example' })).mock.calls).toEqual([['/']]);
  });

  it('lands on home when there is no payload at all', async () => {
    expect((await tap(undefined)).mock.calls).toEqual([['/']]);
  });

  it('registers no listener for delivery or display events', async () => {
    // Those are the raw material of a read receipt, which §14.3 forbids.
    await listenForPushTaps(vi.fn());
    const events = addListener.mock.calls.map((call) => call[0]);
    expect(events).not.toContain('pushNotificationReceived');
  });
});

/**
 * The wiring, asserted from the source.
 *
 * `docs/skills/security-review.md` §1 names "unconnected implementation" as the
 * defect this repository produces most often: a protective function that exists,
 * is tested, and is called by nobody. `setUpPushNotifications` was exactly that
 * for a while -- fully covered above and reachable from no product path.
 *
 * A behavioural test cannot catch it, because a function with no caller passes
 * every test written about the function. So this counts callers instead.
 */
describe('the setup is actually reachable from the product', () => {
  /**
   * Comments are stripped before anything is matched, and the same probe that
   * forced `productEvents.test.ts` to do it forces it here.
   *
   * This gate read `store.tsx` raw and asserted it CONTAINED
   * `setUpPushNotifications()`. Commenting the call out -- so no device ever
   * registers and the first arrow of the loop is severed -- left all of this
   * green, because the call is still spelled inside the comment that replaced
   * it. Measured, not argued: the line was commented out and every test in this
   * file passed.
   *
   * `npm run typecheck` did fail on that mutation, but only incidentally: there
   * is exactly ONE call site, so removing it makes the import unused (TS6133).
   * A second reference to the symbol anywhere in the file takes that away and
   * leaves nothing at all. A gate whose protection comes from an unrelated
   * compiler diagnostic is not a gate.
   *
   * Same class as the push-module export gate and the §19 instrumentation gate
   * before it. Third occurrence; the strip helper is copied rather than invented
   * so the three read alike.
   */
  const stripComments = (text: string) =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

  const store = stripComments(
    readFileSync(resolve(process.cwd(), 'src/lib/store.tsx'), 'utf8'),
  );

  it('is called by the store', () => {
    expect(store).toContain("from '@/lib/pushNotifications'");
    /*
      A CALL, not a mention. `void setUpPushNotifications();` and
      `setUpPushNotifications()` both match; a bare identifier in an export list
      or a type position does not.
    */
    expect(store).toMatch(/(^|[^.\w])setUpPushNotifications\s*\(/m);
  });

  it('is keyed on the couple lifecycle, not on the invitation poll', () => {
    /*
      The poll that first sees a partner join runs only on the INVITER's device
      and only on the launch where it happens. Registering there would leave the
      joining partner unregistered forever and the inviter unregistered after a
      reinstall.
    */
    const effect = store.slice(
      store.indexOf('setUpPushNotifications()') - 400,
      store.indexOf('setUpPushNotifications()') + 100,
    );
    expect(effect).toContain("coupleLifecycle !== 'connected'");
  });
});

/**
 * Resource teardown.
 *
 * `setUpPushNotifications` runs on every transition into `connected` -- a
 * reconnect, a relaunch. Leaving its listeners and its timer behind accumulates
 * native bridge handles for a promise that has already settled and can never
 * resolve again. The tap listener has the same problem in reverse: installed
 * twice, it routes one tap twice.
 */
describe('nothing is left running', () => {
  it('removes both registration listeners once a token arrives', async () => {
    const pending = setUpPushNotifications();
    await vi.waitFor(() => expect(listeners.has('registration')).toBe(true));
    emitToken('t');
    await pending;

    await vi.waitFor(() => {
      expect(removed).toContain('registration');
      expect(removed).toContain('registrationError');
    });
  });

  it('removes them on the give-up path too', async () => {
    vi.useFakeTimers();
    const pending = setUpPushNotifications();
    await vi.waitFor(() => expect(listeners.has('registration')).toBe(true));
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;
    vi.useRealTimers();

    await vi.waitFor(() => expect(removed).toContain('registration'));
  });

  it('clears the timeout when a token arrives, so nothing fires later', async () => {
    /*
      A stuck timer is harmless here only because `finish` is idempotent. Relying
      on that is the kind of thing that stops being true when someone adds a
      retry, so the timer is cleared rather than out-raced.
    */
    vi.useFakeTimers();
    const pending = setUpPushNotifications();
    await vi.waitFor(() => expect(listeners.has('registration')).toBe(true));
    emitToken('t');
    await expect(pending).resolves.toEqual({ registered: true });

    const pendingTimers = vi.getTimerCount();
    vi.useRealTimers();
    expect(pendingTimers).toBe(0);
  });

  it('hands back a teardown for the tap listener', async () => {
    const dispose = await listenForPushTaps(vi.fn());
    expect(typeof dispose).toBe('function');

    dispose?.();
    await vi.waitFor(() => expect(removed).toContain('pushNotificationActionPerformed'));
  });

  it('returns nothing to tear down on web, where nothing was installed', async () => {
    native = false;
    await expect(listenForPushTaps(vi.fn())).resolves.toBeUndefined();
    expect(addListener).not.toHaveBeenCalled();
  });
});
