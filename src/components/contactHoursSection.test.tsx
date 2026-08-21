import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AppState, Role } from '@/types';
import { toast } from 'sonner';

/**
 * 알림 받을 시간 — the window each person controls for themselves.
 *
 * This section used to render for 군화 only, read-only. Migration 048 made both
 * of those wrong: it sends each recipient's notification inside THEIR OWN
 * declared window (§14.3 -- the send time comes from hours the user typed in,
 * never from a learned access pattern). A role that could not see it had no
 * control over being interrupted, and a value nobody can edit is a preference in
 * name only.
 */

const updateProfile = vi.fn(async () => true);

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

let currentState: AppState;
vi.mock('@/lib/useStore', () => ({
  useStore: () => ({ state: currentState, isReady: true, updateProfile }),
}));

const { ContactHoursSection } = await import('@/components/ContactHoursSection');

function makeState(role: Role): AppState {
  return {
    setupComplete: true,
    onboardingStep: 0,
    authenticatedUser: { id: 'me', email: 'me@example.com', provider: 'google' },
    profile: {
      id: 'me',
      myName: '춘향',
      role,
      couple: {
        coupleId: 'couple-1', partnerName: '몽룡', anniversaryDate: '2025-01-01',
        coupleCode: '', connected: true, status: 'active',
      },
      military: {} as never,
      contact: {
        weekdayStart: '18:00', weekdayEnd: '21:00',
        weekendStart: '12:00', weekendEnd: '21:00',
        enabled: true,
      },
    },
    records: [], events: [], trips: [], talkAboutMarks: [],
    widgetLayout: [], hasSeenInstallPrompt: true, theme: 'light',
  };
}

function renderSection(role: Role) {
  currentState = makeState(role);
  return render(<ContactHoursSection />);
}

beforeEach(() => {
  updateProfile.mockClear().mockResolvedValue(true);
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
});

describe('both roles control their own window', () => {
  it.each<Role>(['gomsin', 'soldier'])('renders for %s', (role) => {
    renderSection(role);
    expect(screen.getByTestId('contact-hours')).toBeInTheDocument();
    expect(screen.getByText('바꾸기')).toBeInTheDocument();
  });

  it('shows the whole window, not just the weekday half', () => {
    // The weekend hours were stored and never displayed, so nobody could tell
    // what they were set to -- and `push_delivery_candidates` uses them.
    renderSection('gomsin');
    expect(screen.getByText(/평일 18:00 ~ 21:00/)).toBeInTheDocument();
    expect(screen.getByText(/주말 12:00 ~ 21:00/)).toBeInTheDocument();
  });

  it('saves an edited window', async () => {
    const user = userEvent.setup();
    renderSection('gomsin');

    await user.click(screen.getByText('바꾸기'));
    const start = screen.getByLabelText('평일 시작');
    await user.clear(start);
    await user.type(start, '09:00');
    await user.click(screen.getByText('저장'));

    await waitFor(() => expect(updateProfile).toHaveBeenCalledTimes(1));
    expect(updateProfile.mock.calls[0][0]).toMatchObject({
      contact: expect.objectContaining({ weekdayStart: '09:00' }),
    });
  });
});

describe('a window that cannot fire is refused before it is stored', () => {
  it('refuses an end at or before the start', async () => {
    /*
      The database would accept it and `push_delivery_candidates()` would simply
      never match, so the person would stop receiving notifications with nothing
      on screen to explain why. Refused here, where it can be explained.
    */
    const user = userEvent.setup();
    renderSection('soldier');

    await user.click(screen.getByText('바꾸기'));
    const end = screen.getByLabelText('평일 끝');
    await user.clear(end);
    await user.type(end, '17:00'); // start is 18:00
    await user.click(screen.getByText('저장'));

    expect(updateProfile).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error)).toHaveBeenCalled();
  });

  it('checks the weekend window too, not only the weekday one', async () => {
    const user = userEvent.setup();
    renderSection('gomsin');

    await user.click(screen.getByText('바꾸기'));
    const end = screen.getByLabelText('주말 끝');
    await user.clear(end);
    await user.type(end, '11:00'); // weekend start is 12:00
    await user.click(screen.getByText('저장'));

    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('keeps the editor open when the save is refused by the server', async () => {
    const user = userEvent.setup();
    updateProfile.mockResolvedValue(false);
    renderSection('gomsin');

    await user.click(screen.getByText('바꾸기'));
    await user.click(screen.getByText('저장'));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    // Still editing: closing it would look like the change was kept.
    expect(screen.getByText('저장')).toBeInTheDocument();
  });
});

describe('what the copy promises', () => {
  it.each<Role>(['gomsin', 'soldier'])('%s is told the three guarantees', (role) => {
    /*
      At most once a day, nothing outside the window, no content in the payload.
      Each is enforced elsewhere -- the cap and window inside
      `push_delivery_candidates()`, the body as a constant in the sender -- so
      this is a description of a guarantee rather than a claim.
    */
    renderSection(role);
    const copy = screen.getByTestId('contact-hours').textContent ?? '';
    expect(copy).toContain('하루에 한 번');
    expect(copy).toContain('기록 내용이 담기지 않아요');
  });
});
