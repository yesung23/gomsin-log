import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import { StoreProvider } from '@/lib/store';
import { App } from '@/App';
import '@/styles/index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <StoreProvider>
        <App />
        <Toaster position="top-center" theme="light" richColors={false} />
      </StoreProvider>
    </BrowserRouter>
  </StrictMode>
);

// Register Service Worker for PWA (production only to protect dev HMR)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((reg) => {
      console.info('[PWA] Service Worker registered with scope:', reg.scope);
    }).catch((err) => {
      console.warn('[PWA] Service Worker registration skipped/failed:', err);
    });
  });
}
