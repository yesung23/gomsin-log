import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, Check, RefreshCw, Link2Off, HelpCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useStore } from '@/lib/useStore';
import { regenerateCoupleInvitation } from '@/lib/supabase';
import { invitationExpiryLabel } from '@/lib/coupleLifecycle';
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

  // Demo mode authors its own couple state locally; a server-state banner would
  // be meaningless there.
  if (state.isDemoMode) return null;
  // A healthy, connected couple needs no explanation.
  if (coupleLifecycle === 'connected') return null;

  const code = freshCode || state.profile.couple.coupleCode;
  const expiryLabel = invitationExpiryLabel(invitationExpiresAt);

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
        className="rounded-2xl border border-border bg-card p-4 shadow-sm space-y-2"
      >
        <div className="flex items-center gap-2 text-xs font-bold text-foreground">
          <HelpCircle size={14} className="text-muted-foreground" />
          <span>커플 공간 상태를 확인하고 있어요</span>
        </div>
        <p className="text-[11px] leading-4 text-muted-foreground">
          확인이 끝날 때까지 이 기기에 저장된 정보는 그대로 유지돼요.
        </p>
        <button
          type="button"
          onClick={() => void handleRetry()}
          disabled={busy}
          className="min-h-[44px] w-full rounded-xl border border-border px-4 text-xs font-bold text-foreground disabled:opacity-50"
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
        className="rounded-2xl border border-border bg-card p-4 shadow-sm space-y-2"
      >
        <p className="text-xs font-bold text-foreground">
          우리 공간을 만들거나 초대 코드를 입력해 보세요
        </p>
        <p className="text-[11px] leading-4 text-muted-foreground">
          공간을 만들면 초대 코드가 생기고, 상대방이 그 코드를 입력하면 연결돼요.
        </p>
        <button
          type="button"
          onClick={() => navigate('/settings')}
          className="min-h-[44px] w-full rounded-xl bg-coral px-4 text-xs font-bold text-coral-foreground"
        >
          커플 공간 설정으로 가기
        </button>
      </section>
    );
  }

  if (coupleLifecycle === 'disconnected') {
    return (
      <section
        data-testid="couple-status-banner"
        data-lifecycle="disconnected"
        className="rounded-2xl border border-border bg-card p-4 shadow-sm space-y-2"
      >
        <div className="flex items-center gap-2 text-xs font-bold text-foreground">
          <Link2Off size={14} className="text-muted-foreground" />
          <span>커플 공간 연결이 해제되었어요</span>
        </div>
        <p className="text-[11px] leading-4 text-muted-foreground">
          내가 남긴 비공개 기록은 그대로 있어요. 다시 연결하려면 새 공간을 만들거나
          상대방의 초대 코드를 입력해 주세요.
        </p>
        <button
          type="button"
          onClick={() => navigate('/settings')}
          className="min-h-[44px] w-full rounded-xl bg-coral px-4 text-xs font-bold text-coral-foreground"
        >
          다시 연결하기
        </button>
      </section>
    );
  }

  // pending
  return (
    <section
      data-testid="couple-status-banner"
      data-lifecycle="pending"
      className="rounded-2xl border border-coral/30 bg-coral/10 p-4 shadow-sm space-y-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-coral">상대방을 기다리고 있어요</span>
        {expiryLabel && (
          <span
            data-testid="invitation-expiry"
            className="text-[11px] font-semibold text-muted-foreground"
          >
            {expiryLabel}
          </span>
        )}
      </div>

      {code ? (
        <>
          <div className="flex items-center justify-between rounded-xl border border-coral/20 bg-card px-4 py-3">
            <span className="font-mono text-2xl font-bold tracking-widest text-foreground">
              {code}
            </span>
            <button
              type="button"
              onClick={() => void handleCopy()}
              aria-label="초대 코드 복사"
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-coral"
            >
              {copied ? <Check size={20} /> : <Copy size={20} />}
            </button>
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground">
            상대방이 코드를 입력하면 자동으로 연결돼요.
          </p>
        </>
      ) : (
        <>
          {/* The server stores only a hash of the code, so a device that no longer
              holds the plaintext cannot be shown it -- minting a new one is the
              only possible recovery. */}
          <p className="text-xs font-semibold text-foreground">
            이 기기에 저장된 초대 코드가 없습니다
          </p>
          <p className="text-[11px] leading-4 text-muted-foreground">
            보안을 위해 서버에는 코드가 저장되지 않아요. 새 코드를 발급하면 이전 코드는
            사용할 수 없어요.
          </p>
          <button
            type="button"
            onClick={() => void handleRegenerate()}
            disabled={busy || !isOnline}
            className="min-h-[44px] w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-coral px-4 text-xs font-bold text-coral-foreground disabled:opacity-50"
          >
            <RefreshCw size={14} />
            {busy ? '발급 중...' : '새 코드 발급'}
          </button>
          {!isOnline && (
            <p className="text-[11px] leading-4 text-muted-foreground">
              {OFFLINE_READONLY_MESSAGE}
            </p>
          )}
        </>
      )}
    </section>
  );
}
