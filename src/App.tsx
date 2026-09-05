import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  applyHandwritingAttribute,
  loadHandwritingEnabled,
} from '@/lib/handwritingPreference';
import {
  applyPaperTextureAttribute,
  reconcileOwnedPaperTexture,
} from '@/lib/paperTexturePreference';
import { loadCompanionShopState } from '@/lib/companionShopLocalState';
import {
  applyRecordTextSizeAttribute,
  loadRecordTextSize,
} from '@/lib/recordTextSizePreference';
import { listenForPushTaps } from '@/lib/pushNotifications';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useStore } from '@/lib/useStore';
import { NotificationReentryBridge } from '@/components/NotificationReentryBridge';
import { AppleIapSessionBridge } from '@/components/AppleIapSessionBridge';
import { RouteAccessibilityManager } from '@/components/RouteAccessibilityManager';
import { MilitaryOnlyRoute } from '@/components/MilitaryOnlyRoute';
import { AppLoadingState } from '@/components/ui/AppLoadingState';
import type { ServerErrorKind } from '@/lib/serverErrors';
import type { AuthSyncStage } from '@/lib/sync';
import { authSyncFailureCopy } from '@/lib/authSyncFailureCopy';

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
const CallModePage = lazy(() =>
  import('@/pages/CallModePage').then((m) => ({ default: m.CallModePage })),
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
const SupportPage = lazy(() =>
  import('@/pages/SupportPage').then((m) => ({ default: m.SupportPage })),
);
const ComposePage = lazy(() =>
  import('@/features/compose/ComposePage').then((m) => ({ default: m.ComposePage })),
);
const SavedTopicsPage = lazy(() =>
  import('@/features/talk/SavedTopicsPage').then((m) => ({ default: m.SavedTopicsPage })),
);
const MePage = lazy(() =>
  import('@/features/me/MePage').then((m) => ({ default: m.MePage })),
);
const DiaryPage = lazy(() =>
  import('@/features/diary/DiaryPage').then((m) => ({ default: m.DiaryPage })),
);
const CompanionGardenPage = lazy(() =>
  import('@/features/diary/CompanionGardenPage').then((m) => ({ default: m.CompanionGardenPage })),
);
const ShopPage = lazy(() =>
  import('@/features/shop/ShopPage').then((m) => ({ default: m.ShopPage })),
);
const SearchPage = lazy(() =>
  import('@/features/search/SearchPage').then((m) => ({ default: m.SearchPage })),
);
const StoryRoute = lazy(() =>
  import('@/features/story/StoryRoute').then((m) => ({ default: m.StoryRoute })),
);
const HomePage = lazy(() =>
  import('@/pages/HomePage').then((m) => ({ default: m.HomePage })),
);

function PageLoader() {
  return (
    <AppLoadingState
      label="화면을 불러오고 있어요"
      description="잠시만 기다려 주세요."
    />
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
    if (outcome.status !== 'deleted' && outcome.status !== 'cancelled') {
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
        <h1 className="text-heading text-foreground">탈퇴 처리를 확인하고 있어요</h1>
        <p className="text-body text-muted-foreground">
          안전하게 완료되기 전까지 계정 이용이 잠시 제한돼요.
          아래에서 탈퇴를 다시 시도하거나 로그아웃할 수 있어요.
        </p>
        {message && (
          <p className="text-body text-destructive">{message}</p>
        )}
        <button
          type="button"
          onClick={() => void onRetry()}
          disabled={busy !== null}
          className="press-response w-full min-h-[44px] rounded-xl bg-coral-fill px-4 py-3 text-label font-bold text-coral-fill-foreground disabled:opacity-60"
        >
          {busy === 'retry' ? '처리 중...' : '탈퇴 다시 시도'}
        </button>
        <button
          type="button"
          onClick={() => void onLogout()}
          disabled={busy !== null}
          className="press-response-row w-full min-h-[44px] rounded-xl border border-border px-4 py-3 text-label font-bold text-foreground disabled:opacity-60"
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
}: {
  reason: ServerErrorKind | null;
  stage: AuthSyncStage | null;
}) {
  const { signOut } = useStore();
  const [busy, setBusy] = useState(false);
  const copy = authSyncFailureCopy(reason, stage);

  return (
    <main className="paper-texture-layer min-h-[100dvh] flex items-center justify-center px-6 pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]">
      <section role="alert" className="ink-box w-full max-w-sm p-6 text-center space-y-3">
        <h1 className="text-heading text-foreground">{copy.title}</h1>
        <p className="text-body text-muted-foreground">{copy.description}</p>
        {/*
          The diagnostic, in this app's vocabulary only.

          This line used to append the raw PostgREST/Postgres code, so a failing
          table put `진단 코드: RECORDS-SERVER-PGRST500` on the first screen a person
          saw. Two problems, and the smaller one is that it looks broken: nobody
          outside this repository can act on `PGRST500`, and printing it tells any
          reader which backend stack this runs on, on a screen shown before anyone
          has authenticated.

          `RECORDS-SERVER` is enough. The stage and the classified kind are terms
          this codebase defines, they are what a support conversation actually
          needs, and they name no vendor. The raw code stays where it is useful --
          the server's own logs.

          The store no longer carries the raw code either. It was held only so
          this line could print it, so once that stopped it was a field the
          context exported and nothing read. It now goes to the console at the
          point of failure, where a developer has the context to use it.
        */}
        {stage && (
          <p className="text-caption text-muted-foreground" aria-label="오류 진단 코드">
            진단 코드: {AUTH_STAGE_CODES[stage]}-{(reason || 'UNKNOWN').toUpperCase()}
          </p>
        )}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="press-response ink-fill w-full min-h-[44px] px-4 py-3 text-label font-bold"
        >
          {copy.actionLabel}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void signOut().finally(() => setBusy(false));
          }}
          className="press-response-row w-full min-h-[44px] rounded-xl border border-border px-4 py-3 text-label font-bold text-foreground disabled:opacity-60"
        >
          {busy ? '처리 중...' : '로그아웃'}
        </button>
      </section>
    </main>
  );
}

function AppContent() {
  const {
    state,
    isReady,
    authSyncUnavailable,
    authSyncReason,
    authSyncStage,
    accountDeletionRecovery,
  } = useStore();
  const navigate = useNavigate();

  /*
    A tapped notification has to land somewhere.

    Registered here rather than in the store because it needs the router, and
    once per app rather than per connection: the handler is stateless and a second
    registration would route the same tap twice.

    It lands on home and only home -- `listenForPushTaps` refuses any other route,
    because a payload that can choose a destination is a payload that has already
    said which record it was about (IA §3.1).

    Above the early returns so the listener is installed even while the app is
    showing a loader or a recovery screen: a notification tapped during either is
    still a tap that has to go somewhere.
  */
  /*
    Two ways the first version of this failed to be "once per app".

    `navigate` is not stable. `App` renders above `<Routes>`, so react-router
    hands back `useNavigateUnstable`, whose identity changes with the current
    pathname -- and a dependency array containing it tore the listener down and
    put a new one up on EVERY navigation.

    And the teardown could not run. `dispose` was assigned inside `.then()`, so a
    cleanup firing before the registration promise resolved returned `undefined?.()`
    -- a no-op -- while the listener it was meant to cancel arrived a tick later
    and stayed forever. Native only, and it accumulated: one tap, N routes.

    A ref for the callback and an empty dependency array fix the first. A
    `disposed` flag that the late resolver checks fixes the second.
  */
  const navigateRef = useRef(navigate);
  useEffect(() => { navigateRef.current = navigate; }, [navigate]);

  useEffect(() => {
    let disposed = false;
    let dispose: (() => void) | undefined;
    void listenForPushTaps((path) => navigateRef.current(path)).then((remove) => {
      if (disposed) { remove?.(); return; }
      dispose = remove;
    });
    return () => { disposed = true; dispose?.(); };
  }, []);

  /*
    손글씨를 켤지 끌지는 그 사람의 눈과 그 기기의 화면에 관한 값이므로 계정별 로컬 설정이다.
    `<html>`에 `data-hand`로 반영하고, 켬일 때는 속성을 아예 달지 않는다 -- 켬이 기본이라
    첫 페인트가 이 효과를 기다리지 않는다.

    계정이 바뀌면 다시 읽는다. 같은 기기를 두 사람이 쓸 때 한쪽의 선택이 다른 쪽에 남으면
    사용자가 하지 않은 설정이 적용된 것으로 보인다.
  */
  const viewerId = state.authenticatedUser?.id || state.profile.id || '';
  useEffect(() => {
    applyHandwritingAttribute(loadHandwritingEnabled(viewerId));
    const shopState = loadCompanionShopState(viewerId);
    applyPaperTextureAttribute(reconcileOwnedPaperTexture(viewerId, shopState.ownedPapers));
    applyRecordTextSizeAttribute(loadRecordTextSize(viewerId));
  }, [viewerId]);

  if (!isReady) {
    return (
      <AppLoadingState
        label="곰신로그를 준비하고 있어요"
        description="계정과 기록을 확인하는 중이에요."
      />
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
          <Route path="/support" element={<SupportPage />} />
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
          <Route path="/support" element={<SupportPage />} />
          <Route
            path="*"
            element={(
              <AuthSyncUnavailable
                reason={authSyncReason}
                stage={authSyncStage}
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
        <AppleIapSessionBridge />
        <Routes>
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          {/* Legal documents must be reachable before sign-in too (store listing requirement). */}
          <Route path="/legal/:doc" element={<LegalPage />} />
          <Route path="/support" element={<SupportPage />} />
          {!state.setupComplete ? (
            <>
              <Route path="/onboarding" element={<OnboardingPage />} />
              <Route path="*" element={<OnboardingPage />} />
            </>
          ) : (
            <>
              {/*
                스토리.

                PRODUCT_V3 §7.5 -- 기록은 라우트로 주소 지정 가능해야 한다. 휘발성 앱 상태로만
                대상을 지정하면 새로고침·딥링크·알림에서 원본에 도달할 수 없다. `?at=`은
                인덱스가 아니라 `recordId`이며, 그래야 기록 하나가 지워져도 옆 기록이 열리지
                않는다(§4.2 근사치 금지).
              */}
              <Route path="/story/partner" element={<StoryRoute mode="today" />} />
              <Route path="/story/mine" element={<StoryRoute mode="mine" />} />
              <Route path="/story/day/:date" element={<StoryRoute mode="archive" />} />
              <Route path="/story/highlight/:highlightId" element={<StoryRoute mode="highlight" />} />
              <Route path="/" element={<HomePage />} />
              <Route path="/home" element={<HomePage />} />
              <Route path="/record" element={<RecordPage />} />
              <Route path="/compose" element={<ComposePage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/me" element={<MePage />} />
              <Route path="/diary" element={<DiaryPage />} />
              <Route path="/diary/garden" element={<CompanionGardenPage />} />
              <Route path="/shop" element={<ShopPage />} />
              <Route path="/schedule" element={<SchedulePage />} />
              <Route
                path="/service"
                element={(
                  <MilitaryOnlyRoute>
                    <ServicePage />
                  </MilitaryOnlyRoute>
                )}
              />
              <Route path="/us" element={<UsPage />} />
              <Route path="/my" element={<MyPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              {/* 통화 모드. Draws no tab bar on purpose: this screen is used
                  one-handed with a phone against an ear, and a row of navigation
                  targets along the bottom edge is the wrong thing to have under a
                  thumb that is aiming for 이야기했어요. */}
              <Route path="/saved" element={<SavedTopicsPage />} />
              <Route path="/call" element={<CallModePage />} />
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

export function App() {
  return (
    <RouteAccessibilityManager>
      <AppContent />
    </RouteAccessibilityManager>
  );
}
