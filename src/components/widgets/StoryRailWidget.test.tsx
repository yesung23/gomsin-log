import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { StoryRailWidget } from '@/components/widgets/StoryRailWidget';
import type { DailyRecord } from '@/types';

/*
  홈 맨 위의 봉투 둘.

  여기서 세는 것은 대부분 "없어야 하는 것"이다 -- 링이 셋이 되지 않는지, 개수를 부채처럼
  적지 않는지, 상대가 조용할 때 자리를 비우지 않는지.
*/

const TODAY = '2026-08-22';
const navigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

function record(over: Partial<DailyRecord> = {}): DailyRecord {
  return {
    id: 'r1', userId: 'partner-id', date: TODAY, time: '09:00',
    authorRole: 'gomsin', log: '오늘 시험 끝났어', isPrivate: false, ...over,
  } as DailyRecord;
}

let surface: DailyRecord[] = [];
let records: DailyRecord[] = [];
let connected = true;

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: {
      records,
      profile: {
        id: 'me', role: 'soldier',
        couple: { connected, coupleId: 'c1', partnerName: '춘향' },
      },
      authenticatedUser: { id: 'me' },
    },
  }),
}));

vi.mock('@/lib/usePartnerDay', () => ({
  usePartnerDay: () => ({ surface, todayStr: TODAY, acknowledge: vi.fn() }),
}));

function rail() {
  return render(<MemoryRouter><StoryRailWidget /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  surface = [];
  records = [];
  connected = true;
});

describe('링은 언제나 둘이다', () => {
  it('상대와 나, 둘뿐이다', () => {
    /*
      인스타의 링은 N개라 가로 스크롤이 생기고, 스크롤이 있어서 정렬이 필요하고, 정렬이
      있어서 알고리즘이 생긴다. 둘로 고정하면 그 사슬이 시작되지 않는다.
    */
    surface = [record({ id: 'a' })];
    records = surface;
    const { container } = rail();
    expect(container.querySelectorAll('[data-ink-ring]')).toHaveLength(2);
  });

  it('상대가 조용해도 자리를 비우지 않는다', () => {
    // 사라지면 "없는 것"이 되고 남아 있으면 "아직 오지 않은 것"이 된다.
    const { container } = rail();
    expect(container.querySelectorAll('[data-ink-ring]')).toHaveLength(2);
    expect(screen.getByText('아직 오늘 이야기가 없어요')).toBeTruthy();
  });

  it('연결 전에도 자리가 있다', () => {
    connected = false;
    rail();
    expect(screen.getByText('춘향 초대하기')).toBeTruthy();
    expect(screen.getByText('아직 혼자예요')).toBeTruthy();
  });
});

describe('링 아래에는 사실만 적는다', () => {
  it('상대 링에 개수를 적지 않는다', () => {
    // 개수는 부채이고 초대가 아니다. §14.3의 알림 문구 원칙을 화면에도 적용한다.
    surface = [record({ id: 'a', time: '09:00' }), record({ id: 'b', time: '13:00' })];
    records = surface;
    rail();
    expect(screen.getByText('13:00 업데이트')).toBeTruthy();
    expect(screen.queryByText(/읽지 않음|새 소식|2개 밀/)).toBeNull();
  });

  it('내 링에는 닿았다는 사실만 적는다', () => {
    // 곰신이 알 수 있는 것은 "닿았다"까지다. "읽었다"는 영원히 알 수 없다.
    records = [record({ id: 'mine', userId: 'me' }), record({ id: 'mine2', userId: 'me', time: '13:00' })];
    rail();
    expect(screen.getByText('오늘 2개 남김')).toBeTruthy();
    expect(screen.queryByText(/읽음|확인함|봤어요/)).toBeNull();
  });
});

describe('어디로 가는가', () => {
  it('상대 링은 상대 스토리로', async () => {
    surface = [record({ id: 'a' })];
    records = surface;
    rail();
    await userEvent.click(screen.getByRole('button', { name: '춘향의 오늘' }));
    expect(navigate).toHaveBeenCalledWith('/story/partner');
  });

  it('볼 것이 없으면 상대 링을 누를 수 없다', () => {
    // 빈 전체화면으로 보내지 않는다.
    rail();
    expect(screen.getByRole('button', { name: '춘향의 오늘 — 아직 열어볼 이야기가 없어요' })).toBeDisabled();
  });

  it('+ 는 언제나 컴포저로', async () => {
    /*
      §7.1 -- 기록 진입점은 사용자가 홈을 어떻게 구성하든 남아 있어야 한다. 레일이
      코어라서 이 버튼은 제거되지 않는다.
    */
    rail();
    await userEvent.click(screen.getByRole('button', { name: '지금 남기기' }));
    expect(navigate).toHaveBeenCalledWith('/record?compose=1');
  });

  it('내가 남긴 것이 있으면 내 스토리로', async () => {
    records = [record({ id: 'mine', userId: 'me' })];
    rail();
    await userEvent.click(screen.getByRole('button', { name: '나의 오늘' }));
    expect(navigate).toHaveBeenCalledWith('/story/mine');
  });

  it('아직 없으면 내 링도 남기기로 간다', async () => {
    rail();
    await userEvent.click(screen.getByRole('button', { name: '나의 오늘' }));
    expect(navigate).toHaveBeenCalledWith('/record?compose=1');
  });
});
