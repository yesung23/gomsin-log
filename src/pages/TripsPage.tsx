import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, ChevronRight, LoaderCircle, Map, Plus, RefreshCw, ShieldAlert, Unlink } from 'lucide-react';
import { toast } from 'sonner';
import { useOnlineStatus, OFFLINE_READONLY_MESSAGE } from '@/lib/useOnlineStatus';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { SheetHandle } from '@/components/ui/SheetHandle';
import { useSheetDrag } from '@/lib/useSheetDrag';
import { classifyServerError } from '@/lib/serverErrors';
import { MobileShell } from '@/components/MobileShell';
import { PlanSectionNav } from '@/components/PlanSectionNav';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { PressableRow, RowGroup, SectionHeader } from '@/components/ui/List';
import {
  TRIP_PHASE_LABEL,
  TRIP_PHASE_ORDER,
  TRIP_PHASE_PILL,
  daysUntilTrip,
  groupTripsByPhase,
} from '@/lib/tripPhase';
import { fetchTripsResultFromDB, reconcileParentTrips, saveTripToDB, validateTripDraft } from '@/lib/trips';
import { useStore } from '@/lib/useStore';
import { formatLocalDate, localToday, toLocalDateString } from '@/lib/utils';
import { useEscapeKey } from '@/lib/hooks';
import type { Trip } from '@/types';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden' | 'disconnected';

export function TripsPage() {
  const { state } = useStore();
  const navigate = useNavigate();
  const [trips, setTrips] = useState<Trip[]>(() => reconcileParentTrips(state.trips));
  const globalTripsSnapshotRef = useRef(state.trips);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [showModal, setShowModal] = useState(false);
  const [newTrip, setNewTrip] = useState({ title: '', startDate: '', endDate: '' });
  const [isCreating, setIsCreating] = useState(false);
  /* Drag-to-dismiss. Disabled while a create is in flight: the sheet is the only
     place that write is reported, so letting a swipe take it away mid-save would
     hide the outcome -- the same reason 취소 is blocked then. */
  const { sheetRef, handleProps } = useSheetDrag({
    onDismiss: () => setShowModal(false),
    enabled: !isCreating,
  });
  const isOffline = !useOnlineStatus();
  const [formError, setFormError] = useState<string | null>(null);

  useEscapeKey(() => {
    if (!isCreating) setShowModal(false);
  }, showModal);

  const userId = state.authenticatedUser?.id;
  const coupleId = state.profile.couple.coupleId;
  const activeCouple = Boolean(
    userId && coupleId && state.profile.couple.connected && state.profile.couple.status === 'active',
  );
  const tripAccessKey = activeCouple ? `${userId}:${coupleId}` : '';
  const tripAccessKeyRef = useRef(tripAccessKey);
  const tripAccessGenerationRef = useRef(0);
  if (tripAccessKeyRef.current !== tripAccessKey) {
    tripAccessKeyRef.current = tripAccessKey;
    tripAccessGenerationRef.current += 1;
  }
  const captureTripScope = useCallback(
    () => ({ key: tripAccessKeyRef.current, generation: tripAccessGenerationRef.current }),
    [],
  );
  const isCurrentTripScope = useCallback(
    (scope: { key: string; generation: number }) =>
      scope.key === tripAccessKeyRef.current
      && scope.generation === tripAccessGenerationRef.current
      && scope.key !== '',
    [],
  );

  useLayoutEffect(() => {
    setTrips(activeCouple ? reconcileParentTrips(state.trips) : []);
    setShowModal(false);
    setIsCreating(false);
    setFormError(null);
    setLoadState(activeCouple ? 'loading' : userId ? 'disconnected' : 'forbidden');
  }, [activeCouple, state.trips, tripAccessKey, userId]);

  const loadTrips = useCallback(async () => {
    if (!userId) {
      setLoadState('forbidden');
      return;
    }
    if (!activeCouple || !coupleId) {
      setLoadState('disconnected');
      return;
    }
    setLoadState('loading');
    const requestScope = captureTripScope();
    const globalSnapshot = globalTripsSnapshotRef.current;
    try {
      const result = await fetchTripsResultFromDB(coupleId);
      if (
        !isCurrentTripScope(requestScope) ||
        globalTripsSnapshotRef.current !== globalSnapshot
      ) return;
      if (!result.ok) {
        setLoadState(result.reason === 'forbidden' ? 'forbidden' : 'error');
        return;
      }
      setTrips(reconcileParentTrips(result.trips));
      setLoadState('ready');
    } catch (error) {
      if (
        !isCurrentTripScope(requestScope) ||
        globalTripsSnapshotRef.current !== globalSnapshot
      ) return;
      console.error('Failed to load trips:', error);
      setLoadState('error');
    }
  }, [activeCouple, captureTripScope, coupleId, isCurrentTripScope, userId]);

  useEffect(() => {
    void loadTrips();
  }, [loadTrips]);

  useEffect(() => {
    if (!activeCouple) {
      setTrips([]);
      return;
    }
    if (globalTripsSnapshotRef.current === state.trips) return;
    globalTripsSnapshotRef.current = state.trips;
    setTrips(reconcileParentTrips(state.trips));
    setLoadState('ready');
  }, [activeCouple, state.trips]);

  useEffect(() => {
    if (!activeCouple) setShowModal(false);
  }, [activeCouple]);

  const openCreate = () => {
    if (loadState !== 'ready' || !activeCouple) return;
    setFormError(null);
    setShowModal(true);
  };

  const handleSaveTrip = async () => {
    if (isCreating) return;
    if (isOffline) {
      setFormError(OFFLINE_READONLY_MESSAGE);
      toast.error(OFFLINE_READONLY_MESSAGE);
      return;
    }
    const validationError = validateTripDraft(newTrip);
    if (validationError) {
      setFormError(validationError);
      toast.error(validationError);
      return;
    }
    if (!userId || !coupleId || !activeCouple) {
      setFormError('연결된 우리 공간에서만 여행을 만들 수 있어요.');
      return;
    }

    const operationScope = captureTripScope();
    setIsCreating(true);
    setFormError(null);
    try {
      const saved = await saveTripToDB({
        title: newTrip.title.trim(),
        startDate: newTrip.startDate,
        endDate: newTrip.endDate,
      }, coupleId, userId);
      if (!isCurrentTripScope(operationScope)) return;
      if (!saved) {
        const message = '여행을 만들지 못했어요. 입력 내용은 유지되니 다시 시도해 주세요.';
        setFormError(message);
        toast.error(message);
        return;
      }
      setTrips((current) => reconcileParentTrips([...current, saved]));
      setShowModal(false);
      setNewTrip({ title: '', startDate: '', endDate: '' });
      toast.success('여행 계획이 생성되었습니다!');
      navigate(`/trips/${saved.id}`);
    } catch (error) {
      if (!isCurrentTripScope(operationScope)) return;
      const message = `여행을 만들지 못했어요. ${classifyServerError(error).message}`;
      setFormError(message);
      toast.error(message);
    } finally {
      if (isCurrentTripScope(operationScope)) setIsCreating(false);
    }
  };

  const todayStr = toLocalDateString(localToday());
  const grouped = groupTripsByPhase(trips, todayStr);
  const totalTrips = trips.length;
  const visibleLoadState: LoadState = !userId
    ? 'forbidden'
    : !activeCouple ? 'disconnected' : loadState;


  return (
    <MobileShell>
      <div className="px-4 pt-5 pb-24 space-y-5">
        <header className="flex items-center justify-between gap-3">
          <h1 className="text-title text-foreground">우리의 여행</h1>
          <button
            type="button"
            onClick={openCreate}
            disabled={visibleLoadState !== 'ready' || isOffline}
            className="press-response min-w-11 min-h-11 flex items-center justify-center rounded-control hover:bg-info-surface text-info disabled:opacity-30"
            aria-label="새 여행"
          >
            <Plus size={20} />
          </button>
        </header>

        <PlanSectionNav active="trips" />

        {visibleLoadState === 'loading' ? (
          <div className="py-16 flex justify-center">
            <LoaderCircle className="w-6 h-6 animate-spin text-info" aria-label="여행 불러오는 중" />
          </div>
        ) : visibleLoadState === 'error' ? (
          <EmptyState
            icon={<RefreshCw size={20} className="text-muted-foreground" />}
            title="여행을 불러오지 못했어요"
            description={isOffline ? OFFLINE_READONLY_MESSAGE : '잠시 후 다시 시도해 주세요.'}
            action={<Button size="sm" variant="outline" onClick={() => void loadTrips()}>다시 시도</Button>}
          />
        ) : visibleLoadState === 'forbidden' ? (
          <EmptyState
            icon={<ShieldAlert size={20} className="text-warning" />}
            title="여행 플래너에 접근할 수 없어요"
            description="로그인 상태와 우리 공간 권한을 확인해 주세요."
          />
        ) : visibleLoadState === 'disconnected' ? (
          <EmptyState
            icon={<Unlink size={20} className="text-muted-foreground" />}
            title={state.profile.couple.status === 'pending' ? '상대방의 연결을 기다리고 있어요' : '우리 공간 연결이 필요해요'}
            description="두 사람이 연결된 뒤 함께 여행을 계획할 수 있어요."
            action={<Button size="sm" variant="secondary" onClick={() => navigate('/us')}>우리 공간으로</Button>}
          />
        ) : totalTrips === 0 ? (
          <EmptyState
            icon={<Map size={20} className="text-info" />}
            title="등록된 여행이 없어요"
            description="첫 여행 계획을 세워보세요!"
            action={<Button size="sm" variant="outline" onClick={openCreate}>새 여행 만들기</Button>}
          />
        ) : (
          <div className="space-y-5">
            {TRIP_PHASE_ORDER.map((phase) => {
              const phaseTrips = grouped[phase];
              if (phaseTrips.length === 0) return null;
              return (
                <section key={phase} data-testid={`trip-phase-${phase}`} aria-label={TRIP_PHASE_LABEL[phase]}>
                  <SectionHeader
                    title={TRIP_PHASE_LABEL[phase]}
                    caption={`${phaseTrips.length}개`}
                  />
                  <RowGroup>
                    {phaseTrips.map((trip) => {
                      const untilStart = daysUntilTrip(trip.startDate, todayStr);
                      return (
                        <PressableRow
                          key={trip.id}
                          data-testid={`trip-card-${trip.id}`}
                          onClick={() => navigate(`/trips/${trip.id}`)}
                          leading={
                            <Calendar size={16} className="text-info" aria-hidden="true" />
                          }
                          trailing={
                            <ChevronRight size={16} className="text-muted-foreground" aria-hidden="true" />
                          }
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-label font-semibold text-foreground break-keep">{trip.title}</span>
                            <Badge tone={phase === 'current' ? 'accent' : phase === 'upcoming' ? 'info' : 'neutral'}>
                              {TRIP_PHASE_PILL[phase]}
                            </Badge>
                            {untilStart !== null && untilStart > 0 && (
                              <span className="text-caption font-medium text-coral-strong tabular-nums">D-{untilStart}</span>
                            )}
                          </div>
                          <p className="text-caption text-muted-foreground mt-0.5 tabular-nums">
                            {formatLocalDate(trip.startDate)} ~ {formatLocalDate(trip.endDate)}
                          </p>
                        </PressableRow>
                      );
                    })}
                  </RowGroup>
                </section>
              );
            })}

            <button
              type="button"
              onClick={openCreate}
              disabled={visibleLoadState !== 'ready' || isOffline}
              className="press-response-row w-full min-h-11 rounded-control border border-dashed border-border text-label font-medium text-muted-foreground disabled:opacity-40"
            >
              + 여행 추가하기 (지난 여행도 기록할 수 있어요)
            </button>
          </div>
        )}
      </div>

      {/* z-[60] so the tab bar cannot intercept 취소 / 만들기 */}
      {showModal && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center sm:p-5">
          <div ref={sheetRef} role="dialog" aria-modal="true" aria-labelledby="new-trip-title" className="bg-card w-full max-w-md rounded-t-2xl sm:rounded-surface p-4 animate-in slide-in-from-bottom-4 border border-border">
            <SheetHandle {...handleProps} />
            <h2 id="new-trip-title" className="text-heading text-foreground mb-4">새 여행 만들기</h2>
            <div className="space-y-3">
              <label className="block text-caption font-medium text-muted-foreground">
                여행 이름
                <input
                  type="text"
                  value={newTrip.title}
                  onChange={(event) => setNewTrip((prev) => ({ ...prev, title: event.target.value }))}
                  placeholder="예: 제주도 3박 4일 여행"
                  className="mt-1 w-full bg-muted border border-border rounded-control px-3 py-2 text-body text-foreground outline-none focus:ring-2 focus:ring-info/40 min-h-11"
                />
              </label>
              <div className="flex gap-3">
                <label className="flex-1 text-caption font-medium text-muted-foreground">
                  가는 날
                  <input
                    type="date"
                    value={newTrip.startDate}
                    onChange={(event) => setNewTrip((prev) => ({ ...prev, startDate: event.target.value }))}
                    className="mt-1 w-full bg-muted border border-border rounded-control px-2 py-2 text-body text-foreground outline-none focus:ring-2 focus:ring-info/40 min-h-11"
                  />
                </label>
                <label className="flex-1 text-caption font-medium text-muted-foreground">
                  오는 날
                  <input
                    type="date"
                    min={newTrip.startDate || undefined}
                    value={newTrip.endDate}
                    onChange={(event) => setNewTrip((prev) => ({ ...prev, endDate: event.target.value }))}
                    className="mt-1 w-full bg-muted border border-border rounded-control px-2 py-2 text-body text-foreground outline-none focus:ring-2 focus:ring-info/40 min-h-11"
                  />
                </label>
              </div>
              {formError && <ErrorNote>{formError}</ErrorNote>}
            </div>
            <div className="flex gap-2 mt-5">
              <Button variant="secondary" size="md" full onClick={() => setShowModal(false)} disabled={isCreating}>취소</Button>
              <Button variant="primary" size="md" full onClick={() => void handleSaveTrip()} disabled={isCreating || isOffline}>
                {isCreating ? '만드는 중...' : '만들기'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </MobileShell>
  );
}
