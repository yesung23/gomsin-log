import { useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '@/lib/useStore';

/**
 * Explains why the shared couple workspace is frozen or hidden.
 *
 * Without this, a device that cannot open a WebSocket showed an empty timeline
 * with no reason and no way to retry, which is indistinguishable from having
 * lost the couple's data. Shown only for a connected couple, since a solo or
 * disconnected account has no shared workspace to be out of sync with.
 */
export function SharedSyncBanner() {
  const { state, sharedSyncStatus, retrySharedAccess } = useStore();
  const [retrying, setRetrying] = useState(false);

  const { couple } = state.profile;
  const hasSharedWorkspace = !state.isDemoMode
    && couple.connected
    && couple.status === 'active';
  if (!hasSharedWorkspace || sharedSyncStatus === 'live') return null;

  const unavailable = sharedSyncStatus === 'unavailable';
  /**
   * The `unavailable` copy is reached on a cold load whenever the realtime socket
   * cannot connect, and the authoritative re-check settles in about two seconds.
   * "확인할 수 없어" read as a permanent verdict for a state that is usually
   * transient and self-healing, so it now says what is actually true: not
   * confirmed YET, hidden until it is.
   */
  const message = unavailable
    ? '공유 정보를 아직 확인하지 못해 잠시 숨겨 뒀어요. 확인되면 다시 보여드려요.'
    : '실시간 연결이 끊겨 최신 정보가 아닐 수 있어요.';

  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      // This is the only affordance for a frozen workspace, and it used to be
      // silent whenever the re-check changed nothing -- indistinguishable from a
      // dead button. Say which of the two happened.
      const recovered = await retrySharedAccess();
      if (recovered) toast.success('공유 정보를 다시 확인했어요.');
      else toast.error('아직 공유 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div
      className="mx-4 mt-3 flex items-center justify-between gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900"
      role="status"
    >
      <span>{message}</span>
      {/*
        This is the only affordance for recovering a frozen shared workspace, so
        it has to be reachable by thumb: `p-1` alone rendered a 22x22 target.
      */}
      <button
        type="button"
        onClick={() => void retry()}
        disabled={retrying}
        className="shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg disabled:opacity-50"
        aria-label="공유 정보 다시 확인"
      >
        {retrying
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : <RotateCcw className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}
