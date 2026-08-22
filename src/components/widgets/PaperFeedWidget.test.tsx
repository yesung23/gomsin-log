import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { PaperFeedWidget } from '@/components/widgets/PaperFeedWidget';
import type { DailyRecord } from '@/types';
import { localToday, toLocalDateString } from '@/lib/utils';

/*
  지면이 담는 것과 담지 않는 것.

  가장 중요한 단언은 "오늘이 여기 없다"이다. 인스타에서 스토리와 피드가 같은 게시물을
  동시에 보여주지 않듯, 여기서도 한 기록이 두 자리에 있으면 안 된다 -- 2026-08-20에
  되돌린 대화형 홈이 실패한 이유가 정확히 그 반복이었다.
*/

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

const markTalkAbout = vi.fn(async () => ({ ok: true }));
const unmarkTalkAbout = vi.fn(async () => ({ ok: true }));
let records: DailyRecord[] = [];
let marks: { recordId: string; isCompleted: boolean }[] = [];

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: {
      records,
      talkAboutMarks: marks,
      profile: {
        id: 'me', role: 'soldier', myName: '몽룡',
        couple: { connected: true, coupleId: 'c1', partnerName: '춘향' },
      },
    },
    markTalkAbout,
    unmarkTalkAbout,
  }),
}));

/*
  아직 확인하지 않은 것은 스토리가 소유한다.

  기본값을 빈 surface로 둔다 = "전부 확인했다". 그래야 각 테스트가 날짜 규칙만 다루고,
  확인 규칙은 아래 전용 테스트가 따로 센다.
*/
let outstanding: DailyRecord[] = [];
vi.mock('@/lib/usePartnerDay', () => ({
  usePartnerDay: () => ({ surface: outstanding, todayStr: '', acknowledge: vi.fn() }),
}));

vi.mock('@/components/media/RecordMediaGallery', () => ({
  RecordMediaGallery: ({ recordId }: { recordId: string }) => <div data-testid={`media-${recordId}`} />,
}));

function record(over: Partial<DailyRecord> = {}): DailyRecord {
  return {
    id: 'r1', userId: 'partner-id', date: YESTERDAY, time: '09:00',
    authorRole: 'gomsin', log: '어제 남긴 것', isPrivate: false, ...over,
  } as DailyRecord;
}

/*
  날짜를 고정하지 않고 실제 오늘에서 센다.

  처음에는 `vi.setSystemTime`으로 오늘을 못 박았다가 되돌렸다. `userEvent`가 내부적으로
  타이머를 쓰기 때문에 가짜 시계 아래에서는 클릭이 완료되지 않고 5초 뒤 타임아웃으로
  죽는데, 그 실패는 "버튼이 없다"처럼 보여서 원인을 엉뚱한 데서 찾게 된다.

  위젯이 보는 것과 같은 `localToday()`로 상대 날짜를 만들면 시계 의존이 아예 사라진다.
  자정에 뒤집히지도 않는다 -- 위젯과 테스트가 같은 순간의 같은 함수를 본다.
*/
function dayOffset(days: number): string {
  const date = localToday();
  date.setDate(date.getDate() - days);
  return toLocalDateString(date);
}

const TODAY = toLocalDateString(localToday());
const YESTERDAY = dayOffset(1);
const TWO_DAYS_AGO = dayOffset(2);
const LONG_AGO = dayOffset(30);

function feed() {
  return render(<MemoryRouter><PaperFeedWidget /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  records = [];
  marks = [];
  outstanding = [];
});

describe('오늘은 지면에 없다', () => {
  it('오늘 기록을 담지 않는다', () => {
    // 오늘은 스토리가 소유한다. 같은 기록이 두 자리에 동시에 있으면 안 된다.
    records = [
      record({ id: 'today', date: TODAY, log: '오늘 남긴 것' }),
      record({ id: 'yesterday', date: YESTERDAY, log: '어제 남긴 것' }),
    ];
    feed();
    expect(screen.queryByText('오늘 남긴 것')).toBeNull();
    expect(screen.getByText('어제 남긴 것')).toBeTruthy();
  });

  it('7일보다 오래된 것도 담지 않는다', () => {
    // 그 앞은 `우리` 탭이 소유한다. 위로 갈수록 지금, 아래로 갈수록 쌓인 것.
    records = [
      record({ id: 'old', date: LONG_AGO, log: '지난달 기록' }),
      record({ id: 'recent', date: YESTERDAY, log: '최근 기록' }),
    ];
    feed();
    expect(screen.queryByText('지난달 기록')).toBeNull();
    expect(screen.getByText('최근 기록')).toBeTruthy();
  });

  it('아직 확인하지 않은 것도 담지 않는다', () => {
    /*
      경계는 날짜가 아니라 확인 여부다. `상대방의 오늘`이 다루는 것은 오늘이 아니라
      마지막 확인 이후 놓친 구간이라(§6.1), 사흘 못 본 사람에게는 그 구간이 어제·그제까지
      뻗는다. 날짜로만 자르면 그 겹치는 이틀이 두 자리에 동시에 나온다 -- 실제로 그렇게
      만들었다가 widgetIdentityTransition 이 잡았다.
    */
    const missed = record({ id: 'missed', date: YESTERDAY, log: '아직 못 본 것' });
    const seen = record({ id: 'seen', date: YESTERDAY, time: '10:00', log: '이미 본 것' });
    records = [missed, seen];
    outstanding = [missed];
    feed();
    expect(screen.queryByText('아직 못 본 것')).toBeNull();
    expect(screen.getByText('이미 본 것')).toBeTruthy();
  });

  it('둘의 기록이 함께 최신순으로 온다', () => {
    records = [
      record({ id: 'a', userId: 'partner-id', date: TWO_DAYS_AGO, log: '상대 기록' }),
      record({ id: 'b', userId: 'me', date: YESTERDAY, log: '내 기록' }),
    ];
    const { container } = feed();
    const bodies = [...container.querySelectorAll('.hand-text')].map((n) => n.textContent);
    expect(bodies).toEqual(['내 기록', '상대 기록']);
  });
});

describe('끝이 있다', () => {
  it('마침 카드가 끝을 말한다', () => {
    // 끝을 말하지 않으면 짧은 화면은 "비어 있다"로 읽히고, 말하면 "다 읽었다"로 읽힌다.
    records = [record({ id: 'a' })];
    feed();
    expect(screen.getByText('여기까지가 지난 7일이에요')).toBeTruthy();
  });

  it('비어 있어도 사실대로 말하고 길을 준다', () => {
    feed();
    expect(screen.getByText('아직 함께 쌓은 지면이 없어요')).toBeTruthy();
    expect(screen.getByRole('button', { name: /지난 날 보기/ })).toBeTruthy();
  });

  it('지난 날 보기는 우리 탭으로', async () => {
    feed();
    await userEvent.click(screen.getByRole('button', { name: /지난 날 보기/ }));
    expect(navigate).toHaveBeenCalledWith('/us');
  });
});

describe('책갈피', () => {
  it('상대의 공유 기록에만 붙는다', () => {
    /*
      `이따 이야기하기`는 상대와의 대화 예고다. 내 기록에 붙이는 것은 나 자신에게
      남기는 메모이고, 비공개 기록에 붙이면 그 존재가 상대에게 알려진다.
    */
    records = [
      record({ id: 'partner', userId: 'partner-id' }),
      record({ id: 'mine', userId: 'me', log: '내 기록' }),
      record({ id: 'secret', userId: 'me', isPrivate: true, log: '비공개' }),
    ];
    feed();
    expect(screen.getAllByRole('button', { name: '이따 이야기하기' })).toHaveLength(1);
  });

  it('표시하면 이야기거리로 간다', async () => {
    records = [record({ id: 'partner', userId: 'partner-id' })];
    feed();
    await userEvent.click(screen.getByRole('button', { name: '이따 이야기하기' }));
    expect(markTalkAbout).toHaveBeenCalledWith('partner');
  });
});

describe('그날로 가는 길', () => {
  it('그날 보기가 보관 스토리의 그 순간을 연다', async () => {
    records = [record({ id: 'a', date: TWO_DAYS_AGO })];
    feed();
    await userEvent.click(screen.getByRole('button', { name: '그날 보기' }));
    // 인덱스가 아니라 recordId다. 그 기록이 사라졌다면 스토리가 부재 카드를 그린다.
    expect(navigate).toHaveBeenCalledWith(`/story/day/${TWO_DAYS_AGO}?at=a`);
  });
});

describe('없는 것', () => {
  it('좋아요 수도 조회수도 없다', () => {
    records = [record({ id: 'a' })];
    const { container } = feed();
    expect(container.textContent).not.toMatch(/좋아요|조회|명이 봤|읽음/);
  });

  it('무한 스크롤이 아니다', () => {
    // 끝이 없으면 밀도가 낮은 커플의 화면은 영원히 "덜 찬" 상태로 읽힌다.
    records = Array.from({ length: 30 }, (_, i) => record({ id: `r${i}`, date: YESTERDAY, time: `${String(i % 24).padStart(2, '0')}:00` }));
    feed();
    expect(screen.getByText('여기까지가 지난 7일이에요')).toBeTruthy();
  });
});
