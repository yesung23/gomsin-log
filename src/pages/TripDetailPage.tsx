import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowDown, ArrowUp, Calendar, GripVertical, CheckCircle2, Circle, ExternalLink, ImagePlus, MapPin, MessageCircleHeart, PenTool, Pencil, RefreshCw, ShieldAlert, Trash2, Unlink,
} from 'lucide-react';
import { toast } from 'sonner';
import { useOnlineStatus, OFFLINE_READONLY_MESSAGE } from '@/lib/useOnlineStatus';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { SheetHandle } from '@/components/ui/SheetHandle';
import { useSheetDrag } from '@/lib/useSheetDrag';
import { MobileShell } from '@/components/MobileShell';
import { AppBar, AppBarAction } from '@/components/ui/AppBar';
import { Badge } from '@/components/ui/Badge';
import { reorderByIds } from '@/lib/reorderList';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { ListRow, RowGroup } from '@/components/ui/List';
import { supabase } from '@/lib/supabase';
import { classifyServerError } from '@/lib/serverErrors';
import { inferPlaceCategory, recognizePlaceScreenshot } from '@/lib/placeOcr';
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
import { useEscapeKey } from '@/lib/hooks';
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

  /*
    Drag-to-dismiss for both sheets.

    Each is disabled while its own save is in flight, for the same reason Escape
    already is: the sheet is where that write reports back, so a swipe that took it
    away mid-save would hide the outcome rather than cancel it.
  */
  const tripSheet = useSheetDrag({
    onDismiss: () => setShowTripModal(false),
    enabled: !isSavingTrip,
  });
  const itemSheet = useSheetDrag({
    onDismiss: () => { setShowItemModal(false); setEditingItemId(null); },
    enabled: !isSavingItem,
  });
  const [isReadingScreenshot, setIsReadingScreenshot] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const screenshotInputRef = useRef<HTMLInputElement>(null);
  const quickScreenshotInputRef = useRef<HTMLInputElement>(null);
  const [pendingItemIds, setPendingItemIds] = useState<Set<string>>(new Set());
  const [newChecklistName, setNewChecklistName] = useState('');
  const [isAddingChecklist, setIsAddingChecklist] = useState(false);
  const [pendingChecklistIds, setPendingChecklistIds] = useState<Set<string>>(new Set());
  const [childActionError, setChildActionError] = useState<string | null>(null);

  useEscapeKey(() => {
    if (showItemModal && !isSavingItem && !isReadingScreenshot) {
      setShowItemModal(false);
      return;
    }
    if (showTripModal && !isSavingTrip) setShowTripModal(false);
  }, showItemModal || showTripModal);

  useLayoutEffect(() => {
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
    if (!userId) { setTrip(null); setParentState('forbidden'); return; }
    if (!activeCouple || !coupleId) { setTrip(null); setItems([]); setChecklists([]); setParentState('disconnected'); return; }
    if (!id) { setTrip(null); setParentState('not-found'); return; }
    setParentState('loading');
    const loadGeneration = ++parentLoadGenerationRef.current;
    const requestScope = captureTripScope();
    const globalSnapshot = latestGlobalTripsRef.current;
    try {
      const result = await fetchTripResultFromDB(id);
      if (!isCurrentTripScope(requestScope) || parentLoadGenerationRef.current !== loadGeneration) return;
      if (latestGlobalTripsRef.current !== globalSnapshot) {
        const updated = latestGlobalTripsRef.current.find((entry) => entry.id === id && entry.coupleId === coupleId);
        parentGlobalSnapshotRef.current = latestGlobalTripsRef.current;
        if (!updated) { setTrip(null); setParentState('not-found'); return; }
        setTrip(updated);
        setParentState('ready');
        return;
      }
      if (!result.ok) { setParentState(result.reason === 'forbidden' ? 'forbidden' : 'error'); return; }
      if (!result.trip || result.trip.coupleId !== coupleId) { setTrip(null); setParentState('not-found'); return; }
      parentGlobalSnapshotRef.current = latestGlobalTripsRef.current;
      setTrip(result.trip);
      setParentState('ready');
    } catch (error) {
      if (!isCurrentTripScope(requestScope) || parentLoadGenerationRef.current !== loadGeneration) return;
      console.error('[gomsinlog] Failed to load trip.');
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
      if (!isCurrentTripScope(requestScope) || childLoadGenerationRef.current !== loadGeneration) return;
      if (!itemResult.ok || !checklistResult.ok) {
        const forbidden = (!itemResult.ok && itemResult.reason === 'forbidden') || (!checklistResult.ok && checklistResult.reason === 'forbidden');
        setChildState(forbidden ? 'forbidden' : 'error');
        return;
      }
      setItems(itemResult.items);
      setChecklists(checklistResult.checklists);
      setChildState('ready');
    } catch (error) {
      if (!isCurrentTripScope(requestScope) || childLoadGenerationRef.current !== loadGeneration) return;
      console.error('[gomsinlog] Failed to load trip details.');
      setChildState('error');
    }
  }, [activeCouple, captureTripScope, id, isCurrentTripScope]);

  useEffect(() => { void loadParent(); }, [loadParent]);

  useEffect(() => {
    const previousSnapshot = parentGlobalSnapshotRef.current;
    if (parentState !== 'ready' || !id || !coupleId || previousSnapshot === null || previousSnapshot === state.trips) return;
    parentGlobalSnapshotRef.current = state.trips;
    const updated = state.trips.find((entry) => entry.id === id && entry.coupleId === coupleId);
    if (!updated) { setTrip(null); setItems([]); setChecklists([]); setParentState('not-found'); return; }
    setTrip(updated);
  }, [coupleId, id, parentState, state.trips]);

  useEffect(() => { if (parentState === 'ready') void loadChildren(); }, [loadChildren, parentState]);

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

  const dates = useMemo(() => trip ? inclusiveTripDates(trip.startDate, trip.endDate) : [], [trip]);
  const activeDate = dates[activeDayIndex] || dates[0];
  const currentDayItems = useMemo(
    () => items.filter((item) => item.itemDate === activeDate)
      .sort((a, b) => (a.startTime || '99:99').localeCompare(b.startTime || '99:99') || a.sortOrder - b.sortOrder || a.title.localeCompare(b.title)),
    [activeDate, items],
  );

  useEffect(() => { if (activeDayIndex >= dates.length) setActiveDayIndex(0); }, [activeDayIndex, dates.length]);

  const setItemPending = (itemId: string, pending: boolean) => {
    setPendingItemIds((current) => { const next = new Set(current); if (pending) next.add(itemId); else next.delete(itemId); return next; });
  };
  const setChecklistPending = (checklistId: string, pending: boolean) => {
    setPendingChecklistIds((current) => { const next = new Set(current); if (pending) next.add(checklistId); else next.delete(checklistId); return next; });
  };


  const openTripEdit = () => {
    if (!trip) return;
    setTripDraft({ title: trip.title, startDate: trip.startDate, endDate: trip.endDate, status: trip.status });
    setTripError(null);
    setShowTripModal(true);
  };

  const handleSaveTrip = async () => {
    if (isOffline) { toast.error(OFFLINE_READONLY_MESSAGE); return; }
    if (!trip || isSavingTrip) return;
    const validationError = validateTripDraft(tripDraft) || validateTripRangeAgainstItems(tripDraft, items);
    if (validationError) { setTripError(validationError); return; }
    const operationScope = captureTripScope();
    setIsSavingTrip(true);
    setTripError(null);
    try {
      const saved = await updateTripInDB(trip.id, { title: tripDraft.title.trim(), startDate: tripDraft.startDate, endDate: tripDraft.endDate, status: tripDraft.status }, trip.coupleId);
      if (!isCurrentTripScope(operationScope)) return;
      if (!saved) { setTripError('여행 정보를 수정하지 못했어요. 다시 시도해 주세요.'); return; }
      setTrip(saved);
      setShowTripModal(false);
      toast.success('여행 정보가 수정되었습니다.');
    } catch (error) {
      if (!isCurrentTripScope(operationScope)) return;
      console.error('[gomsinlog] Failed to update trip.');
      setTripError(`여행 정보를 수정하지 못했어요. ${classifyServerError(error).message}`);
    } finally {
      if (isCurrentTripScope(operationScope)) setIsSavingTrip(false);
    }
  };

  const handleDeleteTrip = async () => {
    if (isOffline) { toast.error(OFFLINE_READONLY_MESSAGE); return; }
    if (!trip || isDeletingTrip || !confirm('이 여행과 모든 일정, 준비물을 삭제하시겠습니까?')) return;
    const operationScope = captureTripScope();
    setIsDeletingTrip(true);
    try {
      const deleted = await deleteTripFromDB(trip.id, trip.coupleId);
      if (!isCurrentTripScope(operationScope)) return;
      if (!deleted) { toast.error('여행을 삭제하지 못했어요. 다시 시도해 주세요.'); return; }
      toast.success('여행이 삭제되었습니다.');
      navigate('/trips');
    } catch (error) {
      if (!isCurrentTripScope(operationScope)) return;
      console.error('[gomsinlog] Failed to delete trip.');
      toast.error(`여행을 삭제하지 못했어요. ${classifyServerError(error).message}`);
    } finally {
      if (isCurrentTripScope(operationScope)) setIsDeletingTrip(false);
    }
  };

  const openNewItem = () => { setEditingItemId(null); setItemDraft(EMPTY_ITEM); setItemError(null); setShowItemModal(true); };
  const openEditItem = (item: TripItem) => {
    setEditingItemId(item.id);
    setItemDraft({
      title: item.title, category: item.category, startTime: item.startTime || '',
      memo: item.memo || '', url: item.url || '', address: item.address || '',
      businessHours: item.businessHours || '', source: item.source || 'manual', talkAbout: item.talkAbout === true,
    });
    setItemError(null);
    setShowItemModal(true);
  };

  const validateScreenshot = (file?: File): string | null => {
    if (!file) return '사진을 선택해 주세요.';
    if (!file.type.startsWith('image/')) return '이미지 파일만 선택할 수 있어요.';
    if (file.size > 12 * 1024 * 1024) return '지도 캡처는 12MB 이하로 선택해 주세요.';
    return null;
  };

  const openDraftEditor = (draft: ItemDraft, message: string | null = null) => {
    setEditingItemId(null);
    setItemDraft(draft);
    setItemError(message);
    setShowItemModal(true);
  };

  /**
   * The primary trip-planning path: choose one capture and OCR it locally. The
   * screenshot itself never leaves the device, and recognized text remains a
   * draft until the user reviews it and explicitly presses Save.
   */
  const handleQuickPlaceScreenshot = async (file?: File) => {
    const validationError = validateScreenshot(file);
    if (validationError) {
      if (file) toast.error(validationError);
      return;
    }
    if (!file || !trip || !activeDate || isReadingScreenshot || isSavingItem) return;
    if (isOffline) { toast.error(OFFLINE_READONLY_MESSAGE); return; }

    const operationScope = captureTripScope();
    setIsReadingScreenshot(true);
    setOcrProgress(0);
    setItemError(null);
    try {
      const place = await recognizePlaceScreenshot(file, setOcrProgress);
      if (!isCurrentTripScope(operationScope)) return;
      const draft: ItemDraft = {
        ...EMPTY_ITEM,
        title: place.title,
        address: place.address,
        businessHours: place.businessHours,
        category: inferPlaceCategory(place.rawText),
        source: 'screenshot',
      };
      if (!place.title) {
        openDraftEditor(draft, '장소 이름을 충분히 읽지 못했어요. 이름만 확인해 주세요.');
        return;
      }
      openDraftEditor(draft);
      toast.success('캡처에서 읽은 내용을 확인한 뒤 저장해 주세요.');
    } catch (error) {
      if (!isCurrentTripScope(operationScope)) return;
      console.error('[gomsinlog] Failed to quick-add place screenshot.');
      openDraftEditor(
        { ...EMPTY_ITEM, source: 'screenshot' },
        '사진을 읽지 못했어요. 장소 이름을 입력하고 저장해 주세요.',
      );
    } finally {
      if (isCurrentTripScope(operationScope)) {
        setIsReadingScreenshot(false);
        setIsSavingItem(false);
        setOcrProgress(0);
      }
      if (quickScreenshotInputRef.current) quickScreenshotInputRef.current.value = '';
    }
  };

  const handlePlaceScreenshot = async (file?: File) => {
    if (!file || isReadingScreenshot) return;
    const validationError = validateScreenshot(file);
    if (validationError) { setItemError(validationError); return; }
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
      console.error('[gomsinlog] Failed to read place screenshot.');
      setItemError('캡처를 읽지 못했어요. 직접 입력하거나 더 선명한 이미지로 다시 시도해 주세요.');
    } finally {
      setIsReadingScreenshot(false);
      setOcrProgress(0);
      if (screenshotInputRef.current) screenshotInputRef.current.value = '';
    }
  };

  const handleSaveItem = async () => {
    if (isOffline) { toast.error(OFFLINE_READONLY_MESSAGE); return; }
    if (!trip || !activeDate || isSavingItem) return;
    if (!itemDraft.title.trim()) { setItemError('장소 또는 제목을 입력해 주세요.'); return; }
    const urlError = validateTripItemUrl(itemDraft.url);
    if (urlError) { setItemError(urlError); return; }
    const existing = editingItemId ? items.find((item) => item.id === editingItemId) : undefined;
    if (editingItemId && !existing) { setItemError('수정하려던 일정을 더 이상 찾을 수 없어요. 목록을 다시 확인해 주세요.'); return; }
    const operationScope = captureTripScope();
    setIsSavingItem(true);
    setItemError(null);
    try {
      const input = {
        tripId: trip.id, itemDate: existing?.itemDate || activeDate,
        startTime: itemDraft.startTime || undefined, title: itemDraft.title.trim(),
        category: itemDraft.category, memo: itemDraft.memo.trim() || undefined,
        talkAbout: itemDraft.talkAbout, url: itemDraft.url.trim() || undefined,
        address: itemDraft.address.trim() || undefined, businessHours: itemDraft.businessHours.trim() || undefined,
        source: itemDraft.source, sortOrder: existing?.sortOrder ?? currentDayItems.length,
      };
      const saved = existing ? await updateTripItemInDB({ id: existing.id, ...input }) : await saveTripItemToDB(input);
      if (!isCurrentTripScope(operationScope)) return;
      if (!saved) { setItemError('일정을 저장하지 못했어요. 다시 시도해 주세요.'); return; }
      setItems((current) => existing ? current.map((item) => item.id === saved.id ? saved : item) : [...current, saved]);
      setShowItemModal(false);
      toast.success(existing ? '일정이 수정되었습니다.' : '일정이 추가되었습니다.');
    } catch (error) {
      if (!isCurrentTripScope(operationScope)) return;
      console.error('[gomsinlog] Failed to save trip item.');
      setItemError(`일정을 저장하지 못했어요. ${classifyServerError(error).message}`);
    } finally {
      if (isCurrentTripScope(operationScope)) setIsSavingItem(false);
    }
  };

  const handleDeleteItem = async (itemId: string) => {
    if (isOffline) { toast.error(OFFLINE_READONLY_MESSAGE); return; }
    if (!trip || pendingItemIds.has(itemId)) return;
    const operationScope = captureTripScope();
    setItemPending(itemId, true);
    try {
      const deleted = await deleteTripItemFromDB(itemId, trip.id);
      if (!isCurrentTripScope(operationScope)) return;
      if (!deleted) { toast.error('일정을 삭제하지 못했어요.'); return; }
      setItems((current) => current.filter((item) => item.id !== itemId));
      toast.success('일정이 삭제되었습니다.');
    } catch (error) {
      if (!isCurrentTripScope(operationScope)) return;
      console.error('[gomsinlog] Failed to delete trip item.');
      toast.error(`일정을 삭제하지 못했어요. ${classifyServerError(error).message}`);
    } finally {
      if (isCurrentTripScope(operationScope)) setItemPending(itemId, false);
    }
  };

  /*
    ## 끌어 옮기기 (2026-08-23)

    화살표 둘로도 순서는 바뀌었지만, 다섯 번째를 첫째로 올리려면 네 번 눌러야 하고 그
    사이 네 번의 쓰기가 나간다. 요청은 "쉽게 바꿀 수 있도록" 이었다.

    ### 왜 좌표로 찾는가

    터치에서 `pointerdown` 이 일어난 요소로 포인터가 **암묵적으로 캡처된다.** 손가락이
    다른 줄로 옮겨가도 이벤트의 target 은 처음 줄이고, 그 줄의 `onPointerEnter` 는 영영
    오지 않는다. 마우스로는 되고 폰에서는 안 되는, 정확히 이 앱의 대상에서만 죽는
    코드다. 달력이 같은 함정을 이미 밟았고 같은 방법으로 나왔다.

    ### 시간이 박힌 줄은 끌 수 없다

    시간이 있으면 순서는 시간이 정한다. 끌어서 옮기면 화면과 저장된 값이 어긋나거나,
    사용자가 방금 넣은 시간을 앱이 무시하는 것이 된다.

    ### 저장은 놓을 때 한 번

    끄는 동안에는 화면만 움직인다. 지나가는 자리마다 쓰면 한 번 끌 때 열 번이 나가고,
    중간에 실패하면 되돌릴 지점이 어디인지 아무도 모른다.
  */
  const [dragItemId, setDragItemId] = useState<string | null>(null);
  /** 끄는 동안의 순서. 아이디만 들고 있다가 놓을 때 자리 값에 배분한다. */
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const dragOrderRef = useRef<string[] | null>(null);

  const rowIndexUnder = (x: number, y: number): number | null => {
    const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-trip-row]');
    if (!row) return null;
    const parsed = Number.parseInt(row.dataset.tripRow ?? '', 10);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const onDragStart = (itemId: string) => (event: React.PointerEvent) => {
    event.preventDefault();
    const ids = currentDayItems.map((item) => item.id);
    dragOrderRef.current = ids;
    setDragOrder(ids);
    setDragItemId(itemId);
  };

  const onDragMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragItemId || !dragOrderRef.current) return;
    const index = rowIndexUnder(event.clientX, event.clientY);
    if (index === null) return;
    const ids = dragOrderRef.current;
    const at = ids.indexOf(dragItemId);
    if (at === -1 || at === index || index >= ids.length) return;
    const next = [...ids];
    next.splice(index, 0, next.splice(at, 1)[0]);
    dragOrderRef.current = next;
    setDragOrder(next);
  };

  const onDragEnd = async () => {
    const finalIds = dragOrderRef.current;
    dragOrderRef.current = null;
    setDragItemId(null);
    setDragOrder(null);
    if (!finalIds) return;

    const changes = reorderByIds(currentDayItems, finalIds);
    if (changes.length === 0) return;

    const operationScope = captureTripScope();
    const before = new Map(currentDayItems.map((item) => [item.id, item.sortOrder]));
    const rollback = () => setItems((current) => current.map((item) => (
      before.has(item.id) ? { ...item, sortOrder: before.get(item.id)! } : item
    )));
    const next = new Map(changes.map((change) => [change.id, change.sortOrder]));
    setItems((current) => current.map((item) => (
      next.has(item.id) ? { ...item, sortOrder: next.get(item.id)! } : item
    )));
    for (const change of changes) setItemPending(change.id, true);
    try {
      const saved = await reorderTripItemsInDB(changes);
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
      console.error('[gomsinlog] Failed to reorder trip items.');
      await loadChildren();
      if (!isCurrentTripScope(operationScope)) return;
      toast.error('연결 오류로 순서를 저장하지 못해 서버의 최신 순서를 다시 불러왔어요.');
    } finally {
      if (isCurrentTripScope(operationScope)) {
        for (const change of changes) setItemPending(change.id, false);
      }
    }
  };

  /** 화면이 그리는 순서. 끄는 동안에는 미리보기, 아니면 저장된 순서. */
  const displayDayItems = useMemo(() => {
    if (!dragOrder) return currentDayItems;
    const byId = new Map(currentDayItems.map((item) => [item.id, item]));
    const ordered = dragOrder.map((id) => byId.get(id)).filter(Boolean) as typeof currentDayItems;
    return ordered.length === currentDayItems.length ? ordered : currentDayItems;
  }, [currentDayItems, dragOrder]);

  const handleMoveItem = async (index: number, direction: -1 | 1) => {
    if (isOffline) { toast.error(OFFLINE_READONLY_MESSAGE); return; }
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
      const saved = await reorderTripItemsInDB([{ id: moving.id, sortOrder: targetOrder }, { id: target.id, sortOrder: movingOrder }]);
      if (!isCurrentTripScope(operationScope)) return;
      if (!saved) { rollback(); await loadChildren(); if (!isCurrentTripScope(operationScope)) return; toast.error('순서를 저장하지 못해 서버의 최신 순서를 다시 불러왔어요.'); }
    } catch (error) {
      if (!isCurrentTripScope(operationScope)) return;
      rollback();
      console.error('[gomsinlog] Failed to reorder trip items.');
      await loadChildren();
      if (!isCurrentTripScope(operationScope)) return;
      toast.error('연결 오류로 순서를 저장하지 못해 서버의 최신 순서를 다시 불러왔어요.');
    } finally {
      if (isCurrentTripScope(operationScope)) { setItemPending(moving.id, false); setItemPending(target.id, false); }
    }
  };

  const handleAddChecklist = async () => {
    if (isOffline) { toast.error(OFFLINE_READONLY_MESSAGE); return; }
    if (!trip || !newChecklistName.trim() || isAddingChecklist) return;
    const operationScope = captureTripScope();
    setIsAddingChecklist(true);
    setChildActionError(null);
    try {
      const saved = await saveTripChecklistToDB(trip.id, newChecklistName.trim());
      if (!isCurrentTripScope(operationScope)) return;
      if (!saved) { setChildActionError('준비물을 추가하지 못했어요.'); return; }
      setChecklists((current) => [...current, saved]);
      setNewChecklistName('');
    } catch (error) {
      if (!isCurrentTripScope(operationScope)) return;
      console.error('[gomsinlog] Failed to add trip checklist item.');
      setChildActionError(`준비물을 추가하지 못했어요. ${classifyServerError(error).message}`);
    } finally {
      if (isCurrentTripScope(operationScope)) setIsAddingChecklist(false);
    }
  };

  const handleToggleChecklist = async (item: TripChecklist) => {
    if (isOffline) { toast.error(OFFLINE_READONLY_MESSAGE); return; }
    if (pendingChecklistIds.has(item.id)) return;
    const operationScope = captureTripScope();
    const nextCompleted = !item.completed;
    setChildActionError(null);
    setChecklistPending(item.id, true);
    setChecklists((current) => current.map((entry) => entry.id === item.id ? { ...entry, completed: nextCompleted } : entry));
    try {
      const saved = await toggleTripChecklistInDB(item.id, nextCompleted, item.tripId);
      if (!isCurrentTripScope(operationScope)) return;
      if (!saved) { await loadChildren(); if (!isCurrentTripScope(operationScope)) return; setChildActionError('체크 상태를 저장하지 못해 서버의 최신 상태를 다시 확인했어요.'); toast.error('체크 상태를 저장하지 못해 서버의 최신 상태를 다시 확인했어요.'); }
    } catch (error) {
      if (!isCurrentTripScope(operationScope)) return;
      console.error('[gomsinlog] Failed to toggle trip checklist item.');
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
    if (isOffline) { toast.error(OFFLINE_READONLY_MESSAGE); return; }
    if (!trip || pendingChecklistIds.has(checklistId)) return;
    const operationScope = captureTripScope();
    setChecklistPending(checklistId, true);
    setChildActionError(null);
    try {
      const deleted = await deleteTripChecklistFromDB(checklistId, trip.id);
      if (!isCurrentTripScope(operationScope)) return;
      if (!deleted) { setChildActionError('준비물을 삭제하지 못했어요.'); return; }
      setChecklists((current) => current.filter((entry) => entry.id !== checklistId));
    } catch (error) {
      if (!isCurrentTripScope(operationScope)) return;
      console.error('[gomsinlog] Failed to delete trip checklist item.');
      setChildActionError(`준비물을 삭제하지 못했어요. ${classifyServerError(error).message}`);
    } finally {
      if (isCurrentTripScope(operationScope)) setChecklistPending(checklistId, false);
    }
  };

  const visibleParentState: ParentState = !userId ? 'forbidden' : !activeCouple ? 'disconnected' : parentState;


  /*
    `|| !trip` is what keeps a refresh from blanking this page.

    `loadParent` sets `loading` on every run, including the realtime invalidation
    that fires when the other person edits the trip. Gating only on the state
    replaced a trip the user was reading with a centred spinner; gating on "we have
    no trip to show" makes the placeholder a first-load state instead.
  */
  if ((visibleParentState !== 'ready' && !trip) || !trip) {
    const content = visibleParentState === 'loading'
      ? <Skeleton label="여행을 불러오고 있어요" description="일정과 준비물을 함께 확인하는 중이에요." lines={3} />
      : visibleParentState === 'not-found'
        ? <EmptyState icon={<MapPin size={20} className="text-muted-foreground" />} title="여행을 찾을 수 없어요" description="삭제되었거나 존재하지 않는 여행이에요." />
        : visibleParentState === 'disconnected'
          ? <EmptyState icon={<Unlink size={20} className="text-muted-foreground" />} title="우리 공간 연결이 필요해요" description="두 사람이 연결된 뒤 여행을 열 수 있어요." />
          : visibleParentState === 'forbidden'
            ? <EmptyState icon={<ShieldAlert size={20} className="text-warning" />} title="이 여행에 접근할 권한이 없어요" />
            : <EmptyState icon={<RefreshCw size={20} className="text-muted-foreground" />} title="여행을 불러오지 못했어요" action={<Button size="sm" variant="primary" onClick={() => void loadParent()}>다시 시도</Button>} />;
    return (
      <MobileShell>
        <div className="p-4 mt-16 space-y-3">
          {content}
          <button type="button" onClick={() => navigate('/trips')} className="press-response block mx-auto text-caption text-muted-foreground underline min-h-11">여행 목록으로</button>
        </div>
      </MobileShell>
    );
  }

  return (
    <MobileShell>
      <div className="pb-28">
        {/* Header */}
        <AppBar
          title={trip.title}
          onBack={() => navigate('/trips')}
          backLabel="여행 목록"
          actions={
            <>
              <AppBarAction
                onClick={openTripEdit}
                disabled={isDeletingTrip || isOffline}
                className="text-muted-foreground disabled:opacity-40"
                aria-label="여행 수정"
              >
                <Pencil size={18} aria-hidden="true" />
              </AppBarAction>
              {/*
                Destructive, so it keeps `destructive` ink rather than the bar's
                default. DESIGN_V2 §3.4 forbids an icon-only control for a
                destructive action -- the confirmation dialog this opens is what
                carries the words.
              */}
              <AppBarAction
                onClick={() => void handleDeleteTrip()}
                disabled={isDeletingTrip || isOffline}
                className="text-destructive disabled:opacity-40"
                aria-label="여행 삭제"
              >
                <Trash2 size={18} aria-hidden="true" />
              </AppBarAction>
            </>
          }
        />

        {/* Trip meta - compact info bar */}
        <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-2 flex-wrap">
          <span className="flex items-center gap-1.5 text-caption text-muted-foreground tabular-nums">
            <Calendar size={14} className="text-info" aria-hidden="true" />
            {formatLocalDate(trip.startDate)} ~ {formatLocalDate(trip.endDate)} · {dates.length}일간
          </span>
          <button
            type="button"
            onClick={() => navigate(`/record?from=${trip.startDate}&to=${trip.endDate}&trip=${trip.id}`)}
            className="press-response text-caption font-medium text-coral-strong flex items-center gap-1 min-h-11"
          >
            <PenTool size={12} />추억 보기·남기기
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex border-b border-border bg-card">
          <button type="button" onClick={() => setActiveTab('schedule')} className={`press-response-row flex-1 min-h-11 text-label font-semibold border-b-2 ${activeTab === 'schedule' ? 'border-info text-info' : 'border-transparent text-muted-foreground'}`}>일정 ({items.length})</button>
          <button type="button" onClick={() => setActiveTab('checklist')} className={`press-response-row flex-1 min-h-11 text-label font-semibold border-b-2 ${activeTab === 'checklist' ? 'border-info text-info' : 'border-transparent text-muted-foreground'}`}>준비물 ({checklists.length})</button>
        </div>

        {/* Same rule as the parent: a refresh keeps the rows it already has. */}
        {childState !== 'ready' && items.length === 0 && checklists.length === 0 ? (
          <div className="p-6 space-y-3">
            {childState === 'loading'
              ? <Skeleton label="일정과 준비물을 불러오고 있어요" lines={2} />
              : <EmptyState title={childState === 'forbidden' ? '일정과 준비물을 볼 권한이 없어요.' : '일정과 준비물을 불러오지 못했어요.'} action={<Button size="sm" variant="primary" onClick={() => void loadChildren()}>다시 시도</Button>} />
            }
          </div>
        ) : activeTab === 'schedule' ? (
          <>
            {/* Day tabs */}
            <div className="bg-card border-b border-border px-2 flex overflow-x-auto no-scrollbar">
              {dates.map((date, index) => (
                <button
                  key={date}
                  type="button"
                  onClick={() => setActiveDayIndex(index)}
                  className={`press-response px-3 min-h-11 text-label font-medium whitespace-nowrap border-b-2 ${activeDayIndex === index ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground'}`}
                >
                  {index + 1}일차 <span className="font-normal text-caption">({date.slice(5)})</span>
                </button>
              ))}
            </div>

            <div className="px-4 pt-4 pb-2">
              <input
                ref={quickScreenshotInputRef}
                type="file"
                accept="image/*"
                className="sr-only"
                aria-label="지도 캡처 선택"
                onChange={(event) => void handleQuickPlaceScreenshot(event.target.files?.[0])}
              />
              {currentDayItems.length === 0 ? (
                <EmptyState
                  icon={<MapPin size={18} className="text-muted-foreground" />}
                  title="캡처 한 장이면 일정이 만들어져요"
                  description="지도 화면의 글자를 기기에서 읽어 초안으로 채워요. 확인하기 전에는 저장하지 않습니다."
                  action={(
                    <div className="flex flex-col items-center gap-2">
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => quickScreenshotInputRef.current?.click()}
                        disabled={isReadingScreenshot || isSavingItem || isOffline}
                      >
                        <ImagePlus size={14} />
                        {isReadingScreenshot ? `사진 읽는 중 ${Math.round(ocrProgress * 100)}%` : '사진에서 초안 만들기'}
                      </Button>
                      <button type="button" onClick={openNewItem} disabled={isOffline} className="press-response min-h-11 px-3 text-caption font-medium text-muted-foreground disabled:opacity-40">
                        직접 입력하기
                      </button>
                    </div>
                  )}
                />
              ) : (
                <>
                  <p className="text-caption text-muted-foreground mb-3 break-keep">
                    시간을 넣으면 자동 정렬 · 시간 없는 장소는 손잡이를 끌어 순서 변경
                  </p>
                  {/*
                    목록이 `pointermove` 를 받는다. 줄마다 받게 하면 터치에서 첫 줄만
                    이벤트를 받고(암묵적 포인터 캡처) 손가락이 지나가는 줄은 영영
                    모른다 -- 마우스로는 되고 폰에서는 안 되는 코드가 된다.
                  */}
                  <div onPointerMove={onDragMove} onPointerUp={() => void onDragEnd()} onPointerCancel={() => void onDragEnd()}>
                  <RowGroup>
                    {displayDayItems.map((item, index) => {
                      const pending = pendingItemIds.has(item.id);
                      const mapQuery = [item.title, item.address].filter(Boolean).join(' ');
                      const categoryLabel = CATEGORY_OPTIONS.find((opt) => opt.value === item.category)?.label;
                      return (
                        <ListRow
                          key={item.id}
                          /* 손가락 아래의 줄을 좌표로 찾을 때 쓰는 표식. */
                          data-trip-row={index}
                          leading={
                            <span className="text-caption text-muted-foreground tabular-nums w-11 text-right">
                              {item.startTime || '미정'}
                            </span>
                          }
                          trailing={
                            <div className="flex items-center gap-0">
                              {/*
                                끌 손잡이. 화살표 둘은 남긴다 -- 끌기는 손이 필요하고,
                                스크린리더나 키보드로 쓰는 사람에게는 도달할 수 없는
                                동작이다. 같은 일에 두 길이 있는 것이 아니라, 한 길이
                                닿지 않는 사람에게 다른 길이 있는 것이다.
                              */}
                              <button
                                type="button"
                                onPointerDown={onDragStart(item.id)}
                                disabled={Boolean(item.startTime) || pending || isOffline}
                                title={item.startTime ? '시간을 바꾸면 순서가 바뀌어요.' : '끌어서 순서 바꾸기'}
                                className="press-response min-w-11 min-h-11 flex touch-none items-center justify-center text-muted-foreground disabled:opacity-20"
                                aria-label={`${item.title} 순서 바꾸기 손잡이`}
                                style={dragItemId === item.id ? { color: 'var(--ink)' } : undefined}
                              >
                                <GripVertical size={14} />
                              </button>
                              <button type="button" onClick={() => void handleMoveItem(index, -1)} disabled={Boolean(item.startTime) || index === 0 || pending || isOffline} title={item.startTime ? '시간을 바꾸면 순서가 바뀌어요.' : undefined} className="press-response min-w-11 min-h-11 flex items-center justify-center text-muted-foreground disabled:opacity-20" aria-label="위로 이동"><ArrowUp size={14} /></button>
                              <button type="button" onClick={() => void handleMoveItem(index, 1)} disabled={Boolean(item.startTime) || index === displayDayItems.length - 1 || pending || isOffline} title={item.startTime ? '시간을 바꾸면 순서가 바뀌어요.' : undefined} className="press-response min-w-11 min-h-11 flex items-center justify-center text-muted-foreground disabled:opacity-20" aria-label="아래로 이동"><ArrowDown size={14} /></button>
                            </div>
                          }
                        >
                          <button type="button" onClick={() => openEditItem(item)} disabled={pending || isOffline} className="press-response-row w-full text-left rounded-control min-h-11 disabled:opacity-50" aria-label={`${item.title} 일정 수정`}>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-label font-semibold text-foreground break-keep">{item.title}</span>
                              {categoryLabel && <Badge tone="neutral">{categoryLabel}</Badge>}
                            </div>
                            {item.address && <p className="text-caption text-muted-foreground mt-0.5 break-keep"><MapPin size={10} className="inline mr-0.5" />{item.address}</p>}
                            {item.businessHours && <p className="text-caption text-muted-foreground mt-0.5 break-keep">영업 {item.businessHours}</p>}
                            {item.talkAbout && <span className="inline-flex items-center gap-1 text-caption font-medium text-coral-strong mt-0.5"><MessageCircleHeart size={10} />꼭 얘기</span>}
                            {item.source === 'screenshot' && <Badge tone="warning" className="mt-0.5">사진에서 자동 추가 · 눌러서 수정</Badge>}
                          </button>
                          <div className="flex items-center gap-1 mt-1">
                            <button type="button" onClick={() => void handleDeleteItem(item.id)} disabled={pending || isOffline} className="press-response min-w-11 min-h-11 flex items-center justify-center text-destructive disabled:opacity-25" aria-label="일정 삭제"><Trash2 size={12} /></button>
                            {item.url && <a href={item.url} target="_blank" rel="noreferrer" aria-label="저장된 링크 열기" className="min-w-11 min-h-11 inline-flex items-center justify-center text-info"><ExternalLink size={12} /></a>}
                            {mapQuery && <a href={`https://map.naver.com/p/search/${encodeURIComponent(mapQuery)}`} target="_blank" rel="noreferrer" className="ml-auto text-caption font-medium text-foreground bg-success-surface px-2 py-1 rounded-full min-h-[28px] flex items-center">네이버 지도</a>}
                          </div>
                        </ListRow>
                      );
                    })}
                  </RowGroup>
                  </div>
                </>
              )}
            </div>

            {currentDayItems.length > 0 && (
              <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 w-full max-w-[430px] px-4 flex gap-2 pointer-events-none">
                <Button
                  size="md"
                  variant="primary"
                  full
                  className="pointer-events-auto"
                  onClick={() => quickScreenshotInputRef.current?.click()}
                  disabled={isReadingScreenshot || isSavingItem || isOffline}
                >
                  <ImagePlus size={16} />
                  {isReadingScreenshot ? `사진 읽는 중 ${Math.round(ocrProgress * 100)}%` : '사진으로 일정 추가'}
                </Button>
                <button type="button" onClick={openNewItem} disabled={isOffline} className="press-response pointer-events-auto w-12 h-12 shrink-0 bg-card border border-border text-foreground rounded-control flex items-center justify-center disabled:opacity-40" aria-label="직접 일정 입력">
                  <PenTool size={17} />
                </button>
              </div>
            )}
          </>
        ) : (
          /* Checklist tab */
          <div className="px-4 pt-4 space-y-3">
            <div className="flex gap-2">
              <input
                value={newChecklistName}
                onChange={(event) => setNewChecklistName(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void handleAddChecklist(); }}
                placeholder="새 준비물 추가"
                disabled={isAddingChecklist}
                className="flex-1 bg-muted border border-border rounded-control px-3 py-2 text-body outline-none focus:ring-2 focus:ring-info/40 min-h-11 disabled:opacity-50"
              />
              <Button size="sm" variant="outline" onClick={() => void handleAddChecklist()} disabled={isAddingChecklist || !newChecklistName.trim() || isOffline}>
                {isAddingChecklist ? '추가 중' : '추가'}
              </Button>
            </div>
            {childActionError && <ErrorNote>{childActionError}</ErrorNote>}

            {checklists.length > 0 ? (
              <RowGroup>
                {checklists.map((item) => {
                  const pending = pendingChecklistIds.has(item.id);
                  return (
                    <ListRow
                      key={item.id}
                      leading={
                        <button
                          type="button"
                          onClick={() => void handleToggleChecklist(item)}
                          disabled={pending || isOffline}
                          className="press-response min-w-11 min-h-11 flex items-center justify-center -m-2 text-info disabled:opacity-50"
                          aria-label={`${item.itemName} ${item.completed ? '미완료로 변경' : '완료로 변경'}`}
                        >
                          {item.completed ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                        </button>
                      }
                      trailing={
                        <button
                          type="button"
                          onClick={() => void handleDeleteChecklist(item.id)}
                          disabled={pending || isOffline}
                          className="press-response min-w-11 min-h-11 flex items-center justify-center -m-2 text-muted-foreground hover:text-destructive disabled:opacity-40"
                          aria-label="준비물 삭제"
                        >
                          <Trash2 size={14} />
                        </button>
                      }
                      density="tight"
                    >
                      <span className={`text-label font-medium ${item.completed ? 'line-through text-muted-foreground' : 'text-foreground'}`}>{item.itemName}</span>
                    </ListRow>
                  );
                })}
              </RowGroup>
            ) : (
              <EmptyState title="함께 준비할 짐이나 할 일을 작성해 보세요." />
            )}
          </div>
        )}

        {/* Trip edit modal - z-[60] above tab bar */}
        {showTripModal && (
          <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center sm:p-5">
            <div ref={tripSheet.sheetRef} role="dialog" aria-modal="true" aria-labelledby="trip-edit-title" className="bg-card w-full max-w-md rounded-t-2xl sm:rounded-surface p-4 border border-border">
              <SheetHandle {...tripSheet.handleProps} />
              <h2 id="trip-edit-title" className="text-heading text-foreground mb-4">여행 정보 수정</h2>
              <div className="space-y-3">
                <label className="block text-caption font-medium text-muted-foreground">여행 이름<input value={tripDraft.title} onChange={(event) => setTripDraft((current) => ({ ...current, title: event.target.value }))} className="mt-1 w-full bg-background border border-border rounded-control px-3 py-2 text-body text-foreground min-h-11" /></label>
                <div className="flex gap-2">
                  <label className="flex-1 text-caption font-medium text-muted-foreground">가는 날<input type="date" value={tripDraft.startDate} onChange={(event) => setTripDraft((current) => ({ ...current, startDate: event.target.value }))} className="mt-1 w-full bg-background border border-border rounded-control px-2 py-2 text-body text-foreground min-h-11" /></label>
                  <label className="flex-1 text-caption font-medium text-muted-foreground">오는 날<input type="date" min={tripDraft.startDate} value={tripDraft.endDate} onChange={(event) => setTripDraft((current) => ({ ...current, endDate: event.target.value }))} className="mt-1 w-full bg-background border border-border rounded-control px-2 py-2 text-body text-foreground min-h-11" /></label>
                </div>
                <label className="block text-caption font-medium text-muted-foreground">상태<select value={tripDraft.status} onChange={(event) => setTripDraft((current) => ({ ...current, status: event.target.value as TripStatus }))} className="mt-1 w-full bg-background border border-border rounded-control px-3 py-2 text-body text-foreground min-h-11">{STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                {tripError && <ErrorNote>{tripError}</ErrorNote>}
              </div>
              <div className="flex gap-2 mt-5">
                <Button variant="secondary" size="md" full onClick={() => setShowTripModal(false)} disabled={isSavingTrip || isOffline}>취소</Button>
                <Button variant="primary" size="md" full onClick={() => void handleSaveTrip()} disabled={isSavingTrip || isOffline}>{isSavingTrip ? '저장 중' : '저장'}</Button>
              </div>
            </div>
          </div>
        )}

        {/* Item create/edit modal - z-[60] above tab bar */}
        {showItemModal && (
          <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center sm:p-5">
            <div ref={itemSheet.sheetRef} role="dialog" aria-modal="true" aria-labelledby="trip-item-title" className="bg-card w-full max-w-md rounded-t-2xl sm:rounded-surface p-4 border border-border max-h-[90dvh] overflow-y-auto">
              <SheetHandle {...itemSheet.handleProps} />
              <h2 id="trip-item-title" className="text-heading text-foreground mb-4">{editingItemId ? '일정 수정' : `${activeDayIndex + 1}일차 일정 추가`}</h2>
              <div className="space-y-3">
                {!editingItemId && (
                  <div className="rounded-control border border-dashed border-info/40 bg-info-surface p-3">
                    <input ref={screenshotInputRef} type="file" accept="image/*" className="sr-only" onChange={(event) => void handlePlaceScreenshot(event.target.files?.[0])} />
                    <button type="button" onClick={() => screenshotInputRef.current?.click()} disabled={isReadingScreenshot || isSavingItem} className="press-response-row w-full min-h-11 flex items-center justify-center gap-2 font-medium text-label text-info disabled:opacity-50">
                      <ImagePlus size={14} />
                      {isReadingScreenshot ? `캡처 읽는 중 ${Math.round(ocrProgress * 100)}%` : '네이버 지도 캡처에서 불러오기'}
                    </button>
                    <p className="text-caption text-muted-foreground text-center mt-1">이미지는 서버에 올리지 않고 이 기기에서만 글자를 읽어요.</p>
                  </div>
                )}
                <label className="block text-caption font-medium text-muted-foreground">장소 또는 제목 *<input value={itemDraft.title} onChange={(event) => setItemDraft((current) => ({ ...current, title: event.target.value }))} placeholder="직접 입력해 주세요" className="mt-1 w-full bg-background border border-border rounded-control px-3 py-2 text-body text-foreground min-h-11" /></label>
                <label className="block text-caption font-medium text-muted-foreground">방문 시간 (선택)<input type="time" value={itemDraft.startTime} onChange={(event) => setItemDraft((current) => ({ ...current, startTime: event.target.value }))} className="mt-1 w-full bg-background border border-border rounded-control px-3 py-2 text-body text-foreground min-h-11" /></label>
                <fieldset><legend className="text-caption font-medium text-muted-foreground mb-1">분류</legend><div className="grid grid-cols-4 gap-1">{CATEGORY_OPTIONS.map((option) => <button key={option.value} type="button" onClick={() => setItemDraft((current) => ({ ...current, category: option.value }))} className={`press-response min-h-9 rounded-control border text-label font-medium ${itemDraft.category === option.value ? 'bg-info text-coral-strong-foreground border-info' : 'border-border text-foreground'}`}>{option.label}</button>)}</div></fieldset>
                <label className="block text-caption font-medium text-muted-foreground">링크 (선택)<input type="url" value={itemDraft.url} onChange={(event) => setItemDraft((current) => ({ ...current, url: event.target.value }))} placeholder="https://" className="mt-1 w-full bg-background border border-border rounded-control px-3 py-2 text-body text-foreground min-h-11" /></label>
                <label className="block text-caption font-medium text-muted-foreground">주소 (선택)<input value={itemDraft.address} onChange={(event) => setItemDraft((current) => ({ ...current, address: event.target.value, source: current.source === 'screenshot' ? 'screenshot' : 'manual' }))} placeholder="예: 서울 마포구 연남로 1" maxLength={300} className="mt-1 w-full bg-background border border-border rounded-control px-3 py-2 text-body text-foreground min-h-11" /></label>
                <label className="block text-caption font-medium text-muted-foreground">영업시간 (선택)<textarea value={itemDraft.businessHours} onChange={(event) => setItemDraft((current) => ({ ...current, businessHours: event.target.value }))} rows={2} maxLength={500} placeholder="예: 매일 11:00~21:00" className="mt-1 w-full bg-background border border-border rounded-control px-3 py-2 text-body text-foreground resize-none" /></label>
                <label className="block text-caption font-medium text-muted-foreground">함께 볼 메모 (선택)<textarea value={itemDraft.memo} onChange={(event) => setItemDraft((current) => ({ ...current, memo: event.target.value }))} rows={3} placeholder="예: 예약 필요 · 비 오면 다른 곳으로" className="mt-1 w-full bg-background border border-border rounded-control px-3 py-2 text-body text-foreground resize-none" /></label>
                <label className="flex items-center gap-2 rounded-control bg-coral/5 px-3 py-2 font-medium text-label text-coral-strong min-h-11"><input type="checkbox" checked={itemDraft.talkAbout} onChange={(event) => setItemDraft((current) => ({ ...current, talkAbout: event.target.checked }))} className="accent-coral" />통화 때 꼭 얘기</label>
                {itemError && <ErrorNote>{itemError}</ErrorNote>}
              </div>
              <div className="flex gap-2 mt-5">
                <Button variant="secondary" size="md" full onClick={() => setShowItemModal(false)} disabled={isSavingItem || isReadingScreenshot || isOffline}>취소</Button>
                <Button variant="primary" size="md" full onClick={() => void handleSaveItem()} disabled={isSavingItem || isReadingScreenshot || isOffline}>{isSavingItem ? '저장 중' : '저장'}</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </MobileShell>
  );
}
