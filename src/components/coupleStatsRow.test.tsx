import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { CoupleStatsRow } from '@/components/CoupleStatsRow';
import type { CoupleEvent, MilitaryInfo } from '@/types';

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

const TODAY = '2026-08-22';

const MILITARY = {
  militaryStatus: 'serving', enlistmentDate: '2025-06-01',
  expectedDischargeDate: '2026-12-01', dischargeDateSource: 'user',
} as MilitaryInfo;

function event(over: Partial<CoupleEvent> = {}): CoupleEvent {
  return {
    id: 'e1', coupleId: 'c1', title: '면회', eventType: 'visit',
    startDate: '2026-08-27', createdAt: '', ...over,
  } as CoupleEvent;
}

function row(props: Partial<Parameters<typeof CoupleStatsRow>[0]> = {}) {
  return render(
    <MemoryRouter>
      <CoupleStatsRow
        userId="me" anniversaryDate="2025-08-22" events={[event()]}
        military={MILITARY} todayStr={TODAY} onProtectionTap={vi.fn()} {...props}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('세 칸이 관계의 시간을 말한다', () => {
  it('쌓이는 것 하나와 줄어드는 것 둘', () => {
    row();
    expect(screen.getByText('함께한 날')).toBeTruthy();
    expect(screen.getByText('만남까지')).toBeTruthy();
    expect(screen.getByText('전역까지')).toBeTruthy();
  });

  it('세 칸뿐이다', () => {
    // 인스타의 통계 줄은 균등 3분할이다. 넷이 되면 그 문법이 깨진다.
    const { container } = row();
    expect(container.querySelectorAll('[data-testid="couple-stats"] button')).toHaveLength(3);
  });

  it('줄어드는 숫자에 경고색을 쓰지 않는다', () => {
    /*
      D-1이 빨간색이면 그건 정보가 아니라 카운트다운 압박이다. 세 숫자가 같은 클래스를
      쓴다는 것이 이 앱이 불안을 만들지 않는다는 §3 원칙 6의 구현이다.
    */
    const { container } = row({ events: [event({ startDate: '2026-08-23' })] });
    const values = [...container.querySelectorAll('[data-testid="couple-stats"] .text-title')];
    const classes = new Set(values.map((n) => n.className));
    expect(classes.size).toBe(1);
    expect([...classes][0]).not.toMatch(/destructive|warning|coral/);
  });
});

describe('0을 보여주지 않는다', () => {
  it('기념일이 없으면 0일이 아니라 —', () => {
    row({ anniversaryDate: undefined });
    const together = screen.getByRole('button', { name: /함께한 날/ });
    expect(together.textContent).toContain('—');
    expect(together.textContent).not.toContain('0');
  });

  it('만남이 없으면 D-0이 아니라 미정', () => {
    row({ events: [] });
    expect(screen.getByRole('button', { name: /만남까지/ }).textContent).toContain('미정');
  });

  it('없는 칸은 무엇을 하면 되는지 말한다', () => {
    row({ anniversaryDate: undefined });
    expect(screen.getByRole('button', { name: /함께한 날 — 사귄 날을 정하면/ })).toBeTruthy();
  });
});

describe('세 번째 칸은 바꿀 수 있다', () => {
  it('누르면 다른 항목으로 돈다', async () => {
    // 길게 누르기 같은 숨은 제스처를 만들지 않는다.
    row();
    await userEvent.click(screen.getByRole('button', { name: /전역까지/ }));
    expect(screen.queryByText('전역까지')).toBeNull();
  });

  it('고른 것이 다음에도 남는다', async () => {
    const { unmount } = row();
    await userEvent.click(screen.getByRole('button', { name: /전역까지/ }));
    const chosen = screen.getByTestId('couple-stats').textContent;
    unmount();
    row();
    expect(screen.getByTestId('couple-stats').textContent).toBe(chosen);
  });

  it('바꿀 수 있다는 것을 보조기술에 말한다', () => {
    row();
    expect(screen.getByRole('button', { name: /눌러서 다른 항목으로 바꾸기/ })).toBeTruthy();
  });
});

describe('어디로 가는가', () => {
  it('만남까지는 일정으로', async () => {
    row();
    await userEvent.click(screen.getByRole('button', { name: /만남까지/ }));
    expect(navigate).toHaveBeenCalledWith('/schedule');
  });

  it('자물쇠는 정직한 문장이 있는 곳으로', async () => {
    /*
      보안 표현을 화면에 복사하지 않는다. 두 곳에 있으면 한쪽이 낡고, 낡는 쪽이 화면일
      가능성이 높다. §14.5의 단계별 계약은 개인정보 처리방침이 소유한다.
    */
    const onProtectionTap = vi.fn();
    row({ onProtectionTap });
    await userEvent.click(screen.getByRole('button', { name: '둘만 봅니다' }));
    expect(onProtectionTap).toHaveBeenCalled();
  });

  it('E2EE를 주장하지 않는다', () => {
    // §14.5 -- 지금 단계에서 그렇게 쓰면 거짓이다.
    const { container } = row();
    expect(container.textContent).not.toMatch(/E2EE|종단간|완벽|해킹/);
  });
});
