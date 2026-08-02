import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AppState, DailyRecord, EmotionFlowItem } from '@/types';

const ME = 'user-me';
const PARTNER = 'user-partner';
const TODAY = '2026-07-31';

const updateRecord = vi.fn(async () => true);
const deleteRecord = vi.fn(async () => true);
const setHighlightedRecordId = vi.fn();

function flowItem(overrides: Partial<EmotionFlowItem> = {}): EmotionFlowItem {
  return {
    id: 'flow-1',
    group: 'joy',
    displayLabel: '행복',
    sequence: 1,
    source: 'user_confirmed',
    visibility: 'shared',
    ...overrides,
  };
}

function record(overrides: Partial<DailyRecord> = {}): DailyRecord {
  return {
    id: 'rec-mine',
    userId: ME,
    date: TODAY,
    time: '10:00',
    authorRole: 'gomsin',
    log: 'hello',
    isPrivate: false,
    createdAt: `${TODAY}T10:00:00.000Z`,
    ...overrides,
  };
}

function makeState(records: DailyRecord[]): AppState {
  return {
    setupComplete: true,
    onboardingStep: 0,
    isDemoMode: false,
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
    widgetLayout: [],
    hasSeenInstallPrompt: true,
    theme: 'light',
  };
}

let currentState = makeState([]);

vi.mock('@/components/MobileShell', () => ({
  MobileShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: currentState,
    isReady: true,
    updateRecord,
    deleteRecord,
    setHighlightedRecordId,
  }),
}));

const { RecordPage } = await import('@/pages/RecordPage');

/** RecordPage opens on today, so fixtures are dated today via `TODAY`. */
function renderPage(records: DailyRecord[]) {
  currentState = makeState(records);
  vi.setSystemTime(new Date(`${TODAY}T12:00:00.000Z`));
  return render(
    <MemoryRouter initialEntries={['/records']}>
      <RecordPage />
    </MemoryRouter>,
  );
}

/** Click the timeline entry whose visible time label is `time`. */
async function openRecord(user: ReturnType<typeof userEvent.setup>, time: string) {
  await user.click(await screen.findByText(time));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  updateRecord.mockClear();
  deleteRecord.mockClear();
  setHighlightedRecordId.mockClear();
});

describe('RecordPage ownership controls', () => {
  it('offers 수정 and 삭제 on a record the viewer authored', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage([record()]);
    await openRecord(user, '10:00');

    expect(await screen.findByText('수정')).toBeInTheDocument();
    expect(screen.getByText('삭제')).toBeInTheDocument();
  });

  it('offers neither on the partner\'s shared record', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage([
      record({ id: 'rec-partner', userId: PARTNER, authorRole: 'soldier', time: '11:00' }),
    ]);
    await openRecord(user, '11:00');

    // The modal is open but has no owner controls.
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText('수정')).not.toBeInTheDocument();
    expect(screen.queryByText('삭제')).not.toBeInTheDocument();
  });
});

describe('RecordPage partner privacy sanitisation', () => {
  it('never renders the partner\'s author_only emotion items', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage([
      record({
        id: 'rec-partner',
        userId: PARTNER,
        authorRole: 'soldier',
        time: '11:00',
        emotionFlow: [
          flowItem({ id: 'shared-1', group: 'joy', displayLabel: '행복', sequence: 1 }),
          flowItem({
            id: 'private-1',
            group: 'shame',
            displayLabel: '부끄러움',
            sequence: 2,
            visibility: 'author_only',
          }),
        ],
      }),
    ]);
    await openRecord(user, '11:00');

    expect(await screen.findByText('마음의 흐름')).toBeInTheDocument();
    // Only the shared label survives `visibleRecordsForViewer`.
    expect(screen.getByText('행복')).toBeInTheDocument();
    expect(screen.queryByText(/부끄러움/)).not.toBeInTheDocument();
  });

  it('does not surface the partner\'s private record in the timeline at all', () => {
    renderPage([
      record({
        id: 'rec-partner-private',
        userId: PARTNER,
        authorRole: 'soldier',
        time: '11:00',
        isPrivate: true,
        log: '군대에서만 아는 이야기',
      }),
    ]);

    expect(screen.queryByText('11:00')).not.toBeInTheDocument();
    expect(screen.queryByText('군대에서만 아는 이야기')).not.toBeInTheDocument();
  });
});

describe('RecordPage editing', () => {
  it('disables 저장 for empty text and never calls updateRecord', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage([record()]);
    await openRecord(user, '10:00');
    await user.click(await screen.findByText('수정'));

    const textarea = await screen.findByPlaceholderText('기록 내용을 입력하세요');
    await user.clear(textarea);

    const save = screen.getByText('저장');
    expect(save).toBeDisabled();
    await user.click(save);
    expect(updateRecord).not.toHaveBeenCalled();
  });

  it('warns that changing the text clears the previous confirmations', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage([record({ emotionFlow: [flowItem()] })]);
    await openRecord(user, '10:00');
    await user.click(await screen.findByText('수정'));

    const textarea = await screen.findByPlaceholderText('기록 내용을 입력하세요');
    expect(
      screen.queryByText('내용을 바꾸면 이전 글에서 고른 마음은 지워져요.'),
    ).not.toBeInTheDocument();

    await user.type(textarea, ' 그리고 조금 더');
    expect(
      await screen.findByText('내용을 바꾸면 이전 글에서 고른 마음은 지워져요.'),
    ).toBeInTheDocument();
  });

  it('clears emotionFlow and emotionUpdatedAt when the text changes', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage([record({ emotionFlow: [flowItem()] })]);
    await openRecord(user, '10:00');
    await user.click(await screen.findByText('수정'));

    const textarea = await screen.findByPlaceholderText('기록 내용을 입력하세요');
    await user.clear(textarea);
    await user.type(textarea, 'changed text');
    await user.click(screen.getByText('저장'));

    await waitFor(() => expect(updateRecord).toHaveBeenCalled());
    expect(updateRecord).toHaveBeenCalledWith('rec-mine', {
      log: 'changed text',
      emotionFlow: [],
      emotionUpdatedAt: null,
    });
  });

  it('leaves the emotions alone when the text is saved unchanged', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage([record({ emotionFlow: [flowItem()] })]);
    await openRecord(user, '10:00');
    await user.click(await screen.findByText('수정'));

    await screen.findByPlaceholderText('기록 내용을 입력하세요');
    await user.click(screen.getByText('저장'));

    await waitFor(() => expect(updateRecord).toHaveBeenCalled());
    const [, updates] = updateRecord.mock.calls[0] as unknown as [string, Partial<DailyRecord>];
    expect(updates).toEqual({ log: 'hello' });
    expect(updates).not.toHaveProperty('emotionFlow');
    expect(updates).not.toHaveProperty('emotionUpdatedAt');
  });
});

describe('RecordPage detail insight card', () => {
  it('renders the flow card for a record with two confirmed emotions', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage([
      record({
        emotionFlow: [
          flowItem({ id: 'a', group: 'sadness', displayLabel: '속상함', sequence: 1 }),
          flowItem({ id: 'b', group: 'joy', displayLabel: '행복', sequence: 2 }),
        ],
      }),
    ]);
    await openRecord(user, '10:00');

    expect(await screen.findByText('마음의 흐름')).toBeInTheDocument();
    expect(screen.getByText('속상함 → 행복')).toBeInTheDocument();
    expect(screen.getByText('가장 큰 변화: 속상함 → 행복')).toBeInTheDocument();
    // Detail variant: no composer-only preview notice.
    expect(screen.queryByText(/저장되지 않아요/)).not.toBeInTheDocument();
  });

  it('renders no card for a record with no emotionFlow', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage([record()]);
    await openRecord(user, '10:00');

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByText('마음의 흐름')).not.toBeInTheDocument();
  });
});
