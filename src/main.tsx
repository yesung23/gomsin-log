import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { toast } from 'sonner';
import { StoreProvider } from '@/lib/store';
import { App } from '@/App';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ThemedToaster } from '@/components/ThemedToaster';
import { createDeferredFailureSink, registerAuthDeepLinkHandler } from '@/lib/deepLinks';
import { isNativePlatform } from '@/lib/platform';
import '@/styles/index.css';

// Handles `gomsinlog://auth/callback` in the Capacitor shell. No-op on the web.
const authFailures = createDeferredFailureSink();
registerAuthDeepLinkHandler(authFailures.report);

function showAuthFailures() {
  authFailures.activate((message) => {
    try {
      toast.error(message);
    } catch {
      console.error('[gomsinlog] Could not display toast.');
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <StoreProvider>
          <App />
          <ThemedToaster onReady={showAuthFailures} />
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
    // Reload exactly once when an EXISTING installation moves to a new worker.
    // `sw.js` activates only after the complete hashed app shell is cached, so
    // this replaces the currently running release atomically. On first install
    // there is no controller yet and no reload is needed.
    const hadController = !!navigator.serviceWorker.controller;
    let reloadingForUpdate = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloadingForUpdate) return;
      reloadingForUpdate = true;
      window.location.reload();
    });

    navigator.serviceWorker.register('/sw.js').then(() => {
      console.info('[PWA] Service Worker registered.');
    }).catch(() => {
      console.warn('[PWA] Service Worker registration skipped/failed.');
    });
  });
}
