import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AppState, DailyRecord, TalkAboutMark } from '@/types';

/**
 * "오늘 이야기할 것" as the user meets it.
 *
 * The privacy-critical join logic is unit-tested in `talkAboutList.test.ts`;
 * what this file adds is that the widget actually WIRES to it -- that a mark
 * on an unreachable record produces no row on screen, that the resolve action
 * clears for both, and that tapping a topic uses the durable `?record=` route
 * from P2 rather than a bare path.
 */

const ME = 'user-me';
const PARTNER = 'user-partner';
const TODAY = '2026-08-13';

const resolveTalkAbout = vi.fn(async () => ({ ok: true }));
const setHighlightedRecordId = vi.fn();
const navigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

let currentState: AppState;

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: currentState,
    isReady: true,
    resolveTalkAbout,
    setHighlightedRecordId,
  }),
}));

const { TalkAboutListWidget } = await import('@/components/widgets/TalkAboutListWidget');

function record(overrides: Partial<DailyRecord> = {}): DailyRecord {
  return {
    id: 'rec-1',
    userId: PARTNER,
    date: TODAY,
    time: '10:00',
    authorRole: 'soldier',
    log: '훈련 끝나고 노을을 봤어',
    isPrivate: false,
    createdAt: `${TODAY}T10:00:00.000Z`,
    ...overrides,
  };
}

function mark(overrides: Partial<TalkAboutMark> = {}): TalkAboutMark {
  return {
    id: 'mark-1',
    recordId: 'rec-1',
    coupleId: 'couple-1',
    actorUserId: ME,
    createdAt: new Date().toISOString(),
    isCompleted: false,
    ...overrides,
  };
}

function makeState(records: DailyRecord[], talkAboutMarks: TalkAboutMark[]): AppState {
  return {
    setupComplete: true,
    onboardingStep: 0,
    authenticatedUser: { id: ME, email: 'me@example.com', provider: 'google' },
    profile: {
      id: ME,
      myName: '춘향',
      role: 'gomsin',
      couple: {
        coupleId: 'couple-1',
        partnerName: '몽룡',
        anniversaryDate: '2025-01-01',
        coupleCode: '',
        connected: true,
        status: 'active',
      },
      military: {} as never,
      contact: {} as never,
    },
    records,
    events: [],
    trips: [],
    talkAboutMarks,
    widgetLayout: [],
    hasSeenInstallPrompt: true,
    theme: 'light',
  };
}

function renderWidget(records: DailyRecord[], marks: TalkAboutMark[]) {
  currentState = makeState(records, marks);
  return render(<TalkAboutListWidget />);
}

beforeEach(() => {
  resolveTalkAbout.mockClear();
  setHighlightedRecordId.mockClear();
  navigate.mockClear();
});

describe('오늘 이야기할 것', () => {
  it('renders a marked record using the record\'s own text', () => {
    renderWidget([record()], [mark()]);
    expect(screen.getByText('훈련 끝나고 노을을 봤어')).toBeInTheDocument();
  });

  it('says who marked it', () => {
    renderWidget([record()], [mark({ actorUserId: PARTNER })]);
    expect(screen.getByText(/몽룡가 표시/)).toBeInTheDocument();
  });

  it('is empty and says so when nothing is marked', () => {
    renderWidget([record()], []);
    expect(screen.getByText(/아직 표시한 기록이 없어요/)).toBeInTheDocument();
  });

  /**
   * The leak case. A mark whose record this client cannot resolve must produce
   * generic unavailable row only. It must never show source-derived content.
   */
  it('renders a safe unavailable state for a mark whose record is unreachable', () => {
    renderWidget([], [mark({ recordId: 'rec-not-here' })]);
    expect(screen.getByText('이 기록은 더 이상 볼 수 없어요')).toBeInTheDocument();
    expect(screen.queryByText('rec-not-here')).not.toBeInTheDocument();
  });

  it("never renders a mark pointing at the partner's private record", () => {
    renderWidget(
      [record({ isPrivate: true, log: '비공개 내용' })],
      [mark({ actorUserId: PARTNER })],
    );
    expect(screen.queryByText('비공개 내용')).not.toBeInTheDocument();
    expect(screen.getByText('이 기록은 더 이상 볼 수 없어요')).toBeInTheDocument();
  });

  it('tapping a topic routes with the durable ?record= id from P2', async () => {
    const user = userEvent.setup();
    renderWidget([record()], [mark()]);

    await user.click(screen.getByText('훈련 끝나고 노을을 봤어'));

    expect(setHighlightedRecordId).toHaveBeenCalledWith('rec-1');
    expect(navigate).toHaveBeenCalledWith('/record?record=rec-1');
  });

  it('이야기했어요 resolves the topic for both partners', async () => {
    const user = userEvent.setup();
    renderWidget([record()], [mark()]);

    await user.click(screen.getByRole('button', { name: /이야기했어요/ }));

    await waitFor(() => expect(resolveTalkAbout).toHaveBeenCalledWith('rec-1'));
  });

  it('collapses both partners marking the same record into one row', () => {
    renderWidget(
      [record()],
      [mark({ id: 'm1', actorUserId: ME }), mark({ id: 'm2', actorUserId: PARTNER })],
    );
    expect(screen.getAllByText('훈련 끝나고 노을을 봤어')).toHaveLength(1);
  });

  it('is not a task manager: no due date, assignee, priority or completion count', () => {
    renderWidget([record()], [mark()]);
    const text = document.body.textContent || '';
    for (const forbidden of ['마감', '담당', '우선순위', '완료율', '진행률']) {
      expect(text).not.toContain(forbidden);
    }
  });
});
