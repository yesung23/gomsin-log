import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AppState, DailyRecord, TalkAboutMark } from '@/types';
import { toast } from 'sonner';

const navigate = vi.fn();
const markTalkAbout = vi.fn(async () => ({ ok: true }));
const unmarkTalkAbout = vi.fn(async () => ({ ok: true }));
const resolveTalkAbout = vi.fn(async () => ({ ok: true }));
let currentState: AppState;
let online = true;

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({ state: currentState, markTalkAbout, unmarkTalkAbout, resolveTalkAbout }),
}));

vi.mock('@/lib/useOnlineStatus', async () => {
  const actual = await vi.importActual<typeof import('@/lib/useOnlineStatus')>('@/lib/useOnlineStatus');
  return { ...actual, useOnlineStatus: () => online };
});

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), warning: vi.fn() },
}));

const { SavedTopicsPage } = await import('@/features/talk/SavedTopicsPage');

const ME = 'viewer';
const PARTNER = 'partner';

function record(overrides: Partial<DailyRecord> = {}): DailyRecord {
  return {
    id: 'record-exact',
    userId: PARTNER,
    date: '2026-09-02',
    time: '20:10',
    authorRole: 'soldier',
    log: '오늘 나누고 싶은 정확한 원문',
    isPrivate: false,
    createdAt: '2026-09-02T20:10:00.000Z',
    ...overrides,
  };
}

function mark(overrides: Partial<TalkAboutMark> = {}): TalkAboutMark {
  return {
    id: 'mark-partner',
    recordId: 'record-exact',
    coupleId: 'couple-1',
    actorUserId: PARTNER,
    createdAt: '2026-09-02T21:00:00.000Z',
    isCompleted: false,
    ...overrides,
  };
}

function state(records: DailyRecord[], marks: TalkAboutMark[]): AppState {
  return {
    setupComplete: true,
    onboardingStep: 0,
    authenticatedUser: { id: ME, provider: 'google' },
    profile: {
      id: ME,
      role: 'gomsin',
      myName: '춘향',
      couple: {
        connected: true,
        status: 'active',
        coupleId: 'couple-1',
        partnerUserId: PARTNER,
        partnerName: '몽룡',
        coupleCode: '',
      },
      military: {} as never,
      contact: {} as never,
    },
    records,
    events: [],
    trips: [],
    talkAboutMarks: marks,
    widgetLayout: [],
    hasSeenInstallPrompt: true,
    theme: 'light',
  } as AppState;
}

function view(records = [record()], marks = [mark()]) {
  currentState = state(records, marks);
  return render(<SavedTopicsPage />);
}

beforeEach(() => {
  vi.clearAllMocks();
  online = true;
  markTalkAbout.mockResolvedValue({ ok: true });
  unmarkTalkAbout.mockResolvedValue({ ok: true });
  resolveTalkAbout.mockResolvedValue({ ok: true });
});

describe('SavedTopicsPage actor-aware topics', () => {
  it('shows one stable topic when both people marked the exact same record', () => {
    view([record()], [
      mark(),
      mark({ id: 'mark-mine', actorUserId: ME, createdAt: '2026-09-02T21:05:00.000Z' }),
    ]);

    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getAllByText('오늘 나누고 싶은 정확한 원문')).toHaveLength(1);
  });

  it('treats a partner-only mark as an invitation to add mine, never as removable by me', async () => {
    const user = userEvent.setup();
    view();

    expect(screen.getByText('몽룡님이 이야기하고 싶어 해요')).toBeInTheDocument();
    const action = screen.getByRole('button', {
      name: '몽룡님이 표시했어요. 나도 이따 이야기하기',
    });
    expect(action).toHaveAttribute('aria-pressed', 'false');

    await user.click(action);
    expect(markTalkAbout).toHaveBeenCalledWith('record-exact');
    expect(unmarkTalkAbout).not.toHaveBeenCalled();
  });

  it('attributes a both-mark while removing only the viewer mark', async () => {
    const user = userEvent.setup();
    view([record()], [mark(), mark({ id: 'mark-mine', actorUserId: ME })]);

    expect(screen.getByText('몽룡님도 함께 표시했어요')).toBeInTheDocument();
    const action = screen.getByRole('button', {
      name: '몽룡님도 표시했어요. 이따 이야기하기 표시 해제',
    });
    expect(action).toHaveAttribute('aria-pressed', 'true');

    await user.click(action);
    expect(unmarkTalkAbout).toHaveBeenCalledWith('record-exact');
    expect(markTalkAbout).not.toHaveBeenCalled();
  });

  it('keeps a missing source generic while omitting private and unreadable source records', () => {
    view([
      record({ id: 'private', isPrivate: true }),
      record({ id: 'locked', contentUnavailable: 'key_unavailable', log: '' }),
    ], [
      mark({ id: 'missing-mark', recordId: 'missing' }),
      mark({ id: 'private-mark', recordId: 'private' }),
      mark({ id: 'locked-mark', recordId: 'locked' }),
    ]);

    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('원본을 더 이상 열 수 없는 이야기거리예요.')).toBeInTheDocument();
    expect(screen.getByTestId('talk-about-call-mode')).toBeInTheDocument();
    expect(screen.queryByText(/상대 비공개|이 기기에서 아직 열 수 없어요|2026-09-02|몽룡 ·/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /원본 보기/ })).not.toBeInTheDocument();
  });

  it('opens only the exact source id represented by the topic', async () => {
    const user = userEvent.setup();
    view();

    const row = screen.getByRole('listitem');
    await user.click(within(row).getByRole('button', { name: '몽룡의 9월 2일 기록 원본 보기' }));
    expect(navigate).toHaveBeenCalledWith('/record?record=record-exact');
  });

  it('keeps every mark control disabled while one refresh is pending', async () => {
    let finish!: (value: { ok: boolean }) => void;
    markTalkAbout.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const second = record({ id: 'record-second', log: '두 번째 원문' });
    view([record(), second], [mark(), mark({ id: 'mark-second', recordId: 'record-second' })]);

    const actions = screen.getAllByRole('button', { name: /나도 이따 이야기하기/ });
    await userEvent.click(actions[0]);

    expect(markTalkAbout).toHaveBeenCalledTimes(1);
    expect(actions[0]).toBeDisabled();
    expect(actions[1]).toBeDisabled();

    finish({ ok: true });
    await vi.waitFor(() => expect(actions[0]).not.toBeDisabled());
  });

  it('is explicitly read-only while offline', () => {
    online = false;
    view();

    const action = screen.getByRole('button', { name: /오프라인이라 지금은 읽기만 가능해요/ });
    expect(action).toBeDisabled();
    expect(screen.getByText(/오프라인이라 지금은 읽기만 가능해요/)).toBeInTheDocument();
  });

  it('recovers from an unexpected mutation rejection without an unhandled promise', async () => {
    markTalkAbout.mockRejectedValueOnce(new Error('network exploded'));
    view();

    await userEvent.click(screen.getByRole('button', { name: /나도 이따 이야기하기/ }));

    await vi.waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('책갈피를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.');
    });
    expect(screen.getByRole('button', { name: /나도 이따 이야기하기/ })).not.toBeDisabled();
  });

  it('uses a truthful fallback when a photo record has no text', () => {
    view([record({ log: '', attachments: [{ type: 'photo', name: 'moment.jpg' }] })], [mark()]);

    expect(screen.getByText('사진으로 남긴 순간')).toBeInTheDocument();
  });

  it('moves focus to the list heading and announces when my only mark is removed', async () => {
    view([record()], [mark({ actorUserId: ME })]);

    await userEvent.click(screen.getByRole('button', { name: '이따 이야기하기 표시 해제' }));

    expect(screen.getByRole('heading', { name: '이야기할 것' })).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('책갈피를 뺐어요');
  });

  it('announces delayed reconciliation without claiming the toggle failed', async () => {
    markTalkAbout.mockResolvedValueOnce({ ok: true, syncPending: true });
    view();

    await userEvent.click(screen.getByRole('button', { name: /나도 이따 이야기하기/ }));

    expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining('저장은 됐지만 화면 반영이 늦어지고 있어요'),
    );
    expect(toast.error).not.toHaveBeenCalled();
  });
});
