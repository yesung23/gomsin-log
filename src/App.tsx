import { lazy, Suspense, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useStore } from '@/lib/useStore';
import { HomePage } from '@/pages/HomePage';
import { NotificationReentryBridge } from '@/components/NotificationReentryBridge';
import type { ServerErrorKind } from '@/lib/serverErrors';
import type { AuthSyncStage } from '@/lib/sync';

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

/**
 * The only screen an account in deletion recovery may see.
 *
 * Exactly two actions: retry the deletion, or log out. There is NO override of
 * any kind -- no timeout, no attempt counter, no "continue anyway" affordance
 * and no query parameter re-admits a blocked user to an authenticated route.
 */
function AccountDeletionRecovery() {
  const { retryAccountDeletion, signOut } = useStore();
  const [busy, setBusy] = useState<'retry' | 'logout' | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const onRetry = async () => {
    if (busy) return;
    setBusy('retry');
    setMessage(null);
    const outcome = await retryAccountDeletion();
    if (outcome.status !== 'deleted') {
      setMessage('아직 탈퇴를 완료하지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
    setBusy(null);
  };

  const onLogout = async () => {
    if (busy) return;
    setBusy('logout');
    await signOut();
    setBusy(null);
  };

  return (
    <main className="min-h-[100dvh] bg-background flex items-center justify-center px-6">
      <section
        role="alert"
        className="w-full max-w-sm rounded-surface border border-border bg-card p-6 text-center shadow-sm space-y-3"
      >
        <h1 className="text-heading text-foreground">탈퇴가 완료되지 않았어요</h1>
        <p className="text-body text-muted-foreground">
          기록과 프로필 데이터는 이미 삭제되었지만 로그인 계정이 아직 남아 있어요.
          탈퇴를 끝내려면 아래에서 다시 시도해 주세요.
        </p>
        {message && (
          <p className="text-body text-destructive">{message}</p>
        )}
        <button
          type="button"
          onClick={() => void onRetry()}
          disabled={busy !== null}
          className="w-full min-h-[44px] rounded-xl bg-coral-fill px-4 py-3 text-label font-bold text-coral-fill-foreground disabled:opacity-60"
        >
          {busy === 'retry' ? '처리 중...' : '탈퇴 다시 시도'}
        </button>
        <button
          type="button"
          onClick={() => void onLogout()}
          disabled={busy !== null}
          className="w-full min-h-[44px] rounded-xl border border-border px-4 py-3 text-label font-bold text-foreground disabled:opacity-60"
        >
          로그아웃
        </button>
      </section>
    </main>
  );
}

/**
 * Account hydration failed.
 *
 * The copy is chosen from the CLASSIFIED cause. Previously this screen always
 * blamed the internet connection, so an expired session and an RLS rejection both
 * told the user to check a connection that was working perfectly.
 */
const AUTH_STAGE_CODES: Record<AuthSyncStage, string> = {
  profile: 'PROFILE',
  membership: 'MEMBERSHIP',
  couple: 'COUPLE',
  partner: 'PARTNER',
  contact: 'CONTACT',
  records: 'RECORDS',
  events: 'EVENTS',
  trips: 'TRIPS',
  'talk-about': 'TALK_ABOUT',
  unexpected: 'UNEXPECTED',
  timeout: 'TIMEOUT',
};

function AuthSyncUnavailable({
  reason,
  stage,
  code,
}: {
  reason: ServerErrorKind | null;
  stage: AuthSyncStage | null;
  code: string | null;
}) {
  const { signOut } = useStore();
  const [busy, setBusy] = useState(false);
  const isSessionProblem = reason === 'auth_expired';
  const title = isSessionProblem ? '세션이 만료되었어요' : '계정 정보를 확인하지 못했어요';
  const description = isSessionProblem
    ? '다시 로그인해 주세요. 확인이 끝날 때까지 계정 데이터는 표시하지 않아요.'
    : reason === 'forbidden'
      ? '계정 권한을 확인하지 못했어요. 잠시 후 다시 시도해 주세요. 확인이 끝날 때까지 계정 데이터는 표시하지 않아요.'
      : reason === 'offline'
        ? '인터넷 연결을 확인한 뒤 다시 시도해 주세요. 확인이 끝날 때까지 계정 데이터는 표시하지 않아요.'
        : reason === 'server'
          ? '서비스 설정을 확인하지 못했어요. 잠시 후 다시 시도해 주세요. 확인이 끝날 때까지 계정 데이터는 표시하지 않아요.'
          : reason === 'unreachable'
            ? '서버에 요청이 닿지 않았어요. 잠시 후 다시 시도해 주세요. 확인이 끝날 때까지 계정 데이터는 표시하지 않아요.'
            : '잠시 후 다시 시도해 주세요. 확인이 끝날 때까지 계정 데이터는 표시하지 않아요.';

  return (
    <main className="min-h-[100dvh] bg-background flex items-center justify-center px-6">
      <section role="alert" className="w-full max-w-sm rounded-surface border border-border bg-card p-6 text-center shadow-sm space-y-3">
        <h1 className="text-heading text-foreground">{title}</h1>
        <p className="text-body text-muted-foreground">{description}</p>
        {stage && (
          <p className="text-caption text-muted-foreground" aria-label="오류 진단 코드">
            진단 코드: {AUTH_STAGE_CODES[stage]}-{(reason || 'UNKNOWN').toUpperCase()}
            {code ? `-${code}` : ''}
          </p>
        )}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="w-full min-h-[44px] rounded-xl bg-coral-fill px-4 py-3 text-label font-bold text-coral-fill-foreground"
        >
          {isSessionProblem ? '다시 로그인' : '다시 시도'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void signOut().finally(() => setBusy(false));
          }}
          className="w-full min-h-[44px] rounded-xl border border-border px-4 py-3 text-label font-bold text-foreground disabled:opacity-60"
        >
          {busy ? '처리 중...' : '로그아웃'}
        </button>
      </section>
    </main>
  );
}

export function App() {
  const {
    state,
    isReady,
    authSyncUnavailable,
    authSyncReason,
    authSyncStage,
    authSyncCode,
    accountDeletionRecovery,
  } = useStore();

  if (!isReady) {
    return (
      <div className="min-h-[100dvh] bg-background flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-coral border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Placed BEFORE the `authSyncUnavailable` branch so it TAKES PRECEDENCE over
  // it: a sync outage must not replace the recovery screen with a retry-sync
  // screen that offers no way to complete the deletion.
  if (accountDeletionRecovery) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/legal/:doc" element={<LegalPage />} />
          <Route path="*" element={<AccountDeletionRecovery />} />
        </Routes>
      </Suspense>
    );
  }

  if (authSyncUnavailable) {
    return (
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/legal/:doc" element={<LegalPage />} />
          <Route
            path="*"
            element={(
              <AuthSyncUnavailable
                reason={authSyncReason}
                stage={authSyncStage}
                code={authSyncCode}
              />
            )}
          />
        </Routes>
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<PageLoader />}>
      <>
        {/* Cross-route re-entry belongs under the app/store boundary, not inside
            MobileShell, so shell-level accessibility tests and isolated routes
            remain usable without a StoreProvider. */}
        <NotificationReentryBridge />
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
      </>
    </Suspense>
  );
}
