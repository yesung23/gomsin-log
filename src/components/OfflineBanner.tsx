import { useOnlineStatus } from '@/lib/useOnlineStatus';

/**
 * Offline notice.
 *
 * Connectivity now comes from the shared `useOnlineStatus` hook rather than this
 * component's own listener pair. That pair used to be the ONLY place the app
 * tracked connectivity, so every mutation control had to either duplicate it or
 * ignore it -- and they all ignored it, which is why tapping 저장 offline fired a
 * request and produced a cause-blind error message.
 *
 * The copy stays connection-specific: unlike every other failure message in the
 * app, this one is shown ONLY when the device really has no network.
 */
export function OfflineBanner() {
  const online = useOnlineStatus();

  if (online) return null;

  return (
    <div
      role="alert"
      className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+60px)] left-1/2 -translate-x-1/2 w-full max-w-[430px] z-[60] px-3"
    >
      <div className="w-full rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-center text-xs font-medium text-red-900 shadow-sm">
        인터넷 연결이 끊겼어요 · 지금은 읽기만 가능해요
      </div>
    </div>
  );
}
