import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AppState, DailyRecord, Trip } from '@/types';
import { saveCompanionShopState } from '@/lib/companionShopLocalState';
import { savePaperTexture } from '@/lib/paperTexturePreference';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

let storeState: AppState;
const saveCoupleHighlight = vi.fn();
const deleteCoupleHighlight = vi.fn();

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: storeState,
    isReady: true,
    coupleLifecycle: 'connected',
    saveCoupleHighlight,
    deleteCoupleHighlight,
  }),
}));

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  }
});

const { PaperProfile } = await import('@/features/us/PaperProfile');

function makeRecord(over: Partial<DailyRecord> & { id: string; date: string }): DailyRecord {
  return {
    authorRole: 'gomsin',
    log: '기록 내용',
    time: '12:00',
    isPrivate: false,
    talkAbout: false,
    createdAt: '2026-08-01T00:00:00Z',
    ...over,
  };
}

function baseState(): AppState {
  return {
    authenticatedUser: { id: 'user-me' },
    profile: {
      id: 'user-me',
      myName: '춘향',
      username: 'chunhyang',
      profileCaption: '오늘도 우리답게',
      role: 'gomsin',
      couple: {
        coupleId: 'couple-1',
        partnerName: '몽룡',
        anniversaryDate: '2026-01-01',
        coupleCode: 'ABC',
        connected: true,
        status: 'active',
      },
      military: {
        branch: 'army',
        militaryStatus: 'serving',
        enlistmentDate: '2025-09-01',
        expectedDischargeDate: '2027-02-28',
        dischargeDateSource: 'manual',
      },
      contact: { enabled: true, weekdayStart: '18:00', weekdayEnd: '21:00', weekendStart: '10:00', weekendEnd: '21:00' },
    },
    records: [],
    events: [],
    trips: [],
    widgetLayout: [],
  } as unknown as AppState;
}

describe('PaperProfile (우리 화면)', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    storeState = baseState();
    localStorage.clear();
    document.documentElement.removeAttribute('data-paper');
    saveCoupleHighlight.mockReset().mockResolvedValue({ ok: true });
    deleteCoupleHighlight.mockReset().mockResolvedValue(true);
  });

  it('상단 영역(헤더, 커플 상태 배너, 통계, 소개)이 렌더된다', () => {
    render(
      <MemoryRouter>
        <PaperProfile />
      </MemoryRouter>,
    );

    expect(screen.getByText('춘향')).toBeInTheDocument();
    expect(screen.getByText('@chunhyang')).toBeInTheDocument();
    expect(screen.getByText('오늘도 우리답게')).toBeInTheDocument();
    expect(screen.queryByText('춘향 ♥ 몽룡')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '내 프로필 사진 고르기' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '프로필 편집' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '기록 남기기' })).toBeInTheDocument();
    expect(screen.getByTestId('profile-sticky-header').className).toContain('sticky');
    // The bottom navigation owns the Find tab; this component test does not mount the app shell.
    expect(screen.queryByRole('button', { name: '기록 찾기' })).not.toBeInTheDocument();
  });

  it('마이 메뉴 열기 버튼은 접근 가능한 종이 시트를 열고 닫기 버튼으로 닫힌다', () => {
    render(
      <MemoryRouter>
        <PaperProfile />
      </MemoryRouter>,
    );

    const trigger = screen.getByRole('button', { name: '마이 메뉴 열기' });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: '마이 메뉴' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('radiogroup', { name: '앱 종이' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '마이 메뉴 닫기' }));
    expect(screen.queryByRole('dialog', { name: '마이 메뉴' })).not.toBeInTheDocument();
  });

  it('마이 메뉴는 백드롭을 누르면 닫힌다', () => {
    render(
      <MemoryRouter>
        <PaperProfile />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: '마이 메뉴 열기' }));
    fireEvent.click(screen.getByTestId('profile-paper-menu-backdrop'));

    expect(screen.queryByRole('dialog', { name: '마이 메뉴' })).not.toBeInTheDocument();
  });

  it('마이 메뉴는 활성 계정이 소유한 종이만 표시한다', () => {
    saveCompanionShopState('user-me', {
      version: 1,
      ownedAccessories: [],
      ownedPapers: ['plain', 'ruled', 'grid'],
      lastFreeDrawDate: null,
    });

    render(
      <MemoryRouter>
        <PaperProfile />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: '마이 메뉴 열기' }));

    const group = screen.getByRole('radiogroup', { name: '앱 종이' });
    expect(within(group).getByRole('radio', { name: '따뜻한 무지' })).toBeInTheDocument();
    expect(within(group).getByRole('radio', { name: '줄 노트' })).toBeInTheDocument();
    expect(within(group).getByRole('radio', { name: '모눈 종이' })).toBeInTheDocument();
    expect(screen.getByTestId('paper-texture-preview-grid')).toHaveAttribute('data-paper', 'grid');
    expect(within(group).queryByRole('radio', { name: '도트 종이' })).not.toBeInTheDocument();
    expect(within(group).queryByRole('radio', { name: '크림 편지지' })).not.toBeInTheDocument();
  });

  it('종이를 고르면 저장하고 문서 바탕 속성에 즉시 적용하며 선택을 표시한다', () => {
    saveCompanionShopState('user-me', {
      version: 1,
      ownedAccessories: [],
      ownedPapers: ['plain', 'ruled', 'grid'],
      lastFreeDrawDate: null,
    });

    render(
      <MemoryRouter>
        <PaperProfile />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: '마이 메뉴 열기' }));

    const grid = screen.getByRole('radio', { name: '모눈 종이' });
    fireEvent.click(grid);

    expect(grid).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '줄 노트' })).toHaveAttribute('aria-checked', 'false');
    expect(document.documentElement).toHaveAttribute('data-paper', 'grid');
    expect(localStorage.getItem('gomsin.display.paper.user-me')).toBe('grid');
  });

  it('화살표 키로 다음 종이를 선택하고 포커스를 함께 옮긴다', () => {
    saveCompanionShopState('user-me', {
      version: 1,
      ownedAccessories: [],
      ownedPapers: ['plain', 'ruled', 'grid'],
      lastFreeDrawDate: null,
    });

    render(
      <MemoryRouter>
        <PaperProfile />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: '마이 메뉴 열기' }));

    const ruled = screen.getByRole('radio', { name: '줄 노트' });
    const grid = screen.getByRole('radio', { name: '모눈 종이' });
    ruled.focus();
    fireEvent.keyDown(ruled, { key: 'ArrowDown' });

    expect(grid).toHaveFocus();
    expect(grid).toHaveAttribute('aria-checked', 'true');
    expect(grid).toHaveAttribute('tabindex', '0');
    expect(ruled).toHaveAttribute('tabindex', '-1');
    expect(document.documentElement).toHaveAttribute('data-paper', 'grid');
  });

  it('마이 메뉴에서 설정 및 계정 관리로 설정 화면에 접근한다', () => {
    render(
      <MemoryRouter>
        <PaperProfile />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: '마이 메뉴 열기' }));
    fireEvent.click(screen.getByRole('button', { name: '설정 및 계정 관리' }));

    expect(mockNavigate).toHaveBeenCalledWith('/settings');
    expect(screen.queryByRole('dialog', { name: '마이 메뉴' })).not.toBeInTheDocument();
  });

  it('Escape로 닫고 열기 버튼으로 포커스를 돌려준다', () => {
    render(
      <MemoryRouter>
        <PaperProfile />
      </MemoryRouter>,
    );

    const trigger = screen.getByRole('button', { name: '마이 메뉴 열기' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('button', { name: '마이 메뉴 닫기' })).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: '마이 메뉴' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('Tab과 Shift+Tab 포커스를 열린 시트 안에서 순환시킨다', () => {
    render(
      <MemoryRouter>
        <PaperProfile />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: '마이 메뉴 열기' }));

    const first = screen.getByRole('button', { name: '마이 메뉴 닫기' });
    const last = screen.getByRole('button', { name: '설정 및 계정 관리' });
    last.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(first).toHaveFocus();

    first.focus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });

  it('계정이 바뀌면 이전 계정의 종이 소유권과 선택을 남기지 않는다', async () => {
    saveCompanionShopState('user-me', {
      version: 1,
      ownedAccessories: [],
      ownedPapers: ['plain', 'ruled', 'grid'],
      lastFreeDrawDate: null,
    });
    savePaperTexture('user-me', 'grid');
    savePaperTexture('user-other', 'plain');

    const view = render(
      <MemoryRouter>
        <PaperProfile />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: '마이 메뉴 열기' }));
    expect(screen.getByRole('radio', { name: '모눈 종이' })).toHaveAttribute('aria-checked', 'true');

    const next = baseState();
    storeState = {
      ...next,
      authenticatedUser: { id: 'user-other' },
      profile: { ...next.profile, id: 'user-other' },
    };
    view.rerender(
      <MemoryRouter>
        <PaperProfile />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('radio', { name: '모눈 종이' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('radio', { name: '따뜻한 무지' })).toHaveAttribute('aria-checked', 'true'));
  });

  it('기념일이 있으면 profileCaption이 없어도 기본 문구를 유지한다', () => {
    storeState = {
      ...baseState(),
      profile: { ...baseState().profile, profileCaption: undefined },
    };

    render(
      <MemoryRouter>
        <PaperProfile />
      </MemoryRouter>,
    );

    expect(screen.getByText(/일째 같은 하늘 아래/)).toBeInTheDocument();
  });

  it('기념일이 없으면 기본 문구 대신 설정 상태를 정직하게 보여준다', () => {
    storeState = {
      ...baseState(),
      profile: {
        ...baseState().profile,
        username: undefined,
        profileCaption: undefined,
        couple: { ...baseState().profile.couple, anniversaryDate: undefined },
      },
    };

    render(
      <MemoryRouter>
        <PaperProfile />
      </MemoryRouter>,
    );

    expect(screen.getByText('아이디 설정하기')).toBeInTheDocument();
    expect(screen.getByText('기념일 미설정')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '아이디 설정하기' }));
    expect(mockNavigate).toHaveBeenCalledWith('/settings?profile=edit');
  });

  it('하이라이트는 날짜 파생값이 아니라 공유 사진을 직접 고르는 편집기다', async () => {
    const record = makeRecord({
      id: 'highlight-record',
      date: '2026-02-01',
      attachments: [{ type: 'photo', name: 'cover.jpg', url: 'https://example.test/cover.jpg' }],
    });
    storeState = { ...baseState(), records: [record] };

    render(
      <MemoryRouter>
        <PaperProfile />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: '하이라이트 만들기' }));
    expect(screen.getByRole('dialog', { name: '새 하이라이트' })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('예: 우리의 봄'), { target: { value: '우리의 봄' } });
    fireEvent.click(screen.getByRole('button', { name: /2026-02-01 사진 선택/ }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(saveCoupleHighlight).toHaveBeenCalledWith(expect.objectContaining({
      title: '우리의 봄',
      recordIds: ['highlight-record'],
      coverRecordId: 'highlight-record',
    })));
  });

  it('스토리에서 돌아온 사진 id로 하이라이트 편집기를 연다', async () => {
    const record = makeRecord({
      id: 'story-photo',
      date: '2026-02-02',
      attachments: [{ type: 'photo', name: 'story.jpg', url: 'https://example.test/story.jpg' }],
    });
    storeState = { ...baseState(), records: [record] };

    render(
      <MemoryRouter initialEntries={['/us?highlightRecord=story-photo']}>
        <PaperProfile />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole('dialog', { name: '새 하이라이트' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /2026-02-02 사진 선택 해제/ })).toBeInTheDocument();
  });

  it('게시물 격자는 명시적으로 발행한 사진만 노출하고 일반 스토리 사진은 제외한다', () => {
    const trip: Trip = {
      id: 'trip-jeju',
      coupleId: 'couple-1',
      createdBy: 'user-me',
      title: '제주 여행',
      startDate: '2026-08-10',
      endDate: '2026-08-12',
      status: 'planned',
      createdAt: '2026-08-01T00:00:00Z',
    };

    const normalRecord = makeRecord({
      id: 'rec-normal',
      date: '2026-08-05',
      log: '평범한 하루',
      attachments: [{ type: 'photo', name: 'normal.jpg', url: 'https://example.test/normal.jpg' }],
    });
    const travelRecord = makeRecord({
      id: 'rec-travel',
      date: '2026-08-11',
      log: '제주도 바다 도착!',
      isProfilePost: true,
      attachments: [{ type: 'photo', name: '제주도.jpg', url: 'https://example.test/jeju.jpg' }],
    });

    storeState = {
      ...baseState(),
      trips: [trip],
      records: [normalRecord, travelRecord],
    };

    render(
      <MemoryRouter>
        <PaperProfile />
      </MemoryRouter>,
    );

    // 스토리 사진은 자동으로 들어오지 않고, 명시적으로 발행한 게시물만 보인다.
    expect(screen.getByTestId('post-tile-rec-travel')).toBeInTheDocument();
    expect(screen.queryByTestId('post-tile-rec-normal')).not.toBeInTheDocument();
    expect(screen.getByTestId('post-tile-rec-travel')).toHaveAttribute('data-kind', 'photo');

    fireEvent.click(screen.getByTestId('post-tile-rec-travel'));
    const viewer = screen.getByTestId('photo-post-viewer');
    expect(viewer).toBeInTheDocument();
    expect(viewer.querySelector('[data-testid="record-attachment"] img[alt="제주도.jpg"]')).not.toBeNull();
    expect(within(viewer).getByText('제주도 바다 도착!')).toHaveClass('record-copy');

    fireEvent.click(screen.getByRole('button', { name: '사진 게시물 닫기' }));
    expect(screen.queryByTestId('photo-post-viewer')).not.toBeInTheDocument();
  });

  it('여행 기록이 없으면 여행 안내 문구가 격자에 노출된다', () => {
    storeState = {
      ...baseState(),
      trips: [],
      records: [makeRecord({ id: 'rec-1', date: '2026-08-05', log: '일상 기록' })],
    };

    render(
      <MemoryRouter>
        <PaperProfile />
      </MemoryRouter>,
    );

    expect(screen.getByText(/아직 게시물이 없어요/)).toBeInTheDocument();
  });

  it('사진 탭은 비공개 기록을 제외한 공유 기록 목록을 사용한다', () => {
    const record1 = makeRecord({ id: 'rec-1', date: '2026-08-01', log: '첫 번째 일상 이야기', attachments: [{ type: 'photo', name: 'one.jpg', url: 'https://example.test/one.jpg' }] });
    const record2 = makeRecord({ id: 'rec-2', date: '2026-08-02', log: '두 번째 이야기', isPrivate: true, attachments: [{ type: 'photo', name: 'two.jpg', url: 'https://example.test/two.jpg' }] });

    storeState = {
      ...baseState(),
      records: [record1, record2],
    };

    render(
      <MemoryRouter>
        <PaperProfile />
      </MemoryRouter>,
    );

    // 사진(기록) 탭 클릭
    const photoTab = screen.getByRole('button', { name: '사진' });
    fireEvent.click(photoTab);

    expect(screen.getByTestId('profile-record-list')).toBeInTheDocument();
    expect(screen.getByTestId('profile-record-rec-1')).toBeInTheDocument();
    expect(screen.queryByTestId('profile-record-rec-2')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('profile-record-rec-1'));
    expect(mockNavigate).toHaveBeenCalledWith('/record?record=rec-1');
  });

  it('여행 탭을 누르면 간단한 여행 목록과 상세 진입을 제공한다', () => {
    const trip: Trip = {
      id: 'trip-jeju',
      coupleId: 'couple-1',
      createdBy: 'user-me',
      title: '제주 여행',
      startDate: '2099-08-10',
      endDate: '2099-08-12',
      status: 'planned',
      createdAt: '2026-08-01T00:00:00Z',
    };
    storeState = { ...baseState(), trips: [trip] };

    render(
      <MemoryRouter>
        <PaperProfile />
      </MemoryRouter>,
    );

    const tripTab = screen.getByRole('button', { name: '여행' });
    fireEvent.click(tripTab);

    expect(screen.getByTestId('profile-trips-list')).toBeInTheDocument();
    expect(screen.getByText('제주 여행')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '제주 여행 열기' }));
    expect(mockNavigate).toHaveBeenCalledWith('/trips/trip-jeju');

    fireEvent.click(screen.getByRole('button', { name: '전체 보기' }));
    expect(mockNavigate).toHaveBeenCalledWith('/trips');
  });
});
