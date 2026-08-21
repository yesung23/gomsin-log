import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AppState } from '@/types';

/**
 * PRODUCT_V3 §7.6 — the waiting period, before anyone has joined.
 *
 * A couple space exists as soon as an invite code is created, so records can be
 * written into it days before a partner arrives. The default visibility is
 * SHARED, which meant every one of those records became readable the instant
 * someone joined. §7.6 forbids exactly that: exposure is an explicit act, and
 * "I ticked 공유하기 on a day when nobody could read it" is not one.
 *
 * The enforcement is on the write rather than in the UI, and these tests are
 * split accordingly: hiding the control is copy, the stored value is the
 * contract.
 */

/*
  The FULL success shape, not just `ok`.

  A partial mock passed every assertion here and still broke the run: `runPost`
  reads `result.failedFiles.length` after the save, so an object without it threw
  an unhandled rejection AFTER each test had finished asserting. The tests were
  green and `npm run verify` exited 1.
*/
const addRecordWithMedia = vi.fn(async () => ({ ok: true as const, failedFiles: [] }));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock('@/lib/useOnlineStatus', async () => {
  const actual = await vi.importActual<typeof import('@/lib/useOnlineStatus')>('@/lib/useOnlineStatus');
  return { ...actual, useOnlineStatus: () => true };
});

let currentState: AppState;
vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: currentState,
    isReady: true,
    addRecordWithMedia,
    setHighlightedRecordId: vi.fn(),
  }),
}));

const { TodayLogWidget } = await import('@/components/widgets/TodayLogWidget');

function makeState(connected: boolean): AppState {
  return {
    setupComplete: true,
    onboardingStep: 0,
    authenticatedUser: { id: 'me', email: 'me@example.com', provider: 'google' },
    profile: {
      id: 'me',
      myName: '춘향',
      role: 'gomsin',
      couple: {
        // A space exists either way. That is what makes this defect possible:
        // the write succeeds long before anyone can read it.
        coupleId: 'couple-1',
        partnerName: connected ? '몽룡' : undefined,
        anniversaryDate: '2025-01-01',
        coupleCode: connected ? '' : 'ABC123',
        connected,
        status: connected ? 'active' : 'pending',
      },
      military: {} as never,
      contact: {} as never,
    },
    records: [],
    events: [],
    trips: [],
    talkAboutMarks: [],
    widgetLayout: [],
    hasSeenInstallPrompt: true,
    theme: 'light',
  };
}

function renderComposer(connected: boolean) {
  currentState = makeState(connected);
  return render(<TodayLogWidget />);
}

async function writeAndSave(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(screen.getByText('한줄'));
  await user.type(screen.getByPlaceholderText(/지금 이 순간/), text);
  await user.click(screen.getByRole('button', { name: '저장' }));
  await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalled());
  return addRecordWithMedia.mock.calls[0][0] as unknown as { isPrivate: boolean; talkAbout: boolean };
}

beforeEach(() => {
  addRecordWithMedia.mockClear().mockResolvedValue({ ok: true, failedFiles: [] });
});

describe('while nobody has joined', () => {
  it('stores the record private, whatever the UI would otherwise default to', async () => {
    // The defect in one assertion. The default is shared; without a partner it
    // must not be.
    const user = userEvent.setup();
    renderComposer(false);

    const saved = await writeAndSave(user, '혼자 남기는 하루');
    expect(saved.isPrivate).toBe(true);
  });

  it('offers no visibility choice, because there is nothing to choose between', async () => {
    const user = userEvent.setup();
    renderComposer(false);
    await user.click(screen.getByText('한줄'));

    expect(screen.queryByText('공유하기')).toBeNull();
    expect(screen.queryByText('나만 보기')).toBeNull();
  });

  it('says so, rather than leaving the absence unexplained', async () => {
    // Writing alone is the point of the waiting period, not a degraded mode.
    const user = userEvent.setup();
    renderComposer(false);
    await user.click(screen.getByText('한줄'));

    const notice = screen.getByTestId('composer-waiting-notice');
    expect(notice.textContent).toContain('연결된 상대가 없어요');
    // And it promises the §7.6 question rather than implying the record is lost.
    expect(notice.textContent).toContain('물어볼게요');
  });

  it('cannot mark a record for a conversation with nobody', async () => {
    const user = userEvent.setup();
    renderComposer(false);

    const saved = await writeAndSave(user, '혼자');
    expect(saved.talkAbout).toBe(false);
  });
});

describe('once a partner has joined', () => {
  it('restores the choice', async () => {
    const user = userEvent.setup();
    renderComposer(true);
    await user.click(screen.getByText('한줄'));

    expect(screen.getByText('공유하기')).toBeInTheDocument();
    expect(screen.queryByTestId('composer-waiting-notice')).toBeNull();
  });

  it('stores what the author actually chose', async () => {
    const user = userEvent.setup();
    renderComposer(true);

    const saved = await writeAndSave(user, '같이 보는 하루');
    expect(saved.isPrivate).toBe(false);
  });
});
