import type { ReactNode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AppState, MilitaryInfo } from '@/types';

/**
 * `나` 탭이 역할과 상황에 맞게 낮아지는가.
 *
 * §11 -- 군 복무는 집중된 초기 사용 사례이지 제품의 정체성이 아니다. 군 관련 표면은 끄는
 * 것이 아니라 **없다.** 비활성으로 남기면 그 커플에게 이 앱은 자기 것이 아닌 앱이 된다.
 *
 * 그리고 §5.4 -- 컨디션은 역할의 일이 아니라 몸의 일이므로 **양쪽 모두** 자기 것을 보내고
 * 상대 것을 읽는다. 화면이 그 컴포넌트를 두 번 그리지 않으면 그 사실은 코드에만 있고
 * 사용자에게는 없다.
 */

let currentState: AppState;

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({ state: currentState, isReady: true }),
}));
vi.mock('@/components/MobileShell', () => ({
  MobileShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/ui/AppBar', () => ({
  AppBar: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

/*
  주기·배려 신호는 각자 자기 테스트 파일이 지킨다. 여기서 보고 싶은 것은 `나` 화면이
  **무엇을 몇 번 그리는가**이므로, 그것들을 식별 가능한 자리표시자로 바꾼다.
*/
vi.mock('@/components/CycleSupportSection', () => ({
  CycleSupportSection: ({ mine }: { mine: boolean }) => (
    <div data-testid={mine ? 'care-mine' : 'care-partner'} />
  ),
}));
vi.mock('@/components/CycleTrackerSection', () => ({
  CycleTrackerSection: () => <div data-testid="cycle-tracker" />,
}));

const { MePage } = await import('./MePage');

const SERVING: MilitaryInfo = {
  branch: 'army',
  militaryStatus: 'serving',
  enlistmentDate: '2025-09-01',
  expectedDischargeDate: '2027-05-31',
  dischargeDateSource: 'manual',
};

function stateWith(military: MilitaryInfo, role: 'gomsin' | 'soldier' = 'gomsin'): AppState {
  return {
    records: [], events: [], trips: [],
    authenticatedUser: { id: 'user-me' },
    profile: {
      id: 'user-me',
      myName: '나',
      role,
      couple: { partnerName: '춘향', coupleCode: '', connected: true, status: 'active' },
      military,
      contact: {
        weekdayStart: '18:00', weekdayEnd: '21:00',
        weekendStart: '10:00', weekendEnd: '21:00', enabled: true,
      },
    },
  } as unknown as AppState;
}

function renderMe() {
  return render(<MemoryRouter><MePage /></MemoryRouter>);
}

beforeEach(() => {
  currentState = stateWith(SERVING);
});

describe('컨디션은 양쪽 모두의 것이다', () => {
  it.each(['gomsin', 'soldier'] as const)('%s 도 자기 것을 보내고 상대 것을 읽는다', (role) => {
    /*
      한때 `role === 'gomsin'` 이 보내는 쪽을 정했다. 군화는 자기 몸이 힘든 날에도 그
      사실을 보낼 방법이 없었고, 군 복무가 아닌 커플에서는 한쪽이 영원히 읽기만 했다.
    */
    currentState = stateWith(SERVING, role);
    renderMe();
    expect(screen.getByTestId('care-mine')).toBeInTheDocument();
    expect(screen.getByTestId('care-partner')).toBeInTheDocument();
  });

  it('내 것이 상대 것보다 먼저 온다', () => {
    // 이 화면에서 사용자가 **할 수 있는 일**은 자기 신호를 보내는 것 하나뿐이다.
    renderMe();
    const mine = screen.getByTestId('care-mine');
    const partner = screen.getByTestId('care-partner');
    expect(mine.compareDocumentPosition(partner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('주기 원본과 파생 상태는 파트너 화면에 자동으로 나타나지 않는다', () => {
    currentState = stateWith(SERVING, 'soldier');
    renderMe();
    expect(screen.queryByTestId('cycle-tracker')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/생리 기간|생리 예상|가임|배란/);
  });
});

describe('군 관련 카드는 끄는 것이 아니라 없다', () => {
  it('복무 중이면 남은 날과 연락 가능 시간이 있다', () => {
    renderMe();
    expect(screen.getByRole('button', { name: '춘향의 복무 현황 열기' })).toBeInTheDocument();
    expect(screen.getByText(/평일 18:00–21:00/)).toBeInTheDocument();
  });

  it.each([
    ['날짜가 없으면', { branch: 'army', militaryStatus: 'serving', dischargeDateSource: 'manual' }],
    ['상태가 unknown 이면', { ...SERVING, militaryStatus: 'unknown' }],
  ] as const)('%s 카드가 아예 없다', (_label, military) => {
    /*
      비활성된 회색 카드가 아니라 **없어야** 한다. 군 복무가 아닌 커플에게 "복무 정보를
      입력하세요"가 남아 있으면 그 커플에게 이 앱은 자기 것이 아닌 앱이 된다.
    */
    currentState = stateWith(military as MilitaryInfo);
    renderMe();
    expect(screen.queryByRole('button', { name: /복무 현황 열기/ })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/복무|전역|면회/);
  });

  it.each([
    ['전역일이 지났으면', { ...SERVING, enlistmentDate: '2023-01-01', expectedDischargeDate: '2024-01-01' }],
    ['상태가 discharged 면', { ...SERVING, militaryStatus: 'discharged' }],
  ] as const)('%s 카드가 사라진다 -- 트로피로 남지 않는다', (_label, military) => {
    /*
      `computeServiceProgress` 는 전역 뒤에도 `isDischarged: true` 로 계속 값을 준다 --
      `/service` 와 `coupleStats` 가 그 상태를 알아야 하기 때문이다. 이 화면은 다르다.
      여기가 답하는 질문은 "지금 연락해도 되나"이고, 전역한 사람에게 복무는 더 이상 그
      질문의 답이 아니다. 남겨 두면 `전역 🎉` 가 영원히 붙어 있는 트로피가 된다.

      전역이라는 사건은 `우리` 의 하이라이트와 `일기장` 의 마일스톤이 축하한다.
    */
    currentState = stateWith(military as MilitaryInfo);
    renderMe();
    expect(screen.queryByRole('button', { name: /복무 현황 열기/ })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/전역|복무|면회/);
  });

  it('군 카드가 없어도 컨디션은 그대로 있다', () => {
    // 남는 것이 컨디션 하나뿐인 커플에게도 이 탭은 유효하다 -- 그것이 이 탭이 답하는
    // 질문의 전부이기 때문이다.
    currentState = stateWith({ branch: 'army', militaryStatus: 'unknown', dischargeDateSource: 'manual' });
    renderMe();
    expect(screen.getByTestId('care-mine')).toBeInTheDocument();
  });
});

describe('연락 가능 시간은 꺼져 있으면 말하지 않는다', () => {
  it('꺼져 있으면 그리지 않는다', () => {
    // "설정 안 함"을 굳이 말할 이유가 없고, 말하면 재촉이 된다.
    currentState = stateWith(SERVING);
    currentState.profile.contact.enabled = false;
    renderMe();
    expect(screen.queryByText(/평일 .*–/)).not.toBeInTheDocument();
  });
});
