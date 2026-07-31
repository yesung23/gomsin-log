import { useEffect, useState } from 'react';

export function OfflineBanner() {
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);

    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);

    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="alert"
      className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+60px)] left-1/2 -translate-x-1/2 w-full max-w-[430px] z-50 px-3"
    >
      <div className="w-full rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-center text-xs font-medium text-red-900 shadow-sm">
        인터넷 연결이 끊겼어요
      </div>
    </div>
  );
}
