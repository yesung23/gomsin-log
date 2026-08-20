import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AppState, Role } from '@/types';
import { clearAllComposerDrafts } from '@/lib/composerDraft';

/**
 * One tap, one record.
 *
 * `handlePost` gates itself with `if (isSaving) return` and the button also
 * carries `disabled={isSaving || ...}`. Both are driven by React state, which is
 * only visible on the NEXT render -- so two calls raised before React re-renders
 * both read `isSaving === false` and both reach the server.
 *
 * That is not a synthetic concern: the save button is a full-width primary CTA on
 * a touch surface, and a double-tap (or a tap plus an accessibility activation)
 * lands well inside one frame. The result was a duplicate diary entry with a
 * duplicate media upload behind it, and no way for the author to tell which copy
 * their partner would see.
 *
 * The gate has to be synchronous to hold.
 */

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
      myName: '춘향',
      role: currentRole,
      couple: {
        coupleId: 'couple-1',
        partnerName: '몽룡',
        anniversaryDate: '2025-01-01',
        coupleCode: '',
        connected: true,
        status: 'active',
      },
      military: {
        branch: 'army',
        militaryStatus: 'unknown',
        dischargeDateSource: 'unknown',
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
  } as unknown as AppState;
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

const { RoleHome } = await import('@/features/home/RoleHome');

function renderIn(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

function saveButton(): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === '저장',
  );
  if (!button) throw new Error('save button not found');
  return button as HTMLButtonElement;
}

async function composeText(text: string) {
  const user = userEvent.setup();
  renderIn(<RoleHome />);
  await user.click(screen.getByText('한줄'));
  const textarea = await screen.findByPlaceholderText('지금 이 순간, 어떤 생각을 하고 있나요?');
  await user.type(textarea, text);
  return user;
}

describe('composer: one tap, one record', () => {
  beforeEach(() => {
    addRecordWithMedia.mockClear();
    clearAllComposerDrafts();
    currentRole = 'gomsin';
  });

  it('does not save twice when 저장 is activated twice within one frame', async () => {
    // Hold the save in flight so both activations happen while the first is
    // still running -- the real timing of a double tap.
    let release: (() => void) | undefined;
    addRecordWithMedia.mockImplementationOnce(
      () => new Promise((resolve) => {
        release = () => resolve({ ok: true, failedFiles: [] });
      }),
    );

    await composeText('두 번 눌러도 한 번만');

    const button = saveButton();
    act(() => {
      button.click();
      button.click();
    });

    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalled());
    expect(addRecordWithMedia).toHaveBeenCalledTimes(1);

    await act(async () => { release?.(); });
  });

  it('does not save three times on a rapid triple activation', async () => {
    let release: (() => void) | undefined;
    addRecordWithMedia.mockImplementationOnce(
      () => new Promise((resolve) => {
        release = () => resolve({ ok: true, failedFiles: [] });
      }),
    );

    await composeText('세 번 눌러도 한 번만');

    const button = saveButton();
    act(() => {
      button.click();
      button.click();
      button.click();
    });

    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalled());
    expect(addRecordWithMedia).toHaveBeenCalledTimes(1);

    await act(async () => { release?.(); });
  });

  it('PRESERVATION: a single tap still saves exactly once', async () => {
    const user = await composeText('한 번만 눌렀어요');
    await user.click(screen.getByText('저장'));
    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalledTimes(1));
  });

  /**
   * The guard must release, or a failed save would lock the composer for good and
   * the retry the surrounding tests promise would be impossible.
   */
  it('PRESERVATION: a second, deliberate save after a failure still reaches the server', async () => {
    addRecordWithMedia.mockResolvedValueOnce({
      ok: false,
      failedFiles: [],
      error: '기록을 저장하지 못했어요.',
    } as unknown as { ok: true; failedFiles: string[] });

    const user = await composeText('실패 후 재시도');
    await user.click(screen.getByText('저장'));
    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalledTimes(1));

    // The draft is deliberately kept on failure, so the author can simply retry.
    await user.click(screen.getByText('저장'));
    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalledTimes(2));
  });
});
