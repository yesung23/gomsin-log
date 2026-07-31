import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { toast } from 'sonner';
import { StoreProvider } from '@/lib/store';
import { App } from '@/App';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ThemedToaster } from '@/components/ThemedToaster';
import { registerAuthDeepLinkHandler } from '@/lib/deepLinks';
import { isNativePlatform } from '@/lib/platform';
import '@/styles/index.css';

// Handles `gomsinlog://auth/callback` in the Capacitor shell. No-op on the web.
registerAuthDeepLinkHandler();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <StoreProvider>
          <App />
          <ThemedToaster />
        </StoreProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
);

// Register the service worker for the PWA build only.
// The native shell serves the bundle from the app package, so a service worker
// there would only add a second, stale cache layer.
if (import.meta.env.PROD && !isNativePlatform() && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      console.info('[PWA] Service Worker registered with scope:', registration.scope);

      let updatePromptOpen = false;
      const offerUpdate = (candidate: ServiceWorker | null) => {
        if (!candidate || !navigator.serviceWorker.controller || updatePromptOpen) return;
        updatePromptOpen = true;
        toast('새 버전이 있어요', {
          duration: Infinity,
          action: {
            label: '지금 업데이트',
            onClick: () => {
              // Listen before posting: activation can be fast enough to emit
              // controllerchange in the same task on some browsers.
              navigator.serviceWorker.addEventListener(
                'controllerchange',
                () => window.location.reload(),
                { once: true },
              );
              const waiting = registration.waiting ?? candidate;
              waiting.postMessage({ type: 'SKIP_WAITING' });
            },
          },
        });
      };

      // The update may have finished installing while the app was closed or
      // before this listener was attached. `updatefound` will not fire again for
      // an already-waiting worker, so check it immediately.
      offerUpdate(registration.waiting);
      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed') offerUpdate(registration.waiting ?? installing);
        });
      });
    }).catch((error) => {
      console.warn('[PWA] Service Worker registration skipped/failed:', error);
    });
  });
}
