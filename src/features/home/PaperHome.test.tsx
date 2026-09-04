import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PaperHome } from '@/features/home/PaperHome';
import { localToday } from '@/lib/cycle';
import type { CoupleLifecycle } from '@/lib/coupleLifecycle';
import type { SharedSyncStatus } from '@/lib/storeContext';
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
let partnerName = '예성';
let coupleLifecycle: CoupleLifecycle = 'connected';
let sharedSyncStatus: SharedSyncStatus = 'live';
const markTalkAbout = vi.fn();
const unmarkTalkAbout = vi.fn();
const acknowledgePartnerDay = vi.fn();
let online = true;
let mediaShouldThrow = false;

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
          partnerName,
        },
      },
    },
    coupleLifecycle,
    sharedSyncStatus,
    markTalkAbout,
    unmarkTalkAbout,
  }),
}));

vi.mock('@/lib/usePartnerDay', () => ({
  usePartnerDay: () => ({
    surface: partnerSurface,
    acknowledge: acknowledgePartnerDay,
  }),
}));

vi.mock('@/lib/usePartnerCareNote', () => ({
  usePartnerCareNote: () => null,
}));

vi.mock('@/components/CoupleStatusBanner', () => ({
  CoupleStatusBanner: () => null,
}));

vi.mock('@/components/media/RecordMediaGallery', () => ({
  RecordMediaGallery: ({ recordId }: { recordId: string }) => {
    if (mediaShouldThrow) throw new Error('simulated gallery chunk failure');
    return <div data-testid={`media-${recordId}`} />;
  },
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
  partnerName = '예성';
  coupleLifecycle = 'connected';
  sharedSyncStatus = 'live';
  talkAboutMarks = [];
  online = true;
  mediaShouldThrow = false;
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

describe('Home 출시 상태 표현', () => {
  it('상대 신원이 아직 확인되지 않았으면 사람을 추측하거나 빈 피드라고 단정하지 않는다', () => {
    partnerUserId = undefined;
    records = [];

    view();

    expect(screen.getByText('상대 정보를 확인하고 있어요')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '예성의 스토리' })).not.toBeInTheDocument();
    expect(screen.queryByText('예성')).not.toBeInTheDocument();
    expect(screen.queryByText('상대')).not.toBeInTheDocument();
    expect(screen.queryByText('최근 7일에 공유된 기록이 없어요')).not.toBeInTheDocument();
  });

  it('정확한 상대와 정상 동기화가 확인된 빈 피드에만 검증된 빈 상태를 말한다', () => {
    records = [];

    view();

    expect(screen.getByRole('heading', { name: '예성의 최근 기록' })).toBeInTheDocument();
    expect(screen.queryByText('오늘을 포함한 7일')).not.toBeInTheDocument();
    expect(screen.getByText('최근 7일에 공유된 기록이 없어요')).toBeInTheDocument();
    expect(screen.queryByText('상대 정보를 확인하고 있어요')).not.toBeInTheDocument();
    expect(screen.queryByText('공유 정보를 아직 확인하지 못했어요')).not.toBeInTheDocument();
  });

  it('공유 동기화를 확인하지 못했으면 캐시를 숨기고 빈 피드라고 말하지 않는다', () => {
    sharedSyncStatus = 'unavailable';

    view();

    expect(screen.getByText('공유 정보를 아직 확인하지 못했어요')).toBeInTheDocument();
    expect(screen.queryByText('오늘 하루도 함께해줘서 고마워')).not.toBeInTheDocument();
    expect(screen.queryByText('최근 7일에 공유된 기록이 없어요')).not.toBeInTheDocument();
  });

  it('공유 동기화가 불가하면 캐시된 상대 스토리와 지난 오늘도 새 정보처럼 올리지 않는다', () => {
    const today = localToday();
    const oneYearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
    const cachedMemory = {
      id: 'cached-partner-memory',
      userId: 'partner',
      date: oneYearAgo,
      time: '08:00:00',
      authorRole: 'gomsin',
      log: '확인되지 않은 상대의 지난 오늘',
      isPrivate: false,
      createdAt: `${oneYearAgo}T08:00:00.000Z`,
    } as DailyRecord;
    sharedSyncStatus = 'unavailable';
    partnerSurface = [cachedMemory];
    records = [cachedMemory];

    view();

    expect(screen.queryByText('이어 보기')).not.toBeInTheDocument();
    expect(screen.queryByText('확인되지 않은 상대의 지난 오늘')).not.toBeInTheDocument();
    expect(screen.queryByText('예성의 하루를 이어서 볼 수 있어요')).not.toBeInTheDocument();
  });

  it.each(['personal', 'pending', 'disconnected'] as const)(
    '%s 상태는 기존 연결 안내에 맡기고 피드 상태를 단정하지 않는다',
    (lifecycle) => {
      coupleLifecycle = lifecycle;
      records = [];

      view();

      expect(screen.queryByText('상대 정보를 확인하고 있어요')).not.toBeInTheDocument();
      expect(screen.queryByText('공유 정보를 아직 확인하지 못했어요')).not.toBeInTheDocument();
      expect(screen.queryByText('최근 7일에 공유된 기록이 없어요')).not.toBeInTheDocument();
    },
  );

  it('남은 상대 스토리는 추가 문구 없이 링으로만 구분한다', () => {
    partnerSurface = [records[0]];

    view();

    const story = screen.getByRole('button', { name: '예성의 스토리, 새 기록 있음' });
    expect(within(story).queryByText('이어 보기')).not.toBeInTheDocument();
    expect(story.querySelector('[data-ring="new"]')).not.toBeNull();
    expect(story).not.toHaveTextContent(/\d/);
  });

  it('지금 필요한 것은 한 제목과 진행 아이콘만 보인다', () => {
    partnerSurface = [records[0]];

    view();

    const focus = screen.getByRole('region', { name: '지금 가장 필요한 것' });
    expect(within(focus).getByText('예성의 오늘')).toBeInTheDocument();
    expect(within(focus).queryByText('이어 보기')).not.toBeInTheDocument();
    expect(within(focus).getByRole('button', { name: '예성의 오늘: 이어 보기' })).toBeInTheDocument();
    expect(within(focus).queryByText('상대의 오늘')).not.toBeInTheDocument();
    expect(within(focus).queryByText(/하루를 이어서 볼 수/)).not.toBeInTheDocument();
  });

  it('홈 피드는 이미 원본이므로 중복된 원문 보기 행동을 두지 않는다', () => {
    records = [{
      ...records[0],
      id: 'partner/current?part=1',
    }];

    view();

    expect(screen.getByText('오늘 하루도 함께해줘서 고마워')).toBeInTheDocument();
    expect(screen.queryByText('원문 보기')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '예성의 기록 열기' })).not.toBeInTheDocument();
  });

  it('헤더의 종이 결 위에 보이는 이야기와 사용할 수 있는 통화 행동을 둔다', () => {
    talkAboutMarks = [{
      id: 'my-mark',
      recordId: 'record-1',
      coupleId: 'couple-1',
      actorUserId: 'me',
      createdAt: '2026-09-03T12:00:00.000Z',
      isCompleted: false,
    }];

    view();

    const header = screen.getByTestId('home-sticky-header');
    expect(header).toHaveClass('paper-texture-layer');
    expect(within(header).getByRole('button', { name: '이야기할 것' })).not.toHaveTextContent('이야기');
    expect(within(header).getByRole('button', { name: '통화 모드' })).toBeInTheDocument();
  });

  it('지난 오늘은 현재 상대의 7일 피드 끝 뒤에 놓고 정확한 원문을 연다', () => {
    const today = localToday();
    const oneYearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
    records = [
      records[0],
      {
        id: 'memory/one',
        userId: 'me',
        date: oneYearAgo,
        time: '08:00:00',
        authorRole: 'soldier',
        log: '내 지난 오늘',
        isPrivate: true,
        createdAt: `${oneYearAgo}T08:00:00.000Z`,
      },
    ];

    view();

    const feedRecord = screen.getByText('오늘 하루도 함께해줘서 고마워').closest('article');
    const memory = screen.getByText('내 지난 오늘');
    expect(screen.queryByText('여기까지가 오늘을 포함한 7일이에요')).not.toBeInTheDocument();
    expect(feedRecord).not.toBeNull();
    expect(feedRecord!.compareDocumentPosition(memory) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(memory.closest('button')!);
    expect(navigate).toHaveBeenCalledWith('/record?record=memory%2Fone');
  });

  it('작은 화면과 큰 글씨에서도 포스트 행동 줄이 높이를 고정하지 않고 감싼다', () => {
    partnerName = '아주긴이름을사용하는사랑하는상대방';
    records = [{
      ...records[0],
      log: '띄어쓰기없이아주길게이어지는한글기록도화면밖으로나가지않아야해요'.repeat(3),
    }];

    view();

    const bookmark = screen.getByRole('button', { name: '이따 이야기하기' });
    const actions = bookmark.parentElement;
    expect(actions).toHaveClass('min-h-11', 'flex-wrap', 'gap-y-2');
    expect(actions).not.toHaveClass('h-11');
    expect(actions).not.toHaveStyle({ background: 'var(--paper)' });
    expect(bookmark).toHaveClass('min-h-11');
  });

  it('Home의 탐색과 이야기 표시가 PartnerDay 확인을 대신하지 않는다', () => {
    partnerSurface = [records[0]];

    view();

    fireEvent.click(screen.getByRole('button', { name: '예성의 스토리, 새 기록 있음' }));
    fireEvent.click(screen.getByRole('button', { name: '이따 이야기하기' }));

    expect(acknowledgePartnerDay).not.toHaveBeenCalled();
  });
});

describe('홈의 상대방 전용 7일 피드', () => {
  it('상대방의 오늘 surface에도 있는 공유 원본 기록을 홈에 그대로 표시한다', () => {
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
    expect(screen.queryByText('원문 보기')).not.toBeInTheDocument();
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
  it('사진 다음에 이름 없는 글, 그 아래 분 단위 시간과 책갈피를 표시한다', async () => {
    view();

    const body = screen.getByText('오늘 하루도 함께해줘서 고마워');
    const article = body.closest('article');
    expect(article).not.toBeNull();

    const post = within(article!);
    const media = await post.findByTestId('media-record-1');
    const bookmark = post.getByRole('button', { name: '이따 이야기하기' });
    const time = post.getByText('오늘 01:23');

    expect(article).not.toHaveTextContent('예성');
    expect(article).not.toHaveTextContent('01:23:00');
    expect(body).toHaveClass('record-copy');
    expect(time).not.toHaveClass('record-copy');
    expect(media.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(body.compareDocumentPosition(bookmark) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(body.compareDocumentPosition(time) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bookmark).not.toHaveTextContent('이야기');
  });

  it('고정 로고와 액션 행도 선택한 종이 레이어를 이어 쓴다', () => {
    view();

    const header = screen.getByTestId('home-sticky-header');
    const brand = within(header).getByRole('heading', { name: '곰신로그', level: 1 });
    expect(header).toHaveClass('paper-texture-layer');
    expect(header).not.toHaveStyle({ background: 'var(--paper)' });
    expect(brand).toHaveClass('hand-text', 'text-title', 'leading-none');
    const mark = within(header).getByRole('img', { name: '곰신로그 브랜드 마크' });
    expect(mark).toHaveAttribute('src', '/favicon.svg');
    expect(mark).toHaveAttribute('data-brand-mark', 'true');
  });

  it('사진 모듈 로드 실패를 포스트 안에서 복구하고 나머지 홈은 유지한다', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mediaShouldThrow = true;
    view();

    expect(await screen.findByRole('alert', { name: '사진을 불러오지 못했어요' }))
      .toBeInTheDocument();
    expect(screen.getByText('오늘 하루도 함께해줘서 고마워')).toBeInTheDocument();
    expect(screen.getByTestId('home-sticky-header')).toBeInTheDocument();

    mediaShouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: '사진 다시 불러오기' }));

    expect(await screen.findByTestId('media-record-1')).toBeInTheDocument();
    expect(screen.queryByRole('alert', { name: '사진을 불러오지 못했어요' }))
      .not.toBeInTheDocument();
    consoleError.mockRestore();
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
