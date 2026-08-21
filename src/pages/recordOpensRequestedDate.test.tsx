import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { AppState, DailyRecord } from '@/types';

/**
 * Bug condition:
 *   isBugCondition(app) = a day chosen in 우리 opens some OTHER day's records.
 *
 * PRODUCT_V3 §4.2/§10 asks for the exact source and the exact date, never an
 * approximation, and `UsPage` says so in a comment directly above the call:
 * "A day leads to that day's records. The exact ones, never an approximation."
 *
 * Measured on the unfixed tree. `UsPage` navigates to `/record?date=2026-07-15`,
 * and `RecordPage` initialised its day as
 *
 *     useState(tripPeriod?.from || todayStr)
 *
 * -- `date` appears in no `searchParams.get` call anywhere in the file. The five
 * parameters it does read are `trip`, `from`, `to`, `compose` and `record`. So
 * every past day tapped in 우리 opened TODAY, and a tap from inside a trip period
 * opened the first day of the trip. The link was well-formed and nothing was
 * listening.
 *
 * Nothing caught it because both halves were individually correct: 우리 built the
 * URL the contract describes, and 기록 rendered its selected day faithfully. The
 * defect lived only in the join between them, which no test crossed.
 */

const ME = 'user-me';
const PARTNER = 'user-partner';
const TODAY = '2026-07-31';
const PAST = '2026-07-15';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock('@/components/MobileShell', () => ({
  MobileShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/records', () => ({
  MEDIA_ACCEPT: 'image/jpeg',
  classifyMediaFile: () => ({ error: 'unsupported' }),
  resolveAttachmentUrls: vi.fn(async (attachments: unknown[]) => attachments),
}));

let currentState: AppState;

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: currentState,
    isReady: true,
    sharedSyncStatus: 'live' as const,
    updateRecord: vi.fn(async () => ({ ok: true as const })),
    deleteRecord: vi.fn(async () => ({ ok: true as const })),
    updateRecordMedia: vi.fn(async () => ({ ok: true as const, failedFiles: [] as string[] })),
    setHighlightedRecordId: vi.fn(),
    markTalkAbout: vi.fn(async () => ({ ok: true })),
    unmarkTalkAbout: vi.fn(async () => ({ ok: true })),
    resolveTalkAbout: vi.fn(async () => ({ ok: true })),
  }),
}));

const { RecordPage } = await import('@/pages/RecordPage');

function record(overrides: Partial<DailyRecord> = {}): DailyRecord {
  return {
    id: 'rec-1',
    userId: PARTNER,
    date: TODAY,
    time: '09:00',
    authorRole: 'gomsin',
    log: '오늘의 기록',
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
  } as AppState;
}

const BOTH_DAYS = [
  record({ id: 'rec-today', log: '오늘 쓴 것' }),
  record({ id: 'rec-past', date: PAST, log: '그날 쓴 것', createdAt: `${PAST}T09:00:00.000Z` }),
];

function renderAt(entry: string, records: DailyRecord[] = BOTH_DAYS) {
  currentState = makeState(records);
  // Noon UTC is 21:00 KST the same day, so `localToday()` resolves to TODAY.
  vi.setSystemTime(new Date(`${TODAY}T12:00:00.000Z`));
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <RecordPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

describe('a day chosen in 우리 opens exactly that day', () => {
  it('opens the requested past date, not today', async () => {
    renderAt(`/record?date=${PAST}`);

    await waitFor(() => {
      expect(screen.getByText('그날 쓴 것')).toBeInTheDocument();
    });
    // The discriminating half: landing on today would ALSO render a timeline, so
    // asserting the past record alone could pass on a page showing both.
    expect(screen.queryByText('오늘 쓴 것')).not.toBeInTheDocument();
  });

  it('names the requested date in the header', async () => {
    renderAt(`/record?date=${PAST}`);

    // 7월 15일, not 7월 31일. The label is what the user reads to confirm where
    // they landed, so it has to agree with the timeline underneath it.
    await waitFor(() => {
      expect(screen.getByText('7월 15일')).toBeInTheDocument();
    });
  });

  it('still opens today when no date is asked for', async () => {
    renderAt('/record');

    await waitFor(() => {
      expect(screen.getByText('오늘 쓴 것')).toBeInTheDocument();
    });
    expect(screen.queryByText('그날 쓴 것')).not.toBeInTheDocument();
  });

  it('ignores a malformed date rather than rendering an invalid day', async () => {
    // `2026-13-99` and `; DROP` alike: anything that is not a calendar date falls
    // back to today rather than reaching `new Date(NaN)` in the header.
    renderAt('/record?date=not-a-date');

    await waitFor(() => {
      expect(screen.getByText('오늘 쓴 것')).toBeInTheDocument();
    });
    expect(screen.getByText('7월 31일')).toBeInTheDocument();
  });

  it('lets a trip period still win, because that link carries its own range', async () => {
    // `?trip=&from=&to=` is a different entry point with a different contract:
    // it opens the period, and its own tests cover that. This only asserts the
    // new parameter did not quietly take it over.
    renderAt(`/record?trip=trip-1&from=${PAST}&to=${TODAY}`);

    await waitFor(() => {
      expect(screen.getByText('그날 쓴 것')).toBeInTheDocument();
    });
  });
});
