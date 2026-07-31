import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { toast } from 'sonner';
import { StoreProvider } from '@/lib/store';
import { App } from '@/App';
import { ThemedToaster } from '@/components/ThemedToaster';
import { registerAuthDeepLinkHandler } from '@/lib/deepLinks';
import { isNativePlatform } from '@/lib/platform';
import '@/styles/index.css';

// Handles `gomsinlog://auth/callback` in the Capacitor shell. No-op on the web.
registerAuthDeepLinkHandler();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <StoreProvider>
        <App />
        <ThemedToaster />
      </StoreProvider>
    </BrowserRouter>
  </StrictMode>
);

// Register the service worker for the PWA build only.
// The native shell serves the bundle from the app package, so a service worker
// there would only add a second, stale cache layer.
if (import.meta.env.PROD && !isNativePlatform() && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      console.info('[PWA] Service Worker registered with scope:', reg.scope);

      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (
            newWorker.state === 'installed' &&
            navigator.serviceWorker.controller
          ) {
            toast('새 버전이 있어요', {
              duration: Infinity,
              action: {
                label: '지금 업데이트',
                onClick: () => {
                  reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
                  navigator.serviceWorker.addEventListener(
                    'controllerchange',
                    () => {
                      window.location.reload();
                    }
                  );
                },
              },
            });
          }
        });
      });
    }).catch((err) => {
      console.warn('[PWA] Service Worker registration skipped/failed:', err);
    });
  });
}
