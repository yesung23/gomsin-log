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

  const hasQueue = outboxWaiting > 0 || outboxBlocked > 0;
  if (online && !hasQueue) return null;

  return (
    <div
      role="status"
      className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+60px)] left-1/2 -translate-x-1/2 w-full max-w-[430px] z-[60] px-3"
    >
      {!online && (
        <div
          data-testid="offline-notice"
          className="w-full rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-center text-xs font-medium text-red-900 shadow-sm"
        >
          인터넷 연결이 끊겼어요 · 남긴 기록은 저장해 두고 연결되면 보낼게요
        </div>
      )}

      {outboxWaiting > 0 && (
        <div
          data-testid="outbox-waiting"
          className="mt-1.5 w-full rounded-xl border border-border bg-card px-4 py-2.5 text-center text-xs font-medium text-foreground shadow-sm"
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
          className="mt-1.5 w-full rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-xs font-medium text-amber-900 shadow-sm"
        >
          <p className="text-center">보내지 못한 기록 {outboxBlocked}개가 있어요</p>
          <button
            type="button"
            onClick={() => { void retryBlockedRecords(); }}
            disabled={!online}
            className="mt-1.5 w-full min-h-[44px] rounded-lg border border-amber-400 font-bold disabled:opacity-50"
          >
            다시 시도
          </button>
        </div>
      )}
    </div>
  );
}
