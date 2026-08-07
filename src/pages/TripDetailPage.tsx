import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowDown, ArrowLeft, ArrowUp, Calendar, CheckSquare, ExternalLink, LoaderCircle,
  ImagePlus, MapPin, MessageCircleHeart, PenTool, Pencil, Plus, RefreshCw, ShieldAlert, Square, Trash2, Unlink,
} from 'lucide-react';
import { toast } from 'sonner';
import { useOnlineStatus, OFFLINE_READONLY_MESSAGE } from '@/lib/useOnlineStatus';
import { MobileShell } from '@/components/MobileShell';
import { supabase } from '@/lib/supabase';
import { classifyServerError } from '@/lib/serverErrors';
import { recognizePlaceScreenshot } from '@/lib/placeOcr';
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
type ItemDraft = Pick<TripItem, 'title' | 'category'> & {
  startTime: string;
  memo: string;
  url: string;
  address: string;
  businessHours: string;
  source: NonNullable<TripItem['source']>;
  talkAbout: boolean;
};

const EMPTY_ITEM: ItemDraft = {
  title: '', category: 'activity', startTime: '', memo: '', url: '', address: '', businessHours: '', source: 'manual', talkAbout: false,
};
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
  const isOffline = !useOnlineStatus();
  const [showItemModal, setShowItemModal] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [itemDraft, setItemDraft] = useState<ItemDraft>(EMPTY_ITEM);
  const [itemError, setItemError] = useState<string | null>(null);
  const [isSavingItem, setIsSavingItem] = useState(false);
  const [isReadingScreenshot, setIsReadingScreenshot] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const screenshotInputRef = useRef<HTMLInputElement>(null);
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
    setIsSavingTrip(false);
    setIsDeletingTrip(false);
    setIsSavingItem(false);
    setIsReadingScreenshot(false);
    setOcrProgress(0);
    setIsAddingChecklist(false);
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
      .sort((a, b) => (a.startTime || '99:99').localeCompare(b.startTime || '99:99') || a.sortOrder - b.sortOrder || a.title.localeCompare(b.title)),
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
    if (isOffline) {
      toast.error(OFFLINE_READONLY_MESSAGE);
      return;
    }
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
      }, trip.coupleId);
      if (!isCurrentTripScope(operationScope)) return;
      if (!saved) {
        setTripError('여행 정보를 수정하지 못했어요. 다시 시도해 주세요.');
        return;
      }
      setTrip(saved);
      setShowTripModal(false);
      toast.success('여행 정보가 수정되었습니다.');
    } catch (error) {
      if (!isCurrentTripScope(operationScope)) return;
      console.error('Failed to update trip:', error);
      setTripError(`여행 정보를 수정하지 못했어요. ${classifyServerError(error).message}`);
    } finally {
      if (isCurrentTripScope(operationScope)) setIsSavingTrip(false);
    }
  };

  const handleDeleteTrip = async () => {
    if (isOffline) {
      toast.error(OFFLINE_READONLY_MESSAGE);
      return;
    }
    if (!trip || isDeletingTrip || !confirm('이 여행과 모든 일정, 준비물을 삭제하시겠습니까?')) return;
    const operationScope = captureTripScope();
    setIsDeletingTrip(true);
    try {
      const deleted = await deleteTripFromDB(trip.id, trip.coupleId);
      if (!isCurrentTripScope(operationScope)) return;
      if (!deleted) {
        toast.error('여행을 삭제하지 못했어요. 다시 시도해 주세요.');
        return;
      }
      toast.success('여행이 삭제되었습니다.');
      navigate('/trips');
    } catch (error) {
      if (!isCurrentTripScope(operationScope)) return;
      console.error('Failed to delete trip:', error);
      toast.error(`여행을 삭제하지 못했어요. ${classifyServerError(error).message}`);
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
    setItemDraft({
      title: item.title,
      category: item.category,
      startTime: item.startTime || '',
      memo: item.memo || '',
      url: item.url || '',
      address: item.address || '',
      businessHours: item.businessHours || '',
      source: item.source || 'manual',
      talkAbout: item.talkAbout === true,
    });
    setItemError(null);
    setShowItemModal(true);
  };

  const handlePlaceScreenshot = async (file?: File) => {
    if (!file || isReadingScreenshot) return;
    if (!file.type.startsWith('image/')) {
      setItemError('이미지 파일만 올릴 수 있어요.');
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setItemError('지도 캡처는 12MB 이하로 올려 주세요.');
      return;
    }
    setIsReadingScreenshot(true);
    setOcrProgress(0);
    setItemError(null);
    try {
      const place = await recognizePlaceScreenshot(file, setOcrProgress);
      setItemDraft((current) => ({
        ...current,
        title: place.title || current.title,
        address: place.address || current.address,
        businessHours: place.businessHours || current.businessHours,
        source: 'screenshot',
      }));
      if (!place.title && !place.address && !place.businessHours) {
        setItemError('글자를 충분히 읽지 못했어요. 아래 칸에 직접 입력해 주세요.');
      } else {
        toast.success('캡처에서 읽은 내용을 확인해 주세요. 틀린 부분은 바로 고칠 수 있어요.');
      }
    } catch (error) {
      console.error('Failed to read place screenshot:', error);
      setItemError('캡처를 읽지 못했어요. 직접 입력하거나 더 선명한 이미지로 다시 시도해 주세요.');
    } finally {
      setIsReadingScreenshot(false);
      setOcrProgress(0);
      if (screenshotInputRef.current) screenshotInputRef.current.value = '';
    }
  };

  const handleSaveItem = async () => {
    if (isOffline) {
      toast.error(OFFLINE_READONLY_MESSAGE);
      return;
    }
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
    const existing = editingItemId ? items.find((item) => item.id === editingItemId) : undefined;
    if (editingItemId && !existing) {
      setItemError('수정하려던 일정을 더 이상 찾을 수 없어요. 목록을 다시 확인해 주세요.');
      return;
    }
    const operationScope = captureTripScope();
    setIsSavingItem(true);
    setItemError(null);
    try {
      const input = {
        tripId: trip.id,
        itemDate: existing?.itemDate || activeDate,
        startTime: itemDraft.startTime || undefined,
        title: itemDraft.title.trim(),
        category: itemDraft.category,
        memo: itemDraft.memo.trim() || undefined,
        talkAbout: itemDraft.talkAbout,
        url: itemDraft.url.trim() || undefined,
        address: itemDraft.address.trim() || undefined,
        businessHours: itemDraft.businessHours.trim() || undefined,
        source: itemDraft.source,
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
    } catch (error) {
      if (!isCurrentTripScope(operationScope)) return;
      console.error('Failed to save trip item:', error);
      setItemError(`일정을 저장하지 못했어요. ${classifyServerError(error).message}`);
    } finally {
      if (isCurrentTripScope(operationScope)) setIsSavingItem(false);
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (isOffline) {
      toast.error(OFFLINE_READONLY_MESSAGE);
      return;
    }
    // The parent trip is the scope the delete is issued against, so it has to be
    // loaded and identified before anything is deleted.
    if (!trip || pendingItemIds.has(itemId)) return;
    const operationScope = captureTripScope();
    setItemPending(itemId, true);
    try {
      const deleted = await deleteTripItemFromDB(itemId, trip.id);
      if (!isCurrentTripScope(operationScope)) return;
      if (!deleted) {
        toast.error('일정을 삭제하지 못했어요.');
        return;
      }
      setItems((current) => current.filter((item) => item.id !== itemId));
      toast.success('일정이 삭제되었습니다.');
    } catch (error) {
      if (!isCurrentTripScope(operationScope)) return;
      console.error('Failed to delete trip item:', error);
      toast.error(`일정을 삭제하지 못했어요. ${classifyServerError(error).message}`);
    } finally {
      if (isCurrentTripScope(operationScope)) setItemPending(itemId, false);
    }
  };

  const handleMoveItem = async (index: number, direction: -1 | 1) => {
    if (isOffline) {
      toast.error(OFFLINE_READONLY_MESSAGE);
      return;
    }
    const targetIndex = index + direction;
    const moving = currentDayItems[index];
    const target = currentDayItems[targetIndex];
    if (!moving || !target || pendingItemIds.has(moving.id) || pendingItemIds.has(target.id)) return;
    const operationScope = captureTripScope();
    const movingOrder = moving.sortOrder;
    const targetOrder = target.sortOrder;
    const rollback = () => {
      setItems((current) => current.map((item) => {
        if (item.id === moving.id) return { ...item, sortOrder: movingOrder };
        if (item.id === target.id) return { ...item, sortOrder: targetOrder };
        return item;
      }));
    };
    setItems((current) => current.map((item) => {
      if (item.id === moving.id) return { ...item, sortOrder: targetOrder };
      if (item.id === target.id) return { ...item, sortOrder: movingOrder };
      return item;
    }));
    setItemPending(moving.id, true);
    setItemPending(target.id, true);
    try {
      const saved = await reorderTripItemsInDB([
        { id: moving.id, sortOrder: targetOrder },
        { id: target.id, sortOrder: movingOrder },
      ]);
      if (!isCurrentTripScope(operationScope)) return;
      if (!saved) {
        rollback();
        await loadChildren();
        if (!isCurrentTripScope(operationScope)) return;
        toast.error('순서를 저장하지 못해 서버의 최신 순서를 다시 불러왔어요.');
      }
    } catch (error) {
      if (!isCurrentTripScope(operationScope)) return;
      rollback();
      console.error('Failed to reorder trip items:', error);
      await loadChildren();
      if (!isCurrentTripScope(operationScope)) return;
      toast.error('연결 오류로 순서를 저장하지 못해 서버의 최신 순서를 다시 불러왔어요.');
    } finally {
      if (isCurrentTripScope(operationScope)) {
        setItemPending(moving.id, false);
        setItemPending(target.id, false);
      }
    }
  };

  const handleAddChecklist = async () => {
    if (isOffline) {
      toast.error(OFFLINE_READONLY_MESSAGE);
      return;
    }
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
    } catch (error) {
      if (!isCurrentTripScope(operationScope)) return;
      console.error('Failed to add trip checklist item:', error);
      setChildActionError(`준비물을 추가하지 못했어요. ${classifyServerError(error).message}`);
    } finally {
      if (isCurrentTripScope(operationScope)) setIsAddingChecklist(false);
    }
  };

  const handleToggleChecklist = async (item: TripChecklist) => {
    if (isOffline) {
      toast.error(OFFLINE_READONLY_MESSAGE);
      return;
    }
    if (pendingChecklistIds.has(item.id)) return;
    const operationScope = captureTripScope();
    const nextCompleted = !item.completed;
    setChildActionError(null);
    setChecklistPending(item.id, true);
    setChecklists((current) => current.map((entry) => entry.id === item.id ? { ...entry, completed: nextCompleted } : entry));
    try {
      const saved = await toggleTripChecklistInDB(item.id, nextCompleted, item.tripId);
      if (!isCurrentTripScope(operationScope)) return;
      if (!saved) {
        await loadChildren();
        if (!isCurrentTripScope(operationScope)) return;
        const message = '체크 상태를 저장하지 못해 서버의 최신 상태를 다시 확인했어요.';
        setChildActionError(message);
        toast.error(message);
      }
    } catch (error) {
      if (!isCurrentTripScope(operationScope)) return;
      console.error('Failed to toggle trip checklist item:', error);
      await loadChildren();
      if (!isCurrentTripScope(operationScope)) return;
      const message = '연결 오류로 체크 상태를 저장하지 못해 서버의 최신 상태를 다시 확인했어요.';
      setChildActionError(message);
      toast.error(message);
    } finally {
      if (isCurrentTripScope(operationScope)) setChecklistPending(item.id, false);
    }
  };

  const handleDeleteChecklist = async (checklistId: string) => {
    if (isOffline) {
      toast.error(OFFLINE_READONLY_MESSAGE);
      return;
    }
    if (!trip || pendingChecklistIds.has(checklistId)) return;
    const operationScope = captureTripScope();
    setChecklistPending(checklistId, true);
    setChildActionError(null);
    try {
      const deleted = await deleteTripChecklistFromDB(checklistId, trip.id);
      if (!isCurrentTripScope(operationScope)) return;
      if (!deleted) {
        setChildActionError('준비물을 삭제하지 못했어요.');
        return;
      }
      setChecklists((current) => current.filter((entry) => entry.id !== checklistId));
    } catch (error) {
      if (!isCurrentTripScope(operationScope)) return;
      console.error('Failed to delete trip checklist item:', error);
      setChildActionError(`준비물을 삭제하지 못했어요. ${classifyServerError(error).message}`);
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
        ? <><MapPin className="w-10 h-10 mx-auto text-muted-foreground" /><p className="font-bold">여행을 찾을 수 없어요</p><p className="text-caption text-muted-foreground">삭제되었거나 존재하지 않는 여행이에요.</p></>
        : visibleParentState === 'disconnected'
          ? <><Unlink className="w-10 h-10 mx-auto text-muted-foreground" /><p className="font-bold">우리 공간 연결이 필요해요</p><p className="text-caption text-muted-foreground">두 사람이 연결된 뒤 여행을 열 수 있어요.</p></>
          : visibleParentState === 'forbidden'
            ? <><ShieldAlert className="w-10 h-10 mx-auto text-warning" /><p className="font-bold">이 여행에 접근할 권한이 없어요</p></>
            : <><RefreshCw className="w-10 h-10 mx-auto text-muted-foreground" /><p className="font-bold">여행을 불러오지 못했어요</p><button onClick={() => void loadParent()} className="px-5 py-2.5 bg-coral-strong text-coral-strong-foreground rounded-xl font-bold text-label">다시 시도</button></>;
    return <MobileShell><div className="p-6 text-center mt-20 space-y-3">{content}<button onClick={() => navigate('/trips')} className="block mx-auto text-caption text-muted-foreground underline">여행 목록으로</button></div></MobileShell>;
  }

  return (
    <MobileShell>
      <div className="pb-28">
        <header className="bg-card border-b border-border px-5 py-4 flex items-center justify-between sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => navigate('/trips')} className="p-1 -ml-1 text-muted-foreground" aria-label="여행 목록"><ArrowLeft className="w-5 h-5" /></button>
            <h1 className="text-heading text-foreground truncate">{trip.title}</h1>
          </div>
          <div className="flex items-center">
            <button onClick={openTripEdit} disabled={isDeletingTrip || isOffline} className="p-2 text-muted-foreground disabled:opacity-40" aria-label="여행 수정"><Pencil className="w-4 h-4" /></button>
            <button onClick={() => void handleDeleteTrip()} disabled={isDeletingTrip || isOffline} className="p-2 -mr-2 text-destructive disabled:opacity-40" aria-label="여행 삭제"><Trash2 className="w-5 h-5" /></button>
          </div>
        </header>

        <div className="bg-coral/10 border-b border-coral/20 px-5 py-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-coral-strong font-bold text-label"><Calendar className="w-4 h-4" /><span>{formatLocalDate(trip.startDate)} ~ {formatLocalDate(trip.endDate)}</span></div>
            <span className="text-caption font-bold px-2.5 py-1 rounded-full bg-coral-strong text-coral-strong-foreground shrink-0">{dates.length}일간</span>
          </div>
          <button onClick={() => navigate(`/record?from=${trip.startDate}&to=${trip.endDate}&trip=${trip.id}`)} className="w-full py-2.5 px-3 rounded-2xl bg-card border border-coral/30 text-coral-strong font-bold text-label flex items-center justify-center gap-1.5 shadow-sm"><PenTool size={14} />이 여행 기간의 추억 보기·남기기</button>
        </div>

        <div className="flex border-b border-border bg-card">
          <button onClick={() => setActiveTab('schedule')} className={`flex-1 py-3 text-label font-bold border-b-2 ${activeTab === 'schedule' ? 'border-coral text-coral' : 'border-transparent text-muted-foreground'}`}>일정 ({items.length})</button>
          <button onClick={() => setActiveTab('checklist')} className={`flex-1 py-3 text-label font-bold border-b-2 ${activeTab === 'checklist' ? 'border-coral text-coral' : 'border-transparent text-muted-foreground'}`}>준비물 ({checklists.length})</button>
        </div>

        {childState !== 'ready' ? (
          <div className="p-8 text-center space-y-3">
            {childState === 'loading' ? <LoaderCircle className="w-7 h-7 animate-spin text-coral mx-auto" /> : <><p className="font-bold text-body">{childState === 'forbidden' ? '일정과 준비물을 볼 권한이 없어요.' : '일정과 준비물을 불러오지 못했어요.'}</p><button onClick={() => void loadChildren()} className="px-4 py-2 bg-coral-strong text-coral-strong-foreground rounded-xl text-label font-bold">다시 시도</button></>}
          </div>
        ) : activeTab === 'schedule' ? (
          <>
            <div className="bg-card border-b border-border px-2 flex overflow-x-auto no-scrollbar">
              {dates.map((date, index) => <button key={date} onClick={() => setActiveDayIndex(index)} className={`px-4 py-3 text-label font-bold whitespace-nowrap border-b-2 ${activeDayIndex === index ? 'border-navy text-foreground' : 'border-transparent text-muted-foreground'}`}>{index + 1}일차 <span className="font-normal">({date.slice(5)})</span></button>)}
            </div>
            <div className="p-5">
              {currentDayItems.length === 0 ? (
                <div className="bg-card border border-dashed border-border rounded-2xl p-8 text-center"><MapPin className="w-8 h-8 text-muted-foreground mx-auto mb-2" /><p className="text-body font-bold">직접 장소나 할 일을 추가해 보세요.</p></div>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-2xl bg-coral/5 border border-coral/20 px-4 py-3 flex items-center gap-2 text-caption">
                    <MapPin className="w-4 h-4 text-coral shrink-0" />
                    <span><strong>{currentDayItems.length}개 장소 시간표</strong> · 시간을 넣으면 자동으로 시간순으로 정리돼요. 시간 없는 장소는 화살표로 순서를 정해요.</span>
                  </div>
                  {currentDayItems.map((item, index) => {
                    const pending = pendingItemIds.has(item.id);
                    const mapQuery = [item.title, item.address].filter(Boolean).join(' ');
                    return <div key={item.id} className="relative bg-card border border-border rounded-2xl p-4 shadow-sm flex gap-3">
                      <div className="w-6 h-6 rounded-full bg-coral-strong text-coral-strong-foreground text-caption font-bold flex items-center justify-center shrink-0">{index + 1}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2"><h3 className="text-label font-bold truncate">{item.title}</h3><span className="text-caption px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{item.startTime || '시간 미정'} · {CATEGORY_OPTIONS.find((option) => option.value === item.category)?.label}</span>{item.url && <a href={item.url} target="_blank" rel="noreferrer" aria-label="링크 열기"><ExternalLink className="w-3.5 h-3.5 text-coral" /></a>}</div>
                        {item.address && <p className="text-caption text-foreground mt-1 flex items-start gap-1"><MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-coral" />{item.address}</p>}
                        {item.businessHours && <p className="text-caption text-muted-foreground mt-1 whitespace-pre-wrap">영업시간 · {item.businessHours}</p>}
                        {item.memo && <p className="mt-2 rounded-xl bg-info/5 px-2.5 py-2 text-body text-foreground whitespace-pre-wrap"><strong className="text-caption text-info">함께 볼 메모</strong><br />{item.memo}</p>}
                        {item.talkAbout && <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-coral/10 px-2 py-1 text-caption font-bold text-coral-strong"><MessageCircleHeart className="w-3 h-3" />통화 때 꼭 얘기</p>}
                        <div className="flex gap-1 mt-2">
                          <button onClick={() => void handleMoveItem(index, -1)} disabled={Boolean(item.startTime) || index === 0 || pending || isOffline} title={item.startTime ? '시간을 바꾸면 순서가 바뀌어요.' : undefined} className="p-1.5 text-muted-foreground disabled:opacity-25" aria-label="위로 이동"><ArrowUp className="w-4 h-4" /></button>
                          <button onClick={() => void handleMoveItem(index, 1)} disabled={Boolean(item.startTime) || index === currentDayItems.length - 1 || pending || isOffline} title={item.startTime ? '시간을 바꾸면 순서가 바뀌어요.' : undefined} className="p-1.5 text-muted-foreground disabled:opacity-25" aria-label="아래로 이동"><ArrowDown className="w-4 h-4" /></button>
                          <button onClick={() => openEditItem(item)} disabled={pending || isOffline} className="p-1.5 text-muted-foreground disabled:opacity-25" aria-label="일정 수정"><Pencil className="w-4 h-4" /></button>
                          <button onClick={() => void handleDeleteItem(item.id)} disabled={pending || isOffline} className="p-1.5 text-destructive disabled:opacity-25" aria-label="일정 삭제"><Trash2 className="w-4 h-4" /></button>
                          {mapQuery && <a href={`https://map.naver.com/p/search/${encodeURIComponent(mapQuery)}`} target="_blank" rel="noreferrer" className="ml-auto px-2.5 py-1.5 rounded-lg bg-success-surface text-foreground text-caption font-bold">네이버 지도</a>}
                        </div>
                      </div>
                    </div>;
                  })}
                </div>
              )}
            </div>
            <button onClick={openNewItem} className="fixed bottom-6 right-5 w-14 h-14 bg-coral-strong rounded-full flex items-center justify-center text-coral-strong-foreground shadow-lg z-40" aria-label="일정 추가"><Plus className="w-7 h-7" /></button>
          </>
        ) : (
          <div className="p-5 space-y-4">
            <div className="flex gap-2"><input value={newChecklistName} onChange={(event) => setNewChecklistName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void handleAddChecklist(); }} placeholder="새 준비물 추가" disabled={isAddingChecklist} className="flex-1 bg-card border border-border rounded-xl px-4 py-3 text-body outline-none focus:border-coral disabled:opacity-50" /><button onClick={() => void handleAddChecklist()} disabled={isAddingChecklist || !newChecklistName.trim() || isOffline} className="px-4 bg-coral-strong text-coral-strong-foreground font-bold text-label rounded-xl disabled:opacity-40">{isAddingChecklist ? '추가 중' : '추가'}</button></div>
            {childActionError && <p className="text-caption text-destructive" role="alert">{childActionError}</p>}
            <div className="space-y-2">
              {checklists.map((item) => {
                const pending = pendingChecklistIds.has(item.id);
                return <div key={item.id} className="bg-card border border-border p-3.5 rounded-2xl flex items-center justify-between text-label font-semibold">
                  <button onClick={() => void handleToggleChecklist(item)} disabled={pending || isOffline} className="flex items-center gap-2 text-left disabled:opacity-50">{item.completed ? <CheckSquare className="w-5 h-5 text-coral" /> : <Square className="w-5 h-5 text-muted-foreground" />}<span className={item.completed ? 'line-through text-muted-foreground' : ''}>{item.itemName}</span></button>
                  <button onClick={() => void handleDeleteChecklist(item.id)} disabled={pending || isOffline} className="text-muted-foreground hover:text-destructive p-1 disabled:opacity-40" aria-label="준비물 삭제"><Trash2 className="w-4 h-4" /></button>
                </div>;
              })}
              {checklists.length === 0 && <div className="bg-card border border-dashed border-border rounded-2xl p-6 text-center text-caption text-muted-foreground">함께 준비할 짐이나 할 일을 작성해 보세요.</div>}
            </div>
          </div>
        )}

        {/*
          Both sheets below are z-[60], not z-50: MobileShell's tab bar is
          `fixed bottom-0 ... z-50` and comes after <main> in the DOM, so at an
          equal z-index it paints over a bottom-anchored sheet and intercepts the
          taps aimed at its 취소 / 저장 buttons.
        */}
        {showTripModal && <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center sm:p-5"><div className="bg-card w-full max-w-md rounded-t-3xl sm:rounded-surface p-6"><h2 className="text-heading mb-4">여행 정보 수정</h2><div className="space-y-3 text-caption">
          <label className="block font-bold">여행 이름<input value={tripDraft.title} onChange={(event) => setTripDraft((current) => ({ ...current, title: event.target.value }))} className="mt-1 w-full bg-background border border-border rounded-xl px-4 py-3" /></label>
          <div className="flex gap-2"><label className="flex-1 font-bold">가는 날<input type="date" value={tripDraft.startDate} onChange={(event) => setTripDraft((current) => ({ ...current, startDate: event.target.value }))} className="mt-1 w-full bg-background border border-border rounded-xl px-2 py-3" /></label><label className="flex-1 font-bold">오는 날<input type="date" min={tripDraft.startDate} value={tripDraft.endDate} onChange={(event) => setTripDraft((current) => ({ ...current, endDate: event.target.value }))} className="mt-1 w-full bg-background border border-border rounded-xl px-2 py-3" /></label></div>
          <label className="block font-bold">상태<select value={tripDraft.status} onChange={(event) => setTripDraft((current) => ({ ...current, status: event.target.value as TripStatus }))} className="mt-1 w-full bg-background border border-border rounded-xl px-4 py-3">{STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          {tripError && <p className="text-destructive" role="alert">{tripError}</p>}
        </div><div className="flex gap-3 mt-6"><button onClick={() => setShowTripModal(false)} disabled={isSavingTrip || isOffline} className="flex-1 bg-muted py-3 rounded-xl font-bold">취소</button><button onClick={() => void handleSaveTrip()} disabled={isSavingTrip || isOffline} className="flex-1 bg-coral-strong text-coral-strong-foreground py-3 rounded-xl font-bold disabled:opacity-50">{isSavingTrip ? '저장 중' : '저장'}</button></div></div></div>}

        {showItemModal && <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center sm:p-5"><div className="bg-card w-full max-w-md rounded-t-3xl sm:rounded-surface p-6"><h2 className="text-heading mb-4">{editingItemId ? '일정 수정' : `${activeDayIndex + 1}일차 일정 추가`}</h2><div className="space-y-3 text-caption">
          {!editingItemId && <div className="rounded-2xl border border-dashed border-coral/40 bg-coral/5 p-3">
            <input ref={screenshotInputRef} type="file" accept="image/*" className="sr-only" onChange={(event) => void handlePlaceScreenshot(event.target.files?.[0])} />
            <button type="button" onClick={() => screenshotInputRef.current?.click()} disabled={isReadingScreenshot || isSavingItem} className="w-full min-h-[44px] flex items-center justify-center gap-2 font-bold text-coral disabled:opacity-50">
              <ImagePlus className="w-4 h-4" />
              {isReadingScreenshot ? `캡처 읽는 중 ${Math.round(ocrProgress * 100)}%` : '네이버 지도 캡처에서 불러오기'}
            </button>
            <p className="text-caption text-muted-foreground text-center">이미지는 서버에 올리지 않고 이 기기에서만 글자를 읽어요.</p>
          </div>}
          <label className="block font-bold">장소 또는 제목 *<input value={itemDraft.title} onChange={(event) => setItemDraft((current) => ({ ...current, title: event.target.value }))} placeholder="직접 입력해 주세요" className="mt-1 w-full bg-background border border-border rounded-xl px-4 py-3" /></label>
          <label className="block font-bold">방문 시간 (선택)<input type="time" value={itemDraft.startTime} onChange={(event) => setItemDraft((current) => ({ ...current, startTime: event.target.value }))} className="mt-1 w-full bg-background border border-border rounded-xl px-4 py-3" /></label>
          <fieldset><legend className="font-bold mb-1">분류</legend><div className="grid grid-cols-4 gap-1">{CATEGORY_OPTIONS.map((option) => <button key={option.value} type="button" onClick={() => setItemDraft((current) => ({ ...current, category: option.value }))} className={`py-2 rounded-xl border ${itemDraft.category === option.value ? 'bg-coral-strong text-coral-strong-foreground border-coral-strong' : 'border-border'}`}>{option.label}</button>)}</div></fieldset>
          <label className="block font-bold">링크 (선택)<input type="url" value={itemDraft.url} onChange={(event) => setItemDraft((current) => ({ ...current, url: event.target.value }))} placeholder="https://" className="mt-1 w-full bg-background border border-border rounded-xl px-4 py-3" /></label>
          <label className="block font-bold">주소 (선택)<input value={itemDraft.address} onChange={(event) => setItemDraft((current) => ({ ...current, address: event.target.value, source: current.source === 'screenshot' ? 'screenshot' : 'manual' }))} placeholder="예: 서울 마포구 연남로 1" maxLength={300} className="mt-1 w-full bg-background border border-border rounded-xl px-4 py-3" /></label>
          <label className="block font-bold">영업시간 (선택)<textarea value={itemDraft.businessHours} onChange={(event) => setItemDraft((current) => ({ ...current, businessHours: event.target.value }))} rows={2} maxLength={500} placeholder="예: 매일 11:00~21:00" className="mt-1 w-full bg-background border border-border rounded-xl px-4 py-3 resize-none" /></label>
          <label className="block font-bold">함께 볼 메모 (선택)<textarea value={itemDraft.memo} onChange={(event) => setItemDraft((current) => ({ ...current, memo: event.target.value }))} rows={3} placeholder="예: 예약 필요 · 비 오면 다른 곳으로 · 여기서 사진 찍기" className="mt-1 w-full bg-background border border-border rounded-xl px-4 py-3 resize-none" /></label>
          <label className="flex items-center gap-2 rounded-xl bg-coral/5 px-3 py-3 font-bold text-coral"><input type="checkbox" checked={itemDraft.talkAbout} onChange={(event) => setItemDraft((current) => ({ ...current, talkAbout: event.target.checked }))} className="accent-coral" />통화 때 꼭 얘기</label>
          {itemError && <p className="text-destructive" role="alert">{itemError}</p>}
        </div><div className="flex gap-3 mt-6"><button onClick={() => setShowItemModal(false)} disabled={isSavingItem || isReadingScreenshot || isOffline} className="flex-1 bg-muted py-3 rounded-xl font-bold">취소</button><button onClick={() => void handleSaveItem()} disabled={isSavingItem || isReadingScreenshot || isOffline} className="flex-1 bg-coral-strong text-coral-strong-foreground py-3 rounded-xl font-bold disabled:opacity-50">{isSavingItem ? '저장 중' : '저장'}</button></div></div></div>}
      </div>
    </MobileShell>
  );
}
