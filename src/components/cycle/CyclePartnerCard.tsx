import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { HeartHandshake, Loader2 } from 'lucide-react';
import {
  fetchPartnerCycleProjectionFromDB,
  isPartnerProjectionEmpty,
  type CycleFetchFailureReason,
} from '@/lib/cycle';
import { formatKoreanDate } from '@/components/cycle/cycleFormatting';
import type { CyclePartnerProjection } from '@/types';

/**
 * What the partner sees of the owner's cycle.
 *
 * This card is the receiving end of the three sharing toggles. Before it
 * existed, turning a toggle on wrote a row to `cycle_sharing_preferences` and
 * changed nothing anyone could see, so the app promised a kind of sharing it
 * never delivered.
 *
 * Everything rendered here comes from `get_partner_cycle_projection()`, whose
 * return shape cannot carry a symptom, flow, pain level, mood, note, row id, or
 * actual period date. The partner's own credentials still cannot read a single
 * raw cycle row; that stays owner-only under RLS.
 *
 * Deliberately not shown: anything the owner did not turn on, and any wording
 * that reads as a diagnosis or attributes mood or behaviour to the cycle.
 */

type LoadState = 'loading' | 'ready' | 'unshared' | 'unavailable' | CycleFetchFailureReason;

interface CyclePartnerCardProps {
  authenticated: boolean;
  userId?: string;
  connected: boolean;
}

export function CyclePartnerCard({ authenticated, userId, connected }: CyclePartnerCardProps) {
  const identityKey = `${authenticated ? userId || '' : ''}:${connected ? 'linked' : 'solo'}`;
  const identityRef = useRef(identityKey);
  const generationRef = useRef(0);
  if (identityRef.current !== identityKey) {
    identityRef.current = identityKey;
    generationRef.current += 1;
  }

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [projection, setProjection] = useState<CyclePartnerProjection | null>(null);

  // Clear before the paint that follows an account or connection change, so a
  // previous partner's shared window can never be on screen for one frame.
  useLayoutEffect(() => {
    setProjection(null);
    setLoadState(authenticated && connected ? 'loading' : 'unavailable');
  }, [authenticated, connected, identityKey]);

  const load = useCallback(async () => {
    const generation = generationRef.current;
    const key = identityRef.current;
    const isStale = () => generation !== generationRef.current || key !== identityRef.current;

    if (!authenticated || !connected) {
      setProjection(null);
      setLoadState('unavailable');
      return;
    }

    setLoadState('loading');
    const result = await fetchPartnerCycleProjectionFromDB();
    if (isStale()) return;

    if (!result.ok) {
      setProjection(null);
      setLoadState(result.reason);
      return;
    }
    if (!result.projection) {
      setProjection(null);
      setLoadState('unavailable');
      return;
    }
    if (isPartnerProjectionEmpty(result.projection)) {
      setProjection(null);
      setLoadState('unshared');
      return;
    }
    setProjection(result.projection);
    setLoadState('ready');
  }, [authenticated, connected]);

  useEffect(() => {
    void load();
  }, [load]);

  // Nothing is shared, or there is nothing to share from. Render nothing rather
  // than an empty card that hints at a feature the partner cannot act on, and
  // which would also reveal that the owner considered sharing and declined.
  if (loadState === 'unavailable' || loadState === 'unshared' || loadState === 'unauthenticated') {
    return null;
  }

  // A missing RPC or a refused read is not the partner's problem to solve, and
  // saying "check your connection" would be wrong. Stay quiet.
  if (loadState === 'not_deployed' || loadState === 'forbidden' || loadState === 'error') {
    return null;
  }

  if (loadState === 'loading') {
    return (
      <section className="bg-card rounded-surface p-4 border border-border">
        <div className="py-2 flex items-center justify-center gap-2 text-caption text-muted-foreground" role="status">
          <Loader2 className="w-4 h-4 animate-spin" /> 확인하는 중이에요.
        </div>
      </section>
    );
  }

  if (!projection) return null;

  return (
    <section className="bg-card rounded-surface p-4 border border-border space-y-3">
      <div className="flex items-center gap-2">
        <HeartHandshake className="w-5 h-5 text-coral" aria-hidden="true" />
        <h3 className="text-heading text-foreground">함께 알아두면 좋은 것</h3>
      </div>

      <ul className="space-y-2">
        {projection.isCurrentPeriodShared && (
          <li className="p-3 rounded-control bg-muted/30">
            <p className="text-label font-bold text-foreground">
              {projection.isPeriodActive ? '지금 생리 기간이에요' : '지금은 생리 기간이 아니에요'}
            </p>
            <p className="text-caption text-muted-foreground mt-0.5">
              진행 여부만 공유돼요. 시작일과 컨디션 기록은 볼 수 없어요.
            </p>
          </li>
        )}

        {projection.isPredictionShared
          && projection.predictedWindowStart
          && projection.predictedWindowEnd && (
          <li className="p-3 rounded-control bg-muted/30">
            <p className="text-label font-bold text-foreground">
              다음 생리 예상 {formatKoreanDate(projection.predictedWindowStart)}
              {' ~ '}
              {formatKoreanDate(projection.predictedWindowEnd)}
            </p>
            <p className="text-caption text-muted-foreground mt-0.5">
              지난 기록으로 계산한 예상 범위예요. 정확한 날짜가 아닐 수 있어요.
            </p>
          </li>
        )}

        {projection.isFertilityShared
          && projection.fertilityWindowStart
          && projection.fertilityWindowEnd && (
          <li className="p-3 rounded-control bg-muted/30">
            <p className="text-label font-bold text-foreground">
              가임 예상 {formatKoreanDate(projection.fertilityWindowStart)}
              {' ~ '}
              {formatKoreanDate(projection.fertilityWindowEnd)}
            </p>
            <p className="text-caption text-muted-foreground mt-0.5">
              달력 계산에 따른 추정이에요. 피임 수단으로 쓸 수 없고, 임신 가능성을 알려주는 것도 아니에요.
            </p>
          </li>
        )}
      </ul>

      <p className="text-caption text-muted-foreground">
        상대가 직접 켠 항목만 보여요. 언제든 상대가 공유를 끌 수 있어요.
      </p>
    </section>
  );
}
