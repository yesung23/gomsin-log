import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PaperHome } from '@/features/home/PaperHome';
import { localToday } from '@/lib/cycle';
import type { CoupleLifecycle } from '@/lib/coupleLifecycle';
import type { DailyRecord, TalkAboutMark } from '@/types';
import { toast } from 'sonner';

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

let records: DailyRecord[] = [];
let talkAboutMarks: TalkAboutMark[] = [];
let partnerSurface: DailyRecord[] = [];
let partnerUserId: string | undefined = 'partner';
let coupleLifecycle: CoupleLifecycle = 'connected';
const markTalkAbout = vi.fn();
const unmarkTalkAbout = vi.fn();
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
      talkAboutMarks,
      profile: {
        id: 'me',
        role: 'soldier',
        myName: '나',
        couple: {
          connected: true,
          status: 'active',
          coupleId: 'couple-1',
          partnerUserId,
          partnerName: '예성',
        },
      },
    },
    coupleLifecycle,
    markTalkAbout,
    unmarkTalkAbout,
  }),
}));

vi.mock('@/lib/usePartnerDay', () => ({
  usePartnerDay: () => ({ surface: partnerSurface }),
}));

vi.mock('@/lib/usePartnerCareNote', () => ({
  usePartnerCareNote: () => null,
}));

vi.mock('@/components/CoupleStatusBanner', () => ({
  CoupleStatusBanner: () => null,
}));

vi.mock('@/components/media/RecordMediaGallery', () => ({
  RecordMediaGallery: ({ recordId }: { recordId: string }) => (
    <div data-testid={`media-${recordId}`} />
  ),
}));

function view() {
  return render(<MemoryRouter><PaperHome /></MemoryRouter>);
}

function dateFromToday(offset: number): string {
  const date = new Date(`${localToday()}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

beforeEach(() => {
  vi.clearAllMocks();
  partnerSurface = [];
  partnerUserId = 'partner';
  coupleLifecycle = 'connected';
  talkAboutMarks = [];
  online = true;
  markTalkAbout.mockResolvedValue({ ok: true });
  unmarkTalkAbout.mockResolvedValue({ ok: true });
  records = [{
    id: 'record-1',
    userId: 'partner',
    date: localToday(),
    time: '01:23:00',
    authorRole: 'gomsin',
    log: '오늘 하루도 함께해줘서 고마워',
    isPrivate: false,
    attachments: [{ type: 'photo', name: '오늘.jpg' }],
  } as DailyRecord];
});

describe('홈의 상대방 전용 7일 피드', () => {
  it('상대방의 오늘 surface에도 있는 공유 기록을 표시하고 정확한 원본을 연다', () => {
    records = [{
      id: 'partner-current',
      userId: 'partner',
      date: localToday(),
      time: '10:20:00',
      authorRole: 'gomsin',
      log: '스토리에도 있는 상대 기록',
      isPrivate: false,
      createdAt: `${localToday()}T10:20:00.000Z`,
    }];
    partnerSurface = [records[0]];

    view();

    expect(screen.getByText('스토리에도 있는 상대 기록')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '예성의 기록 열기' }));
    expect(navigate).toHaveBeenCalledWith('/record?record=partner-current');
  });

  it('내 기록과 현재 상대가 아닌 작성자의 공유 기록을 표시하지 않는다', () => {
    records = [
      {
        id: 'partner-current', userId: 'partner', date: localToday(), time: '10:20:00',
        authorRole: 'gomsin', log: '현재 상대 기록', isPrivate: false,
        createdAt: `${localToday()}T10:20:00.000Z`,
      },
      {
        id: 'mine', userId: 'me', date: localToday(), time: '10:10:00',
        authorRole: 'soldier', log: '내 기록', isPrivate: false,
        createdAt: `${localToday()}T10:10:00.000Z`,
      },
      {
        id: 'unrelated', userId: 'unrelated-user', date: localToday(), time: '10:00:00',
        authorRole: 'gomsin', log: '무관한 사용자 기록', isPrivate: false,
        createdAt: `${localToday()}T10:00:00.000Z`,
      },
      {
        id: 'former', userId: 'former-partner', date: localToday(), time: '09:50:00',
        authorRole: 'gomsin', log: '이전 상대 기록', isPrivate: false,
        createdAt: `${localToday()}T09:50:00.000Z`,
      },
    ];

    view();

    expect(screen.getByText('현재 상대 기록')).toBeInTheDocument();
    expect(screen.queryByText('내 기록')).not.toBeInTheDocument();
    expect(screen.queryByText('무관한 사용자 기록')).not.toBeInTheDocument();
    expect(screen.queryByText('이전 상대 기록')).not.toBeInTheDocument();
  });

  it('상대방의 비공개 기록과 이 기기에서 읽을 수 없는 기록을 표시하지 않는다', () => {
    records = [
      {
        id: 'readable', userId: 'partner', date: localToday(), time: '10:20:00',
        authorRole: 'gomsin', log: '읽을 수 있는 공유 기록', isPrivate: false,
        createdAt: `${localToday()}T10:20:00.000Z`,
      },
      {
        id: 'private', userId: 'partner', date: localToday(), time: '10:10:00',
        authorRole: 'gomsin', log: '상대 비공개 기록', isPrivate: true,
        createdAt: `${localToday()}T10:10:00.000Z`,
      },
      {
        id: 'locked', userId: 'partner', date: localToday(), time: '10:00:00',
        authorRole: 'gomsin', log: '', isPrivate: false,
        contentUnavailable: 'key_unavailable',
        createdAt: `${localToday()}T10:00:00.000Z`,
      },
    ];

    view();

    expect(screen.getByText('읽을 수 있는 공유 기록')).toBeInTheDocument();
    expect(screen.queryByText('상대 비공개 기록')).not.toBeInTheDocument();
    expect(screen.queryByText(/이 기기에서 아직 이 기록을 열 수 없어요/)).not.toBeInTheDocument();
  });

  it('현재 상대의 신원이 확인되지 않으면 다른 작성자의 기록을 추측해 표시하지 않는다', () => {
    partnerUserId = undefined;

    view();

    expect(screen.queryByText('오늘 하루도 함께해줘서 고마워')).not.toBeInTheDocument();
  });

  it.each(['unknown', 'disconnected'] as const)(
    '서버 권위의 커플 상태가 %s이면 캐시된 상대 기록을 표시하지 않는다',
    (lifecycle) => {
      coupleLifecycle = lifecycle;

      view();

      expect(screen.queryByText('오늘 하루도 함께해줘서 고마워')).not.toBeInTheDocument();
    },
  );

  it('오늘부터 6일 전까지만 표시하고 미래나 7일 전 기록은 표시하지 않는다', () => {
    records = [
      {
        id: 'six-days-ago', userId: 'partner', date: dateFromToday(-6), time: '10:20:00',
        authorRole: 'gomsin', log: '육일 전 기록', isPrivate: false,
        createdAt: `${dateFromToday(-6)}T10:20:00.000Z`,
      },
      {
        id: 'seven-days-ago', userId: 'partner', date: dateFromToday(-7), time: '10:10:00',
        authorRole: 'gomsin', log: '칠일 전 기록', isPrivate: false,
        createdAt: `${dateFromToday(-7)}T10:10:00.000Z`,
      },
      {
        id: 'tomorrow', userId: 'partner', date: dateFromToday(1), time: '10:00:00',
        authorRole: 'gomsin', log: '미래 기록', isPrivate: false,
        createdAt: `${dateFromToday(1)}T10:00:00.000Z`,
      },
    ];

    view();

    expect(screen.getByText('육일 전 기록')).toBeInTheDocument();
    expect(screen.queryByText('칠일 전 기록')).not.toBeInTheDocument();
    expect(screen.queryByText('미래 기록')).not.toBeInTheDocument();
  });
});

describe('홈의 지난 오늘 개인정보 경계', () => {
  const oneYearAgoToday = () => {
    const today = localToday();
    return `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  };

  it('현재 상대가 아닌 작성자의 캐시된 공유 기록을 표시하지 않는다', () => {
    records = [{
      id: 'former-on-this-day',
      userId: 'former-partner',
      date: oneYearAgoToday(),
      time: '08:00:00',
      authorRole: 'gomsin',
      log: '이전 상대와 남긴 지난 오늘',
      isPrivate: false,
      createdAt: `${oneYearAgoToday()}T08:00:00.000Z`,
    }];

    view();

    expect(screen.queryByText('이전 상대와 남긴 지난 오늘')).not.toBeInTheDocument();
  });

  it('연결 상태와 무관하게 내가 남긴 지난 오늘은 계속 표시한다', () => {
    coupleLifecycle = 'disconnected';
    records = [{
      id: 'mine-on-this-day',
      userId: 'me',
      date: oneYearAgoToday(),
      time: '08:00:00',
      authorRole: 'soldier',
      log: '내가 남긴 지난 오늘',
      isPrivate: true,
      createdAt: `${oneYearAgoToday()}T08:00:00.000Z`,
    }];

    view();

    expect(screen.getByText('내가 남긴 지난 오늘')).toBeInTheDocument();
  });
});

describe('홈 포스트 읽기 순서', () => {
  it('사진 다음에 이름 없는 글, 그 아래 분 단위 시간과 책갈피를 표시한다', () => {
    view();

    const body = screen.getByText('오늘 하루도 함께해줘서 고마워');
    const article = body.closest('article');
    expect(article).not.toBeNull();

    const post = within(article!);
    const media = post.getByTestId('media-record-1');
    const bookmark = post.getByRole('button', { name: '이따 이야기하기' });
    const time = post.getByText('오늘 01:23');

    expect(article).not.toHaveTextContent('예성');
    expect(article).not.toHaveTextContent('01:23:00');
    expect(body).toHaveClass('record-copy');
    expect(time).not.toHaveClass('record-copy');
    expect(media.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(body.compareDocumentPosition(bookmark) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(body.compareDocumentPosition(time) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('고정 로고와 액션 행도 선택한 종이 레이어를 이어 쓴다', () => {
    view();

    const header = screen.getByTestId('home-sticky-header');
    expect(header).toHaveClass('paper-texture-layer');
    expect(header).not.toHaveStyle({ background: 'var(--paper)' });
  });
});

describe('홈의 actor-aware 이야기 표시', () => {
  const partnerMark = (overrides: Partial<TalkAboutMark> = {}): TalkAboutMark => ({
    id: 'partner-mark',
    recordId: 'record-1',
    coupleId: 'couple-1',
    actorUserId: 'partner',
    createdAt: '2026-09-02T20:00:00.000Z',
    isCompleted: false,
    ...overrides,
  });

  it('hides the call-mode entry when there is no eligible topic', () => {
    view();

    expect(screen.queryByRole('button', { name: '통화 모드' })).not.toBeInTheDocument();
  });

  it('invites me to add my mark when only the partner marked the record', () => {
    talkAboutMarks = [partnerMark()];
    view();

    const action = screen.getByRole('button', {
      name: '예성님이 표시했어요. 나도 이따 이야기하기',
    });
    expect(action).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(action);
    expect(markTalkAbout).toHaveBeenCalledWith('record-1');
    expect(unmarkTalkAbout).not.toHaveBeenCalled();
  });

  it('attributes a partner mark while removing only my side when both marked it', () => {
    talkAboutMarks = [
      partnerMark(),
      partnerMark({ id: 'my-mark', actorUserId: 'me' }),
    ];
    view();

    const action = screen.getByRole('button', {
      name: '예성님도 표시했어요. 이따 이야기하기 표시 해제',
    });
    expect(action).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(action);
    expect(unmarkTalkAbout).toHaveBeenCalledWith('record-1');
    expect(markTalkAbout).not.toHaveBeenCalled();
  });

  it('single-flights the bookmark mutation and disables the control until refresh settles', async () => {
    let finish!: (value: { ok: boolean }) => void;
    markTalkAbout.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    view();

    const action = screen.getByRole('button', { name: '이따 이야기하기' });
    fireEvent.click(action);
    fireEvent.click(action);

    expect(markTalkAbout).toHaveBeenCalledTimes(1);
    expect(action).toBeDisabled();
    finish({ ok: true });
    await vi.waitFor(() => expect(action).not.toBeDisabled());
  });

  it('keeps bookmarks read-only while offline', () => {
    online = false;
    view();

    expect(screen.getByRole('button', { name: /오프라인이라 지금은 읽기만 가능해요/ }))
      .toBeDisabled();
    expect(markTalkAbout).not.toHaveBeenCalled();
  });

  it('reports an unexpected mutation rejection and restores the control', async () => {
    markTalkAbout.mockRejectedValueOnce(new Error('network exploded'));
    view();

    fireEvent.click(screen.getByRole('button', { name: '이따 이야기하기' }));

    await vi.waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('책갈피를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.');
    });
    expect(screen.getByRole('button', { name: '이따 이야기하기' })).not.toBeDisabled();
  });

  it('tells the truth when the mark was saved but its refresh is delayed', async () => {
    markTalkAbout.mockResolvedValueOnce({ ok: true, syncPending: true });
    view();

    fireEvent.click(screen.getByRole('button', { name: '이따 이야기하기' }));

    await vi.waitFor(() => expect(toast.warning).toHaveBeenCalledWith(
      expect.stringContaining('저장은 됐지만 화면 반영이 늦어지고 있어요'),
    ));
    expect(toast.error).not.toHaveBeenCalled();
  });
});
