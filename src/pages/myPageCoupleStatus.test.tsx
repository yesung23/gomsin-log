import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { CoupleLifecycle } from '@/lib/coupleLifecycle';
import type { Role } from '@/types';

/**
 * 마이 must not claim a couple state it has not confirmed.
 *
 * The status line was `connected ? "{partner}님과 연결됨" : "연결 대기 중"`, which
 * collapsed four distinct states into two and made three of them false:
 *
 *   - no couple space at all  -> "연결 대기 중"  (nothing is pending)
 *   - link released           -> "연결 대기 중"  (nothing is pending)
 *   - membership unconfirmed  -> "연결 대기 중"  (not known yet)
 *   - genuinely waiting       -> "연결 대기 중"  (the only true case)
 *
 * "대기 중" tells a user an invitation is outstanding and someone may still join.
 * For a user who never made a space, or who just disconnected, that is an
 * invented fact -- and it is the same class of defect the rest of the app already
 * polices (CoupleStatusBanner distinguishes all five lifecycle states by name).
 */

let lifecycle: CoupleLifecycle = 'connected';
let role: Role = 'gomsin';
let relationshipContext: 'military' | 'general' = 'military';
let coupleId: string | undefined = 'couple-1';
let connected = true;
let status: 'active' | 'pending' | 'disconnected' = 'active';

vi.mock('@/components/MobileShell', () => ({
  MobileShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/CycleTrackerSection', () => ({
  CycleTrackerSection: () => <div data-testid="cycle-tracker" />,
}));
vi.mock('@/components/CycleSupportSection', () => ({
  CycleSupportSection: () => <div data-testid="cycle-support" />,
}));

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: {
      authenticatedUser: { id: 'u1', email: 'a@b.c', provider: 'google' as const },
      profile: {
        id: 'u1',
        myName: '춘향',
        role,
        couple: {
          coupleId,
          partnerName: '몽룡',
          anniversaryDate: '2025-01-01',
          coupleCode: '',
          connected,
          status,
          relationshipContext,
        },
        military: { branch: 'army', militaryStatus: 'unknown', dischargeDateSource: 'unknown' },
        contact: { weekdayStart: '18:00', weekdayEnd: '21:00', weekendStart: '12:00', weekendEnd: '21:00', enabled: true },
      },
    },
    coupleLifecycle: lifecycle,
  }),
}));

const { MyPage } = await import('@/pages/MyPage');

function renderMy() {
  return render(<MemoryRouter><MyPage /></MemoryRouter>);
}

describe('마이 couple status line', () => {
  beforeEach(() => {
    role = 'gomsin';
    relationshipContext = 'military';
    lifecycle = 'connected';
    coupleId = 'couple-1';
    connected = true;
    status = 'active';
  });

  it('names the partner when both are actually connected', () => {
    renderMy();
    expect(screen.getByText('몽룡님과 연결됨')).toBeInTheDocument();
  });

  it('says 대기 중 ONLY when a space really is waiting for a partner', () => {
    lifecycle = 'pending';
    connected = false;
    status = 'pending';
    renderMy();
    expect(screen.getByText('연결 대기 중')).toBeInTheDocument();
  });

  it('does not claim anything is pending when there is no couple space', () => {
    lifecycle = 'personal';
    coupleId = undefined;
    connected = false;
    status = 'disconnected';
    renderMy();
    expect(screen.queryByText('연결 대기 중')).not.toBeInTheDocument();
    expect(screen.getByText('아직 우리 공간이 없어요')).toBeInTheDocument();
  });

  it('says the link was released, not that someone may still join', () => {
    lifecycle = 'disconnected';
    coupleId = undefined;
    connected = false;
    status = 'disconnected';
    renderMy();
    expect(screen.queryByText('연결 대기 중')).not.toBeInTheDocument();
    expect(screen.getByText('연결이 해제된 상태예요')).toBeInTheDocument();
  });

  it('admits it does not know yet rather than guessing', () => {
    lifecycle = 'unknown';
    connected = false;
    status = 'pending';
    renderMy();
    expect(screen.queryByText('연결 대기 중')).not.toBeInTheDocument();
    // Worded as a couple-space check, not a connection check: "연결 상태를 확인"
    // reads as a network diagnosis and `serverErrorCopy` guards that phrasing.
    expect(screen.getByText('우리 공간 상태를 확인하는 중이에요')).toBeInTheDocument();
  });

  it('never names a partner while unconfirmed, in any non-connected state', () => {
    for (const state of ['personal', 'pending', 'disconnected', 'unknown'] as CoupleLifecycle[]) {
      lifecycle = state;
      connected = false;
      const view = renderMy();
      expect(screen.queryByText('몽룡님과 연결됨'), state).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it('never exposes internal military role slots or service actions to a general couple', () => {
    role = 'soldier';
    relationshipContext = 'general';
    renderMy();

    expect(screen.queryByText('군화')).not.toBeInTheDocument();
    expect(screen.queryByText('곰신')).not.toBeInTheDocument();
    expect(screen.queryByText('복무와 일정')).not.toBeInTheDocument();
    expect(screen.queryByText('복무 현황 · D-Day')).not.toBeInTheDocument();
    expect(screen.getByText('몽룡님과 연결됨')).toBeInTheDocument();
  });

  it('군 커플 마이 화면은 구조용 이모지 대신 일관된 벡터 아이콘을 사용한다', () => {
    role = 'soldier';
    renderMy();

    expect(document.body.textContent).not.toMatch(/🌸|🪖|🎖️|🏖️/u);

    const avatar = screen.getByRole('button', { name: '내 사진 고르기' });
    expect(avatar.querySelector('svg[viewBox="0 0 40 40"]')).not.toBeNull();

    const service = screen.getByText('복무 현황 · D-Day').closest('button');
    const schedule = screen.getByText('휴가·면회 일정').closest('button');
    expect(service?.querySelector('.lucide-shield')).not.toBeNull();
    expect(schedule?.querySelector('.lucide-calendar-days')).not.toBeNull();

    for (const icon of document.querySelectorAll('svg')) {
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    }
  });
});
