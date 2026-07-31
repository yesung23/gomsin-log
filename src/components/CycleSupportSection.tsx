import { useCallback, useEffect, useMemo, useState } from 'react';
import { HeartHandshake, Loader2, Radio, RotateCcw, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  activeCycleSupportSignal,
  createCycleSupportSignalInDB,
  fetchCycleSupportSignalsResultFromDB,
  isCycleSupportKind,
  isValidCycleSupportMessage,
  localToday,
  revokeCycleSupportSignalFromDB,
  type CycleFetchFailureReason,
} from '@/lib/cycle';
import { supabase } from '@/lib/supabase';
import type { CycleSupportKind, CycleSupportSignal, Role } from '@/types';

type LoadState = 'loading' | 'ready' | 'empty' | 'disconnected' | CycleFetchFailureReason;

const kindLabels: Record<CycleSupportKind, string> = {
  resting: '오늘은 쉬어가고 싶어요',
  need_space: '조용한 시간이 필요해요',
  would_like_support: '따뜻한 응원을 받고 싶어요',
  check_in_later: '나중에 안부를 물어봐 주세요',
};

interface CycleSupportSectionProps {
  role: Role;
  authenticated: boolean;
  userId?: string;
  coupleId?: string;
  connected: boolean;
}

function failureMessage(state: Extract<LoadState, 'unauthenticated' | 'forbidden' | 'error'>) {
  if (state === 'unauthenticated') return '응원 신호를 보려면 로그인해 주세요.';
  if (state === 'forbidden') return '이 응원 신호에 접근할 권한이 없어요.';
  return '응원 신호를 불러오지 못했어요.';
}

export function CycleSupportSection({
  role,
  authenticated,
  userId,
  coupleId,
  connected,
}: CycleSupportSectionProps) {
  const owner = role === 'gomsin';
  const today = localToday();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [signals, setSignals] = useState<CycleSupportSignal[]>([]);
  const [kind, setKind] = useState<CycleSupportKind | ''>('');
  const [message, setMessage] = useState('');
  const [mutationPending, setMutationPending] = useState<'share' | 'revoke' | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [realtimeDisconnected, setRealtimeDisconnected] = useState(false);

  const load = useCallback(async () => {
    setLoadState('loading');
    if (!authenticated) {
      setLoadState('unauthenticated');
      return;
    }
    if (!connected || !coupleId) {
      setLoadState('disconnected');
      return;
    }
    try {
      const result = await fetchCycleSupportSignalsResultFromDB(coupleId);
      if (!result.ok) {
        setLoadState(result.reason);
        return;
      }
      setSignals(result.signals);
      const visibleSignals = owner
        ? result.signals.filter((signal) => signal.ownerId === userId)
        : result.signals.filter((signal) => signal.ownerId !== userId);
      const active = activeCycleSupportSignal(visibleSignals, today, new Date().toISOString());
      setLoadState(active ? 'ready' : 'empty');
    } catch (error) {
      console.error('Failed to load sanitized support signals:', error);
      setLoadState('error');
    }
  }, [authenticated, connected, coupleId, owner, today, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const client = supabase;
    if (!client || !authenticated || !connected || !coupleId) return;
    let timer: number | undefined;
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
          table: 'cycle_support_signals',
          filter: `couple_id=eq.${coupleId}`,
        },
        refresh,
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setRealtimeDisconnected(false);
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setRealtimeDisconnected(true);
        }
      });
    return () => {
      if (timer) window.clearTimeout(timer);
      void client.removeChannel(channel);
    };
  }, [authenticated, connected, coupleId, load]);

  const visibleSignals = useMemo(
    () => owner
      ? signals.filter((signal) => signal.ownerId === userId)
      : signals.filter((signal) => signal.ownerId !== userId),
    [owner, signals, userId],
  );
  const activeSignal = useMemo(
    () => activeCycleSupportSignal(visibleSignals, today, new Date().toISOString()),
    [today, visibleSignals],
  );

  const share = async () => {
    if (!coupleId || !kind || !isCycleSupportKind(kind)) {
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
      const saved = await createCycleSupportSignalInDB({
        coupleId,
        kind,
        message: message.trim() || undefined,
        sharedForDate: today,
      });
      if (!saved) {
        setMutationError('응원 신호를 공유하지 못했어요. 연결을 확인해 주세요.');
        return;
      }
      setSignals((current) => [saved, ...current]);
      setLoadState('ready');
      setKind('');
      setMessage('');
      toast.success('오늘의 응원 신호를 공유했어요.');
    } catch (error) {
      console.error('Failed to create sanitized support signal:', error);
      setMutationError('응원 신호를 공유하지 못했어요. 다시 시도해 주세요.');
    } finally {
      setMutationPending(null);
    }
  };

  const revoke = async () => {
    if (!activeSignal) return;
    setMutationPending('revoke');
    setMutationError(null);
    try {
      const revoked = await revokeCycleSupportSignalFromDB(activeSignal.id);
      if (!revoked) {
        setMutationError('공유를 취소하지 못했어요. 다시 시도해 주세요.');
        return;
      }
      const revokedAt = new Date().toISOString();
      setSignals((current) => current.map((signal) => signal.id === activeSignal.id
        ? { ...signal, revokedAt, updatedAt: revokedAt }
        : signal));
      setLoadState('empty');
      toast.info('응원 신호 공유를 취소했어요.');
    } catch (error) {
      console.error('Failed to revoke sanitized support signal:', error);
      setMutationError('공유를 취소하지 못했어요. 다시 시도해 주세요.');
    } finally {
      setMutationPending(null);
    }
  };

  return (
    <section className="bg-card rounded-3xl p-5 border border-border shadow-sm space-y-4">
      <div className="flex items-center justify-between border-b border-border/40 pb-3 gap-2">
        <div className="flex items-center gap-2">
          <HeartHandshake className="w-5 h-5 text-coral" />
          <h3 className="text-base font-extrabold text-foreground">오늘의 응원 신호</h3>
        </div>
        <span className="text-[10px] text-muted-foreground font-medium">직접 선택할 때만 공유</span>
      </div>

      {loadState === 'loading' && (
        <div className="py-6 flex items-center justify-center gap-2 text-xs text-muted-foreground" role="status">
          <Loader2 className="w-4 h-4 animate-spin" /> 응원 신호를 확인하는 중이에요.
        </div>
      )}

      {loadState === 'disconnected' && (
        <div className="p-4 rounded-2xl bg-muted/40 border border-border text-center">
          <p className="text-xs font-bold text-foreground">파트너와 연결되어 있지 않아요.</p>
          <p className="text-[10px] text-muted-foreground mt-1">연결된 뒤 원할 때만 응원 신호를 공유할 수 있어요.</p>
        </div>
      )}

      {(loadState === 'unauthenticated' || loadState === 'forbidden' || loadState === 'error') && (
        <div className="p-4 rounded-2xl bg-muted/40 border border-border text-center space-y-3" role="alert">
          <p className="text-xs text-muted-foreground">{failureMessage(loadState)}</p>
          {loadState === 'error' && (
            <button type="button" onClick={() => void load()} className="px-4 py-2 rounded-xl bg-foreground text-background text-xs font-bold">
              다시 시도
            </button>
          )}
        </div>
      )}

      {(loadState === 'ready' || loadState === 'empty') && (
        <>
          {realtimeDisconnected && (
            <div className="flex items-center justify-between gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-[10px] text-amber-900" role="status">
              <span>실시간 연결이 끊겼어요. 마지막 확인 내용을 표시해요.</span>
              <button type="button" onClick={() => void load()} className="p-1" aria-label="응원 신호 다시 확인"><RotateCcw className="w-3.5 h-3.5" /></button>
            </div>
          )}

          {activeSignal ? (
            <div className="p-4 rounded-2xl bg-mint/40 border border-mint-foreground/20 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold text-navy">오늘 공유된 신호</p>
                  <p className="text-sm font-extrabold text-navy mt-1">{kindLabels[activeSignal.kind]}</p>
                </div>
                <Radio className="w-4 h-4 text-navy shrink-0" />
              </div>
              {activeSignal.message && (
                <p className="text-xs text-navy/80 bg-white/60 rounded-xl p-3">{activeSignal.message}</p>
              )}
              {owner && (
                <button type="button" onClick={() => void revoke()} disabled={mutationPending !== null} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-navy/20 text-navy text-xs font-bold disabled:opacity-50 min-h-[42px]">
                  {mutationPending === 'revoke' ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                  {mutationPending === 'revoke' ? '공유 취소 중' : '공유 취소'}
                </button>
              )}
            </div>
          ) : owner ? (
            <div className="space-y-3">
              <div className="p-3 rounded-xl bg-muted/30 text-[10px] text-muted-foreground leading-relaxed">
                오늘 하루 동안 보일 비의료적 응원 신호만 공유돼요. 개인 기록 내용은 포함되지 않으며 자동으로 공유되지 않아요.
              </div>
              <label className="text-[10px] font-bold text-foreground space-y-1 block">
                <span>응원 신호 *</span>
                <select value={kind} onChange={(event) => setKind(event.target.value as CycleSupportKind | '')} disabled={mutationPending !== null} className="w-full p-3 rounded-xl border border-border bg-card text-xs">
                  <option value="">직접 선택해 주세요</option>
                  {Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="text-[10px] font-bold text-foreground space-y-1 block">
                <span>짧은 메시지 (선택, 80자 이하)</span>
                <input value={message} onChange={(event) => setMessage(event.target.value)} maxLength={80} disabled={mutationPending !== null} placeholder="예: 오늘 저녁에 짧게 통화하고 싶어요" className="w-full p-3 rounded-xl border border-border bg-card text-xs" />
                <span className="block text-right text-[9px] text-muted-foreground">{Array.from(message).length}/80</span>
              </label>
              {mutationError && <p className="text-[11px] text-destructive" role="alert">{mutationError}</p>}
              <button type="button" onClick={() => void share()} disabled={mutationPending !== null} className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-coral text-white text-xs font-bold disabled:opacity-50 min-h-[42px]">
                {mutationPending === 'share' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                {mutationPending === 'share' ? '공유 중' : '오늘만 공유하기'}
              </button>
            </div>
          ) : (
            <div className="p-4 rounded-2xl border border-dashed border-border text-center space-y-1">
              <p className="text-xs font-bold text-foreground">오늘 공유된 응원 신호가 없어요.</p>
              <p className="text-[10px] text-muted-foreground">상대가 직접 공유한 경우에만 여기에 표시돼요.</p>
            </div>
          )}
          {mutationError && activeSignal && <p className="text-[11px] text-destructive" role="alert">{mutationError}</p>}
        </>
      )}
    </section>
  );
}
