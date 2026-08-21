import { isNativePlatform } from '@/lib/platform';
import { registerPushToken, type PushPlatform } from '@/lib/pushTokens';

/**
 * The native adapter for push: permission, token, and the tap.
 *
 * ## Native only, deliberately
 *
 * `PRODUCT_STRATEGY_REDESIGN_2026-08-21` §10.3 forbids PWA push for LV. Not
 * because it cannot be made to work, but because web push has a different
 * permission model, a different delivery guarantee and a different failure mode
 * on iOS, and validating a loop against two of those at once tells you nothing
 * about either. On web every function here returns without doing anything.
 *
 * ## What is NOT here, and could not be added later without noticing
 *
 * There is no payload parsing. The notification carries one sentence and a route
 * to home, so there is nothing to read out of it -- no record id to open, no
 * event kind to branch on, no count to display. A future "open the record this is
 * about" would have to add a field to the payload first, and the payload is
 * assembled in an Edge Function that cannot see records.
 *
 * There is no listener for delivery receipts or for "notification shown". Those
 * are the raw material of a read-receipt feature and §14.3 forbids the product
 * they add up to.
 */

/** Whether push can work at all on this platform. */
export function pushSupported(): boolean {
  return isNativePlatform();
}

function platformName(): PushPlatform {
  // The token itself is platform-tagged so the sender can pick a transport. This
  // is the only place the distinction is made.
  return /android/i.test(navigator.userAgent) ? 'android' : 'ios';
}

export interface PushSetupResult {
  /** True only when a token reached the server. */
  registered: boolean;
  /** Why not, when it did not. Safe to show; never contains the token. */
  reason?: 'unsupported' | 'denied' | 'failed';
}

/**
 * Ask for permission, obtain a token, and register it.
 *
 * Called at the moment §2 of the strategy identifies -- just after a couple
 * connects -- rather than at first launch. A permission prompt before there is a
 * partner is a prompt for something the app cannot yet do, and iOS gives an app
 * exactly one chance to ask.
 *
 * Safe to call again on later launches: `register_push_token` removes any
 * previous holder before claiming, so re-registering an unchanged token is a
 * no-op and re-registering a REISSUED one is the repair. APNs and FCM reissue
 * without telling the app, so calling this on every launch is correct rather
 * than merely tolerable.
 */
export async function setUpPushNotifications(): Promise<PushSetupResult> {
  if (!pushSupported()) return { registered: false, reason: 'unsupported' };

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');

    const existing = await PushNotifications.checkPermissions();
    const decision = existing.receive === 'prompt' || existing.receive === 'prompt-with-rationale'
      ? await PushNotifications.requestPermissions()
      : existing;

    if (decision.receive !== 'granted') return { registered: false, reason: 'denied' };

    /*
      `register()` resolves as soon as the OS request is made, not when the token
      arrives -- the token comes back on the `registration` event. So the promise
      is what waits, and it resolves from the listener.

      Both listeners and the timer are torn down on the way out. This function
      runs on every transition into `connected` -- a reconnect, a relaunch -- and
      leaving them behind would accumulate native bridge handles for a promise
      that has already settled and can never resolve again.
    */
    const token = await new Promise<string | null>((resolve) => {
      let settled = false;
      const handles: Array<{ remove: () => Promise<void> }> = [];

      const finish = (value: string | null) => {
        if (settled) return;
        settled = true;
        // `timer` is declared below and assigned before any listener can fire,
        // so it is always initialised by the time this runs.
        clearTimeout(timer);
        // Fire-and-forget: removal is cleanup, and a failure to remove must not
        // turn a successful registration into a rejected promise.
        for (const handle of handles) void handle.remove().catch(() => {});
        resolve(value);
      };

      void PushNotifications.addListener('registration', (t) => finish(t.value))
        .then((handle) => {
          // The listener may resolve AFTER the event it was waiting for, in which
          // case there is nothing left to remove later -- so remove it now.
          if (settled) void handle.remove().catch(() => {});
          else handles.push(handle);
        });
      void PushNotifications.addListener('registrationError', () => finish(null))
        .then((handle) => {
          if (settled) void handle.remove().catch(() => {});
          else handles.push(handle);
        });
      void PushNotifications.register();

      // A device with no network gets neither event. Giving up quietly is right:
      // the next launch calls this again, and blocking the connection flow on a
      // notification token would be the wrong thing to make someone wait for.
      const timer = setTimeout(() => finish(null), 10_000);
    });

    if (!token) return { registered: false, reason: 'failed' };

    const result = await registerPushToken(platformName(), token);
    return result.ok ? { registered: true } : { registered: false, reason: 'failed' };
  } catch (error) {
    console.warn('[gomsinlog] Push setup failed', error);
    return { registered: false, reason: 'failed' };
  }
}

/**
 * Route a tapped notification.
 *
 * Home, always. The payload carries a route rather than a destination the sender
 * chose, and the only value it ever holds is `/` -- IA §3.1 settled that a
 * per-record destination would mean the notification had already said which
 * record it was about.
 *
 * The handler still reads the field instead of hard-coding the path, so that if
 * the payload ever carried something else, this would be the one place that
 * decided whether to honour it.
 */
export async function listenForPushTaps(
  navigate: (path: string) => void,
): Promise<(() => void) | undefined> {
  if (!pushSupported()) return undefined;

  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const handle = await PushNotifications.addListener(
      'pushNotificationActionPerformed',
      (action) => {
        const route = action.notification.data?.route;
        // Only a route this app recognises. An unexpected value goes home rather
        // than being passed to the router, which is what stops a payload from
        // choosing a destination.
        navigate(route === '/' ? '/' : '/');
      },
    );
    // Returned so the caller can tear it down. Without this the listener
    // outlives whatever installed it, and a second install routes one tap twice.
    return () => { void handle.remove().catch(() => {}); };
  } catch (error) {
    console.warn('[gomsinlog] Push tap listener failed', error);
    return undefined;
  }
}
