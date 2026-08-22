import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AppState, DailyRecord } from '@/types';

/**
 * 일기장이 실제로 그려지고, 실제로 꾸며지는가.
 *
 * `diaryMonths.test.ts` 와 `stickers.test.ts` 가 계산과 저장을 지키고, 이 파일은 그 둘이
 * **화면에서 만나는 지점**을 지킨다 -- 순수 함수가 전부 맞아도 화면이 그것을 안 부르면
 * 아무 일도 일어나지 않는다.
 */

let currentState: AppState;

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({ state: currentState, isReady: true }),
}));
vi.mock('@/components/ui/AppBar', () => ({
  AppBar: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

const { DiaryPage } = await import('./DiaryPage');

const ME = 'user-me';

function record(partial: Partial<DailyRecord> & { date: string }): DailyRecord {
  return {
    id: `${partial.date}-${partial.time ?? '09:00'}`,
    userId: ME,
    date: partial.date,
    time: partial.time ?? '09:00',
    authorRole: 'gomsin',
    log: partial.log ?? '오늘은 기뻤어',
    isPrivate: false,
    createdAt: `${partial.date}T00:00:00.000Z`,
    ...partial,
  };
}

function stateWith(records: DailyRecord[]): AppState {
  return {
    records,
    events: [],
    trips: [],
    authenticatedUser: { id: ME },
    profile: {
      id: ME,
      myName: '나',
      role: 'gomsin',
      couple: { partnerName: '너', coupleCode: '', connected: true, status: 'active' },
      military: { branch: 'army', militaryStatus: 'serving', dischargeDateSource: 'manual' },
      contact: { weekdayStart: '18:00', weekdayEnd: '21:00', weekendStart: '10:00', weekendEnd: '21:00', enabled: false },
    },
  } as unknown as AppState;
}

beforeEach(() => {
  localStorage.clear();
  currentState = stateWith([
    record({ date: '2026-08-02', time: '08:00', log: '8월 첫 기록' }),
    record({ date: '2026-08-14', time: '21:00', log: '8월 둘째 기록' }),
    record({ date: '2026-06-30', log: '6월 기록' }),
  ]);
});

describe('한 달씩 엮여 있다', () => {
  it('최근 달이 먼저 오고 숫자가 함께 온다', () => {
    render(<DiaryPage />);
    const cards = screen.getAllByRole('button', { name: /지면 열기$/ });
    expect(cards.map((card) => card.getAttribute('aria-label')))
      .toEqual(['2026년 8월 지면 열기', '2026년 6월 지면 열기']);
    expect(within(cards[0]).getByText('기록 2개')).toBeInTheDocument();
    expect(within(cards[0]).getByText('2일')).toBeInTheDocument();
  });

  it('아무것도 없으면 재촉하지 않는다', () => {
    /*
      며칠 남았는지 세어 주지 않는다. 세는 순간 카운트다운이 되고, §16 이 연속 기록을
      금지하는 것과 같은 이유로 남기지 않은 날이 결핍이 된다.
    */
    currentState = stateWith([]);
    render(<DiaryPage />);
    expect(screen.getByText('아직 엮을 것이 없어요.')).toBeInTheDocument();
    expect(screen.queryByText(/D-|남았/)).not.toBeInTheDocument();
  });
});

describe('지면을 열면 그 달의 기록이 있다', () => {
  it('그 달만 온다', async () => {
    const user = userEvent.setup();
    render(<DiaryPage />);
    await user.click(screen.getByRole('button', { name: '2026년 8월 지면 열기' }));

    expect(screen.getByText('8월 첫 기록')).toBeInTheDocument();
    expect(screen.getByText('8월 둘째 기록')).toBeInTheDocument();
    expect(screen.queryByText('6월 기록')).not.toBeInTheDocument();
  });

  it('열 수 없는 기록은 빈 줄이 아니다', async () => {
    /*
      "글을 안 썼다"와 "이 기기가 못 연다"가 같아 보이면, 기다리면 열릴 것을 사라진 줄
      안다. 지면에서는 그것이 특히 잘못 읽힌다 -- 다른 날은 글이 있는데 그 날만 비어
      있으므로.
    */
    currentState = stateWith([
      record({ date: '2026-08-02', log: '', contentUnavailable: 'key_unavailable' }),
    ]);
    const user = userEvent.setup();
    render(<DiaryPage />);
    await user.click(screen.getByRole('button', { name: '2026년 8월 지면 열기' }));
    expect(screen.getByText('이 기기에서 아직 열 수 없어요')).toBeInTheDocument();
  });

  it('이 기기에만 남는다는 사실을 화면이 직접 말한다', async () => {
    // 상대에게도 보이는 줄 알고 꾸몄는데 안 보이는 것은 이 제품이 만들면 안 되는 놀람이다.
    const user = userEvent.setup();
    render(<DiaryPage />);
    await user.click(screen.getByRole('button', { name: '2026년 8월 지면 열기' }));
    expect(screen.getByText(/이 기기에만 남아요/)).toBeInTheDocument();
  });

  it('아직 만들 수 없다고 말하고, 누를 것을 주지 않는다', async () => {
    /*
      `P-MP` 게이트가 열리기 전이다. `대기자 명단`이든 `곧 출시`든 누를 수 있는 것을
      두면 이 화면은 아직 존재하지 않는 것을 파는 화면이 된다.
    */
    const user = userEvent.setup();
    render(<DiaryPage />);
    await user.click(screen.getByRole('button', { name: '2026년 8월 지면 열기' }));
    expect(screen.getByText('한 권으로 만들기')).toBeInTheDocument();
    expect(screen.getByText(/아직 준비 중이에요/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /만들기|대기|알림|구매|결제/ })).not.toBeInTheDocument();
  });
});

describe('읽는 동안에는 붙지 않는다', () => {
  it('꾸미기를 켜기 전에는 스티커 고르는 줄이 없다', async () => {
    // 읽으려고 열었는데 스크롤하다 스티커가 붙으면 그건 사고다.
    const user = userEvent.setup();
    render(<DiaryPage />);
    await user.click(screen.getByRole('button', { name: '2026년 8월 지면 열기' }));
    expect(screen.queryByRole('radiogroup', { name: '붙일 스티커' })).not.toBeInTheDocument();
  });

  it('스티커를 고르기 전에는 지면이 컨트롤이 아니다', async () => {
    /*
      읽는 동안 탭 순서에 이름 없는 버튼이 끼어 있으면 키보드 사용자는 기록을 읽으려다
      매번 그것을 지나쳐야 한다.
    */
    const user = userEvent.setup();
    render(<DiaryPage />);
    await user.click(screen.getByRole('button', { name: '2026년 8월 지면 열기' }));
    await user.click(screen.getByRole('button', { name: '꾸미기' }));
    expect(screen.queryByRole('button', { name: /지면 · 누르면/ })).not.toBeInTheDocument();
  });
});

describe('포인터 없이도 꾸며진다', () => {
  async function openAndPick() {
    const user = userEvent.setup();
    render(<DiaryPage />);
    await user.click(screen.getByRole('button', { name: '2026년 8월 지면 열기' }));
    await user.click(screen.getByRole('button', { name: '꾸미기' }));
    await user.click(screen.getByRole('radio', { name: '하트' }));
    return user;
  }

  it('Enter 로 가운데에 붙는다', async () => {
    /*
      지면을 `<div onClick>` 으로만 두면 다꾸는 마우스나 손가락이 있는 사람만의 기능이
      된다. 이 단언이 키보드 경로 전체의 첫 칸이다.
    */
    const user = await openAndPick();
    await user.click(screen.getByRole('button', { name: /지면 · 누르면/ }));
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: /하트 · 방향키로/ })).toBeInTheDocument();
  });

  it('방향키로 옮긴다', async () => {
    const user = await openAndPick();
    await user.click(screen.getByRole('button', { name: /지면 · 누르면/ }));
    await user.keyboard('{Enter}');

    const sticker = screen.getByRole('button', { name: /하트 · 방향키로/ });
    expect(sticker.style.left).toBe('50%');
    sticker.focus();
    await user.keyboard('{ArrowRight}{ArrowRight}');
    // 2% 씩 두 번. 화면에 남는 값이 바뀌어야 옮겨진 것이다.
    expect(sticker.style.left).toBe('54%');
  });

  it('누르면 뗀다', async () => {
    const user = await openAndPick();
    await user.click(screen.getByRole('button', { name: /지면 · 누르면/ }));
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: /하트 · 방향키로/ }));
    expect(screen.queryByRole('button', { name: /하트 · 방향키로/ })).not.toBeInTheDocument();
  });

  it('붙인 것이 다시 열어도 그대로 있다', async () => {
    const user = await openAndPick();
    await user.click(screen.getByRole('button', { name: /지면 · 누르면/ }));
    await user.keyboard('{Enter}');

    // 지면을 닫고 다시 연다. 저장을 안 부르면 여기서 사라진다.
    await user.click(screen.getByRole('button', { name: '일기장으로 돌아가기' }));
    await user.click(screen.getByRole('button', { name: '2026년 8월 지면 열기' }));
    expect(screen.getByRole('button', { name: /하트 · 방향키로/ })).toBeInTheDocument();
  });

  it('다른 달 지면에는 붙지 않는다', async () => {
    const user = await openAndPick();
    await user.click(screen.getByRole('button', { name: /지면 · 누르면/ }));
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: '일기장으로 돌아가기' }));
    await user.click(screen.getByRole('button', { name: '2026년 6월 지면 열기' }));
    // 달 키로 저장을 안 나누면 8월 스티커가 6월 지면에 나타난다.
    expect(screen.queryByRole('button', { name: /하트 · 방향키로/ })).not.toBeInTheDocument();
  });
});

describe('유료 표시가 화면에 없다', () => {
  it('스티커 줄에 잠금도 가격도 없다', async () => {
    /*
      §9.5 -- 유료 스티커는 Memory Product 의 지불가치 확인 뒤다. 잠긴 스티커를 섞어
      두면 무료로 꾸미는 루프가 돌기 전에 결제가 먼저 보인다.
    */
    const user = userEvent.setup();
    render(<DiaryPage />);
    await user.click(screen.getByRole('button', { name: '2026년 8월 지면 열기' }));
    await user.click(screen.getByRole('button', { name: '꾸미기' }));
    const row = screen.getByRole('radiogroup', { name: '붙일 스티커' });
    expect(within(row).getAllByRole('radio')).toHaveLength(12);
    expect(row.textContent).not.toMatch(/원|₩|잠금|구매|Plus/);
  });
});
