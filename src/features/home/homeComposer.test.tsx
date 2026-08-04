import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AppState, EmotionFlowItem, Role } from '@/types';

const addRecordWithMedia = vi.fn(async () => ({ ok: true, failedFiles: [] as string[] }));
const setWidgetLayout = vi.fn();
const setHighlightedRecordId = vi.fn();

let currentRole: Role = 'gomsin';

function makeState(): AppState {
  return {
    setupComplete: true,
    onboardingStep: 0,
    isDemoMode: false,
    authenticatedUser: { id: 'user-1', email: 'a@b.c', provider: 'google' },
    profile: {
      id: 'user-1',
      myName: currentRole === 'gomsin' ? '춘향' : '몽룡',
      role: currentRole,
      couple: {
        coupleId: 'couple-1',
        partnerName: currentRole === 'gomsin' ? '몽룡' : '춘향',
        anniversaryDate: '2025-01-01',
        coupleCode: '',
        connected: true,
        status: 'active',
      },
      military: {
        branch: 'army',
        militaryStatus: 'serving',
        enlistmentDate: '2025-03-10',
        expectedDischargeDate: '2026-09-09',
        dischargeDateSource: 'calculated',
      },
      contact: {
        weekdayStart: '18:00',
        weekdayEnd: '21:00',
        weekendStart: '12:00',
        weekendEnd: '21:00',
        enabled: true,
      },
    },
    records: [],
    events: [],
    trips: [],
    widgetLayout: ['today_word', 'dday'],
    hasSeenInstallPrompt: true,
    theme: 'light',
  };
}

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: makeState(),
    isReady: true,
    addRecordWithMedia,
    setWidgetLayout,
    setHighlightedRecordId,
  }),
}));

const { WidgetDashboard } = await import('@/features/home/WidgetDashboard');
const { SoldierDashboard } = await import('@/features/home/SoldierDashboard');

function renderIn(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('composer availability by role', () => {
  beforeEach(() => {
    addRecordWithMedia.mockClear();
  });

  it('gives 곰신 a composer on the routed home dashboard', () => {
    currentRole = 'gomsin';
    renderIn(<WidgetDashboard />);

    expect(screen.getByText('오늘의 기록')).toBeInTheDocument();
    expect(screen.getByText('지금찍기')).toBeInTheDocument();
    expect(screen.getByText('사진·영상')).toBeInTheDocument();
    expect(screen.getByText('음성')).toBeInTheDocument();
  });

  it('gives 군화 the same composer (this dashboard used to be read-only)', () => {
    currentRole = 'soldier';
    renderIn(<SoldierDashboard />);

    expect(screen.getByText('오늘의 기록')).toBeInTheDocument();
    expect(screen.getByText('지금찍기')).toBeInTheDocument();
    expect(screen.getByText('사진·영상')).toBeInTheDocument();
    expect(screen.getByText('음성')).toBeInTheDocument();
  });

  it('records the author role of whoever is writing', async () => {
    currentRole = 'soldier';
    const user = userEvent.setup();
    renderIn(<SoldierDashboard />);

    await user.click(screen.getByText('한줄'));
    const textarea = await screen.findByPlaceholderText('지금 이 순간, 어떤 생각을 하고 있나요?');
    await user.type(textarea, '훈련 끝나고 잠깐 남기는 기록');
    await user.click(screen.getByText('저장'));

    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalled());
    const [record] = addRecordWithMedia.mock.calls[0] as unknown as [{ authorRole: Role; log: string }];
    expect(record.authorRole).toBe('soldier');
    expect(record.log).toContain('훈련 끝나고');
  });
});

describe('composer attachment handling', () => {
  beforeEach(() => {
    addRecordWithMedia.mockClear();
    currentRole = 'gomsin';
  });

  it('accepts an allowed image and passes it to the upload flow', async () => {
    const user = userEvent.setup();
    renderIn(<WidgetDashboard />);

    await user.click(screen.getByText('한줄'));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'sunset.png', { type: 'image/png' });
    await user.upload(input, file);

    expect(await screen.findByText('sunset.png')).toBeInTheDocument();

    await user.click(screen.getByText('저장'));
    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalled());
    const [, files] = addRecordWithMedia.mock.calls[0] as unknown as [unknown, File[]];
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('sunset.png');
  });

  it('rejects a disallowed file type instead of attaching it', async () => {
    const user = userEvent.setup();
    renderIn(<WidgetDashboard />);

    await user.click(screen.getByText('한줄'));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['x'], 'payload.pdf', { type: 'application/pdf' }));

    // No attachment chip is created for a rejected file.
    await waitFor(() => {
      expect(screen.queryByText('payload.pdf')).not.toBeInTheDocument();
    });
  });

  it('lets the author remove a chosen attachment before saving', async () => {
    const user = userEvent.setup();
    renderIn(<WidgetDashboard />);

    await user.click(screen.getByText('한줄'));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['x'], 'oops.png', { type: 'image/png' }));

    expect(await screen.findByText('oops.png')).toBeInTheDocument();
    await user.click(screen.getByLabelText('oops.png 첨부 제거'));
    await waitFor(() => expect(screen.queryByText('oops.png')).not.toBeInTheDocument());
  });

  it('refuses to save an entirely empty record', async () => {
    const user = userEvent.setup();
    renderIn(<WidgetDashboard />);

    await user.click(screen.getByText('한줄'));
    await user.click(screen.getByText('저장'));

    await waitFor(() => expect(addRecordWithMedia).not.toHaveBeenCalled());
  });

  /**
   * DEF-14. The validation was always correct -- nothing was ever saved and the
   * toast was honest -- but the button stayed enabled for whitespace-only text,
   * so the affordance promised a save that could not happen.
   */
  it('disables 저장 while there is nothing to save', async () => {
    const user = userEvent.setup();
    renderIn(<WidgetDashboard />);

    await user.click(screen.getByText('한줄'));
    expect(screen.getByText('저장')).toBeDisabled();
  });

  it('keeps 저장 disabled for whitespace-only text', async () => {
    const user = userEvent.setup();
    renderIn(<WidgetDashboard />);

    await user.click(screen.getByText('한줄'));
    const textarea = await screen.findByPlaceholderText('지금 이 순간, 어떤 생각을 하고 있나요?');
    await user.type(textarea, '    ');

    expect(screen.getByText('저장')).toBeDisabled();
    expect(addRecordWithMedia).not.toHaveBeenCalled();
  });

  it('enables 저장 as soon as there is real text', async () => {
    const user = userEvent.setup();
    renderIn(<WidgetDashboard />);

    await user.click(screen.getByText('한줄'));
    const textarea = await screen.findByPlaceholderText('지금 이 순간, 어떤 생각을 하고 있나요?');
    await user.type(textarea, '  오늘 하루  ');

    expect(screen.getByText('저장')).not.toBeDisabled();
  });

  it('enables 저장 for an attachment alone, with no text at all', async () => {
    const user = userEvent.setup();
    renderIn(<WidgetDashboard />);

    await user.click(screen.getByText('한줄'));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['x'], 'sunset.png', { type: 'image/png' }));

    expect(await screen.findByText('sunset.png')).toBeInTheDocument();
    expect(screen.getByText('저장')).not.toBeDisabled();
  });
});

/**
 * The composer preview must be derived from the very array that gets saved, and
 * the derivation itself must never be persisted. `LOG_TEXT` is chosen so the
 * rule engine yields 속상함 (sadness) then 행복 (joy) -- a recovery flow.
 */
describe('composer emotion flow preview', () => {
  const LOG_TEXT = '오늘은 많이 속상했어. 그래도 저녁에는 기분이 좋아졌어.';

  /** Open the composer, type the fixture text and wait for the chips. */
  async function openWithSuggestions(user: ReturnType<typeof userEvent.setup>) {
    renderIn(<WidgetDashboard />);
    await user.click(screen.getByText('한줄'));
    const textarea = await screen.findByPlaceholderText('지금 이 순간, 어떤 생각을 하고 있나요?');
    await user.type(textarea, LOG_TEXT);
    // The suggestion list is debounced by 300ms.
    return waitFor(() => expect(screen.getByText('1. 속상함')).toBeInTheDocument());
  }

  beforeEach(() => {
    addRecordWithMedia.mockClear();
    currentRole = 'gomsin';
  });

  it('shows no insight card before any chip is tapped', async () => {
    const user = userEvent.setup({ delay: null });
    await openWithSuggestions(user);

    expect(screen.queryByText('마음의 흐름')).not.toBeInTheDocument();
  });

  it('renders the insight card with both labels and a summary once two chips are tapped', async () => {
    const user = userEvent.setup({ delay: null });
    await openWithSuggestions(user);

    await user.click(screen.getByText('1. 속상함'));
    await user.click(screen.getByText('2. 행복'));

    expect(await screen.findByText('마음의 흐름')).toBeInTheDocument();
    expect(screen.getByText('속상함 → 행복')).toBeInTheDocument();
    expect(
      screen.getByText(/속상함 → 행복 마음이 조금씩 편해지는 쪽으로 움직였어요\./),
    ).toBeInTheDocument();
    // The preview is explicitly labelled as not being stored.
    expect(screen.getByText('미리보기예요. 이 정리는 저장되지 않아요.')).toBeInTheDocument();
  });

  it('saves only user_confirmed items, with no matchedText and no analysis field', async () => {
    const user = userEvent.setup({ delay: null });
    await openWithSuggestions(user);

    await user.click(screen.getByText('1. 속상함'));
    await user.click(screen.getByText('2. 행복'));
    await user.click(screen.getByText('저장'));

    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalled());
    const [record] = addRecordWithMedia.mock.calls[0] as unknown as [
      Record<string, unknown> & { emotionFlow: EmotionFlowItem[] },
    ];

    expect(record.emotionFlow).toHaveLength(2);
    expect(record.emotionFlow.every((i) => i.source === 'user_confirmed')).toBe(true);
    expect(record.emotionFlow.every((i) => !('matchedText' in i))).toBe(true);
    expect(record.emotionFlow.map((i) => i.displayLabel)).toEqual(['속상함', '행복']);
    expect(record.emotionFlow.map((i) => i.sequence)).toEqual([1, 2]);

    // The derived analysis must not ride along into storage.
    for (const key of ['emotionFlowAnalysis', 'analysis', 'summary', 'emotionSummary', 'shape']) {
      expect(record).not.toHaveProperty(key);
    }
    // No diary fragment reached the payload's emotion items.
    expect(JSON.stringify(record.emotionFlow)).not.toContain('속상했어');
  });

  it('marks every saved item author_only when 나만 보기 is on', async () => {
    const user = userEvent.setup({ delay: null });
    await openWithSuggestions(user);

    await user.click(screen.getByText('공유하기'));
    await waitFor(() => expect(screen.getByText('나만 보기')).toBeInTheDocument());

    await user.click(screen.getByText('1. 속상함'));
    await user.click(screen.getByText('2. 행복'));
    await user.click(screen.getByText('저장'));

    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalled());
    const [record] = addRecordWithMedia.mock.calls[0] as unknown as [
      { emotionFlow: EmotionFlowItem[]; isPrivate: boolean },
    ];
    expect(record.isPrivate).toBe(true);
    expect(record.emotionFlow).toHaveLength(2);
    expect(record.emotionFlow.every((i) => i.visibility === 'author_only')).toBe(true);
  });
});
