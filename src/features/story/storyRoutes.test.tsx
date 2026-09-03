import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { StoryRoute } from '@/features/story/StoryRoute';
import type { CoupleHighlight, DailyRecord, TalkAboutMark } from '@/types';
import { toast } from 'sonner';

const mockNavigate = vi.hoisted(() => vi.fn());
const recordProductEvent = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@/lib/productEvents', () => ({ recordProductEvent }));

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
let talkAboutMarks: TalkAboutMark[] = [];
let online = true;

vi.mock('@/lib/useOnlineStatus', async () => {
  const actual = await vi.importActual<typeof import('@/lib/useOnlineStatus')>('@/lib/useOnlineStatus');
  return { ...actual, useOnlineStatus: () => online };
});

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: {
      records,
      coupleHighlights,
      talkAboutMarks,
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
  talkAboutMarks = [];
  online = true;
  markTalkAbout.mockResolvedValue({ ok: true });
  unmarkTalkAbout.mockResolvedValue({ ok: true });
});

describe('/story/partner', () => {
  it('읽을 수 있는 상대 스토리를 실제로 열 때만 briefing_opened를 한 번 기록한다', async () => {
    surface = [record({ id: 'a' }), record({ id: 'b', time: '13:00' })];
    records = surface;
    open('/story/partner');

    await waitFor(() => expect(recordProductEvent).toHaveBeenCalledWith({
      kind: 'briefing_opened',
      screen: 'story',
    }));
    await userEvent.click(screen.getByRole('button', { name: '다음 순간' }));
    expect(recordProductEvent.mock.calls.filter(([event]) => (
      event.kind === 'briefing_opened'
    ))).toHaveLength(1);
  });

  it('읽을 수 있는 순간이 없으면 briefing_opened를 기록하지 않는다', async () => {
    surface = [record({ id: 'locked', contentUnavailable: 'key_unavailable' })];
    records = surface;
    open('/story/partner');

    await Promise.resolve();
    expect(recordProductEvent).not.toHaveBeenCalled();
  });

  it('상대의 놓친 구간을 연다', () => {
    surface = [record({ id: 'a' }), record({ id: 'b', time: '13:00', log: '점심' })];
    records = surface;
    open('/story/partner');
    expect(screen.getByRole('dialog', { name: '오늘' })).toBeTruthy();
  });

  it('여러 날이 밀렸으면 놓친 하루라고 부른다', () => {
    surface = [record({ id: 'a', date: '2026-08-20' }), record({ id: 'b' })];
    records = surface;
    open('/story/partner');
    expect(screen.getByRole('dialog', { name: '놓친 하루' })).toBeTruthy();
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

  it('다 읽었어요는 실제로 읽은 기록만 영수증에 쓰고 unreadable은 OUTSTANDING으로 남긴다', async () => {
    const readable = record({ id: 'readable' });
    const unreadable = record({ id: 'unreadable', time: '13:00', contentUnavailable: 'key_unavailable' });
    surface = [readable, unreadable];
    records = surface;
    open('/story/partner');
    await userEvent.click(screen.getByRole('button', { name: '다음 순간' }));
    expect(screen.getByText('열 수 없는 기록 1개')).toBeTruthy();
    await userEvent.click(screen.getByTestId('story-acknowledge'));
    expect(acknowledge).toHaveBeenCalledTimes(1);
    expect(acknowledge).toHaveBeenCalledWith([readable]);
  });

  it('책갈피가 이야기거리로 간다', async () => {
    surface = [record({ id: 'a' })];
    records = surface;
    open('/story/partner');
    await userEvent.click(screen.getByRole('button', { name: '이따 이야기하기' }));
    await waitFor(() => expect(markTalkAbout).toHaveBeenCalledWith('a'));
  });

  it('상대만 표시한 책갈피는 내 표시를 추가하고 상대 표시를 지우려 하지 않는다', async () => {
    surface = [record({ id: 'a' })];
    records = surface;
    talkAboutMarks = [{
      id: 'partner-mark', recordId: 'a', coupleId: 'c1', actorUserId: 'partner-id',
      createdAt: '2026-08-22T10:00:00.000Z', isCompleted: false,
    }];
    open('/story/partner');

    const action = screen.getByRole('button', {
      name: '춘향님이 표시했어요. 나도 이따 이야기하기',
    });
    expect(action).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(action);
    await waitFor(() => expect(markTalkAbout).toHaveBeenCalledWith('a'));
    expect(unmarkTalkAbout).not.toHaveBeenCalled();
  });

  it('둘 다 표시한 책갈피는 내 표시만 해제한다', async () => {
    surface = [record({ id: 'a' })];
    records = surface;
    talkAboutMarks = [
      {
        id: 'partner-mark', recordId: 'a', coupleId: 'c1', actorUserId: 'partner-id',
        createdAt: '2026-08-22T10:00:00.000Z', isCompleted: false,
      },
      {
        id: 'my-mark', recordId: 'a', coupleId: 'c1', actorUserId: 'me',
        createdAt: '2026-08-22T10:01:00.000Z', isCompleted: false,
      },
    ];
    open('/story/partner');

    const action = screen.getByRole('button', {
      name: '춘향님도 표시했어요. 이따 이야기하기 표시 해제',
    });
    expect(action).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(action);
    await waitFor(() => expect(unmarkTalkAbout).toHaveBeenCalledWith('a'));
    expect(markTalkAbout).not.toHaveBeenCalled();
  });

  it('책갈피 저장을 single-flight하고 처리 중에는 다시 누를 수 없다', async () => {
    let finish!: (value: { ok: boolean }) => void;
    markTalkAbout.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    surface = [record({ id: 'a' })];
    records = surface;
    open('/story/partner');

    const action = screen.getByRole('button', { name: '이따 이야기하기' });
    await userEvent.click(action);
    action.click();

    expect(markTalkAbout).toHaveBeenCalledTimes(1);
    expect(action).toBeDisabled();
    finish({ ok: true });
    await vi.waitFor(() => expect(action).not.toBeDisabled());
  });

  it('오프라인에서는 책갈피를 바꾸지 않고 이유를 읽어 준다', () => {
    online = false;
    surface = [record({ id: 'a' })];
    records = surface;
    open('/story/partner');

    expect(screen.getByRole('button', { name: /연결되면 표시할 수 있어요/ })).toBeDisabled();
    expect(markTalkAbout).not.toHaveBeenCalled();
  });

  it('예상 밖 저장 거절도 처리하고 책갈피를 다시 사용할 수 있게 한다', async () => {
    markTalkAbout.mockRejectedValueOnce(new Error('network exploded'));
    surface = [record({ id: 'a' })];
    records = surface;
    open('/story/partner');

    await userEvent.click(screen.getByRole('button', { name: '이따 이야기하기' }));

    await vi.waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('책갈피를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.');
    });
    expect(screen.getByRole('button', { name: '이따 이야기하기' })).not.toBeDisabled();
  });

  it('저장 후 재조회만 늦으면 재시도를 유도하지 않고 지연을 알린다', async () => {
    markTalkAbout.mockResolvedValueOnce({ ok: true, syncPending: true });
    surface = [record({ id: 'a' })];
    records = surface;
    open('/story/partner');

    await userEvent.click(screen.getByRole('button', { name: '이따 이야기하기' }));

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining('저장은 됐지만 화면 반영이 늦어지고 있어요'),
    ));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('사진 스토리에서 정확한 원본을 하이라이트 편집기로 가져온다', async () => {
    surface = [record({
      id: 'photo-story',
      attachments: [{ type: 'photo', name: 'story.jpg', url: 'https://example.test/story.jpg' }],
    })];
    records = surface;
    open('/story/partner');
    await userEvent.click(screen.getByRole('button', { name: '하이라이트에 추가' }));
    expect(mockNavigate).toHaveBeenCalledWith('/us?highlightRecord=photo-story');
  });

  it('상대의 오늘에서 정확한 원본을 열 때만 briefing_to_original을 기록한다', async () => {
    surface = [record({ id: 'exact-source' })];
    records = surface;
    open('/story/partner');

    await userEvent.click(screen.getByRole('button', { name: '원본 보기' }));

    expect(recordProductEvent).toHaveBeenCalledWith({
      kind: 'briefing_to_original',
      screen: 'story',
    });
    expect(mockNavigate).toHaveBeenCalledWith('/record?record=exact-source');

    await userEvent.click(screen.getByRole('button', { name: '원본 보기' }));
    expect(recordProductEvent.mock.calls.filter(([event]) => (
      event.kind === 'briefing_to_original'
    ))).toHaveLength(1);
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

  it('내 비공개 기록에는 커플 이야기 책갈피를 노출하지 않는다', () => {
    records = [record({ id: 'private-mine', userId: 'me', isPrivate: true, log: '나만 보는 기록' })];
    open('/story/mine');

    expect(screen.getByText('나만 보는 기록')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /이따 이야기하기/ })).not.toBeInTheDocument();
  });

  it('내 스토리 열기와 원본 이동을 상대 briefing 지표로 기록하지 않는다', async () => {
    records = [record({ id: 'mine', userId: 'me' })];
    open('/story/mine');

    await userEvent.click(screen.getByRole('button', { name: '원본 보기' }));
    expect(recordProductEvent).not.toHaveBeenCalled();
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

  it('보관 스토리의 원본 이동을 상대 briefing 지표로 기록하지 않는다', async () => {
    records = [record({ id: 'then', date: '2026-08-14' })];
    open('/story/day/2026-08-14');

    await userEvent.click(screen.getByRole('button', { name: '원본 보기' }));
    expect(recordProductEvent).not.toHaveBeenCalled();
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

  it('하이라이트의 원본 이동을 상대 briefing 지표로 기록하지 않는다', async () => {
    records = [record({ id: 'picked', log: '직접 고른 사진' })];
    coupleHighlights = [{
      id: 'summer', coupleId: 'c1', title: '여름', recordIds: ['picked'],
      coverRecordId: 'picked', sortOrder: 0, createdAt: '2026-08-01', updatedAt: '2026-08-01',
    }];
    open('/story/highlight/summer');

    await userEvent.click(screen.getByRole('button', { name: '원본 보기' }));
    expect(recordProductEvent).not.toHaveBeenCalled();
  });
});
