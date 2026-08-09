import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';

/**
 * The lifecycle banner is the surface that fixes three separate defects at once:
 *
 *  - a creator who reloads no longer loses every route to a usable code;
 *  - a pending creator is never shown a code-ENTRY field;
 *  - an `unknown` lifecycle never renders as personal mode.
 */

const { regenerateCoupleInvitation, navigateSpy } = vi.hoisted(() => ({
  regenerateCoupleInvitation: vi.fn(),
  navigateSpy: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  regenerateCoupleInvitation: (...args: unknown[]) => regenerateCoupleInvitation(...(args as [])),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateSpy };
});

const toastCalls: { level: string; message: string }[] = [];
vi.mock('sonner', () => ({
  toast: {
    success: (message: string) => { toastCalls.push({ level: 'success', message }); },
    error: (message: string) => { toastCalls.push({ level: 'error', message }); },
    warning: (message: string) => { toastCalls.push({ level: 'warning', message }); },
  },
}));

const refreshCoupleLifecycle = vi.fn();

type Ctx = {
  coupleLifecycle: string;
  invitationExpiresAt: string | null;
  coupleCode?: string;
};

let ctx: Ctx = { coupleLifecycle: 'pending', invitationExpiresAt: null };

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: {
      profile: { couple: { coupleCode: ctx.coupleCode ?? '' } },
    },
    coupleLifecycle: ctx.coupleLifecycle,
    invitationExpiresAt: ctx.invitationExpiresAt,
    refreshCoupleLifecycle,
  }),
}));

const { CoupleStatusBanner } = await import('@/components/CoupleStatusBanner');

function mount() {
  return render(
    <MemoryRouter>
      <CoupleStatusBanner />
    </MemoryRouter>,
  );
}

describe('CoupleStatusBanner', () => {
  beforeEach(() => {
    toastCalls.length = 0;
    navigateSpy.mockReset();
    refreshCoupleLifecycle.mockReset().mockResolvedValue('pending');
    regenerateCoupleInvitation.mockReset();
    ctx = { coupleLifecycle: 'pending', invitationExpiresAt: null };
  });

  it('renders nothing at all when the couple is connected', () => {
    ctx = { coupleLifecycle: 'connected', invitationExpiresAt: null };
    mount();
    expect(screen.queryByTestId('couple-status-banner')).toBeNull();
  });

  it('shows the code, the expiry and what happens next while pending', () => {
    ctx = {
      coupleLifecycle: 'pending',
      coupleCode: '123456',
      invitationExpiresAt: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString(),
    };
    mount();

    expect(screen.getByTestId('couple-status-banner')).toHaveAttribute('data-lifecycle', 'pending');
    expect(screen.getByText('123456')).toBeInTheDocument();
    expect(screen.getByTestId('invitation-expiry').textContent).toMatch(/시간 남음/);
    expect(screen.getByText('상대방이 코드를 입력하면 자동으로 연결돼요.')).toBeInTheDocument();
  });

  it('never renders a code-entry field for a pending creator', () => {
    ctx = { coupleLifecycle: 'pending', coupleCode: '123456', invitationExpiresAt: null };
    mount();
    // `redeem_invitation` rejects a creator's own code as `self_invitation`, so an
    // entry field here could only produce a confusing failure.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.querySelectorAll('input').length).toBe(0);
  });

  it('offers a fresh code when this device no longer holds the plaintext', async () => {
    ctx = { coupleLifecycle: 'pending', coupleCode: '', invitationExpiresAt: null };
    regenerateCoupleInvitation.mockResolvedValue({ code: '654321' });
    mount();

    expect(screen.getByText('이 기기에 저장된 초대 코드가 없습니다')).toBeInTheDocument();
    await act(async () => {
      screen.getByText('새 코드 발급').click();
    });

    await waitFor(() => expect(screen.getByText('654321')).toBeInTheDocument());
    expect(refreshCoupleLifecycle).toHaveBeenCalled();
  });

  /**
   * DEF-05. `invitation_active` is only re-read on a refresh, so a session left
   * open across the 24-hour deadline kept displaying a six-digit code that
   * `redeem_invitation` now rejects -- and the partner looked like the one who
   * mistyped it.
   */
  it('stops showing a cached code once its known deadline has passed', () => {
    ctx = {
      coupleLifecycle: 'pending',
      coupleCode: '123456',
      invitationExpiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
    };
    mount();

    expect(screen.queryByText('123456')).toBeNull();
    expect(screen.queryByLabelText('초대 코드 복사')).toBeNull();
    expect(screen.getByTestId('invitation-expiry').textContent).toBe('만료됨');
    // And it says which situation this is, rather than claiming the device never
    // had a code.
    expect(screen.getByText('초대 코드의 유효기간이 지났어요')).toBeInTheDocument();
    expect(screen.queryByText('이 기기에 저장된 초대 코드가 없습니다')).toBeNull();
    expect(screen.getByText('새 코드 발급')).toBeInTheDocument();
  });

  it('shows a freshly minted code even though the old deadline has passed', async () => {
    ctx = {
      coupleLifecycle: 'pending',
      coupleCode: '123456',
      invitationExpiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
    };
    regenerateCoupleInvitation.mockResolvedValue({ code: '654321' });
    mount();

    await act(async () => {
      screen.getByText('새 코드 발급').click();
    });

    // The new code's own expiry has not been re-read yet, so the lapsed one must
    // not suppress it.
    await waitFor(() => expect(screen.getByText('654321')).toBeInTheDocument());
  });

  it('surfaces the regeneration failure message verbatim', async () => {
    ctx = { coupleLifecycle: 'pending', coupleCode: '', invitationExpiresAt: null };
    regenerateCoupleInvitation.mockResolvedValue({ error: '이미 두 사람이 연결되어 있어 초대 코드가 필요하지 않습니다.' });
    mount();

    await act(async () => {
      screen.getByText('새 코드 발급').click();
    });

    await waitFor(() => expect(toastCalls.some((call) => call.level === 'error')).toBe(true));
    expect(toastCalls[0].message).toBe('이미 두 사람이 연결되어 있어 초대 코드가 필요하지 않습니다.');
  });

  it('offers create-or-join for a genuinely personal account', () => {
    ctx = { coupleLifecycle: 'personal', invitationExpiresAt: null };
    mount();

    expect(screen.getByTestId('couple-status-banner')).toHaveAttribute('data-lifecycle', 'personal');
    expect(screen.getByText('우리 공간을 만들거나 초대 코드를 입력해 보세요')).toBeInTheDocument();
    screen.getByText('커플 공간 설정으로 가기').click();
    expect(navigateSpy).toHaveBeenCalledWith('/settings');
  });

  it('gives reconnect guidance after a disconnect', () => {
    ctx = { coupleLifecycle: 'disconnected', invitationExpiresAt: null };
    mount();

    expect(screen.getByTestId('couple-status-banner')).toHaveAttribute('data-lifecycle', 'disconnected');
    expect(screen.getByText('커플 공간 연결이 해제되었어요')).toBeInTheDocument();
    expect(screen.getByText('다시 연결하기')).toBeInTheDocument();
  });

  it('shows a neutral checking state with a retry for unknown, and NO personal wording', () => {
    ctx = { coupleLifecycle: 'unknown', invitationExpiresAt: null };
    mount();

    const banner = screen.getByTestId('couple-status-banner');
    expect(banner).toHaveAttribute('data-lifecycle', 'unknown');
    expect(screen.getByText('커플 공간 상태를 확인하고 있어요')).toBeInTheDocument();
    // The core invariant: an unanswered question must never read as "you have no
    // couple space".
    expect(banner.textContent).not.toContain('우리 공간을 만들거나');
    expect(banner.textContent).not.toContain('초대 코드를 입력해 보세요');
    expect(screen.getByText('다시 확인')).toBeInTheDocument();
  });

  it('retries the lifecycle check from the unknown state', async () => {
    ctx = { coupleLifecycle: 'unknown', invitationExpiresAt: null };
    mount();

    await act(async () => {
      screen.getByText('다시 확인').click();
    });
    expect(refreshCoupleLifecycle).toHaveBeenCalledTimes(1);
  });

  it('keeps every interactive control at or above the 44px tap target', () => {
    for (const lifecycle of ['pending', 'personal', 'disconnected', 'unknown']) {
      ctx = { coupleLifecycle: lifecycle, coupleCode: lifecycle === 'pending' ? '123456' : '', invitationExpiresAt: null };
      const { unmount } = mount();
      const controls = Array.from(document.querySelectorAll('button'));
      expect(controls.length).toBeGreaterThan(0);
      for (const control of controls) {
        expect(
          control.className,
          `${lifecycle}: control "${control.textContent}" must declare a 44px tap target`,
        ).toMatch(/min-h-\[44px\]/);
      }
      unmount();
    }
  });

  it('is inline, never a bottom-anchored overlay that could sit under the tab bar', () => {
    ctx = { coupleLifecycle: 'pending', coupleCode: '123456', invitationExpiresAt: null };
    mount();
    const banner = screen.getByTestId('couple-status-banner');
    // `modalStacking.test.ts` guards bottom-anchored overlays; this component
    // avoids the whole class of problem by not being one.
    expect(banner.className).not.toContain('fixed');
    expect(banner.className).not.toContain('bottom-0');
  });
});
