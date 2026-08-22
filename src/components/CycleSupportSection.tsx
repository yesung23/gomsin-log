import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, HeartHandshake, Loader2, Radio, RotateCcw, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  activeCycleSupportSignal,
  createCycleSupportSignalInDB,
  fetchCycleSupportSignalsResultFromDB,
  isCycleSupportKind,
  isValidCycleSupportMessage,
  koreaToday,
  revokeCycleSupportSignalFromDB,
  type CycleFetchFailureReason,
} from '@/lib/cycle';
import { classifyServerError, serverErrorMessage } from '@/lib/serverErrors';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import type { CycleSupportKind, CycleSupportSignal } from '@/types';
import { Card } from '@/components/ui/Card';

type LoadState = 'loading' | 'ready' | 'empty' | 'disconnected' | CycleFetchFailureReason;

/**
 * The care requests, `feeling_unwell` among them.
 *
 * One vocabulary on purpose. An earlier draft carried a separate graded pain
 * fieldset (`조금 아파요`/`많이 아파요`); the independent review refused it because a
 * severity scale in a server-visible column restates the personal HRK pain levels.
 * "오늘은 몸이 힘들어요" says today is hard without saying how much — which is all a
 * care signal needs to say, and exactly what V1_LAUNCH_DECISIONS §5 approved.
 */
const kindLabels: Record<CycleSupportKind, string> = {
  resting: '오늘은 쉬어가고 싶어요',
  need_space: '조용한 시간이 필요해요',
  would_like_support: '따뜻한 응원을 받고 싶어요',
  check_in_later: '나중에 안부를 물어봐 주세요',
  feeling_unwell: '오늘은 몸이 힘들어요',
};

interface CycleSupportSectionProps {
  /**
   * 내 신호를 보내는 자리인가, 상대의 신호를 읽는 자리인가.
   *
   * 예전에는 `role === 'gomsin'` 이었다. 그것은 **컨디션을 역할의 일로 만든 것**이고,
   * 결과적으로 군화는 자기 몸이 힘든 날에도 그 사실을 보낼 방법이 없었다. 군 복무가
   * 아닌 커플에서는 더 분명하게 틀린다 -- 그 커플에도 `soldier` 역할을 가진 사람이
   * 있고, 그 사람은 영원히 읽기만 하게 된다.
   *
   * 서버는 이것을 역할로 막고 있지 않았다. `cycle_support_signals` 의 RLS 는
   * `owner_id = auth.uid()` 와 커플 소속만 본다(migration 014). 제약은 이 파일 한 줄에만
   * 있었고, 그래서 마이그레이션 없이 고칠 수 있다.
   *
   * 이제 부르는 쪽이 정한다. `컨디션` 탭은 이 컴포넌트를 **두 번** 그린다 -- 내 것 하나,
   * 상대 것 하나.
   */
  mine: boolean;
  authenticated: boolean;
  userId?: string;
  coupleId?: string;
  connected: boolean;
}

function failureMessage(
  state: Extract<LoadState, 'unauthenticated' | 'forbidden' | 'not_deployed' | 'error'>,
) {
  if (state === 'unauthenticated') return '응원 신호를 보려면 로그인해 주세요.';
  if (state === 'forbidden') return '이 응원 신호에 접근할 권한이 없어요.';
  // Reachable only if the support table itself is missing. Without this branch the
  // error block rendered nothing at all, leaving a blank section.
  if (state === 'not_deployed') return '응원 신호 기능 준비가 아직 끝나지 않았어요.';
  return '응원 신호의 최신 상태를 확인하지 못했어요. 안전을 위해 이전 확인 내용은 숨겼어요.';
}

function nextKoreaMidnightMs(nowMs: number): number {
  const korea = new Date(nowMs + 9 * 60 * 60 * 1000);
  return Date.UTC(
    korea.getUTCFullYear(),
    korea.getUTCMonth(),
    korea.getUTCDate() + 1,
  ) - 9 * 60 * 60 * 1000;
}

export function CycleSupportSection({
  mine,
  authenticated,
  userId,
  coupleId,
  connected,
}: CycleSupportSectionProps) {
  const owner = mine;
  const identityKey = `${authenticated ? userId || '' : ''}:${connected ? coupleId || '' : ''}:${mine ? 'mine' : 'partner'}`;
  const identityRef = useRef(identityKey);
  const generationRef = useRef(0);
  if (identityRef.current !== identityKey) {
    identityRef.current = identityKey;
    generationRef.current += 1;
  }
  const captureIdentity = useCallback(
    () => ({ key: identityKey, generation: generationRef.current }),
    [identityKey],
  );
  const isCurrentIdentity = useCallback(
    (identity: { key: string; generation: number }) =>
      identity.key === identityRef.current && identity.generation === generationRef.current,
    [],
  );
  const [nowIso, setNowIso] = useState(() => new Date().toISOString());
  const today = koreaToday(new Date(nowIso));
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [signals, setSignals] = useState<CycleSupportSignal[]>([]);
  const [kind, setKind] = useState<CycleSupportKind | ''>('');
  const [message, setMessage] = useState('');
  const [mutationPending, setMutationPending] = useState<'share' | 'revoke' | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [realtimeDisconnected, setRealtimeDisconnected] = useState(false);
  const verificationGenerationRef = useRef(0);
  const verificationBlockedRef = useRef(false);

  useLayoutEffect(() => {
    setSignals([]);
    setKind('');
    setMessage('');
    setMutationPending(null);
    setMutationError(null);
    setRealtimeDisconnected(false);
    verificationBlockedRef.current = false;
    setNowIso(new Date().toISOString());
    setLoadState(authenticated ? (connected && coupleId ? 'loading' : 'disconnected') : 'unauthenticated');
  }, [authenticated, connected, coupleId, identityKey]);

  const load = useCallback(async (allowWhileRealtimeFailed = false) => {
    const identity = captureIdentity();
    const verificationGeneration = verificationGenerationRef.current;
    if (verificationBlockedRef.current && !allowWhileRealtimeFailed) {
      setSignals([]);
      setLoadState('error');
      return;
    }
    setLoadState('loading');
    if (!authenticated) {
      setSignals([]);
      setLoadState('unauthenticated');
      return;
    }
    if (!connected || !coupleId) {
      setSignals([]);
      setLoadState('disconnected');
      return;
    }
    try {
      const result = await fetchCycleSupportSignalsResultFromDB(coupleId);
      if (
        !isCurrentIdentity(identity)
        || verificationGenerationRef.current !== verificationGeneration
      ) return;
      if (!result.ok) {
        setSignals([]);
        setLoadState(result.reason);
        return;
      }
      const checkedAt = new Date().toISOString();
      setNowIso(checkedAt);
      setSignals(result.signals);
      const visibleSignals = owner
        ? result.signals.filter((signal) => signal.ownerId === userId)
        : result.signals.filter((signal) => signal.ownerId !== userId);
      const active = activeCycleSupportSignal(visibleSignals, koreaToday(new Date(checkedAt)), checkedAt);
      setLoadState(active ? 'ready' : 'empty');
    } catch (error) {
      if (
        !isCurrentIdentity(identity)
        || verificationGenerationRef.current !== verificationGeneration
      ) return;
      console.error('Failed to load sanitized support signals:', error);
      setSignals([]);
      setLoadState('error');
    }
  }, [authenticated, captureIdentity, connected, coupleId, isCurrentIdentity, owner, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const client = supabase;
    if (!client || !authenticated || !userId || !connected || !coupleId) return;
    const identity = captureIdentity();
    let timer: number | undefined;
    let disposed = false;
    const refresh = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => void load(), 150);
    };
    const channel = client
      .channel(`cycle-support:${coupleId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'collaboration_invalidations',
          filter: `couple_id=eq.${coupleId}`,
        },
        (payload) => {
          const invalidation = payload.new as Record<string, unknown>;
          if (invalidation.slice === 'cycle_support') refresh();
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'cycle_support_signals',
          filter: `couple_id=eq.${coupleId}`,
        },
        refresh,
      )
      .subscribe((status) => {
        if (disposed || !isCurrentIdentity(identity)) return;
        if (status === 'SUBSCRIBED') {
          verificationBlockedRef.current = false;
          setRealtimeDisconnected(false);
          void load();
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          if (timer) {
            window.clearTimeout(timer);
            timer = undefined;
          }
          verificationBlockedRef.current = true;
          verificationGenerationRef.current += 1;
          setSignals([]);
          setRealtimeDisconnected(true);
          setLoadState('error');
        }
      });
    const recover = () => {
      if (document.visibilityState === 'visible' && isCurrentIdentity(identity)) void load();
    };
    document.addEventListener('visibilitychange', recover);
    window.addEventListener('online', recover);
    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', recover);
      window.removeEventListener('online', recover);
      void client.removeChannel(channel);
    };
  }, [authenticated, captureIdentity, connected, coupleId, isCurrentIdentity, load, userId]);

  const visibleSignals = useMemo(
    () => owner
      ? signals.filter((signal) => signal.ownerId === userId)
      : signals.filter((signal) => signal.ownerId !== userId),
    [owner, signals, userId],
  );
  const activeSignal = useMemo(
    () => activeCycleSupportSignal(visibleSignals, today, nowIso),
    [nowIso, today, visibleSignals],
  );

  useEffect(() => {
    const nowMs = Date.now();
    const futureExpiries = visibleSignals
      .filter((signal) => !signal.revokedAt)
      .map((signal) => Date.parse(signal.expiresAt))
      .filter((expiresAt) => Number.isFinite(expiresAt) && expiresAt > nowMs);
    const nextBoundary = Math.min(nextKoreaMidnightMs(nowMs), ...futureExpiries);
    const delay = Math.max(1, Math.min(nextBoundary - nowMs + 25, 2_147_483_647));
    const timer = window.setTimeout(() => setNowIso(new Date().toISOString()), delay);
    return () => window.clearTimeout(timer);
  }, [nowIso, visibleSignals]);

  const share = async () => {
    const identity = captureIdentity();
    if (!authenticated || !userId || !connected || !coupleId || !owner) {
      setMutationError('활성 연결에서 본인이 직접 선택한 신호만 공유할 수 있어요.');
      return;
    }
    if (!kind || !isCycleSupportKind(kind)) {
      setMutationError('공유할 응원 신호를 선택해 주세요.');
      return;
    }
    if (!isValidCycleSupportMessage(message.trim() || undefined)) {
      setMutationError('짧은 메시지는 80자 이하로 입력해 주세요.');
      return;
    }
    setMutationPending('share');
    setMutationError(null);
    try {
      const result = await createCycleSupportSignalInDB({
        coupleId,
        kind,
        message: message.trim() || undefined,
        sharedForDate: today,
      });
      if (!isCurrentIdentity(identity)) return;
      if (!result.ok) {
        // The cause decides the copy. A `forbidden` result means the couple link
        // is not usable -- reporting it as a connection problem sent users to
        // retry forever instead of checking the connection state.
        setMutationError(serverErrorMessage(result.reason));
        return;
      }
      const saved = result.signal;
      setSignals((current) => [saved, ...current]);
      setLoadState('ready');
      setKind('');
      setMessage('');
      toast.success('오늘의 응원 신호를 공유했어요.');
    } catch (error) {
      if (!isCurrentIdentity(identity)) return;
      console.error('Failed to create sanitized support signal:', error);
      setMutationError(classifyServerError(error).message);
    } finally {
      if (isCurrentIdentity(identity)) setMutationPending(null);
    }
  };

  const revoke = async () => {
    const identity = captureIdentity();
    if (!activeSignal || !authenticated || !userId || !connected || !coupleId || !owner) return;
    setMutationPending('revoke');
    setMutationError(null);
    try {
      const result = await revokeCycleSupportSignalFromDB(activeSignal.id);
      if (!isCurrentIdentity(identity)) return;
      if (!result.ok) {
        setMutationError(serverErrorMessage(result.reason));
        return;
      }
      const revokedAt = new Date().toISOString();
      setSignals((current) => current.map((signal) => signal.id === activeSignal.id
        ? { ...signal, revokedAt, updatedAt: revokedAt }
        : signal));
      setLoadState('empty');
      toast.info('응원 신호 공유를 취소했어요.');
    } catch (error) {
      if (!isCurrentIdentity(identity)) return;
      console.error('Failed to revoke sanitized support signal:', error);
      setMutationError(classifyServerError(error).message);
    } finally {
      if (isCurrentIdentity(identity)) setMutationPending(null);
    }
  };

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between border-b border-border/40 pb-3 gap-2">
        <div className="flex items-center gap-2">
          <HeartHandshake className="w-5 h-5 text-coral" />
          <h3 className="text-heading text-foreground">오늘의 응원 신호</h3>
        </div>
        <span className="text-caption text-muted-foreground font-medium">직접 선택할 때만 공유</span>
      </div>

      {/*
        Shown only when there is nothing on screen yet.

        A realtime invalidation re-runs `load()` and sets `loading` again, so a
        refresh used to pull the current signal away and replace it with this line
        while the round-trip completed -- on a card whose whole job is to say
        whether a signal is live right now.

        This does NOT weaken the security rule one state over: a FAILED
        verification is `error`, not `loading`, and that branch still hides the
        previous content deliberately. Keeping a signal visible while a refresh is
        in flight is different from keeping one whose verification just failed.
      */}
      {loadState === 'loading' && signals.length === 0 && (
        <div className="py-6 flex items-center justify-center gap-2 text-caption text-muted-foreground" role="status">
          <Loader2 className="w-4 h-4 animate-spin" /> 응원 신호를 확인하는 중이에요.
        </div>
      )}

      {loadState === 'disconnected' && (
        <div className="p-4 rounded-surface bg-muted/40 border border-border text-center">
          <p className="text-label font-bold text-foreground">파트너와 연결되어 있지 않아요.</p>
          <p className="text-caption text-muted-foreground mt-1">연결된 뒤 원할 때만 응원 신호를 공유할 수 있어요.</p>
        </div>
      )}

      {(loadState === 'unauthenticated'
        || loadState === 'forbidden'
        || loadState === 'not_deployed'
        || loadState === 'error') && (
        <div className="p-4 rounded-surface bg-muted/40 border border-border text-center space-y-3" role="alert">
          <p className="text-caption text-muted-foreground">{failureMessage(loadState)}</p>
          {loadState === 'error' && (
            <button type="button" onClick={() => void load(true)} className="press-response px-4 py-2 rounded-control bg-foreground text-background text-label font-bold">
              다시 시도
            </button>
          )}
        </div>
      )}

      {(loadState === 'ready' || loadState === 'empty'
        // Keep the card up through a refresh that already has something to show.
        || (loadState === 'loading' && signals.length > 0)) && (
        <>
          {realtimeDisconnected && (
            <div className="flex items-center justify-between gap-2 p-3 rounded-control bg-warning-surface border border-warning/30 text-caption text-warning-foreground" role="status">
              <span>실시간 확인이 중단됐어요. 최신 상태를 다시 확인해 주세요.</span>
              <button type="button" onClick={() => void load(true)} className="press-response p-1 min-h-11 min-w-11 flex items-center justify-center" aria-label="응원 신호 다시 확인"><RotateCcw className="w-3.5 h-3.5" /></button>
            </div>
          )}

          {activeSignal ? (
            <div className="p-4 rounded-surface bg-mint/40 border border-mint-foreground/20 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-caption font-bold text-mint-foreground">오늘 공유된 신호</p>
                  <p className="text-heading text-mint-foreground mt-1">{kindLabels[activeSignal.kind]}</p>
                </div>
                <Radio className="w-4 h-4 text-mint-foreground shrink-0" />
              </div>
              {activeSignal.message && (
                <p className="text-body text-mint-foreground bg-card/60 rounded-control p-3">{activeSignal.message}</p>
              )}
              {owner && (
                <button type="button" onClick={() => void revoke()} disabled={mutationPending !== null} className="press-response-row w-full flex items-center justify-center gap-1.5 py-2.5 rounded-control border border-mint-foreground/20 text-mint-foreground text-label font-bold disabled:opacity-50 min-h-11">
                  {mutationPending === 'revoke' ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                  {mutationPending === 'revoke' ? '공유 취소 중' : '공유 취소'}
                </button>
              )}
            </div>
          ) : owner ? (
            <div className="space-y-3">
              <div className="p-3 rounded-control bg-muted/30 text-caption text-muted-foreground leading-relaxed">
                오늘 하루 동안 보일 응원 신호만 공유돼요. 선택 메시지는 파트너에게 그대로 보이므로 개인적인 상세 내용은 적지 마세요. 주기·증상 등 개인 기록은 자동으로 공유되지 않아요.
              </div>
              {/*
                Cards, not a <select>.

                A native picker hides every option behind a tap and then shows the
                chosen one as a line of text indistinguishable from its own
                placeholder. On a screen whose entire job is "be clear about what you
                are sending your partner", that was the least clear thing on it.

                All five are visible, the chosen one is unmistakable, and nothing is
                chosen for you: `kind` starts empty and there is no default, so the
                send button stays disabled until a person actually picks. An app that
                guessed how someone feels today and pre-filled it would be doing the
                one thing this feature must never do.
              */}
              <fieldset className="space-y-1.5">
                <legend className="text-label font-bold text-foreground">응원 신호 *</legend>
                <ul className="grid gap-1.5" data-testid="support-kind-options">
                  {Object.entries(kindLabels).map(([value, label]) => {
                    const chosen = kind === value;
                    return (
                      <li key={value}>
                        <button
                          type="button"
                          onClick={() => setKind(chosen ? '' : (value as CycleSupportKind))}
                          disabled={mutationPending !== null}
                          aria-pressed={chosen}
                          data-testid={`support-kind-${value}`}
                          className={cn(
                            'press-response-row w-full text-left min-h-11 px-3 py-2.5 rounded-control border text-label disabled:opacity-50 flex items-center justify-between gap-2',
                            chosen
                              ? 'border-coral bg-coral/10 text-foreground font-bold'
                              : 'border-border bg-card text-foreground',
                          )}
                        >
                          {label}
                          {/* A second, non-colour signal for the chosen one. */}
                          {chosen && <Check className="w-4 h-4 shrink-0 text-coral-strong" aria-hidden="true" />}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>


              {/*
                What the partner will actually read, before it is sent.

                Rendered from the same `kindLabels` the partner's own view uses, so
                the preview cannot drift from the payload -- which is a failure this
                surface has had once already, when the cycle preview described
                sharing that was switched off.
              */}
              {kind && (
                <div
                  data-testid="signal-send-preview"
                  className="rounded-surface bg-muted/40 p-3.5 space-y-1"
                >
                  <p className="text-caption font-bold text-foreground">군화에게 이렇게 보여요</p>
                  <p className="text-label text-foreground">{kindLabels[kind]}</p>
                  {message.trim() && (
                    <p className="text-caption text-muted-foreground">“{message.trim()}”</p>
                  )}
                  <p className="text-caption text-muted-foreground leading-relaxed">
                    오늘 하루가 지나면 자동으로 사라져요. 그 전에도 언제든 취소할 수 있어요.
                  </p>
                </div>
              )}

              <label className="text-label font-bold text-foreground space-y-1 block">
                <span>파트너에게 보낼 짧은 메시지 (선택, 80자 이하)</span>
                <input value={message} onChange={(event) => setMessage(event.target.value)} maxLength={80} disabled={mutationPending !== null} placeholder="예: 오늘 저녁에 짧게 통화하고 싶어요" className="w-full p-3 rounded-control border border-border bg-card text-body" />
                <span className="block text-right text-caption text-muted-foreground">{Array.from(message).length}/80</span>
              </label>
              {mutationError && <ErrorNote>{mutationError}</ErrorNote>}
              <button type="button" onClick={() => void share()} disabled={mutationPending !== null} className="press-response w-full flex items-center justify-center gap-1.5 py-2.5 rounded-control bg-coral-strong text-coral-strong-foreground text-label font-bold disabled:opacity-50 min-h-11">
                {mutationPending === 'share' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {mutationPending === 'share' ? '공유 중' : '오늘만 공유하기'}
              </button>
            </div>
          ) : (
            <div className="p-4 rounded-surface border border-dashed border-border text-center space-y-1">
              <p className="text-label font-bold text-foreground">오늘 공유된 응원 신호가 없어요.</p>
              <p className="text-caption text-muted-foreground">상대가 직접 공유한 경우에만 여기에 표시돼요.</p>
            </div>
          )}
          {mutationError && activeSignal && <ErrorNote>{mutationError}</ErrorNote>}
        </>
      )}
    </Card>
  );
}
