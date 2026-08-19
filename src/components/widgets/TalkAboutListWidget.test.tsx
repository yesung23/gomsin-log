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

/**
 * §8 puts every marked topic behind the count on the home widget and rules out a
 * separate tab, so this widget is the ONLY way to reach 이야기거리. That made the
 * overflow a real dead end rather than a truncation: the sixth topic onwards was
 * announced as "외 N개" in inert text, with no control on it and no route to a
 * fuller list. A pair who marked seven records could not open two of them.
 */
describe('every marked topic is reachable, not just the first five', () => {
  function manyTopics(count: number) {
    const records = Array.from({ length: count }, (_, i) => record({
      id: `rec-${String(i).padStart(2, '0')}`,
      time: `${String(i % 24).padStart(2, '0')}:00`,
      log: `이야기거리 ${i}`,
    }));
    const marks = records.map((r, i) => mark({
      id: `mark-${i}`,
      recordId: r.id,
      // Newest first is the widget's order, so ascending time = descending list.
      createdAt: new Date(Date.parse(`${TODAY}T00:00:00.000Z`) + i * 60_000).toISOString(),
    }));
    return { records, marks };
  }

  it('counts every topic in the heading even while it shows five', () => {
    const { records, marks } = manyTopics(7);
    renderWidget(records, marks);
    expect(screen.getByText(/오늘 이야기할 것 · 7/)).toBeInTheDocument();
    expect(screen.getAllByText(/이야기거리 \d/)).toHaveLength(5);
  });

  it('the overflow notice is a control, and it opens the rest', async () => {
    const user = userEvent.setup();
    const { records, marks } = manyTopics(7);
    renderWidget(records, marks);

    const expand = screen.getByTestId('talk-about-expand');
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    await user.click(expand);

    expect(screen.getAllByText(/이야기거리 \d/)).toHaveLength(7);
    expect(screen.getByTestId('talk-about-expand')).toHaveAttribute('aria-expanded', 'true');
  });

  it('a topic revealed by expanding still opens its exact original', async () => {
    const user = userEvent.setup();
    const { records, marks } = manyTopics(7);
    renderWidget(records, marks);
    await user.click(screen.getByTestId('talk-about-expand'));

    // The oldest mark sorts last, so it is only present once expanded.
    await user.click(screen.getByText('이야기거리 0'));
    expect(setHighlightedRecordId).toHaveBeenCalledWith('rec-00');
    expect(navigate).toHaveBeenCalledWith('/record?record=rec-00');
  });

  it('collapses again, so a long list cannot permanently take over the home', async () => {
    const user = userEvent.setup();
    const { records, marks } = manyTopics(7);
    renderWidget(records, marks);

    await user.click(screen.getByTestId('talk-about-expand'));
    await user.click(screen.getByTestId('talk-about-expand'));
    expect(screen.getAllByText(/이야기거리 \d/)).toHaveLength(5);
  });

  it('offers no control at all when everything already fits', () => {
    const { records, marks } = manyTopics(3);
    renderWidget(records, marks);
    expect(screen.queryByTestId('talk-about-expand')).not.toBeInTheDocument();
  });
});

describe('core-flow copy renders as prose, not as source markup', () => {
  it('the empty state does not show literal backticks around 이따 이야기하기', () => {
    renderWidget([], []);
    const empty = screen.getByText(/아직 표시한 기록이 없어요/);
    expect(empty.textContent).toContain("'이따 이야기하기'");
    expect(empty.textContent).not.toContain('`');
  });
});

describe('the overflow control holds up at the sizes a real couple reaches', () => {
  function manyTopicsAt(count: number) {
    const records = Array.from({ length: count }, (_, i) => record({
      id: `rec-${String(i).padStart(3, '0')}`,
      log: `이야기거리 ${i}`,
    }));
    const marks = records.map((r, i) => mark({
      id: `mark-${i}`,
      recordId: r.id,
      createdAt: new Date(Date.parse(`${TODAY}T00:00:00.000Z`) + i * 60_000).toISOString(),
    }));
    return { records, marks };
  }

  for (const count of [0, 1, 5]) {
    it(`shows all ${count} with no overflow control`, () => {
      const { records, marks } = manyTopicsAt(count);
      renderWidget(records, marks);
      expect(screen.queryByTestId('talk-about-expand')).not.toBeInTheDocument();
      if (count > 0) expect(screen.getAllByText(/이야기거리 \d/)).toHaveLength(count);
    });
  }

  for (const count of [6, 20, 60]) {
    it(`reaches every one of ${count} once expanded`, async () => {
      const user = userEvent.setup();
      const { records, marks } = manyTopicsAt(count);
      renderWidget(records, marks);

      expect(screen.getByText(new RegExp(`오늘 이야기할 것 · ${count}`))).toBeInTheDocument();
      expect(screen.getAllByText(/이야기거리 \d/)).toHaveLength(5);

      await user.click(screen.getByTestId('talk-about-expand'));
      expect(screen.getAllByText(/이야기거리 \d/)).toHaveLength(count);

      // And it still folds back, so a long list cannot own the home screen.
      await user.click(screen.getByTestId('talk-about-expand'));
      expect(screen.getAllByText(/이야기거리 \d/)).toHaveLength(5);
    });
  }

  it('completes a topic that only exists in the expanded region', async () => {
    const user = userEvent.setup();
    const { records, marks } = manyTopicsAt(20);
    renderWidget(records, marks);
    await user.click(screen.getByTestId('talk-about-expand'));

    // The oldest mark sorts last, so it is unreachable while collapsed.
    const rows = screen.getAllByRole('button', { name: '이야기했어요' });
    expect(rows).toHaveLength(20);
    await user.click(rows[19]);

    await waitFor(() => expect(resolveTalkAbout).toHaveBeenCalledWith('rec-000'));
  });

  it('an unreachable source in the expanded region stays generic, never substituted', async () => {
    const user = userEvent.setup();
    const { records, marks } = manyTopicsAt(7);
    // Drop the oldest record so its mark can no longer resolve to a source.
    const withoutOldest = records.filter((r) => r.id !== 'rec-000');
    renderWidget(withoutOldest, marks);
    await user.click(screen.getByTestId('talk-about-expand'));

    expect(screen.getByText('이 기록은 더 이상 볼 수 없어요')).toBeInTheDocument();
    // No other topic's text was borrowed to fill the gap.
    expect(screen.queryByText('이야기거리 0')).not.toBeInTheDocument();
    expect(screen.getAllByText(/이야기거리 \d/)).toHaveLength(6);
  });
});
