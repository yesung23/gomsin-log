import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { CoupleHighlights } from '@/components/CoupleHighlights';
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
    startDate: '2026-01-10', createdAt: '', ...over,
  } as CoupleEvent;
}

function highlights(props: Partial<Parameters<typeof CoupleHighlights>[0]> = {}) {
  return render(
    <MemoryRouter>
      <CoupleHighlights
        anniversaryDate="2025-01-01" events={[event()]} military={MILITARY}
        todayStr={TODAY} {...props}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('지나온 것', () => {
  it('도착한 마일스톤을 누르면 그날의 스토리로', async () => {
    highlights();
    await userEvent.click(screen.getByRole('button', { name: /^100일/ }));
    expect(navigate).toHaveBeenCalledWith('/story/day/2025-04-10');
  });

  it('첫 면회가 담긴다', () => {
    highlights();
    expect(screen.getByRole('button', { name: /첫 면회/ })).toBeTruthy();
  });
});

describe('아직 오지 않은 것', () => {
  it('맨 뒤에 흐리게 있고 누를 수 없다', () => {
    /*
      없는 것을 열어 빈 화면을 보여주지 않는다. 통화 모드가 0개일 때 진입점을 숨기는 것,
      상대 링이 볼 것 없을 때 비활성인 것과 같은 규칙이다.
    */
    highlights();
    const future = screen.getByRole('button', { name: /전역.*아직 오지 않았어요/ });
    expect(future).toBeDisabled();
  });

  it('언제인지 남은 날로 말한다', () => {
    highlights();
    expect(screen.getByRole('button', { name: /전역, D-\d+/ })).toBeTruthy();
  });
});

describe('없는 것', () => {
  it('기념일도 일정도 없으면 아무것도 그리지 않는다', () => {
    // 지어내지 않는다. 빈 줄을 남기는 것보다 없는 것이 정직하다.
    const { container } = highlights({ anniversaryDate: undefined, events: [], military: undefined });
    expect(container.querySelector('[data-testid="couple-highlights"]')).toBeNull();
  });

  it('개수나 순위를 적지 않는다', () => {
    const { container } = highlights();
    expect(container.textContent).not.toMatch(/개 달성|위|등급|점수/);
  });
});
