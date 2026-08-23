import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { StoryRoute } from '@/features/story/StoryRoute';
import type { CoupleHighlight, DailyRecord } from '@/types';

/*
  라우트가 무엇을 여는가.

  §7.5가 요구하는 것은 하나다 -- 기록은 라우트로 주소 지정 가능해야 하고, 휘발성 앱
  상태로만 대상을 지정하면 새로고침·딥링크·알림에서 원본에 도달할 수 없다. 그래서 여기서
  세는 것은 "어떤 URL이 어떤 카드를 여는가"다.
*/

const TODAY = '2026-08-22';

function record(over: Partial<DailyRecord> = {}): DailyRecord {
  return {
    id: 'r1', userId: 'partner-id', date: TODAY, time: '09:00',
    authorRole: 'gomsin', log: '오늘 시험 끝났어', isPrivate: false, ...over,
  } as DailyRecord;
}

const markTalkAbout = vi.fn(async () => ({ ok: true }));
const unmarkTalkAbout = vi.fn(async () => ({ ok: true }));
const acknowledge = vi.fn(() => true);
let surface: DailyRecord[] = [];
let records: DailyRecord[] = [];
let coupleHighlights: CoupleHighlight[] = [];

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: {
      records,
      coupleHighlights,
      talkAboutMarks: [],
      profile: {
        id: 'me', role: 'soldier',
        couple: { connected: true, coupleId: 'c1', partnerName: '춘향' },
      },
      authenticatedUser: { id: 'me' },
    },
    sharedSyncStatus: 'live',
    setHighlightedRecordId: vi.fn(),
    markTalkAbout,
    unmarkTalkAbout,
  }),
}));

vi.mock('@/lib/usePartnerDay', () => ({
  usePartnerDay: () => ({ surface, todayStr: TODAY, acknowledge }),
}));

vi.mock('@/components/media/RecordMediaGallery', () => ({
  RecordMediaGallery: ({ recordId }: { recordId: string }) => <div data-testid={`media-${recordId}`} />,
}));

function open(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/story/partner" element={<StoryRoute mode="today" />} />
        <Route path="/story/mine" element={<StoryRoute mode="mine" />} />
        <Route path="/story/day/:date" element={<StoryRoute mode="archive" />} />
        <Route path="/story/highlight/:highlightId" element={<StoryRoute mode="highlight" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  surface = [];
  records = [];
  coupleHighlights = [];
});

describe('/story/partner', () => {
  it('상대의 놓친 구간을 연다', () => {
    surface = [record({ id: 'a' }), record({ id: 'b', time: '13:00', log: '점심' })];
    records = surface;
    open('/story/partner');
    expect(screen.getByRole('dialog', { name: '춘향의 오늘' })).toBeTruthy();
  });

  it('여러 날이 밀렸으면 놓친 하루라고 부른다', () => {
    surface = [record({ id: 'a', date: '2026-08-20' }), record({ id: 'b' })];
    records = surface;
    open('/story/partner');
    expect(screen.getByRole('dialog', { name: '춘향의 놓친 하루' })).toBeTruthy();
  });

  it('?at= 이 그 정확한 카드를 연다', () => {
    surface = [record({ id: 'a' }), record({ id: 'b', time: '13:00', log: '점심 먹었어' })];
    records = surface;
    open('/story/partner?at=b');
    expect(screen.getByText('점심 먹었어')).toBeTruthy();
  });

  it('?at= 대상이 사라졌으면 대체하지 않고 사실을 말한다', () => {
    surface = [record({ id: 'a' })];
    records = surface;
    open('/story/partner?at=gone');
    expect(screen.getByText('이 기록은 더 이상 볼 수 없어요')).toBeTruthy();
  });

  it('볼 것이 없으면 빈 전체화면 대신 돌아갈 길을 준다', () => {
    open('/story/partner');
    expect(screen.queryByTestId('story-viewer')).toBeNull();
    expect(screen.getByRole('button', { name: '돌아가기' })).toBeTruthy();
  });

  it('다 읽었어요가 영수증을 쓴다', async () => {
    surface = [record({ id: 'a' })];
    records = surface;
    open('/story/partner');
    await userEvent.click(screen.getByRole('button', { name: '다음 순간' }));
    await userEvent.click(screen.getByTestId('story-acknowledge'));
    expect(acknowledge).toHaveBeenCalledTimes(1);
  });

  it('책갈피가 이야기거리로 간다', async () => {
    surface = [record({ id: 'a' })];
    records = surface;
    open('/story/partner');
    await userEvent.click(screen.getByRole('button', { name: '이따 이야기하기' }));
    await waitFor(() => expect(markTalkAbout).toHaveBeenCalledWith('a'));
  });
});

describe('/story/mine', () => {
  it('내가 오늘 남긴 것만 담는다', () => {
    records = [
      record({ id: 'mine', userId: 'me', log: '내가 쓴 것' }),
      record({ id: 'theirs', userId: 'partner-id', log: '상대가 쓴 것' }),
      record({ id: 'old', userId: 'me', date: '2026-08-01', log: '지난달' }),
    ];
    open('/story/mine');
    expect(screen.getByText('내가 쓴 것')).toBeTruthy();
    expect(screen.queryByText('상대가 쓴 것')).toBeNull();
    expect(screen.queryByText('지난달')).toBeNull();
  });

  it('확인 버튼이 없다', async () => {
    // 내 기록을 내가 "확인"하는 것은 의미가 없고, 영수증을 앞으로 밀어 버린다.
    records = [record({ id: 'mine', userId: 'me' })];
    open('/story/mine');
    await userEvent.click(screen.getByRole('button', { name: '다음 순간' }));
    expect(screen.queryByTestId('story-acknowledge')).toBeNull();
  });
});

describe('/story/day/:date', () => {
  it('그 날짜의 기록만 담고 날짜로 부른다', () => {
    records = [
      record({ id: 'then', date: '2026-08-14', log: '그날 기록' }),
      record({ id: 'now', date: TODAY, log: '오늘 기록' }),
    ];
    open('/story/day/2026-08-14');
    expect(screen.getByRole('dialog', { name: '8월 14일' })).toBeTruthy();
    expect(screen.getByText('그날 기록')).toBeTruthy();
    expect(screen.queryByText('오늘 기록')).toBeNull();
  });

  it('달력 날짜가 아니면 열지 않는다', () => {
    records = [record({ id: 'then', date: '2026-08-14' })];
    open('/story/day/2026-02-31');
    expect(screen.queryByTestId('story-viewer')).toBeNull();
  });

  it('보관 모드에는 책갈피도 확인도 없다', () => {
    records = [record({ id: 'then', date: '2026-08-14' })];
    open('/story/day/2026-08-14');
    expect(screen.queryByRole('button', { name: '이따 이야기하기' })).toBeNull();
    expect(screen.queryByTestId('story-acknowledge')).toBeNull();
  });
});

describe('/story/highlight/:highlightId', () => {
  it('replays the saved highlight order instead of sorting by clock time', async () => {
    records = [
      record({ id: 'late', time: '18:00', log: '두 번째로 고른 사진' }),
      record({ id: 'early', time: '09:00', log: '첫 번째로 고른 사진' }),
    ];
    coupleHighlights = [{
      id: 'summer', coupleId: 'c1', title: '여름', recordIds: ['late', 'early'],
      coverRecordId: 'late', sortOrder: 0, createdAt: '2026-08-01', updatedAt: '2026-08-01',
    }];

    open('/story/highlight/summer');
    expect(screen.getByRole('dialog', { name: '여름' })).toBeTruthy();
    expect(screen.getByText('두 번째로 고른 사진')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '다음 순간' }));
    expect(screen.getByText('첫 번째로 고른 사진')).toBeTruthy();
  });
});
