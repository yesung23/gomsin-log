import { useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
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
  const message = unavailable
    ? '공유 정보를 확인할 수 없어 잠시 숨겼어요.'
    : '실시간 연결이 끊겨 최신 정보가 아닐 수 있어요.';

  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      await retrySharedAccess();
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
      <button
        type="button"
        onClick={() => void retry()}
        disabled={retrying}
        className="p-1 shrink-0 disabled:opacity-50"
        aria-label="공유 정보 다시 확인"
      >
        {retrying
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : <RotateCcw className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}
