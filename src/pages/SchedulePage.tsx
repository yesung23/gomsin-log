import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock,
  Heart,
  Lock,
  ListTodo,
  Pencil,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { useOnlineStatus, OFFLINE_READONLY_MESSAGE } from '@/lib/useOnlineStatus';
import { classifyServerError, serverErrorMessage } from '@/lib/serverErrors';
import { MobileShell } from '@/components/MobileShell';
import { PlanSectionNav } from '@/components/PlanSectionNav';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ListRow, RowGroup, SectionHeader } from '@/components/ui/List';
import {
  dDayLabel,
  eventsOnDate,
  upcomingEvents,
  validateEventDraft,
} from '@/lib/calendar';
import { useEscapeKey } from '@/lib/hooks';
import { nextAnniversaryMilestone } from '@/lib/milestones';
import { daysBetweenLocal, localToday, toLocalDateString } from '@/lib/utils';
import { useStore } from '@/lib/useStore';
import { createTask, deleteTask, fetchTasks, updateTask, validateTaskTitle } from '@/lib/tasks';
import { supabase } from '@/lib/supabase';
import type { CoupleEvent, CoupleTask, EventType } from '@/types';

const EVENT_BADGES: Record<EventType, { label: string; tone: 'neutral' | 'accent' | 'info' | 'success' | 'warning' }> = {
  anniversary: { label: '기념일', tone: 'accent' },
  visit: { label: '면회', tone: 'success' },
  vacation: { label: '휴가', tone: 'accent' },
  date: { label: '데이트', tone: 'accent' },
  trip: { label: '여행', tone: 'info' },
  other: { label: '기타', tone: 'neutral' },
};

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

export function SchedulePage() {
  const { state, addEvent, updateEvent, deleteEvent, reloadEvents, sharedSyncStatus } = useStore();
  const { profile, events, authenticatedUser } = state;
  const today = toLocalDateString(localToday());
  const activeCouple = Boolean(
    authenticatedUser?.id &&
      profile.couple.coupleId &&
      profile.couple.connected &&
      profile.couple.status === 'active',
  );
  const hasCoupleSpace = Boolean(
    authenticatedUser?.id &&
      profile.couple.coupleId &&
      profile.couple.status !== 'disconnected',
  );
  const scheduleAccessKey = authenticatedUser?.id
    ? `${authenticatedUser.id}:${profile.couple.coupleId || ''}:${profile.couple.connected ? 'connected' : 'disconnected'}:${profile.couple.status}`
    : '';
  const accessKeyRef = useRef(scheduleAccessKey);
  const accessGenerationRef = useRef(0);
  if (accessKeyRef.current !== scheduleAccessKey) {
    accessKeyRef.current = scheduleAccessKey;
    accessGenerationRef.current += 1;
  }
  const captureAccess = useCallback(
    () => ({ key: scheduleAccessKey, generation: accessGenerationRef.current }),
    [scheduleAccessKey],
  );
  const isCurrentAccess = useCallback(
    (access: { key: string; generation: number }) =>
      access.key === accessKeyRef.current
      && access.generation === accessGenerationRef.current
      && access.key !== '',
    [],
  );

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [selectedDate, setSelectedDate] = useState(today);
  const [currMonth, setCurrMonth] = useState(localToday().getMonth());
  const [currYear, setCurrYear] = useState(localToday().getFullYear());
  const [showEventModal, setShowEventModal] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [eventType, setEventType] = useState<EventType>('visit');
  const [eventStartDate, setEventStartDate] = useState(today);
  const [eventEndDate, setEventEndDate] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [talkAbout, setTalkAbout] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const isOffline = !useOnlineStatus();
  const [deletingEventId, setDeletingEventId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<CoupleTask[]>([]);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskTime, setTaskTime] = useState('');
  const [taskForMe, setTaskForMe] = useState(false);
  const [isSavingTask, setIsSavingTask] = useState(false);
  const [pendingTaskIds, setPendingTaskIds] = useState<Set<string>>(new Set());
  const reloadEventsRef = useRef(reloadEvents);
  reloadEventsRef.current = reloadEvents;

  useEscapeKey(
    () => setShowEventModal(false),
    showEventModal && !isSaving && deletingEventId === null,
  );

  useLayoutEffect(() => {
    setShowEventModal(false);
    setEditingEventId(null);
    setTitle('');
    setEventType('visit');
    setEventStartDate(today);
    setEventEndDate('');
    setIsPrivate(false);
    setTalkAbout(false);
    setFormError(null);
    setIsSaving(false);
    setDeletingEventId(null);
  }, [scheduleAccessKey, today]);

  useEffect(() => {
    if (!authenticatedUser?.id) return;
    let cancelled = false;
    setLoadState('loading');
    void reloadEventsRef.current().then((result) => {
      if (cancelled) return;
      if (result.ok) setLoadState('ready');
      else setLoadState(result.reason === 'forbidden' ? 'forbidden' : 'error');
    });
    return () => { cancelled = true; };
  }, [authenticatedUser?.id, scheduleAccessKey]);

  const refreshTasks = useCallback(async () => {
    const coupleId = profile.couple.coupleId;
    if (!authenticatedUser?.id || !coupleId || !activeCouple) {
      setTasks([]);
      return;
    }
    const access = captureAccess();
    const result = await fetchTasks(coupleId);
    if (!isCurrentAccess(access)) return;
    if (result.ok) setTasks(result.tasks);
  }, [activeCouple, authenticatedUser?.id, captureAccess, isCurrentAccess, profile.couple.coupleId]);

  useEffect(() => {
    void refreshTasks();
    const client = supabase;
    const coupleId = profile.couple.coupleId;
    if (!client || !activeCouple || !coupleId) return;
    const channel = client.channel(`couple-tasks:${coupleId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'couple_tasks', filter: `couple_id=eq.${coupleId}` }, () => void refreshTasks())
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [activeCouple, profile.couple.coupleId, refreshTasks]);

  const previousSyncStatusRef = useRef(sharedSyncStatus);
  const loadStateRef = useRef(loadState);
  loadStateRef.current = loadState;
  useEffect(() => {
    const previous = previousSyncStatusRef.current;
    previousSyncStatusRef.current = sharedSyncStatus;
    if (!authenticatedUser?.id) return;
    if (previous !== 'unavailable' || sharedSyncStatus === 'unavailable') return;
    if (loadStateRef.current === 'ready' || loadStateRef.current === 'loading') return;

    let cancelled = false;
    setLoadState('loading');
    void reloadEventsRef.current().then((result) => {
      if (cancelled) return;
      if (result.ok) setLoadState('ready');
      else setLoadState(result.reason === 'forbidden' ? 'forbidden' : 'error');
    });
    return () => { cancelled = true; };
  }, [authenticatedUser?.id, sharedSyncStatus]);

  const retryLoad = async () => {
    setLoadState('loading');
    const result = await reloadEvents();
    if (result.ok) setLoadState('ready');
    else setLoadState(result.reason === 'forbidden' ? 'forbidden' : 'error');
  };

  const moveMonth = (offset: number) => {
    const next = new Date(currYear, currMonth + offset, 1);
    setCurrYear(next.getFullYear());
    setCurrMonth(next.getMonth());
  };

  const openCreateModal = () => {
    if (!hasCoupleSpace) return;
    setEditingEventId(null);
    setTitle('');
    setEventType('visit');
    setEventStartDate(selectedDate);
    setEventEndDate('');
    setIsPrivate(!activeCouple);
    setTalkAbout(false);
    setFormError(null);
    setShowEventModal(true);
  };

  const openEditModal = (event: CoupleEvent) => {
    if (event.createdBy !== authenticatedUser?.id) return;
    setEditingEventId(event.id);
    setTitle(event.title);
    setEventType(event.eventType);
    setEventStartDate(event.startDate);
    setEventEndDate(event.endDate || '');
    setIsPrivate(event.isPrivate);
    setTalkAbout(event.talkAbout === true);
    setFormError(null);
    setShowEventModal(true);
  };

  const handleSaveEvent = async () => {
    if (isSaving) return;
    if (isOffline) {
      setFormError(OFFLINE_READONLY_MESSAGE);
      toast.error(OFFLINE_READONLY_MESSAGE);
      return;
    }
    const validationError = validateEventDraft({
      title,
      startDate: eventStartDate,
      endDate: eventEndDate || undefined,
    });
    if (validationError) {
      setFormError(validationError);
      toast.error(validationError);
      return;
    }
    const editingEvent = editingEventId
      ? events.find((event) => event.id === editingEventId)
      : undefined;
    if (editingEventId && !editingEvent) {
      const message = '이 일정은 더 이상 확인할 수 없어요. 목록을 새로 확인해 주세요.';
      setFormError(message);
      toast.error(message);
      return;
    }
    const canEditPrivateWhileDisconnected = Boolean(
      editingEvent
      && editingEvent.createdBy === authenticatedUser?.id
      && editingEvent.isPrivate
      && isPrivate,
    );
    const canSave = editingEventId
      ? (activeCouple || canEditPrivateWhileDisconnected)
      : (hasCoupleSpace && (isPrivate || activeCouple));
    if (!authenticatedUser || !canSave) {
      const message = editingEventId
        ? '연결이 해제된 동안에는 기존 비공개 일정만 수정할 수 있어요.'
        : hasCoupleSpace
          ? '공유 일정은 파트너와 연결된 뒤에 등록할 수 있어요. 나만 보기로는 지금 저장할 수 있어요.'
          : '로그인하고 우리 공간을 만든 뒤에 새 일정을 저장할 수 있어요.';
      setFormError(message);
      toast.error(message);
      return;
    }

    const access = captureAccess();
    setIsSaving(true);
    setFormError(null);
    const changes = {
      title: title.trim(),
      eventType,
      startDate: eventStartDate,
      endDate: eventEndDate || undefined,
      isPrivate,
      talkAbout: !isPrivate && talkAbout,
    };

    try {
      const saved = editingEventId
        ? await updateEvent(editingEventId, changes)
        : await addEvent({
            coupleId: profile.couple.coupleId!,
            createdBy: authenticatedUser.id,
            ...changes,
          });
      if (!isCurrentAccess(access)) return;
      if (!saved) {
        const message = '일정을 저장하지 못했습니다. 입력 내용은 유지되니 다시 시도해 주세요.';
        setFormError(message);
        toast.error(message);
        return;
      }
      toast.success(editingEventId ? '일정이 수정되었습니다.' : '새 일정이 등록되었습니다.');
      setSelectedDate(eventStartDate);
      setShowEventModal(false);
    } catch {
      if (!isCurrentAccess(access)) return;
      const message = '일정을 저장하지 못했습니다. 입력 내용은 유지되니 다시 시도해 주세요.';
      setFormError(message);
      toast.error(message);
    } finally {
      if (isCurrentAccess(access)) setIsSaving(false);
    }
  };

  const handleDeleteEvent = async (event: CoupleEvent) => {
    if (deletingEventId || event.createdBy !== authenticatedUser?.id) return;
    if (isOffline) {
      toast.error(OFFLINE_READONLY_MESSAGE);
      return;
    }
    const access = captureAccess();
    setDeletingEventId(event.id);
    try {
      const deleted = await deleteEvent(event.id);
      if (!isCurrentAccess(access)) return;
      if (deleted) toast.success('일정이 삭제되었습니다.');
      else toast.error(`일정을 삭제하지 못했습니다. ${serverErrorMessage('forbidden')}`);
    } catch (error) {
      if (!isCurrentAccess(access)) return;
      toast.error(`일정을 삭제하지 못했습니다. ${classifyServerError(error).message}`);
    } finally {
      if (isCurrentAccess(access)) setDeletingEventId(null);
    }
  };

  const handleCreateTask = async () => {
    if (isSavingTask || isOffline || !authenticatedUser?.id || !profile.couple.coupleId || !activeCouple) return;
    const error = validateTaskTitle(taskTitle);
    if (error) {
      toast.error(error);
      return;
    }
    const access = captureAccess();
    setIsSavingTask(true);
    try {
      const saved = await createTask({
        coupleId: profile.couple.coupleId,
        createdBy: authenticatedUser.id,
        title: taskTitle,
        dueDate: selectedDate,
        dueTime: taskTime || undefined,
        assigneeId: taskForMe ? authenticatedUser.id : undefined,
        isPrivate: false,
      });
      if (!isCurrentAccess(access)) return;
      if (!saved) {
        toast.error('할 일을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
        return;
      }
      setTasks((current) => [...current, saved]);
      setTaskTitle('');
      setTaskTime('');
      toast.success('우리 할 일에 추가했습니다.');
    } finally {
      if (isCurrentAccess(access)) setIsSavingTask(false);
    }
  };

  const handleToggleTask = async (task: CoupleTask) => {
    if (pendingTaskIds.has(task.id) || isOffline) return;
    setPendingTaskIds((current) => new Set(current).add(task.id));
    const saved = await updateTask(task, { completed: !task.completed });
    setPendingTaskIds((current) => {
      const next = new Set(current);
      next.delete(task.id);
      return next;
    });
    if (!saved) {
      toast.error('할 일 상태를 저장하지 못했어요.');
      return;
    }
    setTasks((current) => current.map((entry) => entry.id === saved.id ? saved : entry));
  };

  const handleDeleteTask = async (task: CoupleTask) => {
    if (pendingTaskIds.has(task.id) || task.createdBy !== authenticatedUser?.id || isOffline) return;
    setPendingTaskIds((current) => new Set(current).add(task.id));
    const deleted = await deleteTask(task);
    setPendingTaskIds((current) => {
      const next = new Set(current);
      next.delete(task.id);
      return next;
    });
    if (deleted) setTasks((current) => current.filter((entry) => entry.id !== task.id));
    else toast.error('할 일을 삭제하지 못했어요.');
  };

  const selectedEvents = eventsOnDate(events, selectedDate).sort((a, b) =>
    a.startDate.localeCompare(b.startDate),
  );
  const selectedTasks = tasks.filter((task) => task.dueDate === selectedDate)
    .sort((a, b) => (a.completed === b.completed ? (a.dueTime || '99:99').localeCompare(b.dueTime || '99:99') : Number(a.completed) - Number(b.completed)));
  const upcoming = upcomingEvents(events, today);
  const daysInMonth = new Date(currYear, currMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(currYear, currMonth, 1).getDay();
  const anniversaryDate = profile.couple.anniversaryDate;
  const daysTogether = anniversaryDate ? daysBetweenLocal(anniversaryDate, today) + 1 : null;
  const nextMilestone = nextAnniversaryMilestone(anniversaryDate, today);


  return (
    <MobileShell>
      <div className="pb-28 px-4 pt-5 space-y-5">
        <header className="flex items-center justify-between gap-3">
          <h1 className="text-title text-foreground">우리의 계획</h1>
          <Button
            variant="primary"
            size="sm"
            onClick={openCreateModal}
            disabled={!hasCoupleSpace || loadState !== 'ready' || isOffline}
          >
            <Plus size={14} aria-hidden="true" />
            <span>일정 추가</span>
          </Button>
        </header>

        <PlanSectionNav active="schedule" />

        {!authenticatedUser ? (
          <EmptyState
            icon={<ShieldAlert size={20} className="text-muted-foreground" />}
            title="로그인 권한이 필요해요"
            description="일정은 계정과 연결된 공간에서만 안전하게 확인하고 등록할 수 있어요."
          />
        ) : loadState === 'loading' ? (
          <EmptyState
            icon={<RefreshCw size={20} className="animate-spin text-muted-foreground" />}
            title="일정을 불러오는 중이에요"
            description="공유 범위를 확인해 안전하게 가져오고 있어요."
          />
        ) : loadState === 'forbidden' ? (
          <EmptyState
            icon={<ShieldAlert size={20} className="text-warning" />}
            title="일정을 볼 권한이 없어요"
            description="연결 상태나 계정 권한을 확인한 뒤 다시 시도해 주세요."
            action={<Button size="sm" variant="primary" onClick={() => void retryLoad()}>다시 시도</Button>}
          />
        ) : loadState === 'error' ? (
          <EmptyState
            icon={<RefreshCw size={20} className="text-muted-foreground" />}
            title="일정을 불러오지 못했어요"
            description="서버 연결을 확인한 뒤 다시 시도해 주세요. 기존 일정이 없는 상태와는 다른 오류예요."
            action={<Button size="sm" variant="primary" onClick={() => void retryLoad()}>다시 시도</Button>}
          />
        ) : (
          <>
            {!activeCouple && (
              <Card>
                <div className="flex items-start gap-3">
                  <Users size={18} className="text-muted-foreground mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-label font-semibold text-foreground break-keep">
                      {profile.couple.status === 'pending' ? '파트너 연결을 기다리고 있어요' : '연결된 우리 공간이 없어요'}
                    </p>
                    <p className="text-caption text-muted-foreground mt-0.5 break-keep">
                      {profile.couple.status === 'pending'
                        ? '지금은 나만 보기 일정만 등록할 수 있어요. 공유 일정은 파트너가 연결되면 열려요.'
                        : '기존 비공개 일정만 본인이 계속 확인·수정할 수 있어요. 새 일정과 공유 일정은 연결 후 이용할 수 있어요.'}
                    </p>
                  </div>
                </div>
              </Card>
            )}

            {/* Anniversary D-Day - compact row, not a large card */}
            {anniversaryDate && daysTogether !== null && (
              <div className="flex items-center justify-between px-1 py-2">
                <div className="flex items-center gap-2">
                  <Heart size={14} className="fill-coral text-coral" aria-hidden="true" />
                  <span className="text-label font-semibold text-foreground">함께한 지</span>
                  <span className="text-display text-foreground tabular-nums">
                    {daysTogether > 0 ? `+${daysTogether}일` : dDayLabel(anniversaryDate, today)}
                  </span>
                </div>
                {nextMilestone && (
                  <span className="text-caption text-muted-foreground">
                    {nextMilestone.label} D-{nextMilestone.daysRemaining}
                  </span>
                )}
              </div>
            )}

            {/* Calendar grid */}
            <section aria-label="달력">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-heading text-foreground">{currYear}년 {currMonth + 1}월</h2>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveMonth(-1)}
                    aria-label="이전 달"
                    className="relative min-w-11 min-h-11 flex items-center justify-center rounded-control text-muted-foreground hover:bg-muted"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveMonth(1)}
                    aria-label="다음 달"
                    className="relative min-w-11 min-h-11 flex items-center justify-center rounded-control text-muted-foreground hover:bg-muted"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-7 gap-0.5 text-center text-caption font-medium text-muted-foreground pb-1">
                <span className="text-destructive">일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span className="text-info">토</span>
              </div>
              <div className="grid grid-cols-7 gap-0.5 text-center">
                {Array.from({ length: firstDayOfWeek }).map((_, index) => <div key={`empty-${index}`} className="h-11" />)}
                {Array.from({ length: daysInMonth }).map((_, index) => {
                  const day = index + 1;
                  const date = `${currYear}-${String(currMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const dayEvents = eventsOnDate(events, date);
                  const dayTasks = tasks.filter((task) => task.dueDate === date && !task.completed);
                  const isToday = date === today;
                  const isSelected = date === selectedDate;
                  return (
                    <button
                      type="button"
                      key={date}
                      onClick={() => setSelectedDate(date)}
                      aria-label={`${date}, 일정 ${dayEvents.length}개, 남은 할 일 ${dayTasks.length}개`}
                      aria-pressed={isSelected}
                      className={`min-h-11 min-w-[44px] rounded-control flex flex-col items-center justify-center text-label transition ${
                        isSelected
                          ? 'ring-2 ring-coral bg-coral/10 text-coral font-semibold'
                          : isToday
                            ? 'bg-coral-strong text-coral-strong-foreground font-bold'
                            : 'hover:bg-muted/50 text-foreground'
                      }`}
                    >
                      <span>{day}</span>
                      {(dayEvents.length > 0 || dayTasks.length > 0) && (
                        <span className="flex gap-0.5 mt-0.5" aria-hidden="true">
                          {dayEvents.slice(0, 3).map((event) => (
                            <span key={event.id} className={`w-1 h-1 rounded-full ${event.isPrivate ? 'bg-muted-foreground' : isToday && !isSelected ? 'bg-coral-strong-foreground' : 'bg-coral'}`} />
                          ))}
                          {dayTasks.length > 0 && <span className="w-1 h-1 rounded-sm bg-info" />}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Selected date events and tasks */}
            <section>
              <SectionHeader
                title={`${selectedDate.slice(5)} 일정`}
                action={
                  <button
                    type="button"
                    onClick={openCreateModal}
                    disabled={!hasCoupleSpace || isOffline}
                    className="text-caption font-semibold text-info disabled:opacity-40 min-h-11 flex items-center"
                  >
                    이 날짜에 추가
                  </button>
                }
              />

              {/* Quick task creation */}
              {activeCouple && (
                <div className="flex gap-2 mb-3">
                  <input
                    value={taskTitle}
                    onChange={(event) => setTaskTitle(event.target.value.slice(0, 120))}
                    onKeyDown={(event) => { if (event.key === 'Enter') void handleCreateTask(); }}
                    placeholder="우리 할 일 빠르게 추가"
                    className="flex-1 min-w-0 bg-muted rounded-control px-3 py-2 text-body outline-none focus:ring-2 focus:ring-info/40 min-h-11"
                  />
                  <input
                    type="time"
                    value={taskTime}
                    onChange={(event) => setTaskTime(event.target.value)}
                    aria-label="할 일 시간"
                    className="w-20 bg-muted rounded-control px-2 py-2 text-body min-h-11"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleCreateTask()}
                    disabled={isSavingTask || !taskTitle.trim() || isOffline}
                  >
                    추가
                  </Button>
                </div>
              )}
              {activeCouple && (
                /*
                 * The native checkbox paints at 13x13 and cannot be resized reliably
                 * across browsers, so the tap target is the LABEL: `min-h-11` makes the
                 * whole row 44px tall, and wrapping the input means a tap anywhere on
                 * the row toggles it.
                 *
                 * `aria-label` is added because the accessible name came from the label
                 * text alone, which reads as `내 담당으로 표시` with no indication that
                 * it is about a task -- fine in place, thin when announced out of
                 * context in a form with two other inputs.
                 */
                <label className="flex items-center gap-2 text-caption text-muted-foreground mb-3 px-1 min-h-11 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={taskForMe}
                    onChange={(event) => setTaskForMe(event.target.checked)}
                    aria-label="이 할 일을 내 담당으로 표시"
                    className="accent-info w-4 h-4"
                  />
                  내 담당으로 표시
                </label>
              )}

              {/* Tasks list */}
              {selectedTasks.length > 0 && (
                <RowGroup className="mb-3">
                  {selectedTasks.map((task) => {
                    const pending = pendingTaskIds.has(task.id);
                    return (
                      <ListRow
                        key={task.id}
                        leading={
                          <button
                            type="button"
                            onClick={() => void handleToggleTask(task)}
                            disabled={pending || isOffline}
                            aria-label={`${task.title} ${task.completed ? '미완료로 변경' : '완료로 변경'}`}
                            className="text-info disabled:opacity-40 min-w-11 min-h-11 flex items-center justify-center -m-2"
                          >
                            {task.completed ? <CheckCircle2 size={18} /> : <Circle size={18} />}
                          </button>
                        }
                        trailing={
                          task.createdBy === authenticatedUser?.id ? (
                            <button
                              type="button"
                              onClick={() => void handleDeleteTask(task)}
                              disabled={pending || isOffline}
                              aria-label={`${task.title} 할 일 삭제`}
                              className="min-w-11 min-h-11 flex items-center justify-center -m-2 text-muted-foreground hover:text-destructive disabled:opacity-40"
                            >
                              <Trash2 size={14} />
                            </button>
                          ) : undefined
                        }
                        density="tight"
                      >
                        <p className={`text-label font-semibold break-keep ${task.completed ? 'line-through text-muted-foreground' : 'text-foreground'}`}>{task.title}</p>
                        <p className="text-caption text-muted-foreground tabular-nums">{task.dueTime || '시간 미정'} · {task.assigneeId === authenticatedUser?.id ? '내 담당' : '함께'}</p>
                      </ListRow>
                    );
                  })}
                </RowGroup>
              )}

              {/* Events for selected date */}
              {selectedEvents.length > 0 && (
                <RowGroup>
                  {selectedEvents.map((event) => {
                    const badge = EVENT_BADGES[event.eventType];
                    const isAuthor = event.createdBy === authenticatedUser?.id;
                    return (
                      <ListRow
                        key={event.id}
                        leading={
                          <span className="text-caption text-muted-foreground tabular-nums w-11 text-right shrink-0">
                            {event.startDate === selectedDate ? dDayLabel(event.startDate, today) : event.startDate.slice(5)}
                          </span>
                        }
                        trailing={
                          isAuthor ? (
                            <div className="flex items-center">
                              <button
                                type="button"
                                onClick={() => openEditModal(event)}
                                disabled={isSaving || deletingEventId !== null || isOffline}
                                aria-label={`${event.title} 일정 수정`}
                                className="min-w-11 min-h-11 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeleteEvent(event)}
                                disabled={deletingEventId !== null || isSaving || isOffline}
                                aria-label={`${event.title} 일정 삭제`}
                                className="min-w-11 min-h-11 flex items-center justify-center text-muted-foreground hover:text-destructive disabled:opacity-40"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          ) : undefined
                        }
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-label font-semibold text-foreground break-keep">{event.title}</span>
                          <Badge tone={badge.tone}>{badge.label}</Badge>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {event.isPrivate ? (
                            <span className="flex items-center gap-1 text-caption text-muted-foreground"><Lock size={10} />나만 보기</span>
                          ) : (
                            <span className="flex items-center gap-1 text-caption text-muted-foreground"><Users size={10} />둘이 보기</span>
                          )}
                          {event.talkAbout && <span className="text-caption font-medium text-coral-strong">꼭 얘기</span>}
                        </div>
                      </ListRow>
                    );
                  })}
                </RowGroup>
              )}

              {selectedEvents.length === 0 && selectedTasks.length === 0 && (
                <EmptyState
                  icon={<ListTodo size={18} className="text-muted-foreground" />}
                  title="선택한 날짜에 일정과 할 일이 없어요."
                />
              )}
            </section>

            {/* Upcoming events */}
            <section>
              <SectionHeader title="다가오는 일정" />
              {upcoming.length > 0 ? (
                <RowGroup>
                  {upcoming.map((event) => {
                    const badge = EVENT_BADGES[event.eventType];
                    const isAuthor = event.createdBy === authenticatedUser?.id;
                    const isOngoing = event.startDate < today && (event.endDate || event.startDate) >= today;
                    return (
                      <ListRow
                        key={event.id}
                        leading={
                          <span className="text-caption text-muted-foreground tabular-nums w-11 text-right">
                            {isOngoing ? '진행 중' : dDayLabel(event.startDate, today)}
                          </span>
                        }
                        trailing={
                          isAuthor ? (
                            <div className="flex items-center">
                              <button
                                type="button"
                                onClick={() => openEditModal(event)}
                                disabled={isSaving || deletingEventId !== null || isOffline}
                                aria-label={`${event.title} 일정 수정`}
                                className="min-w-11 min-h-11 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeleteEvent(event)}
                                disabled={deletingEventId !== null || isSaving || isOffline}
                                aria-label={`${event.title} 일정 삭제`}
                                className="min-w-11 min-h-11 flex items-center justify-center text-muted-foreground hover:text-destructive disabled:opacity-40"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          ) : undefined
                        }
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-label font-semibold text-foreground break-keep">{event.title}</span>
                          <Badge tone={badge.tone}>{badge.label}</Badge>
                        </div>
                        <p className="text-caption text-muted-foreground mt-0.5">
                          {event.startDate}{event.endDate ? ` ~ ${event.endDate}` : ''}
                          {event.isPrivate && ' · 나만 보기'}
                          {event.talkAbout && ' · 꼭 얘기'}
                        </p>
                      </ListRow>
                    );
                  })}
                </RowGroup>
              ) : (
                <EmptyState
                  icon={<Clock size={18} className="text-muted-foreground" />}
                  title="다가오는 일정이 없어요."
                  description="지난 일정은 날짜를 선택하면 다시 볼 수 있어요."
                />
              )}
            </section>
          </>
        )}

        {/* Event create/edit modal — z-[60] above the tab bar */}
        {showEventModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
            <div role="dialog" aria-modal="true" aria-labelledby="event-modal-title" className="bg-card rounded-surface p-4 max-w-sm w-full space-y-4 border border-border">
              <div className="flex items-center justify-between">
                <h3 id="event-modal-title" className="text-heading text-foreground">{editingEventId ? '일정 수정' : '새 일정 추가'}</h3>
                <button type="button" onClick={() => setShowEventModal(false)} disabled={isSaving} aria-label="닫기" className="min-w-11 min-h-11 flex items-center justify-center text-muted-foreground disabled:opacity-40"><X size={18} /></button>
              </div>
              <div className="space-y-3">
                <div>
                  <label htmlFor="event-title" className="block text-caption text-muted-foreground font-medium mb-1">일정 제목 *</label>
                  <input id="event-title" type="text" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="예: 첫 휴가 / 주말 데이트" className="w-full px-3 py-2 rounded-control border border-border bg-background text-foreground text-body focus:outline-none focus:ring-2 focus:ring-coral/40 min-h-11" />
                </div>
                <div>
                  <label htmlFor="event-type" className="block text-caption text-muted-foreground font-medium mb-1">일정 유형</label>
                  <select id="event-type" value={eventType} onChange={(event) => setEventType(event.target.value as EventType)} className="w-full px-3 py-2 rounded-control border border-border bg-background text-foreground text-body focus:outline-none focus:ring-2 focus:ring-coral/40 min-h-11">
                    {(Object.entries(EVENT_BADGES) as [EventType, { label: string }][]).map(([value, badge]) => <option key={value} value={value}>{badge.label}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label htmlFor="event-start" className="block text-caption text-muted-foreground font-medium mb-1">시작일 *</label>
                    <input id="event-start" type="date" value={eventStartDate} onChange={(event) => setEventStartDate(event.target.value)} className="w-full px-2 py-2 rounded-control border border-border bg-background text-foreground text-body min-h-11" />
                  </div>
                  <div>
                    <label htmlFor="event-end" className="block text-caption text-muted-foreground font-medium mb-1">종료일</label>
                    <input id="event-end" type="date" value={eventEndDate} onChange={(event) => setEventEndDate(event.target.value)} className="w-full px-2 py-2 rounded-control border border-border bg-background text-foreground text-body min-h-11" />
                  </div>
                </div>
                <fieldset className="space-y-2">
                  <legend className="text-caption text-muted-foreground font-medium">공개 범위 *</legend>
                  <label className={`flex items-center gap-3 px-3 py-2 rounded-control border cursor-pointer min-h-11 ${!isPrivate ? 'border-coral bg-coral/5' : 'border-border'}`}>
                    <input type="radio" name="visibility" checked={!isPrivate} onChange={() => setIsPrivate(false)} disabled={!activeCouple} className="accent-coral" />
                    <Users size={14} className="text-coral shrink-0" />
                    <span className="min-w-0"><strong className="block text-label text-foreground">둘이 보기</strong><span className="text-caption text-muted-foreground">파트너도 읽을 수 있어요.</span></span>
                  </label>
                  <label className={`flex items-center gap-3 px-3 py-2 rounded-control border cursor-pointer min-h-11 ${isPrivate ? 'border-coral bg-coral/5' : 'border-border'}`}>
                    <input type="radio" name="visibility" checked={isPrivate} onChange={() => setIsPrivate(true)} className="accent-coral" />
                    <Lock size={14} className="text-muted-foreground shrink-0" />
                    <span className="min-w-0"><strong className="block text-label text-foreground">나만 보기</strong><span className="text-caption text-muted-foreground">작성자 본인만 읽을 수 있어요.</span></span>
                  </label>
                </fieldset>
                {!isPrivate && (
                  <label className="flex items-center gap-2 rounded-control bg-coral/5 px-3 py-2 font-medium text-label text-coral-strong min-h-11">
                    <input type="checkbox" checked={talkAbout} onChange={(event) => setTalkAbout(event.target.checked)} className="accent-coral" />
                    통화 때 꼭 얘기
                  </label>
                )}
                {formError && <p role="alert" className="rounded-control bg-destructive/10 px-3 py-2 text-caption font-medium text-destructive">{formError}</p>}
              </div>
              <div className="flex gap-2 pt-1">
                <Button variant="secondary" size="md" full onClick={() => setShowEventModal(false)} disabled={isSaving}>취소</Button>
                <Button variant="primary" size="md" full onClick={() => void handleSaveEvent()} disabled={isSaving || isOffline}>
                  {isSaving ? '저장 중...' : editingEventId ? '수정하기' : '등록하기'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </MobileShell>
  );
}
