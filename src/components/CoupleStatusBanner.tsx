import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, Check, RefreshCw, Link2Off, HelpCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '@/lib/useStore';
import { Button } from '@/components/ui/Button';
import { regenerateCoupleInvitation } from '@/lib/supabase';
import { invitationExpiryLabel, isInvitationExpired } from '@/lib/coupleLifecycle';
import { useOnlineStatus, OFFLINE_READONLY_MESSAGE } from '@/lib/useOnlineStatus';

/**
 * The couple lifecycle, rendered wherever the user actually is.
 *
 * Before this component the only lifecycle affordance in the whole app was buried
 * in Settings, so a creator who reloaded the page lost their invitation code with
 * no on-screen way to get another one, and `/us` told them to "complete the space
 * with an invitation code" -- which reads as "enter one", the single action
 * `redeem_invitation` refuses for them.
 *
 * Rendering rules, one per lifecycle state:
 *
 *  - `personal`     -> offer both create and join, via Settings.
 *  - `pending`      -> the code (or a way to mint a new one), its expiry, and what
 *                      happens next. NEVER a code-entry field.
 *  - `connected`    -> nothing at all. A healthy state needs no banner.
 *  - `disconnected` -> reconnect guidance.
 *  - `unknown`      -> a neutral "checking" state with a retry, and NO
 *                      personal-mode wording. This is the whole reason `unknown`
 *                      is a distinct variant: telling a connected user they have no
 *                      couple space is the exact failure being prevented.
 *
 * Deliberately INLINE, not bottom-anchored: `src/lib/modalStacking.test.ts`
 * requires any bottom-anchored overlay to clear the `z-50` tab bar, and the right
 * way to satisfy that here is to not be an overlay at all.
 */
export function CoupleStatusBanner() {
  const navigate = useNavigate();
  const { state, coupleLifecycle, invitationExpiresAt, refreshCoupleLifecycle } = useStore();
  const isOnline = useOnlineStatus();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [freshCode, setFreshCode] = useState('');

  // A healthy, connected couple needs no explanation.
  if (coupleLifecycle === 'connected') return null;

  const expiryLabel = invitationExpiryLabel(invitationExpiresAt);
  /**
   * A code whose known deadline has passed is not a code any more.
   *
   * The server's verdict (`invitation_active`) is only re-read on a refresh, so a
   * session left open across the 24-hour expiry would otherwise keep showing a
   * six-digit number that `redeem_invitation` now rejects as
   * `invalid_or_expired` -- with the partner blamed for mistyping it. A freshly
   * minted code is exempt: its expiry has not been re-read yet.
   */
  const cachedCodeExpired = !freshCode && isInvitationExpired(invitationExpiresAt);
  const code = freshCode || (cachedCodeExpired ? '' : state.profile.couple.coupleCode);

  const handleCopy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast.success('초대 코드가 클립보드에 복사되었습니다.');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('코드를 복사하지 못했어요. 직접 입력해 전달해 주세요.');
    }
  };

  const handleRegenerate = async () => {
    if (busy) return;
    if (!isOnline) {
      toast.error(OFFLINE_READONLY_MESSAGE);
      return;
    }
    setBusy(true);
    try {
      const result = await regenerateCoupleInvitation();
      if (result.error || !result.code) {
        toast.error(result.error || '초대 코드를 새로 발급하지 못했어요.');
        return;
      }
      setFreshCode(result.code);
      // Re-read the authoritative expiry rather than computing one locally.
      await refreshCoupleLifecycle();
      toast.success('새 초대 코드를 발급했어요.');
    } finally {
      setBusy(false);
    }
  };

  const handleRetry = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await refreshCoupleLifecycle();
    } finally {
      setBusy(false);
    }
  };

  if (coupleLifecycle === 'unknown') {
    return (
      <section
        aria-live="polite"
        data-testid="couple-status-banner"
        data-lifecycle="unknown"
        className="rounded-surface border border-border bg-card p-4 space-y-2"
      >
        <div className="flex items-center gap-2 text-label font-bold text-foreground">
          <HelpCircle size={14} className="text-muted-foreground" />
          <span>커플 공간 상태를 확인하고 있어요</span>
        </div>
        <p className="text-caption text-muted-foreground">
          확인이 끝날 때까지 이 기기에 저장된 정보는 그대로 유지돼요.
        </p>
        <button
          type="button"
          onClick={() => void handleRetry()}
          disabled={busy}
          className="press-response-row min-h-[44px] w-full rounded-control border border-border px-4 text-label font-bold text-foreground disabled:opacity-50"
        >
          {busy ? '확인 중...' : '다시 확인'}
        </button>
      </section>
    );
  }

  if (coupleLifecycle === 'personal') {
    return (
      <section
        data-testid="couple-status-banner"
        data-lifecycle="personal"
        className="rounded-surface border border-border bg-card p-4 space-y-2"
      >
        <p className="text-label font-bold text-foreground">
          우리 공간을 만들거나 초대 코드를 입력해 보세요
        </p>
        <p className="text-caption text-muted-foreground">
          공간을 만들면 초대 코드가 생기고, 상대방이 그 코드를 입력하면 연결돼요.
        </p>
        <Button variant="primary" full
                onClick={() => navigate('/settings')}>
          커플 공간 설정으로 가기
        </Button>
      </section>
    );
  }

  if (coupleLifecycle === 'disconnected') {
    return (
      <section
        data-testid="couple-status-banner"
        data-lifecycle="disconnected"
        className="rounded-surface border border-border bg-card p-4 space-y-2"
      >
        <div className="flex items-center gap-2 text-label font-bold text-foreground">
          <Link2Off size={14} className="text-muted-foreground" />
          <span>커플 공간 연결이 해제되었어요</span>
        </div>
        <p className="text-caption text-muted-foreground">
          내가 남긴 비공개 기록은 그대로 있어요. 다시 연결하려면 새 공간을 만들거나
          상대방의 초대 코드를 입력해 주세요.
        </p>
        <Button variant="primary" full
                onClick={() => navigate('/settings')}>
          다시 연결하기
        </Button>
      </section>
    );
  }

  // pending
  return (
    <section
      data-testid="couple-status-banner"
      data-lifecycle="pending"
      className="rounded-surface border border-coral/30 bg-coral/10 p-4 space-y-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-label font-bold text-coral-strong">상대방을 기다리고 있어요</span>
        {expiryLabel && (
          <span
            data-testid="invitation-expiry"
            className="text-caption font-semibold text-muted-foreground"
          >
            {expiryLabel}
          </span>
        )}
      </div>

      {code ? (
        <>
          <div className="flex items-center justify-between rounded-control border border-coral/20 bg-card px-4 py-3">
            <span className="font-mono text-display tracking-widest text-foreground">
              {code}
            </span>
            <button
              type="button"
              onClick={() => void handleCopy()}
              aria-label="초대 코드 복사"
              className="press-response min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-coral"
            >
              {copied ? <Check size={20} /> : <Copy size={20} />}
            </button>
          </div>
          <p className="text-caption text-muted-foreground">
            상대방이 코드를 입력하면 자동으로 연결돼요.
          </p>
        </>
      ) : cachedCodeExpired ? (
        <>
          {/* A lapsed code is a different situation from a missing one, and saying
              "this device has no code" about a code the user can still remember
              sending would be false. */}
          <p className="text-label font-semibold text-foreground">
            초대 코드의 유효기간이 지났어요
          </p>
          <p className="text-caption text-muted-foreground">
            이전 코드는 더 이상 사용할 수 없어요. 새 코드를 발급해 상대방에게 다시
            전달해 주세요.
          </p>
          <Button variant="primary" full
                onClick={() => void handleRegenerate()}
            disabled={busy || !isOnline}>
            <RefreshCw size={14} />
            {busy ? '발급 중...' : '새 코드 발급'}
          </Button>
          {!isOnline && (
            <p className="text-caption text-muted-foreground">
              {OFFLINE_READONLY_MESSAGE}
            </p>
          )}
        </>
      ) : (
        <>
          {/* The server stores only a hash of the code, so a device that no longer
              holds the plaintext cannot be shown it -- minting a new one is the
              only possible recovery. */}
          <p className="text-label font-semibold text-foreground">
            이 기기에 저장된 초대 코드가 없습니다
          </p>
          <p className="text-caption text-muted-foreground">
            보안을 위해 서버에는 코드가 저장되지 않아요. 새 코드를 발급하면 이전 코드는
            사용할 수 없어요.
          </p>
          <Button variant="primary" full
                onClick={() => void handleRegenerate()}
            disabled={busy || !isOnline}>
            <RefreshCw size={14} />
            {busy ? '발급 중...' : '새 코드 발급'}
          </Button>
          {!isOnline && (
            <p className="text-caption text-muted-foreground">
              {OFFLINE_READONLY_MESSAGE}
            </p>
          )}
        </>
      )}
    </section>
  );
}
