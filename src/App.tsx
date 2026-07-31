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

function AuthSyncUnavailable() {
  return (
    <main className="min-h-[100dvh] bg-background flex items-center justify-center px-6">
      <section role="alert" className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 text-center shadow-sm space-y-3">
        <h1 className="text-base font-bold text-foreground">계정 정보를 확인하지 못했어요</h1>
        <p className="text-xs leading-5 text-muted-foreground">
          인터넷 연결을 확인한 뒤 다시 시도해 주세요. 확인이 끝날 때까지 계정 데이터는 표시하지 않아요.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="w-full min-h-[44px] rounded-xl bg-coral px-4 py-3 text-xs font-bold text-white"
        >
          다시 시도
        </button>
      </section>
    </main>
  );
}

export function App() {
  const { state, isReady, authSyncUnavailable } = useStore();

  if (!isReady) {
    return (
      <div className="min-h-[100dvh] bg-background flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-coral border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (authSyncUnavailable) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/legal/:doc" element={<LegalPage />} />
          <Route path="*" element={<AuthSyncUnavailable />} />
        </Routes>
      </Suspense>
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
