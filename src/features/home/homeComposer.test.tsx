import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AppState, EmotionFlowItem, Role } from '@/types';
import { clearAllComposerDrafts } from '@/lib/composerDraft';

const addRecordWithMedia = vi.fn(async () => ({ ok: true, failedFiles: [] as string[] }));
const setWidgetLayout = vi.fn();
const setHighlightedRecordId = vi.fn();

let currentRole: Role = 'gomsin';

function makeState(): AppState {
  return {
    setupComplete: true,
    onboardingStep: 0,
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
    /*
     * Stated explicitly rather than inherited from `DEFAULT_LAYOUT_BY_ROLE`.
     *
     * These tests are about the COMPOSER -- that 군화 gets the same one 곰신 does
     * (this dashboard used to be a read-only tree) and that whoever writes is
     * recorded as the author. Neither claim is about which widgets 군화 gets by
     * default, but both silently depended on `today_word` being in that default,
     * so they broke when the 군화 default was reduced to the briefing, the
     * partner's day and D-Day.
     *
     * `today_word` is still offered to 군화 by `widgetsForRole` and is asserted
     * there (`emotionRedesign.test.ts`); this fixture is a 군화 who has added it,
     * which is exactly the state these assertions describe. README §1.3 -- both
     * roles write with the same composer -- is therefore still under test.
     */
    soldierWidgetLayout: ['today_word', 'dday'],
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

function renderIn(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('composer availability by role', () => {
  beforeEach(() => {
    addRecordWithMedia.mockClear();
    // The composer now keeps an unsent draft in memory across unmounts (by
    // design), so each test has to start from a clean stash or it inherits the
    // previous test's text and its 저장 button state.
    clearAllComposerDrafts();
  });

  it('gives 곰신 a composer on the routed home dashboard', () => {
    currentRole = 'gomsin';
    renderIn(<WidgetDashboard />);

    expect(screen.getByText('오늘의 기록')).toBeInTheDocument();
    expect(screen.getByText('지금찍기')).toBeInTheDocument();
    expect(screen.getByText('사진·영상')).toBeInTheDocument();
    expect(screen.getByText('음성')).toBeInTheDocument();
  });

  /**
   * 군화 used to get a separate hardcoded `SoldierDashboard`. Both roles now run
   * the same role-aware `WidgetDashboard`, so this renders the real component the
   * app renders rather than a parallel one that could drift.
   */
  it('gives 군화 the same composer (this dashboard used to be read-only)', () => {
    currentRole = 'soldier';
    renderIn(<WidgetDashboard />);

    expect(screen.getByText('오늘의 기록')).toBeInTheDocument();
    expect(screen.getByText('지금찍기')).toBeInTheDocument();
    expect(screen.getByText('사진·영상')).toBeInTheDocument();
    expect(screen.getByText('음성')).toBeInTheDocument();
  });

  it('records the author role of whoever is writing', async () => {
    currentRole = 'soldier';
    const user = userEvent.setup();
    renderIn(<WidgetDashboard />);

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
    // The composer now keeps an unsent draft in memory across unmounts (by
    // design), so each test has to start from a clean stash or it inherits the
    // previous test's text and its 저장 button state.
    clearAllComposerDrafts();
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
   * The text saves, an attachment does not. The composer used to clear
   * `pendingFiles` BEFORE showing "잠시 후 다시 첨부해 주세요", so the files the
   * user was being asked to retry with had already been discarded.
   *
   * For a photo that was merely annoying. For a voice memo it was unrecoverable:
   * the recording is synthesised into an in-memory `File` and exists nowhere on
   * disk, so there was no "다시 첨부" the user could actually perform.
   */
  it('keeps a failed attachment in the composer instead of destroying it', async () => {
    addRecordWithMedia.mockResolvedValueOnce({ ok: true, failedFiles: ['목소리.webm'] });
    const user = userEvent.setup();
    renderIn(<WidgetDashboard />);

    await user.click(screen.getByText('한줄'));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, [
      new File(['x'], '목소리.webm', { type: 'audio/webm' }),
      new File(['x'], 'sunset.png', { type: 'image/png' }),
    ]);
    expect(await screen.findByText('목소리.webm')).toBeInTheDocument();

    await user.click(screen.getByText('저장'));
    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalled());

    // The one that failed is still attached and still retryable...
    expect(await screen.findByText('목소리.webm')).toBeInTheDocument();
    // ...and the one that succeeded is not offered again, so a retry cannot
    // silently duplicate it.
    await waitFor(() => expect(screen.queryByText('sunset.png')).not.toBeInTheDocument());
  });

  it('clears the composer completely when every attachment succeeded', async () => {
    addRecordWithMedia.mockResolvedValueOnce({ ok: true, failedFiles: [] });
    const user = userEvent.setup();
    renderIn(<WidgetDashboard />);

    await user.click(screen.getByText('한줄'));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['x'], 'sunset.png', { type: 'image/png' }));
    expect(await screen.findByText('sunset.png')).toBeInTheDocument();

    await user.click(screen.getByText('저장'));
    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('sunset.png')).not.toBeInTheDocument());
  });

  /**
   * A failed save must never clear the draft either -- that is the other half of
   * the same promise, and it is the path an offline or RLS failure takes.
   */
  it('keeps both the text and the attachment when the save itself fails', async () => {
    addRecordWithMedia.mockResolvedValueOnce({
      ok: false,
      failedFiles: ['sunset.png'],
      error: '권한이 없어요. 커플 공간 연결 상태를 확인해 주세요.',
    } as never);
    const user = userEvent.setup();
    renderIn(<WidgetDashboard />);

    await user.click(screen.getByText('한줄'));
    const textarea = screen.getByPlaceholderText('지금 이 순간, 어떤 생각을 하고 있나요?');
    await user.type(textarea, '오늘도 보고 싶어');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['x'], 'sunset.png', { type: 'image/png' }));

    await user.click(screen.getByText('저장'));
    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalled());

    expect(screen.getByDisplayValue('오늘도 보고 싶어')).toBeInTheDocument();
    expect(screen.getByText('sunset.png')).toBeInTheDocument();
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
describe('composer emotion review (suggested, then answered)', () => {
  const LOG_TEXT = '오늘은 많이 속상했어. 그래도 저녁에는 기분이 좋아졌어.';
  /** The literal case the product owner reported. */
  const REPORTED_TEXT = '일하느라 ㅈ같았는데, 손님이 먹을 것을 줘서 기분이 나아졌어';

  /**
   * Open the composer, write, and reach the composition boundary.
   *
   * The `tab()` is load-bearing. The analyser no longer runs on a typing
   * debounce -- it runs when the field is left or when save is pressed -- so a
   * helper that only typed would wait forever for a list the app has correctly
   * not produced. See `lib/onDeviceInference.ts`.
   */
  async function openWith(user: ReturnType<typeof userEvent.setup>, text: string) {
    renderIn(<WidgetDashboard />);
    await user.click(screen.getByText('한줄'));
    const textarea = await screen.findByPlaceholderText('지금 이 순간, 어떤 생각을 하고 있나요?');
    await user.type(textarea, text);
    await user.tab();
    return waitFor(() => expect(screen.getByTestId('emotion-suggestion-list')).toBeInTheDocument());
  }

  /** Answer every reading, which is what turns a suggestion into a stored feeling. */
  async function answerAll(user: ReturnType<typeof userEvent.setup>) {
    const confirmAll = screen.queryByTestId('emotion-suggestion-confirm-all');
    if (confirmAll) {
      await user.click(confirmAll);
      return;
    }
    const buttons = screen
      .getAllByRole('button')
      .filter((b) => b.getAttribute('data-testid')?.startsWith('emotion-suggestion-confirm-'));
    for (const button of buttons) await user.click(button);
  }

  beforeEach(() => {
    addRecordWithMedia.mockClear();
    // The composer now keeps an unsent draft in memory across unmounts (by
    // design), so each test has to start from a clean stash or it inherits the
    // previous test's text and its 저장 button state.
    clearAllComposerDrafts();
    currentRole = 'gomsin';
  });

  /**
   * The reading is offered without any tap. Storing it still takes one.
   *
   * The suggestion appears on its own -- writing an entry should not cost an
   * extra step to find out what the app made of it -- but the preview of what
   * WILL BE SAVED stays empty until a person agrees, because until then the
   * honest answer is that nothing will be.
   */
  it('shows what it read without any tap, and previews only what was answered', async () => {
    const user = userEvent.setup({ delay: null });
    await openWith(user, LOG_TEXT);

    expect(screen.getByText('슬픔')).toBeInTheDocument();
    expect(screen.getByText('행복')).toBeInTheDocument();
    // Nothing answered yet, so there is no flow to preview.
    expect(screen.queryByText('슬픔 → 행복')).not.toBeInTheDocument();

    await answerAll(user);

    expect(await screen.findByText('마음의 흐름')).toBeInTheDocument();
    expect(screen.getByText('슬픔 → 행복')).toBeInTheDocument();
    expect(screen.getByText('미리보기예요. 이 정리는 저장되지 않아요.')).toBeInTheDocument();
  });

  /**
   * The reported sentence, end to end. "ㅈ같았는데" has to be understood: an engine
   * that only knows "짜증났는데" misses the entries carrying the most feeling.
   */
  it('reads the reported example as 분노 → 행복 and shows the evidence phrase', async () => {
    const user = userEvent.setup({ delay: null });
    await openWith(user, REPORTED_TEXT);

    expect(screen.getByText('분노')).toBeInTheDocument();
    expect(screen.getByText('행복')).toBeInTheDocument();
    // The user can see WHY, not just what.
    expect(screen.getByText('“ㅈ같음”에서 읽었어요')).toBeInTheDocument();
    expect(screen.getByText('“기분이 나아짐”에서 읽었어요')).toBeInTheDocument();
    await answerAll(user);
    expect(await screen.findByText('분노 → 행복')).toBeInTheDocument();
  });

  it('✕ removes a feeling from what will be saved, and it can be put back', async () => {
    const user = userEvent.setup({ delay: null });
    await openWith(user, LOG_TEXT);

    await user.click(screen.getByLabelText('슬픔 빼기'));

    // Scoped to the kept list on purpose: the restore button also carries the
    // word 슬픔, so an unscoped query would pass whether or not removal worked.
    await waitFor(() => {
      expect(screen.getByLabelText('슬픔 다시 넣기')).toBeInTheDocument();
    });
    const keptList = screen.getByTestId('emotion-suggestion-list');
    expect(keptList.textContent).not.toContain('슬픔');
    expect(keptList.textContent).toContain('행복');
    // Removal is reversible: a mis-tap must not cost the user their reading.
    expect(screen.getByTestId('emotion-suggestion-removed')).toBeInTheDocument();

    await user.click(screen.getByLabelText('슬픔 다시 넣기'));
    await waitFor(() => {
      expect(screen.getByTestId('emotion-suggestion-list').textContent).toContain('슬픔');
    });
  });

  /**
   * Correcting a reading IS answering it.
   *
   * Someone who replaces 슬픔 with 분노 has said more about what they felt than
   * someone who tapped 맞아요, so a correction must not also require a separate
   * confirmation before it can be stored.
   */
  it('picking a different feeling corrects it, counts as the answer, and is what gets saved', async () => {
    const user = userEvent.setup({ delay: null });
    await openWith(user, LOG_TEXT);

    const firstRow = screen.getByTestId('emotion-suggestion-list').querySelector('li');
    const candidateId = firstRow?.getAttribute('data-testid')?.replace('emotion-suggestion-', '');
    expect(candidateId).toBeTruthy();

    await user.click(screen.getByTestId(`emotion-suggestion-change-${candidateId}`));
    await user.click(screen.getByTestId(`emotion-suggestion-option-${candidateId}-anger`));

    // The second reading is still unanswered, so only the corrected one is saved.
    await user.click(screen.getByText('저장'));
    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalled());
    const [record] = addRecordWithMedia.mock.calls[0] as unknown as [
      { emotionFlow: EmotionFlowItem[] },
    ];
    expect(record.emotionFlow.map((item) => item.basic)).toEqual(['anger']);
    expect(record.emotionFlow.map((item) => item.displayLabel)).toEqual(['분노']);
    // A human overrode the machine, and that is recorded.
    expect(record.emotionFlow[0].userEdited).toBe(true);
    expect(record.emotionFlow[0].source).toBe('user_confirmed');
  });

  it('saves only answered items, with no diary text and no analysis field', async () => {
    const user = userEvent.setup({ delay: null });
    await openWith(user, LOG_TEXT);
    await answerAll(user);
    await user.click(screen.getByText('저장'));

    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalled());
    const [record] = addRecordWithMedia.mock.calls[0] as unknown as [
      Record<string, unknown> & { emotionFlow: EmotionFlowItem[] },
    ];

    expect(record.emotionFlow).toHaveLength(2);
    expect(record.emotionFlow.every((i) => i.source === 'user_confirmed')).toBe(true);
    expect(record.emotionFlow.every((i) => !('matchedText' in i))).toBe(true);
    // The evidence phrase is display-only and must not ride along.
    expect(record.emotionFlow.every((i) => !('evidence' in i))).toBe(true);
    expect(record.emotionFlow.map((i) => i.displayLabel)).toEqual(['슬픔', '행복']);
    expect(record.emotionFlow.map((i) => i.sequence)).toEqual([1, 2]);

    for (const key of ['emotionFlowAnalysis', 'analysis', 'summary', 'emotionSummary', 'shape']) {
      expect(record).not.toHaveProperty(key);
    }
    expect(JSON.stringify(record.emotionFlow)).not.toContain('속상했어');
    expect(JSON.stringify(record.emotionFlow)).not.toContain('좋아졌어');
  });

  /** Writing and saving without engaging the question stores no feeling. */
  it('saves nothing when the author never answers the suggestion', async () => {
    const user = userEvent.setup({ delay: null });
    await openWith(user, LOG_TEXT);

    await user.click(screen.getByText('저장'));
    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalled());
    const [record] = addRecordWithMedia.mock.calls[0] as unknown as [
      { emotionFlow: EmotionFlowItem[] },
    ];
    expect(record.emotionFlow).toEqual([]);
  });

  it('saves nothing when the author removes every feeling', async () => {
    const user = userEvent.setup({ delay: null });
    await openWith(user, LOG_TEXT);

    await user.click(screen.getByLabelText('슬픔 빼기'));
    await user.click(screen.getByLabelText('행복 빼기'));
    expect(await screen.findByTestId('emotion-suggestion-empty')).toBeInTheDocument();

    await user.click(screen.getByText('저장'));
    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalled());
    const [record] = addRecordWithMedia.mock.calls[0] as unknown as [
      { emotionFlow: EmotionFlowItem[] },
    ];
    expect(record.emotionFlow).toEqual([]);
  });

  it('marks every saved item author_only when 나만 보기 is on', async () => {
    const user = userEvent.setup({ delay: null });
    await openWith(user, LOG_TEXT);
    await answerAll(user);

    await user.click(screen.getByText('공유하기'));
    await waitFor(() => expect(screen.getByText('나만 보기')).toBeInTheDocument());
    await user.click(screen.getByText('저장'));

    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalled());
    const [record] = addRecordWithMedia.mock.calls[0] as unknown as [
      { emotionFlow: EmotionFlowItem[]; isPrivate: boolean },
    ];
    expect(record.isPrivate).toBe(true);
    expect(record.emotionFlow).toHaveLength(2);
    expect(record.emotionFlow.every((i) => i.visibility === 'author_only')).toBe(true);
  });

  /**
   * The timing rule, asserted where it is observable.
   *
   * Typing must not produce a reading. Only leaving the field does. Without this
   * the analyser could quietly be moved back onto a debounce and every other
   * test here would still pass, because they all blur before asserting.
   */
  it('does not read the entry while it is still being typed', async () => {
    const user = userEvent.setup({ delay: null });
    renderIn(<WidgetDashboard />);
    await user.click(screen.getByText('한줄'));
    const textarea = await screen.findByPlaceholderText('지금 이 순간, 어떤 생각을 하고 있나요?');
    await user.type(textarea, LOG_TEXT);

    expect(screen.queryByTestId('emotion-suggestion-review')).not.toBeInTheDocument();

    await user.tab();
    expect(await screen.findByTestId('emotion-suggestion-review')).toBeInTheDocument();
  });
});
