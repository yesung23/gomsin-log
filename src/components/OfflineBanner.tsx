import { useEffect, useRef } from 'react';
import { useStore } from '@/lib/useStore';
import { useOnlineStatus } from '@/lib/useOnlineStatus';

/**
 * Connectivity notice, and the state of anything waiting to be sent.
 *
 * Connectivity comes from the shared `useOnlineStatus` hook rather than this
 * component's own listener pair. That pair used to be the ONLY place the app
 * tracked connectivity, so every mutation control had to either duplicate it or
 * ignore it -- and they all ignored it, which is why tapping 저장 offline fired a
 * request and produced a cause-blind error message.
 *
 * It now also reports the outbox, because a queue nobody can see is only half a
 * fix: a record that is waiting has to look different from one that was sent, and a
 * record that has STOPPED being retried has to be able to ask for attention. Those
 * are two different sentences, which is why the store exposes two counts.
 *
 * The offline copy no longer says 읽기만 가능해요. It is not read-only any more --
 * the composer queues instead of refusing.
 */
export function OfflineBanner() {
  const online = useOnlineStatus();
  const { outboxWaiting, outboxBlocked, retryBlockedRecords } = useStore();
  const rootRef = useRef<HTMLDivElement>(null);

  const hasQueue = outboxWaiting > 0 || outboxBlocked > 0;
  const visible = !online || hasQueue;

  /**
   * Publish this layer's height as `--gomsin-bottom-banner-height`.
   *
   * The bottom of the screen holds three independently pinned layers -- tab bar,
   * this banner, and the record screen's floating CTA -- and each one used a
   * constant to guess where the ones below it ended. The guesses disagreed: the CTA
   * at `bottom-20` (80px) and this banner overlapped by 18px, and AI_HANDOFF §4.1
   * recorded that moving the banner up to clear the tab bar would widen that to
   * 36px. It did, exactly, the moment the tab bar fix landed.
   *
   * So the stack now measures itself, bottom upwards:
   *   tab bar   -> `--gomsin-tabbar-height`        (MobileShell)
   *   banner    -> `--gomsin-bottom-banner-height` (here)
   *   CTA       -> positioned off both             (RecordPage)
   *
   * Set on `documentElement` because the consumer is a page inside `<main>`, a
   * sibling subtree from this banner.
   */
  useEffect(() => {
    const root = document.documentElement;
    const node = rootRef.current;
    if (!visible || !node) {
      root.style.setProperty('--gomsin-bottom-banner-height', '0px');
      return;
    }
    const apply = () => {
      root.style.setProperty(
        '--gomsin-bottom-banner-height',
        `${Math.round(node.getBoundingClientRect().height)}px`,
      );
    };
    apply();
    if (typeof ResizeObserver === 'undefined') {
      return () => root.style.setProperty('--gomsin-bottom-banner-height', '0px');
    }
    const observer = new ResizeObserver(apply);
    observer.observe(node);
    return () => {
      observer.disconnect();
      root.style.setProperty('--gomsin-bottom-banner-height', '0px');
    };
  }, [visible, outboxWaiting, outboxBlocked, online]);

  if (!visible) return null;

  return (
    <div
      ref={rootRef}
      role="status"
      /*
       * Cleared off the tab bar's MEASURED height (`--gomsin-tabbar-height`,
       * published by MobileShell) rather than a constant.
       *
       * This used to be `calc(env(safe-area-inset-bottom,0px)+60px)`. The bar is
       * `8px + 48px + max(env(safe-area-inset-bottom,0px),10px)` tall, so 60px only
       * cleared it on a device WITH a home indicator; at inset 0 -- every Android
       * phone, every older iPhone, and the 320x568 and 390x844 test viewports --
       * the banner sat 10px inside `nav[role=tablist]`.
       *
       * `fixed` and `z-[60]` are load-bearing and must stay: `modalStacking.test.ts`
       * requires this layer to declare a z-index above the tab bar's, because the
       * bar is painted after it in the DOM.
       */
      className="fixed bottom-[calc(var(--gomsin-tabbar-height,70px)+8px)] left-1/2 -translate-x-1/2 w-full max-w-[430px] z-[60] px-3"
    >
      {!online && (
        <div
          data-testid="offline-notice"
          className="w-full rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-center text-caption font-medium text-destructive shadow-sm"
        >
          인터넷 연결이 끊겼어요 · 남긴 기록은 저장해 두고 연결되면 보낼게요
        </div>
      )}

      {outboxWaiting > 0 && (
        <div
          data-testid="outbox-waiting"
          className="mt-1.5 w-full rounded-xl border border-border bg-card px-4 py-2.5 text-center text-caption font-medium text-foreground shadow-sm"
        >
          보낼 기록 {outboxWaiting}개 · 연결되면 자동으로 보내요
        </div>
      )}

      {outboxBlocked > 0 && (
        <div
          data-testid="outbox-blocked"
          // `alert` only for this one: it is the only state that needs the user to
          // do something, and announcing the reassuring counts that way would be
          // noise on every reconnection.
          role="alert"
          className="mt-1.5 w-full rounded-xl border border-warning/40 bg-warning-surface px-4 py-2.5 text-caption font-medium text-warning-foreground shadow-sm"
        >
          <p className="text-center">보내지 못한 기록 {outboxBlocked}개가 있어요</p>
          <button
            type="button"
            onClick={() => { void retryBlockedRecords(); }}
            disabled={!online}
            className="mt-1.5 w-full min-h-[44px] rounded-lg border border-warning/50 font-bold disabled:opacity-50"
          >
            다시 시도
          </button>
        </div>
      )}
    </div>
  );
}
