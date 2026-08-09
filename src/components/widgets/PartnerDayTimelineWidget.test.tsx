import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AppState, DailyRecord } from '@/types';

/**
 * Bug condition:
 *   isBugCondition(home) = the 군화 home offers no way to see the partner's
 *                          moments themselves, only descriptions of them.
 *
 * Measured on the unfixed tree, `DEFAULT_LAYOUT_BY_ROLE.soldier` was
 * `['partner_emotion_flow', 'partner_emotion_summary', 'care_hint', 'today_word',
 * 'dday']`:
 *  - `partner_emotion_flow` renders emotion labels, no text and no media
 *  - `partner_emotion_summary` renders one headline sentence
 *  - `care_hint` renders a suggested opening line
 *  - `today_word` is the composer plus the VIEWER'S OWN entries
 *
 * Every one of those is a description. README section 1.4 states what this home is
 * for: "상대방의 오늘 순간들을 시간순(사진, 영상, 음성, 텍스트)으로 있는 그대로
 * 감상합니다". The moments were reachable only by leaving home for the 기록 tab.
 *
 * Nothing caught it: no test asserted that the partner's records appear on the
 * home screen at all, and `emotionRedesign.test.ts` actively pinned the layout
 * that omitted them.
 */

const ME = 'user-soldier';
const PARTNER = 'user-gomsin';
const TODAY = '2026-07-31';

const setHighlightedRecordId = vi.fn();
const navigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('@/lib/records', () => ({
  resolveAttachmentUrls: vi.fn(async (attachments: unknown[]) => attachments),
}));

let currentState: AppState;
let currentSyncStatus: 'live' | 'delayed' | 'unavailable' = 'live';
/**
 * Turns the STORE-level privacy filter into a passthrough.
 *
 * Without this, a test that renders a private record and asserts it is absent
 * proves nothing about this widget: `visibleRecordsForViewer` upstream already
 * removed it, so the widget's own guard could be deleted and the test would still
 * pass. Verified, not assumed -- that exact mutation was tried and 15/15 tests
 * still passed. With the flag on, only the widget's own filter is left standing.
 */
let bypassStorePrivacyFilter = false;

vi.mock('@/lib/privacy', async () => {
  const actual = await vi.importActual<typeof import('@/lib/privacy')>('@/lib/privacy');
  return {
    ...actual,
    visibleRecordsForViewer: (
      records: Parameters<typeof actual.visibleRecordsForViewer>[0],
      viewer: Parameters<typeof actual.visibleRecordsForViewer>[1],
    ) => (bypassStorePrivacyFilter ? records : actual.visibleRecordsForViewer(records, viewer)),
  };
});

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: currentState,
    isReady: true,
    sharedSyncStatus: currentSyncStatus,
    setHighlightedRecordId,
  }),
}));

const { PartnerDayTimelineWidget, PARTNER_DAY_VISIBLE_LIMIT } =
  await import('@/components/widgets/PartnerDayTimelineWidget');

function record(overrides: Partial<DailyRecord> = {}): DailyRecord {
  return {
    id: 'rec-1',
    userId: PARTNER,
    date: TODAY,
    time: '09:00',
    authorRole: 'gomsin',
    log: '아침 산책',
    isPrivate: false,
    createdAt: `${TODAY}T09:00:00.000Z`,
    ...overrides,
  };
}

function makeState(records: DailyRecord[]): AppState {
  return {
    setupComplete: true,
    onboardingStep: 0,
    authenticatedUser: { id: ME, email: 'me@example.com', provider: 'google' },
    profile: {
      id: ME,
      myName: '몽룡',
      role: 'soldier',
      couple: {
        coupleId: 'couple-1',
        partnerName: '춘향',
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
    widgetLayout: [],
    hasSeenInstallPrompt: true,
    theme: 'light',
  };
}

function renderWidget(records: DailyRecord[]) {
  currentState = makeState(records);
  // Noon UTC is 21:00 KST the same day, so `localToday()` resolves to TODAY.
  vi.setSystemTime(new Date(`${TODAY}T12:00:00.000Z`));
  return render(
    <MemoryRouter>
      <PartnerDayTimelineWidget />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  setHighlightedRecordId.mockClear();
  navigate.mockClear();
  currentSyncStatus = 'live';
  bypassStorePrivacyFilter = false;
});

describe("the partner's moments appear on the 군화 home, in time order", () => {
  it('lists every moment of today, earliest first', () => {
    renderWidget([
      record({ id: 'c', time: '21:00', log: '저녁' }),
      record({ id: 'a', time: '08:00', log: '아침' }),
      record({ id: 'b', time: '13:00', log: '점심' }),
    ]);

    const entries = screen.getAllByTestId('partner-day-entry');
    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.textContent?.slice(0, 5)))
      .toEqual(['08:00', '13:00', '21:00']);
  });

  it('shows the text of the moment, not a summary of it', () => {
    renderWidget([record({ log: '오늘 눈이 왔어' })]);
    expect(screen.getByText('오늘 눈이 왔어')).toBeInTheDocument();
  });

  it('plays a voice note in place, so it can be heard without leaving home', () => {
    const { container } = renderWidget([record({
      attachments: [{
        type: 'voice',
        name: '음성기록-1.webm',
        url: 'https://example.supabase.co/signed/voice?token=t',
        path: 'couple-1/rec-1/voice.webm',
      }],
    })]);

    const audio = container.querySelector('audio');
    expect(audio, 'README 1.4 says 음성 is part of what is consumed here').not.toBeNull();
    expect(audio).toHaveAttribute('controls');
  });

  it('shows a photo as a photo', () => {
    const { container } = renderWidget([record({
      attachments: [{
        type: 'photo',
        name: 'p.jpg',
        url: 'https://example.supabase.co/signed/photo?token=t',
        path: 'couple-1/rec-1/p.jpg',
      }],
    })]);

    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'https://example.supabase.co/signed/photo?token=t',
    );
  });

  it('tapping a moment opens 기록 ON that moment', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWidget([record({ id: 'rec-target', time: '10:30' })]);

    await user.click(screen.getByRole('button', { name: /10:30/ }));

    expect(setHighlightedRecordId).toHaveBeenCalledWith('rec-target');
    expect(navigate).toHaveBeenCalledWith('/record');
  });
});

describe('the widget stays glanceable without hiding anything', () => {
  function manyRecords(count: number): DailyRecord[] {
    return Array.from({ length: count }, (_, index) => record({
      id: `rec-${index}`,
      time: `${String(8 + index).padStart(2, '0')}:00`,
      log: `순간 ${index}`,
    }));
  }

  it(`shows at most ${PARTNER_DAY_VISIBLE_LIMIT} moments`, () => {
    renderWidget(manyRecords(PARTNER_DAY_VISIBLE_LIMIT + 3));
    expect(screen.getAllByTestId('partner-day-entry')).toHaveLength(PARTNER_DAY_VISIBLE_LIMIT);
  });

  it('says how many are left, and how many there are in total', () => {
    renderWidget(manyRecords(PARTNER_DAY_VISIBLE_LIMIT + 3));
    expect(screen.getByText(/나머지 3개 보기/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`순간 ${PARTNER_DAY_VISIBLE_LIMIT + 3}개`))).toBeInTheDocument();
  });

  it('the overflow control lands on the FIRST moment that was cut off', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderWidget(manyRecords(PARTNER_DAY_VISIBLE_LIMIT + 3));

    await user.click(screen.getByText(/나머지 3개 보기/));

    expect(setHighlightedRecordId).toHaveBeenCalledWith(`rec-${PARTNER_DAY_VISIBLE_LIMIT}`);
    expect(navigate).toHaveBeenCalledWith('/record');
  });

  it('offers no overflow control when nothing is cut off', () => {
    renderWidget(manyRecords(PARTNER_DAY_VISIBLE_LIMIT));
    expect(screen.queryByText(/나머지/)).not.toBeInTheDocument();
  });
});

describe('it never says something it does not know', () => {
  it('does not claim an empty day while the shared workspace is unconfirmed', () => {
    // A ~2s window on every cold load with no realtime socket. `records` is empty
    // there for a reason that is NOT "she shared nothing".
    currentSyncStatus = 'unavailable';
    renderWidget([]);

    const widget = screen.getByTestId('widget-partner-day');
    expect(widget).toHaveAttribute('data-state', 'unconfirmed');
    expect(widget.textContent).toContain('확인하는 중');
    expect(widget.textContent).not.toContain('아직 없어요');
  });

  it('says the day is empty once the workspace is live, because then it is', () => {
    currentSyncStatus = 'live';
    renderWidget([]);

    const widget = screen.getByTestId('widget-partner-day');
    expect(widget).toHaveAttribute('data-state', 'empty');
    expect(widget.textContent).toContain('아직 없어요');
  });

  it('shows a delayed workspace normally, but admits it may be stale', () => {
    // `delayed` means what is on screen is real, just possibly incomplete. Hiding
    // it would lose information the user already has.
    currentSyncStatus = 'delayed';
    renderWidget([record({ log: '점심 먹었어' })]);

    expect(screen.getByText('점심 먹었어')).toBeInTheDocument();
    expect(screen.getByTestId('widget-partner-day').textContent)
      .toContain('아직 안 보일 수 있어요');
  });
});

describe('privacy: only what this viewer is entitled to see', () => {
  it("excludes the partner's private records", () => {
    renderWidget([
      record({ id: 'shared', log: '공유한 것' }),
      record({ id: 'private', time: '10:00', log: '비공개인 것', isPrivate: true }),
    ]);

    expect(screen.getByText('공유한 것')).toBeInTheDocument();
    expect(screen.queryByText('비공개인 것')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('partner-day-entry')).toHaveLength(1);
  });

  it('refuses a private record on its OWN, not only because the store filtered it', () => {
    // Defence in depth, asserted rather than claimed: with the store-level filter
    // turned into a passthrough, the widget must still refuse. This is what makes
    // the previous test more than a test of `visibleRecordsForViewer`.
    bypassStorePrivacyFilter = true;
    renderWidget([
      record({ id: 'shared', log: '공유한 것' }),
      record({ id: 'private', time: '10:00', log: '비공개인 것', isPrivate: true }),
    ]);

    expect(screen.getByText('공유한 것')).toBeInTheDocument();
    expect(screen.queryByText('비공개인 것')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('partner-day-entry')).toHaveLength(1);
  });

  it("excludes the viewer's OWN records, which is the whole point of the widget", () => {
    // `today_word` already shows the viewer their own day. This widget answers a
    // different question, and mixing the two is what made the old home unable to
    // answer either.
    renderWidget([
      record({ id: 'hers', log: '상대 기록' }),
      record({ id: 'mine', time: '10:00', userId: ME, authorRole: 'soldier', log: '내 기록' }),
    ]);

    expect(screen.getByText('상대 기록')).toBeInTheDocument();
    expect(screen.queryByText('내 기록')).not.toBeInTheDocument();
  });

  it('excludes records from other days', () => {
    renderWidget([
      record({ id: 'today', log: '오늘 것' }),
      record({ id: 'yesterday', date: '2026-07-30', log: '어제 것' }),
    ]);

    expect(screen.getByText('오늘 것')).toBeInTheDocument();
    expect(screen.queryByText('어제 것')).not.toBeInTheDocument();
  });
});
