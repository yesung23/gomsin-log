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
import { ErrorNote } from '@/components/ui/ErrorNote';
import { classifyServerError, serverErrorMessage } from '@/lib/serverErrors';
import { MobileShell } from '@/components/MobileShell';
import { groupIntoRuns, describeRuns, nextDay, type DateRun } from '@/lib/dateRuns';
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
  /*
    여러 날을 한 번에 고르기 (2026-08-22).

    커플 일정은 대부분 **연속된 날**이다 -- 휴가 3박 4일, 여행 닷새. 하루씩 네 번 넣게
    하면 같은 일정이 네 개가 되고 `우리` 격자에도 네 번 찍힌다. 이벤트 모델이 이미
    `startDate` + `endDate` 범위이므로, 끌어서 고른 범위가 그대로 한 건이 된다.

    ## 왜 좌표로 찾는가

    터치에서는 `pointerdown` 이 일어난 요소로 포인터가 **암묵적으로 캡처된다.** 손가락이
    옆 칸으로 옮겨가도 이벤트의 target 은 처음 칸이고, 그 칸의 `onPointerEnter` 는 영영
    오지 않는다. 마우스로는 되고 폰에서는 안 되는, 정확히 이 앱의 대상에서만 죽는
    코드다. 격자가 `pointermove` 를 받아 손가락 좌표 아래의 날을 직접 찾는다.

    ## 왜 확정값을 ref 에서 읽는가

    `pointermove` 는 React 의 continuous 이벤트여서 그 안의 setState 가 즉시 flush 되지
    않는다. 손가락을 빠르게 튕기면 `pointerup` 이 그 렌더보다 먼저 도착하고, 그때 state
    는 아직 비어 있어 방금 잡은 범위가 통째로 사라진다.
  */
  /*
    ## 범위 하나에서 **고른 날들**로 (2026-08-23)

    앞의 판은 연속 범위 하나만 가질 수 있었다. 이번 달에 면회가 세 번인 사람은 같은
    일을 세 번 반복해야 했고, 그것이 "여러 개 선택해서 한 번에" 라는 요청의 내용이다.

    이제 상태는 **고른 날들의 집합**이다. 끌면 그 구간이 집합에 더해지고, 톡 누르면 그
    하루가 켜지고 꺼진다. 저장할 때 `groupIntoRuns` 가 연속 구간으로 잘라 주고 구간
    하나가 일정 하나가 된다 -- 붙은 날은 기간 하나로, 흩어진 날은 각각 하루로.
  */
  const [picking, setPicking] = useState(false);
  const [pickedDays, setPickedDays] = useState<string[]>([]);
  /** 손가락이 지나가는 동안의 구간. 놓을 때 집합에 합쳐진다. */
  const [dragFrom, setDragFrom] = useState<string | null>(null);
  const [dragTo, setDragTo] = useState<string | null>(null);
  const pickAnchor = useRef<string | null>(null);
  const pickEnd = useRef<string | null>(null);
  const pickDragged = useRef(false);
  /*
    확정값을 ref 에도 둔다. `pointermove` 는 continuous 이벤트여서 그 안의 setState 가
    즉시 flush 되지 않고, 손가락을 빠르게 튕기면 `pointerup` 이 그 렌더보다 먼저
    도착한다. 그때 state 는 아직 비어 있다.
  */
  const dragRange = useRef<[string, string] | null>(null);
  /*
    구간이 여럿일 때만 채워진다. 폼은 제목·종류·공개 범위 하나만 받고 이것이 날짜를
    들고 있다가, 저장할 때 구간마다 한 건씩 만든다. 하나뿐이면 `null` 이고 앞의
    경로가 그대로 돈다 -- 대부분의 일정은 여전히 한 건이다.
  */
  const [pendingRuns, setPendingRuns] = useState<DateRun[] | null>(null);

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

  const dayUnder = (x: number, y: number): string | null => {
    const cell = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-cal-date]');
    return cell?.dataset.calDate ?? null;
  };

  const onGridDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!picking) return;
    const date = dayUnder(event.clientX, event.clientY);
    pickAnchor.current = date;
    pickEnd.current = date;
    pickDragged.current = false;
    dragRange.current = null;
    setDragFrom(null);
    setDragTo(null);
  };

  const onGridMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!picking || !pickAnchor.current) return;
    const date = dayUnder(event.clientX, event.clientY);
    if (!date || date === pickEnd.current) return;
    pickDragged.current = true;
    pickEnd.current = date;
    const [from, to] = [pickAnchor.current, date].sort();
    dragRange.current = [from, to];
    setDragFrom(from);
    setDragTo(to);
  };

  /*
    놓는 순간 지나온 구간이 **집합에 합쳐진다.** 끌기는 지우지 않는다 -- 지우는 것은
    톡 누르는 쪽의 일이다. 끌어서 지우게 하면 손가락이 스치기만 해도 고른 날이
    사라지고, 그러면 여러 날을 모으는 동안 마음 놓고 끌 수 없다.
  */
  const onGridUp = () => {
    if (!picking) return;
    const range = dragRange.current;
    pickAnchor.current = null;
    dragRange.current = null;
    setDragFrom(null);
    setDragTo(null);
    if (!range) return;
    const [from, to] = range;
    setPickedDays((current) => {
      const next = new Set(current);
      for (let day = from; day <= to; day = nextDay(day)) next.add(day);
      return [...next].sort();
    });
  };

  const cancelPicking = () => {
    setPicking(false);
    setPickedDays([]);
    setDragFrom(null);
    setDragTo(null);
    pickAnchor.current = null;
    pickEnd.current = null;
    pickDragged.current = false;
    dragRange.current = null;
  };

  /**
   * 고른 것을 사람이 읽는 말로. 며칠인지와 **몇 건이 되는지**를 둘 다 말한다 --
   * 흩어진 날을 고른 사람은 저장 전에 그것이 여러 건이 된다는 것을 알아야 한다.
   */
  const pickedLabel = describeRuns(pickedDays);
  const pickedSet = new Set(pickedDays);

  /*
    고른 범위로 폼을 연다.

    하루만 골랐으면 `endDate` 를 비운다 -- 시작일과 같은 종료일을 저장하면 하루짜리
    일정이 기간 일정처럼 읽히고, 기존 데이터와도 모양이 달라진다.
  */
  /*
    고른 날들로 폼을 연다.

    구간이 하나면 앞과 똑같다 -- 시작일과 종료일이 폼에 들어가고 한 건이 저장된다.
    구간이 여럿이면 폼은 제목·종류·공개 범위만 받고, 날짜는 `pendingRuns` 가 들고
    있다가 저장할 때 구간마다 한 건씩 만든다.
  */
  const openCreateFromPick = () => {
    const runs = groupIntoRuns(pickedDays);
    if (runs.length === 0) return;
    setEditingEventId(null);
    setTitle('');
    setEventType('visit');
    setEventStartDate(runs[0].start);
    setEventEndDate(runs[0].end ?? '');
    setPendingRuns(runs.length > 1 ? runs : null);
    setIsPrivate(!activeCouple);
    setTalkAbout(false);
    setFormError(null);
    setPicking(false);
    setShowEventModal(true);
  };

  const openCreateModal = () => {
    if (!hasCoupleSpace) return;
    setEditingEventId(null);
    setPendingRuns(null);
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
    setPendingRuns(null);
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
      /*
        여러 구간을 한 번에.

        구간마다 한 건이므로 **일부만 성공할 수 있다.** 전부 성공한 것처럼 말하면
        사용자는 격자를 보고서야 빠진 것을 알게 되고, 그때는 무엇이 빠졌는지 스스로
        세어야 한다. 그래서 몇 건이 되었고 몇 건이 안 되었는지 그대로 말한다.

        하나라도 성공하면 폼은 닫는다 -- 남은 것을 다시 넣게 하려고 열어 두면 이미
        저장된 것까지 한 번 더 만들기 쉽다.
      */
      if (pendingRuns && !editingEventId) {
        const results = [];
        for (const run of pendingRuns) {
          const created = await addEvent({
            coupleId: profile.couple.coupleId!,
            createdBy: authenticatedUser.id,
            ...changes,
            startDate: run.start,
            endDate: run.end,
          });
          results.push(Boolean(created));
        }
        if (!isCurrentAccess(access)) return;
        const done = results.filter(Boolean).length;
        if (done === 0) {
          const message = '일정을 저장하지 못했습니다. 입력 내용은 유지되니 다시 시도해 주세요.';
          setFormError(message);
          toast.error(message);
          return;
        }
        if (done < results.length) {
          toast.warning(`${results.length}건 중 ${done}건만 등록했어요. 나머지는 다시 시도해 주세요.`);
        } else {
          toast.success(`일정 ${done}건을 등록했습니다.`);
        }
        setSelectedDate(pendingRuns[0].start);
        setPendingRuns(null);
        setPickedDays([]);
        setShowEventModal(false);
        setEditingEventId(null);
        return;
      }

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
      {/*
        일정이 공책 위로 옮겨졌다 (2026-08-22, §5).

        달력 문법은 이 앱에서 여기만 소유한다 -- 요일을 맞추고 미래를 담는다. 표면만
        바뀌었고 셀 계산·이벤트·실시간 구독은 그대로다.
      */}
      <div className="notebook min-h-full pb-28 px-4 pt-5 space-y-5">
        {/*
          제목줄을 걷어냈다 (2026-08-23).

          `우리의 계획` 이라는 앱바와 그 아래 `2026년 8월` 이 따로 있었다. 프리뷰는 달
          이름이 곧 헤더이고 그 줄 오른쪽에 `‹ › +` 가 있다 -- 인스타의 화면들이 그렇듯
          제목이 곧 지금 보고 있는 것이다. 화면 이름을 한 번 더 적는 줄은 종이를 먹는다.

          `+` 는 채운 알약이 아니라 펜 획이다. 종이 위에서 채운 알약은 그 화면에서 유일하게
          앱처럼 보이는 물건이 된다.
        */}

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
                <h2 className="text-heading" style={{ color: 'var(--ink)' }}>{currYear}년 {currMonth + 1}월</h2>
                <div className="flex items-center gap-1">
                  {picking ? (
                    <button
                      type="button"
                      onClick={cancelPicking}
                      className="press-response min-h-11 px-2 text-label"
                      style={{ color: 'var(--ink-soft)' }}
                    >
                      취소
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => moveMonth(-1)}
                    aria-label="이전 달"
                    className="press-response relative min-w-11 min-h-11 flex items-center justify-center rounded-control"
                  >
                    <ChevronLeft size={18} className="pen-icon" color="var(--ink)" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveMonth(1)}
                    aria-label="다음 달"
                    className="press-response relative min-w-11 min-h-11 flex items-center justify-center rounded-control"
                  >
                    <ChevronRight size={18} className="pen-icon" color="var(--ink)" />
                  </button>
                  {!picking ? (
                    <button
                      type="button"
                      aria-label="일정 추가"
                      onClick={() => {
                        if (!hasCoupleSpace) return;
                        setPicking(true);
                        setPickedDays([]);
                      }}
                      disabled={!hasCoupleSpace || loadState !== 'ready' || isOffline}
                      className="press-response relative min-w-11 min-h-11 flex items-center justify-center rounded-control disabled:opacity-40"
                    >
                      <Plus size={22} className="pen-icon" color="var(--ink)" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="grid grid-cols-7 gap-0.5 pb-1 text-center text-caption" style={{ color: 'var(--ink-soft)' }}>
                <span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span>
              </div>
              <div
                className="grid grid-cols-7 gap-0.5 text-center"
                onPointerDown={onGridDown}
                onPointerMove={onGridMove}
                onPointerUp={onGridUp}
                /* 손가락이 격자 밖에서 떨어져도 끌기는 끝나야 한다. 잡힌 채 남으면 유령 선택이 된다. */
                onPointerCancel={onGridUp}
                onPointerLeave={onGridUp}
                style={{ touchAction: picking ? 'none' : undefined }}
              >
                {Array.from({ length: firstDayOfWeek }).map((_, index) => <div key={`empty-${index}`} className="h-11" />)}
                {Array.from({ length: daysInMonth }).map((_, index) => {
                  const day = index + 1;
                  const date = `${currYear}-${String(currMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const dayEvents = eventsOnDate(events, date);
                  const dayTasks = tasks.filter((task) => task.dueDate === date && !task.completed);
                  const isToday = date === today;
                  /*
                    고른 날 **또는** 지금 손가락이 지나고 있는 구간. 끌기는 놓아야
                    집합에 들어가므로, 그 전까지는 미리보기로만 켜진다.
                  */
                  const inDrag = Boolean(dragFrom && date >= dragFrom && date <= (dragTo || dragFrom));
                  const inPick = picking && (pickedSet.has(date) || inDrag);
                  const isSelected = picking ? inPick : date === selectedDate;
                  return (
                    <button
                      type="button"
                      key={date}
                      data-cal-date={date}
                      /*
                        고르는 동안 탭은 그 하루를 **켜고 끈다.** 끌기가 끝난 뒤
                        브라우저가 보내는 click 은 anchor 가 이미 비어 있어도 도착하므로
                        끌었을 때는 삼킨다 -- 안 그러면 방금 끌어 담은 구간의 끝 날이
                        곧바로 꺼진다.

                        토글이어야 하는 이유: 여러 날을 모으는 일에는 **잘못 누르는 일**이
                        딸려 온다. 되돌리는 길이 전체 취소밖에 없으면 열두 번 고른 사람이
                        열세 번째에 잘못 눌렀을 때 처음부터 다시 해야 한다.
                      */
                      onClick={() => {
                        if (!picking) { setSelectedDate(date); return; }
                        if (pickDragged.current) { pickDragged.current = false; return; }
                        pickEnd.current = date;
                        setPickedDays((current) => (current.includes(date)
                          ? current.filter((one) => one !== date)
                          : [...current, date].sort()));
                      }}
                      aria-label={picking
                        ? `${date}${inPick ? ', 선택됨' : ''}`
                        : `${date}, 일정 ${dayEvents.length}개, 남은 할 일 ${dayTasks.length}개`}
                      aria-pressed={isSelected}
                      /*
                        달력 칸도 손으로 그린 것이다 (2026-08-23).

                        오늘은 잉크로 채운 삐뚤한 사각형, 고른 날은 강조 잉크. 링과 채움을
                        같은 반경으로 두면 자로 그린 캘린더 앱이 되고, 그러면 이 화면만
                        공책이 아니게 된다.
                      */
                      className="press-response min-h-11 min-w-[44px] flex flex-col items-center justify-center text-label"
                      style={
                        isSelected
                          ? {
                            color: 'var(--paper)',
                            background: 'var(--ink-accent)',
                            borderRadius: '60px 6px 66px 6px / 6px 66px 6px 60px',
                            fontWeight: 600,
                          }
                          : isToday
                            ? {
                              color: 'var(--paper)',
                              background: 'var(--ink)',
                              borderRadius: '60px 6px 66px 6px / 6px 66px 6px 60px',
                              fontWeight: 700,
                            }
                            : { color: 'var(--ink)' }
                      }
                    >
                      <span>{day}</span>
                      {(dayEvents.length > 0 || dayTasks.length > 0) && (
                        <span className="flex gap-0.5 mt-0.5" aria-hidden="true">
                          {dayEvents.slice(0, 3).map((event) => (
                            <span
                              key={event.id}
                              className="w-1 h-1 rounded-full"
                              style={{ background: isToday || isSelected ? 'var(--paper)' : event.isPrivate ? 'var(--ink-soft)' : 'var(--ink-accent)' }}
                            />
                          ))}
                          {dayTasks.length > 0 && <span className="w-1 h-1 rounded-sm bg-info" />}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/*
                고르는 동안의 확정 줄.

                달력 바로 아래에 둔다 -- 방금 고른 것과 그것을 확정하는 버튼 사이에
                화면이 끼면 사용자는 둘을 연결해서 읽지 못한다.
              */}
              {picking ? (
                <div className="mt-3 flex items-center gap-3">
                  <p className="text-label flex-1" style={{ color: 'var(--ink)' }}>{pickedLabel}</p>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={openCreateFromPick}
                    disabled={pickedDays.length === 0}
                  >
                    <span>다음</span>
                  </Button>
                </div>
              ) : (
                <p className="mt-2 text-caption" style={{ color: 'var(--ink-soft)' }}>
                  일정 추가를 누르고 날짜를 끌면 여러 날이 한 번에 잡혀요. 떨어진 날은 하나씩 눌러 더할 수 있어요
                </p>
              )}
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
                    className="press-response text-caption font-semibold disabled:opacity-40 min-h-11 flex items-center" style={{ color: 'var(--ink)' }}
                  >
                    이 날짜에 추가
                  </button>
                }
              />

              {/* Quick task creation */}
              {activeCouple && (
                /*
                  두 줄로 나눴다 (2026-08-23).

                  한 줄에 제목·시간·버튼을 나란히 두었더니 제목이 `flex-1` 로 남는 폭을
                  전부 먹고 시간 입력이 `w-20`(80px)에 갇혔다. `<input type="time">` 은
                  브라우저가 그리는 컨트롤이라 안에 `--:--` 와 시계 아이콘이 들어가야
                  하는데 80px 로는 글자가 잘리고, **화면에서 무시되는 컨트롤**이 됐다.

                  제목이 한 줄을 다 쓰고, 시간과 버튼이 그 아래 한 줄을 나눠 갖는다.
                  시간에 최소 폭을 주고 `tabular-nums` 로 숫자 폭을 고정해 값이 바뀔 때
                  줄이 흔들리지 않는다.
                */
                <div className="mb-3 space-y-2">
                  <input
                    value={taskTitle}
                    onChange={(event) => setTaskTitle(event.target.value.slice(0, 120))}
                    onKeyDown={(event) => { if (event.key === 'Enter') void handleCreateTask(); }}
                    placeholder="우리 할 일 빠르게 추가"
                    aria-label="할 일 제목"
                    className="ink-chip w-full bg-transparent px-3 py-2 text-body outline-none min-h-11"
                  />
                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      value={taskTime}
                      onChange={(event) => setTaskTime(event.target.value)}
                      aria-label="할 일 시간"
                      className="ink-chip min-w-[7.5rem] flex-1 bg-transparent px-3 py-2 text-body tabular-nums min-h-11"
                      style={{ color: 'var(--ink)' }}
                    />
                    {/* 시간을 지우는 길. 한 번 넣으면 못 비우는 입력은 되돌릴 수 없다. */}
                    {taskTime ? (
                      <button
                        type="button"
                        onClick={() => setTaskTime('')}
                        aria-label="시간 지우기"
                        className="press-response min-h-11 min-w-11 flex items-center justify-center"
                        style={{ color: 'var(--ink-soft)' }}
                      >
                        <X size={16} className="pen-icon" aria-hidden="true" />
                      </button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleCreateTask()}
                      disabled={isSavingTask || !taskTitle.trim() || isOffline}
                    >
                      추가
                    </Button>
                  </div>
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
                            className="press-response disabled:opacity-40 min-w-11 min-h-11 flex items-center justify-center -m-2" style={{ color: 'var(--ink)' }}
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
                              className="press-response min-w-11 min-h-11 flex items-center justify-center -m-2 text-muted-foreground hover:text-destructive disabled:opacity-40"
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
                                className="press-response min-w-11 min-h-11 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeleteEvent(event)}
                                disabled={deletingEventId !== null || isSaving || isOffline}
                                aria-label={`${event.title} 일정 삭제`}
                                className="press-response min-w-11 min-h-11 flex items-center justify-center text-muted-foreground hover:text-destructive disabled:opacity-40"
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
                                className="press-response min-w-11 min-h-11 flex items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDeleteEvent(event)}
                                disabled={deletingEventId !== null || isSaving || isOffline}
                                aria-label={`${event.title} 일정 삭제`}
                                className="press-response min-w-11 min-h-11 flex items-center justify-center text-muted-foreground hover:text-destructive disabled:opacity-40"
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
                <button type="button" onClick={() => setShowEventModal(false)} disabled={isSaving} aria-label="닫기" className="press-response min-w-11 min-h-11 flex items-center justify-center text-muted-foreground disabled:opacity-40"><X size={18} /></button>
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
                {formError && <ErrorNote>{formError}</ErrorNote>}
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
