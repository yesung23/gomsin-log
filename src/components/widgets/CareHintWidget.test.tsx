import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AppState, DailyRecord } from '@/types';
import { localToday, toLocalDateString } from '@/lib/utils';
import { writePartnerDayCheckpoint } from '@/lib/partnerDay';

/**
 * Bug condition:
 *   isBugCondition(widget) = the absence of a hard/good tag is read as
 *                            evidence of a calm mood, and rendered as one.
 *
 * PRODUCT_V3 §6.4 rules this out ("침묵으로부터 추론하지 않는다"): author
 * tags are optional (TodayLogWidget), so "no tag" is the ordinary case, not
 * a signal. The widget used to render '평온하게 하루를 보내고 있어요 ✨' for
 * every untagged record, which claims a specific emotional state nobody
 * expressed.
 */

const ME = 'user-soldier';
const PARTNER = 'user-gomsin';
const TODAY = toLocalDateString(localToday());

let currentState: AppState;

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
      myName: '현우',
      role: 'soldier',
      couple: {
        coupleId: 'couple-1',
        partnerName: '민지',
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

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({ state: currentState, isReady: true }),
}));

const { CareHintWidget } = await import('@/components/widgets/CareHintWidget');

function renderWidget(records: DailyRecord[]) {
  currentState = makeState(records);
  return render(<CareHintWidget />);
}

function yesterdayStr(): string {
  const d = localToday();
  d.setDate(d.getDate() - 1);
  return toLocalDateString(d);
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('CareHintWidget: no mood claim from silence', () => {
  it('never renders the removed calm-inference line', () => {
    renderWidget([record({ reaction: undefined })]);
    expect(screen.queryByText(/평온하게/)).not.toBeInTheDocument();
  });

  it('an untagged shared record states only that a moment was shared', () => {
    renderWidget([record({ reaction: undefined })]);
    expect(screen.getByText(/오늘 순간을 나눴어요/)).toBeInTheDocument();
  });

  it('an explicit hard tag is still reported as such', () => {
    renderWidget([record({ reaction: 'hard' })]);
    expect(screen.getByText(/힘든 일이 있었어요/)).toBeInTheDocument();
  });

  it('uses the same missed-context window as 상대방의 오늘', () => {
    renderWidget([record({ date: yesterdayStr(), reaction: 'hard', log: '어제 힘들었던 일' })]);
    expect(screen.getByText(/힘든 일이 있었어요/)).toBeInTheDocument();
  });

  it('honours the stored checkpoint rather than a state field', () => {
    writePartnerDayCheckpoint(ME, 'couple-1', {
      confirmedRecordIds: ['rec-1'],
      confirmedThrough: TODAY,
      confirmedAt: `${TODAY}T09:00:00.000Z`,
    });
    renderWidget([record({ id: 'rec-1', reaction: 'hard' })]);
    // Already acknowledged, so there is no missed mood left to describe.
    expect(screen.getByText(/새로 공유된 순간이 아직 없어요/)).toBeInTheDocument();
  });

  it('an explicit good tag is still reported as such', () => {
    renderWidget([record({ reaction: 'good' })]);
    expect(screen.getByText(/기분 좋은 순간을 남겼어요/)).toBeInTheDocument();
  });

  it('no shared record at all states that honestly, not as a mood', () => {
    renderWidget([]);
    // Not "오늘 공유된 순간이 없어요": the window it just searched was up to seven
    // days wide, so a claim scoped to today is not the claim it can make.
    expect(screen.getByText(/새로 공유된 순간이 아직 없어요/)).toBeInTheDocument();
  });

  it('a private record is never used to describe the partner\'s mood', () => {
    renderWidget([record({ isPrivate: true, reaction: 'hard' })]);
    expect(screen.getByText(/새로 공유된 순간이 아직 없어요/)).toBeInTheDocument();
    expect(screen.queryByText(/힘든 일이 있었어요/)).not.toBeInTheDocument();
  });
});

/**
 * The widget describes a window that can reach back several days, so every
 * sentence in it has to survive that. Saying "오늘 힘든 순간이 있었으니" about a
 * record from three days ago is not a rounding error -- it hands the caller a
 * false premise to open the conversation with.
 */
describe('CareHintWidget: temporal accuracy across the missed window', () => {
  it('does not call an older record today', () => {
    renderWidget([record({ date: yesterdayStr(), reaction: 'hard', log: '어제 일' })]);

    const hint = screen.getByText(/수고했다고 다정하게 말해주세요/);
    expect(hint.textContent).not.toContain('오늘');
    expect(hint.textContent).toContain('그동안');
  });

  it('keeps the today wording when every record really is from today', () => {
    renderWidget([record({ reaction: 'hard' })]);
    expect(screen.getByText(/오늘 힘든 순간이 있었으니/)).toBeInTheDocument();
  });

  it('does not call an older untagged record today either', () => {
    renderWidget([record({ date: yesterdayStr(), reaction: undefined })]);
    expect(screen.getByText(/그동안 순간을 나눴어요/)).toBeInTheDocument();
    expect(screen.queryByText(/오늘 순간을 나눴어요/)).not.toBeInTheDocument();
  });

  it('still reports only author-selected tags, never an inferred mood', () => {
    // Widening the window must not become a licence to interpret it (§6.3, §13).
    renderWidget([
      record({ id: 'a', date: yesterdayStr(), reaction: undefined }),
      record({ id: 'b', reaction: undefined }),
    ]);
    expect(screen.queryByText(/평온|힘든|기분 좋은/)).not.toBeInTheDocument();
  });

  it('excludes a future-dated record from the mood it describes', () => {
    const tomorrow = localToday();
    tomorrow.setDate(tomorrow.getDate() + 1);
    renderWidget([record({ date: toLocalDateString(tomorrow), reaction: 'hard' })]);
    expect(screen.getByText(/새로 공유된 순간이 아직 없어요/)).toBeInTheDocument();
  });
});
