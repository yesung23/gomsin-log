import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useStore } from '@/lib/useStore';
import { HomePage } from '@/pages/HomePage';

// Eagerly loaded: auth callback must resolve immediately on redirect.
import { AuthCallbackPage } from '@/pages/AuthCallbackPage';

// Lazy-loaded routes: not on the critical first-paint path.
const OnboardingPage = lazy(() =>
  import('@/pages/OnboardingPage').then((m) => ({ default: m.OnboardingPage })),
);
const RecordPage = lazy(() =>
  import('@/pages/RecordPage').then((m) => ({ default: m.RecordPage })),
);
const SchedulePage = lazy(() =>
  import('@/pages/SchedulePage').then((m) => ({ default: m.SchedulePage })),
);
const UsPage = lazy(() =>
  import('@/pages/UsPage').then((m) => ({ default: m.UsPage })),
);
const MyPage = lazy(() =>
  import('@/pages/MyPage').then((m) => ({ default: m.MyPage })),
);
const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const TripsPage = lazy(() =>
  import('@/pages/TripsPage').then((m) => ({ default: m.TripsPage })),
);
const TripDetailPage = lazy(() =>
  import('@/pages/TripDetailPage').then((m) => ({ default: m.TripDetailPage })),
);
const ServicePage = lazy(() =>
  import('@/pages/ServicePage').then((m) => ({ default: m.ServicePage })),
);
const LegalPage = lazy(() =>
  import('@/pages/LegalPage').then((m) => ({ default: m.LegalPage })),
);

function PageLoader() {
  return (
    <div className="min-h-[100dvh] bg-background flex items-center justify-center">
      <div className="w-8 h-8 border-3 border-coral border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export function App() {
  const { state, isReady } = useStore();

  if (!isReady) {
    return (
      <div className="min-h-[100dvh] bg-background flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-coral border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        {/* Legal documents must be reachable before sign-in too (store listing requirement). */}
        <Route path="/legal/:doc" element={<LegalPage />} />
        {!state.setupComplete ? (
          <>
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route path="*" element={<OnboardingPage />} />
          </>
        ) : (
          <>
            <Route path="/" element={<HomePage />} />
            <Route path="/home" element={<HomePage />} />
            <Route path="/record" element={<RecordPage />} />
            <Route path="/schedule" element={<SchedulePage />} />
            <Route path="/service" element={<ServicePage />} />
            <Route path="/us" element={<UsPage />} />
            <Route path="/my" element={<MyPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/trips" element={<TripsPage />} />
            <Route path="/trips/:id" element={<TripDetailPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        )}
      </Routes>
    </Suspense>
  );
}
