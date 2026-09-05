import { StrictMode, type ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localToday, toLocalDateString } from '@/lib/utils';
import type { AppState, CoupleTask } from '@/types';

const taskMocks = vi.hoisted(() => ({
  fetchTasks: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
}));
const realtime = vi.hoisted(() => ({
  callbacks: [] as Array<(payload?: unknown) => void>,
  statuses: [] as Array<(status: string) => void>,
  channel: vi.fn(),
  removeChannel: vi.fn(),
}));
const reloadEvents = vi.hoisted(() => vi.fn());

vi.mock('@/components/MobileShell', () => ({
  MobileShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/tasks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tasks')>()),
  fetchTasks: taskMocks.fetchTasks,
  createTask: taskMocks.createTask,
  updateTask: taskMocks.updateTask,
  deleteTask: taskMocks.deleteTask,
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: realtime.channel,
    removeChannel: realtime.removeChannel,
  },
}));

let currentState: AppState;
vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: currentState,
    addEvent: vi.fn(),
    updateEvent: vi.fn(),
    deleteEvent: vi.fn(),
    reloadEvents,
    sharedSyncStatus: 'live',
  }),
}));

const { SchedulePage } = await import('./SchedulePage');
const TODAY = toLocalDateString(localToday());

function stateFor(userId: string, coupleId: string): AppState {
  return {
    authenticatedUser: { id: userId, provider: 'google' },
    profile: {
      id: userId,
      myName: userId,
      role: 'gomsin',
      couple: {
        coupleId,
        partnerName: '파트너',
        coupleCode: '',
        connected: true,
        status: 'active',
      },
      military: {},
      contact: {},
    },
    events: [],
    records: [],
    trips: [],
    widgetLayout: [],
  } as AppState;
}

function task(id: string, title: string, coupleId = 'couple-a', createdBy = 'user-a'): CoupleTask {
  return {
    id,
    coupleId,
    createdBy,
    title,
    dueDate: TODAY,
    completed: false,
    isPrivate: false,
    createdAt: `${TODAY}T00:00:00.000Z`,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function renderSchedule(strict = false) {
  const page = <MemoryRouter><SchedulePage /></MemoryRouter>;
  return render(strict ? <StrictMode>{page}</StrictMode> : page);
}

beforeEach(() => {
  currentState = stateFor('user-a', 'couple-a');
  taskMocks.fetchTasks.mockReset().mockResolvedValue({ ok: true, tasks: [] });
  taskMocks.createTask.mockReset();
  taskMocks.updateTask.mockReset();
  taskMocks.deleteTask.mockReset();
  reloadEvents.mockReset().mockResolvedValue({ ok: true });
  realtime.callbacks.length = 0;
  realtime.statuses.length = 0;
  realtime.removeChannel.mockReset().mockResolvedValue(undefined);
  realtime.channel.mockReset().mockImplementation(() => {
    const channel = {
      on: vi.fn((_event, _filter, callback: () => void) => {
        realtime.callbacks.push(callback);
        return channel;
      }),
      subscribe: vi.fn((callback?: (status: string) => void) => {
        if (callback) realtime.statuses.push(callback);
        return channel;
      }),
    };
    return channel;
  });
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
});

describe('SchedulePage task read state', () => {
  it('does not call an unfinished task request an empty day', async () => {
    const pending = deferred<{ ok: true; tasks: CoupleTask[] }>();
    taskMocks.fetchTasks.mockReturnValueOnce(pending.promise);
    renderSchedule();

    expect(await screen.findByText('할 일을 불러오는 중이에요')).toBeInTheDocument();
    expect(screen.queryByText('선택한 날짜에 일정과 할 일이 없어요.')).not.toBeInTheDocument();

    await act(async () => pending.resolve({ ok: true, tasks: [] }));
    expect(await screen.findByText('선택한 날짜에 일정과 할 일이 없어요.')).toBeInTheDocument();
  });

  it('names a failed task read and retries it separately from events', async () => {
    const user = userEvent.setup();
    taskMocks.fetchTasks
      .mockResolvedValueOnce({ ok: false, reason: 'error' })
      .mockResolvedValueOnce({ ok: true, tasks: [] });
    renderSchedule();

    expect(await screen.findByText('할 일을 불러오지 못했어요')).toBeInTheDocument();
    expect(screen.queryByText('선택한 날짜에 일정과 할 일이 없어요.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '할 일 다시 시도' }));
    expect(await screen.findByText('선택한 날짜에 일정과 할 일이 없어요.')).toBeInTheDocument();
    expect(reloadEvents).toHaveBeenCalledTimes(1);
  });

  it('clears the previous couple before the next task request resolves', async () => {
    const nextCouple = deferred<{ ok: true; tasks: CoupleTask[] }>();
    taskMocks.fetchTasks
      .mockResolvedValueOnce({ ok: true, tasks: [task('a', '이전 커플의 할 일')] })
      .mockReturnValueOnce(nextCouple.promise);
    const view = renderSchedule();
    expect(await screen.findByText('이전 커플의 할 일')).toBeInTheDocument();

    currentState = stateFor('user-b', 'couple-b');
    view.rerender(<MemoryRouter><SchedulePage /></MemoryRouter>);

    expect(screen.queryByText('이전 커플의 할 일')).not.toBeInTheDocument();
    expect(await screen.findByText('할 일을 불러오는 중이에요')).toBeInTheDocument();
    await act(async () => nextCouple.resolve({
      ok: true,
      tasks: [task('b', '새 커플의 할 일', 'couple-b', 'user-b')],
    }));
    expect(await screen.findByText('새 커플의 할 일')).toBeInTheDocument();
  });

  it('ignores an old couple response that resolves after the account switches', async () => {
    const oldCouple = deferred<{ ok: true; tasks: CoupleTask[] }>();
    const newCouple = deferred<{ ok: true; tasks: CoupleTask[] }>();
    taskMocks.fetchTasks
      .mockReturnValueOnce(oldCouple.promise)
      .mockReturnValueOnce(newCouple.promise);
    const view = renderSchedule();
    expect(await screen.findByText('할 일을 불러오는 중이에요')).toBeInTheDocument();

    currentState = stateFor('user-b', 'couple-b');
    view.rerender(<MemoryRouter><SchedulePage /></MemoryRouter>);
    await act(async () => oldCouple.resolve({
      ok: true,
      tasks: [task('old', '늦게 도착한 이전 커플 할 일')],
    }));

    expect(screen.queryByText('늦게 도착한 이전 커플 할 일')).not.toBeInTheDocument();
    expect(await screen.findByText('할 일을 불러오는 중이에요')).toBeInTheDocument();
    await act(async () => newCouple.resolve({
      ok: true,
      tasks: [task('new', '현재 커플 할 일', 'couple-b', 'user-b')],
    }));
    expect(await screen.findByText('현재 커플 할 일')).toBeInTheDocument();
  });

  it('ignores an older same-access response that arrives after a newer one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const older = deferred<{ ok: true; tasks: CoupleTask[] }>();
    const newer = deferred<{ ok: true; tasks: CoupleTask[] }>();
    taskMocks.fetchTasks
      .mockResolvedValueOnce({ ok: true, tasks: [] })
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    renderSchedule();
    await waitFor(() => expect(realtime.callbacks).toHaveLength(3));

    await act(async () => {
      realtime.callbacks[0]();
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => expect(taskMocks.fetchTasks).toHaveBeenCalledTimes(2));
    await act(async () => {
      realtime.callbacks[0]();
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => expect(taskMocks.fetchTasks).toHaveBeenCalledTimes(3));
    await act(async () => newer.resolve({ ok: true, tasks: [task('new', '최신 할 일')] }));
    expect(await screen.findByText('최신 할 일')).toBeInTheDocument();
    await act(async () => older.resolve({ ok: true, tasks: [task('old', '오래된 응답')] }));
    expect(screen.queryByText('오래된 응답')).not.toBeInTheDocument();
    expect(screen.getByText('최신 할 일')).toBeInTheDocument();
  });

  it('turns a thrown task transport failure into a retryable error state', async () => {
    taskMocks.fetchTasks.mockRejectedValueOnce(new Error('transport failed'));
    renderSchedule();

    expect(await screen.findByText('할 일을 불러오지 못했어요')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '할 일 다시 시도' })).toBeEnabled();
  });

  it('does not let an in-flight task read erase a successful create', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const staleRead = deferred<{ ok: true; tasks: CoupleTask[] }>();
    const created = task('created', '방금 만든 할 일');
    taskMocks.fetchTasks
      .mockResolvedValueOnce({ ok: true, tasks: [] })
      .mockReturnValueOnce(staleRead.promise);
    taskMocks.createTask.mockResolvedValueOnce(created);
    renderSchedule();
    await waitFor(() => expect(realtime.callbacks).toHaveLength(3));
    await screen.findByRole('textbox', { name: '할 일 제목' });

    await act(async () => {
      realtime.callbacks[1]({ new: { slice: 'tasks' } });
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => expect(taskMocks.fetchTasks).toHaveBeenCalledTimes(2));
    fireEvent.change(screen.getByRole('textbox', { name: '할 일 제목' }), {
      target: { value: '방금 만든 할 일' },
    });
    await act(async () => screen.getByRole('button', { name: '추가' }).click());
    expect(await screen.findByText('방금 만든 할 일')).toBeInTheDocument();

    await act(async () => staleRead.resolve({ ok: true, tasks: [] }));
    expect(screen.getByText('방금 만든 할 일')).toBeInTheDocument();
  });

  it('does not append a task twice when its invalidation refetch wins the create-response race', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const createResponse = deferred<CoupleTask>();
    const created = task('created-once', '한 번만 보일 할 일');
    taskMocks.fetchTasks
      .mockResolvedValueOnce({ ok: true, tasks: [] })
      .mockResolvedValueOnce({ ok: true, tasks: [created] })
      .mockResolvedValueOnce({ ok: true, tasks: [created] });
    taskMocks.createTask.mockReturnValueOnce(createResponse.promise);
    renderSchedule();
    await waitFor(() => expect(realtime.callbacks).toHaveLength(3));
    fireEvent.change(screen.getByRole('textbox', { name: '할 일 제목' }), {
      target: { value: created.title },
    });
    await act(async () => screen.getByRole('button', { name: '추가' }).click());
    await waitFor(() => expect(taskMocks.createTask).toHaveBeenCalledTimes(1));

    await act(async () => {
      realtime.callbacks[1]({ new: { slice: 'tasks' } });
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(await screen.findByText(created.title)).toBeInTheDocument();
    await act(async () => createResponse.resolve(created));

    await waitFor(() => expect(taskMocks.fetchTasks).toHaveBeenCalledTimes(3));
    expect(screen.getAllByText(created.title)).toHaveLength(1);
  });

  it('keeps a successful create once and clears its draft when post-response reconciliation fails', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const createResponse = deferred<CoupleTask>();
    const created = task('created-despite-sync-error', '동기화 실패 뒤에도 한 번만');
    taskMocks.fetchTasks
      .mockResolvedValueOnce({ ok: true, tasks: [] })
      .mockResolvedValueOnce({ ok: true, tasks: [created] })
      .mockResolvedValueOnce({ ok: false, reason: 'error' })
      .mockResolvedValueOnce({ ok: true, tasks: [created] });
    taskMocks.createTask.mockReturnValueOnce(createResponse.promise);
    renderSchedule();
    await waitFor(() => expect(realtime.callbacks).toHaveLength(3));
    fireEvent.change(screen.getByRole('textbox', { name: '할 일 제목' }), {
      target: { value: created.title },
    });
    await act(async () => screen.getByRole('button', { name: '추가' }).click());
    await waitFor(() => expect(taskMocks.createTask).toHaveBeenCalledTimes(1));
    await act(async () => {
      realtime.callbacks[1]({ new: { slice: 'tasks' } });
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(await screen.findByText(created.title)).toBeInTheDocument();

    await act(async () => createResponse.resolve(created));
    expect(await screen.findByText('할 일을 불러오지 못했어요')).toBeInTheDocument();
    expect(screen.getAllByText(created.title)).toHaveLength(1);

    await act(async () => screen.getByRole('button', { name: '할 일 다시 시도' }).click());
    const titleInput = await screen.findByRole('textbox', { name: '할 일 제목' });
    expect(titleInput).toHaveValue('');
    expect(screen.getAllByText(created.title)).toHaveLength(1);
  });

  it('does not let an in-flight task read undo a successful completion update', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const original = task('known', '완료할 일');
    const staleRead = deferred<{ ok: true; tasks: CoupleTask[] }>();
    taskMocks.fetchTasks
      .mockResolvedValueOnce({ ok: true, tasks: [original] })
      .mockReturnValueOnce(staleRead.promise);
    taskMocks.updateTask.mockResolvedValueOnce({ ...original, completed: true });
    renderSchedule();
    expect(await screen.findByText('완료할 일')).toBeInTheDocument();
    await waitFor(() => expect(realtime.callbacks).toHaveLength(3));

    await act(async () => {
      realtime.callbacks[1]({ new: { slice: 'tasks' } });
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => expect(taskMocks.fetchTasks).toHaveBeenCalledTimes(2));
    await act(async () => screen.getByRole('button', { name: '완료할 일 완료로 변경' }).click());
    expect(await screen.findByRole('button', { name: '완료할 일 미완료로 변경' })).toBeInTheDocument();

    await act(async () => staleRead.resolve({ ok: true, tasks: [original] }));
    expect(screen.getByRole('button', { name: '완료할 일 미완료로 변경' })).toBeInTheDocument();
  });

  it('re-reads authority instead of letting a delayed task mutation overwrite a newer refetch', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const original = task('known', '수정 전 제목');
    const newer = { ...original, title: '다른 기기의 최신 제목', completed: false };
    const delayedMutation = deferred<CoupleTask>();
    taskMocks.fetchTasks
      .mockResolvedValueOnce({ ok: true, tasks: [original] })
      .mockResolvedValueOnce({ ok: true, tasks: [newer] })
      .mockResolvedValueOnce({ ok: true, tasks: [newer] });
    taskMocks.updateTask.mockReturnValueOnce(delayedMutation.promise);
    renderSchedule();
    expect(await screen.findByText(original.title)).toBeInTheDocument();
    await waitFor(() => expect(realtime.callbacks).toHaveLength(3));

    await act(async () => screen.getByRole('button', { name: `${original.title} 완료로 변경` }).click());
    await waitFor(() => expect(taskMocks.updateTask).toHaveBeenCalledTimes(1));
    await act(async () => {
      realtime.callbacks[1]({ new: { slice: 'tasks' } });
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(await screen.findByText(newer.title)).toBeInTheDocument();

    await act(async () => delayedMutation.resolve({ ...original, completed: true }));
    await waitFor(() => expect(taskMocks.fetchTasks).toHaveBeenCalledTimes(3));
    expect(screen.getByText(newer.title)).toBeInTheDocument();
    expect(screen.queryByText(original.title)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${newer.title} 완료로 변경` })).toBeInTheDocument();
  });

  it('keeps the successful task update when both racing reads fail before committing state', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const original = task('known', '실패 중에도 완료될 일');
    const saved = { ...original, completed: true };
    const delayedMutation = deferred<CoupleTask>();
    taskMocks.fetchTasks
      .mockResolvedValueOnce({ ok: true, tasks: [original] })
      .mockResolvedValueOnce({ ok: false, reason: 'error' })
      .mockResolvedValueOnce({ ok: false, reason: 'error' });
    taskMocks.updateTask.mockReturnValueOnce(delayedMutation.promise);
    renderSchedule();
    expect(await screen.findByText(original.title)).toBeInTheDocument();
    await waitFor(() => expect(realtime.callbacks).toHaveLength(3));

    await act(async () => screen.getByRole('button', { name: `${original.title} 완료로 변경` }).click());
    await act(async () => {
      realtime.callbacks[1]({ new: { slice: 'tasks' } });
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(await screen.findByText('할 일을 불러오지 못했어요')).toBeInTheDocument();
    await act(async () => delayedMutation.resolve(saved));

    await waitFor(() => expect(taskMocks.fetchTasks).toHaveBeenCalledTimes(3));
    expect(screen.getByRole('button', { name: `${original.title} 미완료로 변경` })).toBeDisabled();
  });

  it('does not let an in-flight task read resurrect a successful deletion', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const original = task('known', '삭제할 일');
    const staleRead = deferred<{ ok: true; tasks: CoupleTask[] }>();
    taskMocks.fetchTasks
      .mockResolvedValueOnce({ ok: true, tasks: [original] })
      .mockReturnValueOnce(staleRead.promise);
    taskMocks.deleteTask.mockResolvedValueOnce(true);
    renderSchedule();
    expect(await screen.findByText('삭제할 일')).toBeInTheDocument();
    await waitFor(() => expect(realtime.callbacks).toHaveLength(3));

    await act(async () => {
      realtime.callbacks[1]({ new: { slice: 'tasks' } });
      await vi.advanceTimersByTimeAsync(300);
    });
    await waitFor(() => expect(taskMocks.fetchTasks).toHaveBeenCalledTimes(2));
    await act(async () => screen.getByRole('button', { name: '삭제할 일 할 일 삭제' }).click());
    await waitFor(() => expect(screen.queryByText('삭제할 일')).not.toBeInTheDocument());

    await act(async () => staleRead.resolve({ ok: true, tasks: [original] }));
    expect(screen.queryByText('삭제할 일')).not.toBeInTheDocument();
  });

  it('keeps a successful delete removed when both racing reads fail', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const original = task('known', '동기화 실패 중 삭제할 일');
    const delayedDelete = deferred<boolean>();
    taskMocks.fetchTasks
      .mockResolvedValueOnce({ ok: true, tasks: [original] })
      .mockResolvedValueOnce({ ok: false, reason: 'error' })
      .mockResolvedValueOnce({ ok: false, reason: 'error' });
    taskMocks.deleteTask.mockReturnValueOnce(delayedDelete.promise);
    renderSchedule();
    expect(await screen.findByText(original.title)).toBeInTheDocument();
    await waitFor(() => expect(realtime.callbacks).toHaveLength(3));

    await act(async () => screen.getByRole('button', { name: `${original.title} 할 일 삭제` }).click());
    await act(async () => {
      realtime.callbacks[1]({ new: { slice: 'tasks' } });
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(await screen.findByText('할 일을 불러오지 못했어요')).toBeInTheDocument();
    await act(async () => delayedDelete.resolve(true));

    await waitFor(() => expect(taskMocks.fetchTasks).toHaveBeenCalledTimes(3));
    expect(screen.queryByText(original.title)).not.toBeInTheDocument();
  });

  it('keeps known tasks on a transport error but removes them on forbidden', async () => {
    taskMocks.fetchTasks
      .mockResolvedValueOnce({ ok: true, tasks: [task('known', '확인된 할 일')] })
      .mockResolvedValueOnce({ ok: false, reason: 'error' })
      .mockResolvedValueOnce({ ok: false, reason: 'forbidden' });
    renderSchedule();
    expect(await screen.findByText('확인된 할 일')).toBeInTheDocument();
    await waitFor(() => expect(realtime.callbacks).toHaveLength(3));

    act(() => realtime.callbacks[0]());
    expect(await screen.findByText('할 일을 불러오지 못했어요')).toBeInTheDocument();
    expect(screen.getByText('확인된 할 일')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '확인된 할 일 완료로 변경' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '확인된 할 일 할 일 삭제' })).toBeDisabled();
    expect(screen.queryByRole('textbox', { name: '할 일 제목' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '확인된 할 일 완료로 변경' }));
    await userEvent.click(screen.getByRole('button', { name: '확인된 할 일 할 일 삭제' }));
    expect(taskMocks.updateTask).not.toHaveBeenCalled();
    expect(taskMocks.deleteTask).not.toHaveBeenCalled();

    act(() => realtime.callbacks[0]());
    expect(await screen.findByText('할 일을 볼 권한이 없어요')).toBeInTheDocument();
    expect(screen.queryByText('확인된 할 일')).not.toBeInTheDocument();
  });

  it('ignores a callback from a StrictMode subscription that was already removed', async () => {
    renderSchedule(true);
    await waitFor(() => expect(realtime.callbacks.length).toBeGreaterThanOrEqual(2));
    const callsBefore = taskMocks.fetchTasks.mock.calls.length;

    act(() => realtime.callbacks[0]());
    expect(taskMocks.fetchTasks).toHaveBeenCalledTimes(callsBefore);
    act(() => realtime.callbacks.at(-3)?.());
    await waitFor(() => expect(taskMocks.fetchTasks).toHaveBeenCalledTimes(callsBefore + 1));
    expect(realtime.removeChannel).toHaveBeenCalled();
  });

  it('isolates the temporary direct task subscription from the authoritative invalidation channel', async () => {
    renderSchedule();
    await waitFor(() => expect(realtime.callbacks).toHaveLength(3));
    expect(realtime.channel).toHaveBeenCalledWith('couple-tasks:couple-a');
    expect(realtime.channel).toHaveBeenCalledWith('couple-tasks-compat:couple-a');
    const compatibilityChannel = realtime.channel.mock.results[0]?.value as {
      on: ReturnType<typeof vi.fn>;
    };
    const invalidationChannel = realtime.channel.mock.results[1]?.value as {
      on: ReturnType<typeof vi.fn>;
    };
    expect(compatibilityChannel.on.mock.calls.map((call) => call[1])).toEqual([
      {
        event: '*', schema: 'public', table: 'couple_tasks',
        filter: 'couple_id=eq.couple-a',
      },
    ]);
    expect(invalidationChannel.on.mock.calls.map((call) => call[1])).toEqual([
      {
        event: 'INSERT', schema: 'public', table: 'collaboration_invalidations',
        filter: 'couple_id=eq.couple-a',
      },
      {
        event: 'UPDATE', schema: 'public', table: 'collaboration_invalidations',
        filter: 'couple_id=eq.couple-a',
      },
    ]);
  });

  it('debounces invalidation bursts and refreshes on SUBSCRIBED, visible, and online events', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderSchedule();
    await waitFor(() => expect(realtime.callbacks).toHaveLength(3));
    const callsAfterInitial = taskMocks.fetchTasks.mock.calls.length;

    act(() => {
      realtime.callbacks[1]({ new: { slice: 'tasks', title: 'must not be trusted' } });
      realtime.callbacks[1]({ new: { slice: 'tasks' } });
      realtime.callbacks[0]();
    });
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(taskMocks.fetchTasks.mock.calls.length).toBe(callsAfterInitial + 1);

    await act(async () => realtime.statuses[0]?.('SUBSCRIBED'));
    await waitFor(() => expect(taskMocks.fetchTasks.mock.calls.length).toBe(callsAfterInitial + 2));

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(taskMocks.fetchTasks.mock.calls.length).toBe(callsAfterInitial + 3));

    await act(async () => window.dispatchEvent(new Event('online')));
    await waitFor(() => expect(taskMocks.fetchTasks.mock.calls.length).toBe(callsAfterInitial + 4));
  });

  it('polls with bounded backoff after task channel failure and cancels polling on recovery and unmount', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderSchedule();
    await waitFor(() => expect(realtime.statuses).toHaveLength(1));
    const callsAfterInitial = taskMocks.fetchTasks.mock.calls.length;

    await act(async () => realtime.statuses[0]?.('CHANNEL_ERROR'));
    act(() => {
      realtime.callbacks[0]();
      realtime.callbacks[1]({ new: { slice: 'tasks' } });
    });
    await act(async () => vi.advanceTimersByTimeAsync(300));
    expect(taskMocks.fetchTasks.mock.calls.length).toBe(callsAfterInitial);
    await act(async () => vi.advanceTimersByTimeAsync(1_699));
    expect(taskMocks.fetchTasks.mock.calls.length).toBe(callsAfterInitial);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    await waitFor(() => expect(taskMocks.fetchTasks.mock.calls.length).toBe(callsAfterInitial + 1));

    await act(async () => realtime.statuses[0]?.('SUBSCRIBED'));
    const callsAfterRecovery = taskMocks.fetchTasks.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(taskMocks.fetchTasks.mock.calls.length).toBe(callsAfterRecovery);

    const view = renderSchedule();
    await waitFor(() => expect(realtime.statuses.length).toBeGreaterThanOrEqual(2));
    await act(async () => realtime.statuses.at(-1)?.('TIMED_OUT'));
    view.unmount();
    const callsAfterUnmount = taskMocks.fetchTasks.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(taskMocks.fetchTasks.mock.calls.length).toBe(callsAfterUnmount);
    expect(realtime.removeChannel).toHaveBeenCalled();
  });

  it('removes tasks authoritatively on forbidden while preserving them on transport failure', async () => {
    taskMocks.fetchTasks
      .mockResolvedValueOnce({ ok: true, tasks: [task('known', '확인된 할 일')] })
      .mockResolvedValueOnce({ ok: false, reason: 'error' })
      .mockResolvedValueOnce({ ok: false, reason: 'forbidden' });
    renderSchedule();
    expect(await screen.findByText('확인된 할 일')).toBeInTheDocument();
    await waitFor(() => expect(realtime.callbacks).toHaveLength(3));

    act(() => realtime.callbacks[1]({ new: { slice: 'tasks' } }));
    expect(await screen.findByText('할 일을 불러오지 못했어요')).toBeInTheDocument();
    expect(screen.getByText('확인된 할 일')).toBeInTheDocument();

    act(() => realtime.callbacks[0]());
    expect(await screen.findByText('할 일을 볼 권한이 없어요')).toBeInTheDocument();
    expect(screen.queryByText('확인된 할 일')).not.toBeInTheDocument();
  });
});
