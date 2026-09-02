import { StrictMode, type ReactNode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
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
  callbacks: [] as Array<() => void>,
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
  realtime.removeChannel.mockReset().mockResolvedValue(undefined);
  realtime.channel.mockReset().mockImplementation(() => {
    const channel = {
      on: vi.fn((_event, _filter, callback: () => void) => {
        realtime.callbacks.push(callback);
        return channel;
      }),
      subscribe: vi.fn(() => channel),
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
    const older = deferred<{ ok: true; tasks: CoupleTask[] }>();
    const newer = deferred<{ ok: true; tasks: CoupleTask[] }>();
    taskMocks.fetchTasks
      .mockResolvedValueOnce({ ok: true, tasks: [] })
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    renderSchedule();
    await waitFor(() => expect(realtime.callbacks).toHaveLength(1));

    act(() => realtime.callbacks[0]());
    act(() => realtime.callbacks[0]());
    await act(async () => newer.resolve({ ok: true, tasks: [task('new', '최신 할 일')] }));
    expect(await screen.findByText('최신 할 일')).toBeInTheDocument();
    await act(async () => older.resolve({ ok: true, tasks: [task('old', '오래된 응답')] }));
    expect(screen.queryByText('오래된 응답')).not.toBeInTheDocument();
    expect(screen.getByText('최신 할 일')).toBeInTheDocument();
  });

  it('keeps known tasks on a transport error but removes them on forbidden', async () => {
    taskMocks.fetchTasks
      .mockResolvedValueOnce({ ok: true, tasks: [task('known', '확인된 할 일')] })
      .mockResolvedValueOnce({ ok: false, reason: 'error' })
      .mockResolvedValueOnce({ ok: false, reason: 'forbidden' });
    renderSchedule();
    expect(await screen.findByText('확인된 할 일')).toBeInTheDocument();
    await waitFor(() => expect(realtime.callbacks).toHaveLength(1));

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
    act(() => realtime.callbacks.at(-1)?.());
    expect(taskMocks.fetchTasks).toHaveBeenCalledTimes(callsBefore + 1);
    expect(realtime.removeChannel).toHaveBeenCalled();
  });
});
