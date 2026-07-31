import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowDown, ArrowLeft, ArrowUp, Calendar, CheckSquare, ExternalLink, LoaderCircle,
  MapPin, PenTool, Pencil, Plus, RefreshCw, ShieldAlert, Square, Trash2, Unlink,
} from 'lucide-react';
import { toast } from 'sonner';
import { MobileShell } from '@/components/MobileShell';
import { supabase } from '@/lib/supabase';
import {
  deleteTripChecklistFromDB,
  deleteTripFromDB,
  deleteTripItemFromDB,
  fetchTripChecklistsResultFromDB,
  fetchTripItemsResultFromDB,
  fetchTripResultFromDB,
  inclusiveTripDates,
  reorderTripItemsInDB,
  saveTripChecklistToDB,
  saveTripItemToDB,
  toggleTripChecklistInDB,
  updateTripInDB,
  updateTripItemInDB,
  validateTripDraft,
  validateTripItemUrl,
  validateTripRangeAgainstItems,
} from '@/lib/trips';
import { useStore } from '@/lib/useStore';
import { formatLocalDate } from '@/lib/utils';
import type { Trip, TripChecklist, TripItem, TripStatus } from '@/types';

type ParentState = 'loading' | 'ready' | 'not-found' | 'forbidden' | 'error' | 'disconnected';
type ChildState = 'loading' | 'ready' | 'error' | 'forbidden';
type ItemDraft = Pick<TripItem, 'title' | 'category'> & { memo: string; url: string };

const EMPTY_ITEM: ItemDraft = { title: '', category: 'activity', memo: '', url: '' };
const CATEGORY_OPTIONS: Array<{ value: TripItem['category']; label: string }> = [
  { value: 'activity', label: '활동' },
  { value: 'food', label: '음식' },
  { value: 'lodging', label: '숙소' },
  { value: 'transport', label: '교통' },
];
const STATUS_OPTIONS: Array<{ value: TripStatus; label: string }> = [
  { value: 'planned', label: '계획중' },
  { value: 'ongoing', label: '여행중' },
  { value: 'completed', label: '다녀옴' },
];

export function TripDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { state } = useStore();
  const userId = state.authenticatedUser?.id;
  const coupleId = state.profile.couple.coupleId;
  const activeCouple = Boolean(
    userId && coupleId && state.profile.couple.connected && state.profile.couple.status === 'active',
  );
  const tripAccessKey = activeCouple && id ? `${userId}:${coupleId}:${id}` : '';
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
  const latestGlobalTripsRef = useRef(state.trips);
  const parentGlobalSnapshotRef = useRef<Trip[] | null>(null);
  const parentLoadGenerationRef = useRef(0);
  const childLoadGenerationRef = useRef(0);
  latestGlobalTripsRef.current = state.trips;

  const [trip, setTrip] = useState<Trip | null>(null);
  const [parentState, setParentState] = useState<ParentState>('loading');
  const [childState, setChildState] = useState<ChildState>('loading');
  const [items, setItems] = useState<TripItem[]>([]);
  const [checklists, setChecklists] = useState<TripChecklist[]>([]);
  const [activeTab, setActiveTab] = useState<'schedule' | 'checklist'>('schedule');
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  const [showTripModal, setShowTripModal] = useState(false);
  const [tripDraft, setTripDraft] = useState({ title: '', startDate: '', endDate: '', status: 'planned' as TripStatus });
  const [tripError, setTripError] = useState<string | null>(null);
  const [isSavingTrip, setIsSavingTrip] = useState(false);
  const [isDeletingTrip, setIsDeletingTrip] = useState(false);
  const [showItemModal, setShowItemModal] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [itemDraft, setItemDraft] = useState<ItemDraft>(EMPTY_ITEM);
  const [itemError, setItemError] = useState<string | null>(null);
  const [isSavingItem, setIsSavingItem] = useState(false);
  const [pendingItemIds, setPendingItemIds] = useState<Set<string>>(new Set());
  const [newChecklistName, setNewChecklistName] = useState('');
  const [isAddingChecklist, setIsAddingChecklist] = useState(false);
  const [pendingChecklistIds, setPendingChecklistIds] = useState<Set<string>>(new Set());
  const [childActionError, setChildActionError] = useState<string | null>(null);

  useLayoutEffect(() => {
    // React Router reuses this component when only :id changes. Clear every
    // route-owned value before paint so trip A cannot remain interactive on B.
    parentGlobalSnapshotRef.current = null;
    parentLoadGenerationRef.current += 1;
    childLoadGenerationRef.current += 1;
    setTrip(null);
    setItems([]);
    setChecklists([]);
    setChildState('loading');
    setParentState(!userId ? 'forbidden' : !activeCouple ? 'disconnected' : !id ? 'not-found' : 'loading');
    setShowTripModal(false);
    setShowItemModal(false);
    setEditingItemId(null);
    setTripError(null);
    setItemError(null);
    setChildActionError(null);
    setPendingItemIds(new Set());
    setPendingChecklistIds(new Set());
  }, [activeCouple, id, tripAccessKey, userId]);

  const loadParent = useCallback(async () => {
    parentGlobalSnapshotRef.current = null;
    if (!userId) {
      setTrip(null);
      setParentState('forbidden');
      return;
    }
    if (!activeCouple || !coupleId) {
      setTrip(null);
      setItems([]);
      setChecklists([]);
      setParentState('disconnected');
      return;
    }
    if (!id) {
      setTrip(null);
      setParentState('not-found');
      return;
    }
    setParentState('loading');
    const loadGeneration = ++parentLoadGenerationRef.current;
    const requestScope = captureTripScope();
    const globalSnapshot = latestGlobalTripsRef.current;
    try {
      const result = await fetchTripResultFromDB(id);
      if (
        !isCurrentTripScope(requestScope)
        || parentLoadGenerationRef.current !== loadGeneration
      ) return;
      if (latestGlobalTripsRef.current !== globalSnapshot) {
        const updated = latestGlobalTripsRef.current.find(
          (entry) => entry.id === id && entry.coupleId === coupleId,
        );
        parentGlobalSnapshotRef.current = latestGlobalTripsRef.current;
        if (!updated) {
          setTrip(null);
          setParentState('not-found');
          return;
        }
        setTrip(updated);
        setParentState('ready');
        return;
      }
      if (!result.ok) {
        setParentState(result.reason === 'forbidden' ? 'forbidden' : 'error');
        return;
      }
      if (!result.trip || result.trip.coupleId !== coupleId) {
        setTrip(null);
        setParentState('not-found');
        return;
      }
      parentGlobalSnapshotRef.current = latestGlobalTripsRef.current;
      setTrip(result.trip);
      setParentState('ready');
    } catch (error) {
      if (
        !isCurrentTripScope(requestScope)
        || parentLoadGenerationRef.current !== loadGeneration
      ) return;
      console.error('Failed to load trip:', error);
      setParentState('error');
    }
  }, [activeCouple, captureTripScope, coupleId, id, isCurrentTripScope, userId]);

  const loadChildren = useCallback(async () => {
    if (!id || !activeCouple) return;
    setChildState('loading');
    const loadGeneration = ++childLoadGenerationRef.current;
    const requestScope = captureTripScope();
    try {
      const [itemResult, checklistResult] = await Promise.all([
        fetchTripItemsResultFromDB(id),
        fetchTripChecklistsResultFromDB(id),
      ]);
      if (
        !isCurrentTripScope(requestScope)
        || childLoadGenerationRef.current !== loadGeneration
      ) return;
      if (!itemResult.ok || !checklistResult.ok) {
        const forbidden = (!itemResult.ok && itemResult.reason === 'forbidden')
          || (!checklistResult.ok && checklistResult.reason === 'forbidden');
        setChildState(forbidden ? 'forbidden' : 'error');
        return;
      }
      setItems(itemResult.items);
      setChecklists(checklistResult.checklists);
      setChildState('ready');
    } catch (error) {
      if (
        !isCurrentTripScope(requestScope)
        || childLoadGenerationRef.current !== loadGeneration
      ) return;
      console.error('Failed to load trip details:', error);
      setChildState('error');
    }
  }, [activeCouple, captureTripScope, id, isCurrentTripScope]);

  useEffect(() => {
    void loadParent();
  }, [loadParent]);

  useEffect(() => {
    const previousSnapshot = parentGlobalSnapshotRef.current;
    if (
      parentState !== 'ready' ||
      !id ||
      !coupleId ||
      previousSnapshot === null ||
      previousSnapshot === state.trips
    ) return;

    parentGlobalSnapshotRef.current = state.trips;
    const updated = state.trips.find((entry) => entry.id === id && entry.coupleId === coupleId);
    if (!updated) {
      setTrip(null);
      setItems([]);
      setChecklists([]);
      setParentState('not-found');
      return;
    }
    setTrip(updated);
  }, [coupleId, id, parentState, state.trips]);

  useEffect(() => {
    if (parentState === 'ready') void loadChildren();
  }, [loadChildren, parentState]);

  useEffect(() => {
    const client = supabase;
    if (!client || !id || !activeCouple || !userId || !coupleId || parentState !== 'ready') return;
    let timer: number | undefined;
    const channelScope = captureTripScope();
    const refresh = () => {
      if (!isCurrentTripScope(channelScope)) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => void loadChildren(), 200);
    };
    const channel = client.channel(`trip-detail:${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_items', filter: `trip_id=eq.${id}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_checklists', filter: `trip_id=eq.${id}` }, refresh)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED' && isCurrentTripScope(channelScope)) refresh();
      });
    const recover = () => {
      if (document.visibilityState === 'visible' && isCurrentTripScope(channelScope)) refresh();
    };
    document.addEventListener('visibilitychange', recover);
    window.addEventListener('online', recover);
    return () => {
      if (timer) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', recover);
      window.removeEventListener('online', recover);
      void client.removeChannel(channel);
    };
  }, [activeCouple, captureTripScope, coupleId, id, isCurrentTripScope, loadChildren, parentState, tripAccessKey, userId]);

  const dates = useMemo(
    () => trip ? inclusiveTripDates(trip.startDate, trip.endDate) : [],
    [trip],
  );
  const activeDate = dates[activeDayIndex] || dates[0];
  const currentDayItems = useMemo(
    () => items.filter((item) => item.itemDate === activeDate)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title)),
    [activeDate, items],
  );

  useEffect(() => {
    if (activeDayIndex >= dates.length) setActiveDayIndex(0);
  }, [activeDayIndex, dates.length]);

  const setItemPending = (itemId: string, pending: boolean) => {
    setPendingItemIds((current) => {
      const next = new Set(current);
      if (pending) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  };
  const setChecklistPending = (checklistId: string, pending: boolean) => {
    setPendingChecklistIds((current) => {
      const next = new Set(current);
      if (pending) next.add(checklistId);
      else next.delete(checklistId);
      return next;
    });
  };

  const openTripEdit = () => {
    if (!trip) return;
    setTripDraft({ title: trip.title, startDate: trip.startDate, endDate: trip.endDate, status: trip.status });
    setTripError(null);
    setShowTripModal(true);
  };

  const handleSaveTrip = async () => {
    if (!trip || isSavingTrip) return;
    const validationError = validateTripDraft(tripDraft)
      || validateTripRangeAgainstItems(tripDraft, items);
    if (validationError) {
      setTripError(validationError);
      return;
    }
    const operationScope = captureTripScope();
    setIsSavingTrip(true);
    setTripError(null);
    try {
      const saved = await updateTripInDB(trip.id, {
        title: tripDraft.title.trim(),
        startDate: tripDraft.startDate,
        endDate: tripDraft.endDate,
        status: tripDraft.status,
      });
      if (!isCurrentTripScope(operationScope)) return;
      if (!saved) {
        setTripError('여행 정보를 수정하지 못했어요. 다시 시도해 주세요.');
        return;
      }
      setTrip(saved);
      setShowTripModal(false);
      toast.success('여행 정보가 수정되었습니다.');
    } finally {
      if (isCurrentTripScope(operationScope)) setIsSavingTrip(false);
    }
  };

  const handleDeleteTrip = async () => {
    if (!trip || isDeletingTrip || !confirm('이 여행과 모든 일정, 준비물을 삭제하시겠습니까?')) return;
    const operationScope = captureTripScope();
    setIsDeletingTrip(true);
    try {
      const deleted = await deleteTripFromDB(trip.id);
      if (!isCurrentTripScope(operationScope)) return;
      if (!deleted) {
        toast.error('여행을 삭제하지 못했어요. 다시 시도해 주세요.');
        return;
      }
      toast.success('여행이 삭제되었습니다.');
      navigate('/trips');
    } finally {
      if (isCurrentTripScope(operationScope)) setIsDeletingTrip(false);
    }
  };

  const openNewItem = () => {
    setEditingItemId(null);
    setItemDraft(EMPTY_ITEM);
    setItemError(null);
    setShowItemModal(true);
  };
  const openEditItem = (item: TripItem) => {
    setEditingItemId(item.id);
    setItemDraft({ title: item.title, category: item.category, memo: item.memo || '', url: item.url || '' });
    setItemError(null);
    setShowItemModal(true);
  };

  const handleSaveItem = async () => {
    if (!trip || !activeDate || isSavingItem) return;
    if (!itemDraft.title.trim()) {
      setItemError('장소 또는 제목을 입력해 주세요.');
      return;
    }
    const urlError = validateTripItemUrl(itemDraft.url);
    if (urlError) {
      setItemError(urlError);
      return;
    }
    const operationScope = captureTripScope();
    setIsSavingItem(true);
    setItemError(null);
    const existing = editingItemId ? items.find((item) => item.id === editingItemId) : undefined;
    try {
      const input = {
        tripId: trip.id,
        itemDate: existing?.itemDate || activeDate,
        title: itemDraft.title.trim(),
        category: itemDraft.category,
        memo: itemDraft.memo.trim() || undefined,
        url: itemDraft.url.trim() || undefined,
        sortOrder: existing?.sortOrder ?? currentDayItems.length,
      };
      const saved = existing
        ? await updateTripItemInDB({ id: existing.id, ...input })
        : await saveTripItemToDB(input);
      if (!isCurrentTripScope(operationScope)) return;
      if (!saved) {
        setItemError('일정을 저장하지 못했어요. 다시 시도해 주세요.');
        return;
      }
      setItems((current) => existing
        ? current.map((item) => item.id === saved.id ? saved : item)
        : [...current, saved]);
      setShowItemModal(false);
      toast.success(existing ? '일정이 수정되었습니다.' : '일정이 추가되었습니다.');
    } finally {
      if (isCurrentTripScope(operationScope)) setIsSavingItem(false);
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (pendingItemIds.has(itemId)) return;
    const operationScope = captureTripScope();
    setItemPending(itemId, true);
    try {
      const deleted = await deleteTripItemFromDB(itemId);
      if (!isCurrentTripScope(operationScope)) return;
      if (!deleted) {
        toast.error('일정을 삭제하지 못했어요.');
        return;
      }
      setItems((current) => current.filter((item) => item.id !== itemId));
      toast.success('일정이 삭제되었습니다.');
    } finally {
      if (isCurrentTripScope(operationScope)) setItemPending(itemId, false);
    }
  };

  const handleMoveItem = async (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    const moving = currentDayItems[index];
    const target = currentDayItems[targetIndex];
    if (!moving || !target || pendingItemIds.has(moving.id) || pendingItemIds.has(target.id)) return;
    const operationScope = captureTripScope();
    const movingOrder = moving.sortOrder;
    const targetOrder = target.sortOrder;
    setItems((current) => current.map((item) => {
      if (item.id === moving.id) return { ...item, sortOrder: targetOrder };
      if (item.id === target.id) return { ...item, sortOrder: movingOrder };
      return item;
    }));
    setItemPending(moving.id, true);
    setItemPending(target.id, true);
    const saved = await reorderTripItemsInDB([
      { id: moving.id, sortOrder: targetOrder },
      { id: target.id, sortOrder: movingOrder },
    ]);
    if (!isCurrentTripScope(operationScope)) return;
    if (!saved) {
      await loadChildren();
      if (!isCurrentTripScope(operationScope)) return;
      toast.error('순서를 저장하지 못해 서버의 최신 순서를 다시 불러왔어요.');
    }
    setItemPending(moving.id, false);
    setItemPending(target.id, false);
  };

  const handleAddChecklist = async () => {
    if (!trip || !newChecklistName.trim() || isAddingChecklist) return;
    const operationScope = captureTripScope();
    setIsAddingChecklist(true);
    setChildActionError(null);
    try {
      const saved = await saveTripChecklistToDB(trip.id, newChecklistName.trim());
      if (!isCurrentTripScope(operationScope)) return;
      if (!saved) {
        setChildActionError('준비물을 추가하지 못했어요.');
        return;
      }
      setChecklists((current) => [...current, saved]);
      setNewChecklistName('');
    } finally {
      if (isCurrentTripScope(operationScope)) setIsAddingChecklist(false);
    }
  };

  const handleToggleChecklist = async (item: TripChecklist) => {
    if (pendingChecklistIds.has(item.id)) return;
    const operationScope = captureTripScope();
    const nextCompleted = !item.completed;
    setChildActionError(null);
    setChecklistPending(item.id, true);
    setChecklists((current) => current.map((entry) => entry.id === item.id ? { ...entry, completed: nextCompleted } : entry));
    const saved = await toggleTripChecklistInDB(item.id, nextCompleted);
    if (!isCurrentTripScope(operationScope)) return;
    if (!saved) {
      setChecklists((current) => current.map((entry) => entry.id === item.id ? { ...entry, completed: item.completed } : entry));
      const message = '체크 상태를 저장하지 못해 이전 상태로 되돌렸어요.';
      setChildActionError(message);
      toast.error(message);
    }
    setChecklistPending(item.id, false);
  };

  const handleDeleteChecklist = async (checklistId: string) => {
    if (pendingChecklistIds.has(checklistId)) return;
    const operationScope = captureTripScope();
    setChecklistPending(checklistId, true);
    setChildActionError(null);
    try {
      const deleted = await deleteTripChecklistFromDB(checklistId);
      if (!isCurrentTripScope(operationScope)) return;
      if (!deleted) {
        setChildActionError('준비물을 삭제하지 못했어요.');
        return;
      }
      setChecklists((current) => current.filter((entry) => entry.id !== checklistId));
    } finally {
      if (isCurrentTripScope(operationScope)) setChecklistPending(checklistId, false);
    }
  };

  const visibleParentState: ParentState = !userId
    ? 'forbidden'
    : !activeCouple
      ? 'disconnected'
      : parentState;

  if (visibleParentState !== 'ready' || !trip) {
    const content = visibleParentState === 'loading'
      ? <LoaderCircle className="w-8 h-8 animate-spin text-coral mx-auto" aria-label="여행 불러오는 중" />
      : visibleParentState === 'not-found'
        ? <><MapPin className="w-10 h-10 mx-auto text-muted-foreground" /><p className="font-bold">여행을 찾을 수 없어요</p><p className="text-sm text-muted-foreground">삭제되었거나 존재하지 않는 여행이에요.</p></>
        : visibleParentState === 'disconnected'
          ? <><Unlink className="w-10 h-10 mx-auto text-muted-foreground" /><p className="font-bold">우리 공간 연결이 필요해요</p><p className="text-sm text-muted-foreground">두 사람이 연결된 뒤 여행을 열 수 있어요.</p></>
          : visibleParentState === 'forbidden'
            ? <><ShieldAlert className="w-10 h-10 mx-auto text-amber-500" /><p className="font-bold">이 여행에 접근할 권한이 없어요</p></>
            : <><RefreshCw className="w-10 h-10 mx-auto text-muted-foreground" /><p className="font-bold">여행을 불러오지 못했어요</p><button onClick={() => void loadParent()} className="px-5 py-2.5 bg-coral text-white rounded-xl font-bold text-sm">다시 시도</button></>;
    return <MobileShell><div className="p-6 text-center mt-20 space-y-3">{content}<button onClick={() => navigate('/trips')} className="block mx-auto text-sm text-muted-foreground underline">여행 목록으로</button></div></MobileShell>;
  }

  return (
    <MobileShell>
      <div className="pb-28">
        <header className="bg-card border-b border-border px-5 py-4 flex items-center justify-between sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => navigate('/trips')} className="p-1 -ml-1 text-muted-foreground" aria-label="여행 목록"><ArrowLeft className="w-5 h-5" /></button>
            <h1 className="font-bold text-foreground text-lg truncate">{trip.title}</h1>
          </div>
          <div className="flex items-center">
            <button onClick={openTripEdit} disabled={isDeletingTrip} className="p-2 text-muted-foreground disabled:opacity-40" aria-label="여행 수정"><Pencil className="w-4 h-4" /></button>
            <button onClick={() => void handleDeleteTrip()} disabled={isDeletingTrip} className="p-2 -mr-2 text-red-500 disabled:opacity-40" aria-label="여행 삭제"><Trash2 className="w-5 h-5" /></button>
          </div>
        </header>

        <div className="bg-coral/10 border-b border-coral/20 px-5 py-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-coral font-bold text-sm"><Calendar className="w-4 h-4" /><span>{formatLocalDate(trip.startDate)} ~ {formatLocalDate(trip.endDate)}</span></div>
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-coral text-white shrink-0">{dates.length}일간</span>
          </div>
          <button onClick={() => navigate(`/record?from=${trip.startDate}&to=${trip.endDate}&trip=${trip.id}`)} className="w-full py-2.5 px-3 rounded-2xl bg-card border border-coral/30 text-coral font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm"><PenTool size={14} />이 여행 기간의 추억 보기·남기기</button>
        </div>

        <div className="flex border-b border-border bg-card">
          <button onClick={() => setActiveTab('schedule')} className={`flex-1 py-3 text-xs font-bold border-b-2 ${activeTab === 'schedule' ? 'border-coral text-coral' : 'border-transparent text-muted-foreground'}`}>일정 ({items.length})</button>
          <button onClick={() => setActiveTab('checklist')} className={`flex-1 py-3 text-xs font-bold border-b-2 ${activeTab === 'checklist' ? 'border-coral text-coral' : 'border-transparent text-muted-foreground'}`}>준비물 ({checklists.length})</button>
        </div>

        {childState !== 'ready' ? (
          <div className="p-8 text-center space-y-3">
            {childState === 'loading' ? <LoaderCircle className="w-7 h-7 animate-spin text-coral mx-auto" /> : <><p className="font-bold text-sm">{childState === 'forbidden' ? '일정과 준비물을 볼 권한이 없어요.' : '일정과 준비물을 불러오지 못했어요.'}</p><button onClick={() => void loadChildren()} className="px-4 py-2 bg-coral text-white rounded-xl text-xs font-bold">다시 시도</button></>}
          </div>
        ) : activeTab === 'schedule' ? (
          <>
            <div className="bg-card border-b border-border px-2 flex overflow-x-auto no-scrollbar">
              {dates.map((date, index) => <button key={date} onClick={() => setActiveDayIndex(index)} className={`px-4 py-3 text-xs font-bold whitespace-nowrap border-b-2 ${activeDayIndex === index ? 'border-navy text-navy' : 'border-transparent text-muted-foreground'}`}>{index + 1}일차 <span className="font-normal">({date.slice(5)})</span></button>)}
            </div>
            <div className="p-5">
              {currentDayItems.length === 0 ? (
                <div className="bg-card border border-dashed border-border rounded-2xl p-8 text-center"><MapPin className="w-8 h-8 text-muted-foreground mx-auto mb-2" /><p className="text-xs font-bold">직접 장소나 할 일을 추가해 보세요.</p></div>
              ) : (
                <div className="space-y-3">
                  {currentDayItems.map((item, index) => {
                    const pending = pendingItemIds.has(item.id);
                    return <div key={item.id} className="bg-card border border-border rounded-2xl p-4 shadow-sm flex gap-3">
                      <div className="w-6 h-6 rounded-full bg-coral text-white text-[10px] font-bold flex items-center justify-center shrink-0">{index + 1}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2"><h3 className="font-bold text-sm truncate">{item.title}</h3><span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{CATEGORY_OPTIONS.find((option) => option.value === item.category)?.label}</span>{item.url && <a href={item.url} target="_blank" rel="noreferrer" aria-label="링크 열기"><ExternalLink className="w-3.5 h-3.5 text-coral" /></a>}</div>
                        {item.memo && <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{item.memo}</p>}
                        <div className="flex gap-1 mt-2">
                          <button onClick={() => void handleMoveItem(index, -1)} disabled={index === 0 || pending} className="p-1.5 text-muted-foreground disabled:opacity-25" aria-label="위로 이동"><ArrowUp className="w-4 h-4" /></button>
                          <button onClick={() => void handleMoveItem(index, 1)} disabled={index === currentDayItems.length - 1 || pending} className="p-1.5 text-muted-foreground disabled:opacity-25" aria-label="아래로 이동"><ArrowDown className="w-4 h-4" /></button>
                          <button onClick={() => openEditItem(item)} disabled={pending} className="p-1.5 text-muted-foreground disabled:opacity-25" aria-label="일정 수정"><Pencil className="w-4 h-4" /></button>
                          <button onClick={() => void handleDeleteItem(item.id)} disabled={pending} className="p-1.5 text-destructive disabled:opacity-25" aria-label="일정 삭제"><Trash2 className="w-4 h-4" /></button>
                        </div>
                      </div>
                    </div>;
                  })}
                </div>
              )}
            </div>
            <button onClick={openNewItem} className="fixed bottom-6 right-5 w-14 h-14 bg-coral rounded-full flex items-center justify-center text-white shadow-lg z-40" aria-label="일정 추가"><Plus className="w-7 h-7" /></button>
          </>
        ) : (
          <div className="p-5 space-y-4">
            <div className="flex gap-2"><input value={newChecklistName} onChange={(event) => setNewChecklistName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void handleAddChecklist(); }} placeholder="새 준비물 추가" disabled={isAddingChecklist} className="flex-1 bg-card border border-border rounded-xl px-4 py-3 text-xs outline-none focus:border-coral disabled:opacity-50" /><button onClick={() => void handleAddChecklist()} disabled={isAddingChecklist || !newChecklistName.trim()} className="px-4 bg-coral text-white font-bold text-xs rounded-xl disabled:opacity-40">{isAddingChecklist ? '추가 중' : '추가'}</button></div>
            {childActionError && <p className="text-xs text-red-600" role="alert">{childActionError}</p>}
            <div className="space-y-2">
              {checklists.map((item) => {
                const pending = pendingChecklistIds.has(item.id);
                return <div key={item.id} className="bg-card border border-border p-3.5 rounded-2xl flex items-center justify-between text-xs font-semibold">
                  <button onClick={() => void handleToggleChecklist(item)} disabled={pending} className="flex items-center gap-2 text-left disabled:opacity-50">{item.completed ? <CheckSquare className="w-5 h-5 text-coral" /> : <Square className="w-5 h-5 text-muted-foreground" />}<span className={item.completed ? 'line-through text-muted-foreground' : ''}>{item.itemName}</span></button>
                  <button onClick={() => void handleDeleteChecklist(item.id)} disabled={pending} className="text-muted-foreground hover:text-destructive p-1 disabled:opacity-40" aria-label="준비물 삭제"><Trash2 className="w-4 h-4" /></button>
                </div>;
              })}
              {checklists.length === 0 && <div className="bg-card border border-dashed border-border rounded-2xl p-6 text-center text-xs text-muted-foreground">함께 준비할 짐이나 할 일을 작성해 보세요.</div>}
            </div>
          </div>
        )}

        {showTripModal && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-5"><div className="bg-card w-full max-w-md rounded-t-3xl sm:rounded-3xl p-6"><h2 className="text-lg font-bold mb-4">여행 정보 수정</h2><div className="space-y-3 text-xs">
          <label className="block font-bold">여행 이름<input value={tripDraft.title} onChange={(event) => setTripDraft((current) => ({ ...current, title: event.target.value }))} className="mt-1 w-full bg-background border border-border rounded-xl px-4 py-3" /></label>
          <div className="flex gap-2"><label className="flex-1 font-bold">가는 날<input type="date" value={tripDraft.startDate} onChange={(event) => setTripDraft((current) => ({ ...current, startDate: event.target.value }))} className="mt-1 w-full bg-background border border-border rounded-xl px-2 py-3" /></label><label className="flex-1 font-bold">오는 날<input type="date" min={tripDraft.startDate} value={tripDraft.endDate} onChange={(event) => setTripDraft((current) => ({ ...current, endDate: event.target.value }))} className="mt-1 w-full bg-background border border-border rounded-xl px-2 py-3" /></label></div>
          <label className="block font-bold">상태<select value={tripDraft.status} onChange={(event) => setTripDraft((current) => ({ ...current, status: event.target.value as TripStatus }))} className="mt-1 w-full bg-background border border-border rounded-xl px-4 py-3">{STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          {tripError && <p className="text-red-600" role="alert">{tripError}</p>}
        </div><div className="flex gap-3 mt-6"><button onClick={() => setShowTripModal(false)} disabled={isSavingTrip} className="flex-1 bg-muted py-3 rounded-xl font-bold">취소</button><button onClick={() => void handleSaveTrip()} disabled={isSavingTrip} className="flex-1 bg-coral text-white py-3 rounded-xl font-bold disabled:opacity-50">{isSavingTrip ? '저장 중' : '저장'}</button></div></div></div>}

        {showItemModal && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-5"><div className="bg-card w-full max-w-md rounded-t-3xl sm:rounded-3xl p-6"><h2 className="text-lg font-bold mb-4">{editingItemId ? '일정 수정' : `${activeDayIndex + 1}일차 일정 추가`}</h2><div className="space-y-3 text-xs">
          <label className="block font-bold">장소 또는 제목 *<input value={itemDraft.title} onChange={(event) => setItemDraft((current) => ({ ...current, title: event.target.value }))} placeholder="직접 입력해 주세요" className="mt-1 w-full bg-background border border-border rounded-xl px-4 py-3" /></label>
          <fieldset><legend className="font-bold mb-1">분류</legend><div className="grid grid-cols-4 gap-1">{CATEGORY_OPTIONS.map((option) => <button key={option.value} type="button" onClick={() => setItemDraft((current) => ({ ...current, category: option.value }))} className={`py-2 rounded-xl border ${itemDraft.category === option.value ? 'bg-coral text-white border-coral' : 'border-border'}`}>{option.label}</button>)}</div></fieldset>
          <label className="block font-bold">링크 (선택)<input type="url" value={itemDraft.url} onChange={(event) => setItemDraft((current) => ({ ...current, url: event.target.value }))} placeholder="https://" className="mt-1 w-full bg-background border border-border rounded-xl px-4 py-3" /></label>
          <label className="block font-bold">메모 (선택)<textarea value={itemDraft.memo} onChange={(event) => setItemDraft((current) => ({ ...current, memo: event.target.value }))} rows={3} className="mt-1 w-full bg-background border border-border rounded-xl px-4 py-3 resize-none" /></label>
          {itemError && <p className="text-red-600" role="alert">{itemError}</p>}
        </div><div className="flex gap-3 mt-6"><button onClick={() => setShowItemModal(false)} disabled={isSavingItem} className="flex-1 bg-muted py-3 rounded-xl font-bold">취소</button><button onClick={() => void handleSaveItem()} disabled={isSavingItem} className="flex-1 bg-coral text-white py-3 rounded-xl font-bold disabled:opacity-50">{isSavingItem ? '저장 중' : '저장'}</button></div></div></div>}
      </div>
    </MobileShell>
  );
}
