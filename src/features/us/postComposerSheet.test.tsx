import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { AppState, DailyRecord } from '@/types';

/**
 * 게시물 만들기가 실제로 무엇을 하는가.
 *
 * 세는 것은 세 가지다.
 *
 * 1. **아이디는 가운데, 만들기는 왼쪽 끝.** 요청받은 배치이고 헤더는 눌리는 자리가 바뀌면
 *    사용자가 매일 틀리는 종류의 변경이다.
 * 2. **사진만 올라간다.** 영상 경로는 E2EE 이전에 열지 않기로 한 결정이므로 이 표면이
 *    그것을 우회하지 못해야 한다.
 * 3. **기존 기록 경로로 저장된다.** 게시물 전용 저장 경로를 만들지 않았으므로 커플 권한과
 *    보호 게이트가 그대로 적용된다.
 */

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

let storeState: AppState;
const addRecordWithMedia = vi.fn(async () => ({ ok: true, failedFiles: [] as string[] }));

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: storeState,
    isReady: true,
    coupleLifecycle: 'connected',
    saveCoupleHighlight: vi.fn(),
    deleteCoupleHighlight: vi.fn(),
    addRecordWithMedia,
  }),
}));

/** 서명 URL을 실제로 부르지 않는다. 이 테스트가 세는 것은 선택과 순서다. */
vi.mock('@/lib/useMediaAttachment', () => ({
  useMediaAttachment: (attachment: { path?: string }) => ({
    url: attachment.path ? `blob:${attachment.path}` : undefined,
    refreshing: false,
    reportLoadFailure: () => {},
  }),
}));

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  }
  if (!URL.createObjectURL) {
    URL.createObjectURL = (() => 'blob:new-file') as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
  }
});

const { PaperProfile } = await import('@/features/us/PaperProfile');

function record(over: Partial<DailyRecord> & { id: string }): DailyRecord {
  return {
    userId: 'user-me',
    date: '2026-08-25',
    time: '12:00',
    authorRole: 'gomsin',
    log: '기록',
    isPrivate: false,
    talkAbout: false,
    createdAt: '2026-08-25T00:00:00Z',
    ...over,
  } as DailyRecord;
}

function baseState(): AppState {
  return {
    authenticatedUser: { id: 'user-me' },
    profile: {
      id: 'user-me',
      myName: '춘향',
      username: 'chunhyang',
      role: 'gomsin',
      couple: { coupleId: 'couple-1', partnerName: '몽룡', coupleCode: '', connected: true, status: 'active' },
      military: { branch: 'army', militaryStatus: 'serving', dischargeDateSource: 'manual' },
      contact: { enabled: true, weekdayStart: '18:00', weekdayEnd: '21:00', weekendStart: '10:00', weekendEnd: '21:00' },
    },
    records: [],
    events: [],
    trips: [],
    coupleHighlights: [],
    talkAboutMarks: [],
    widgetLayout: [],
  } as unknown as AppState;
}

function open() {
  return render(<MemoryRouter><PaperProfile /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  storeState = baseState();
  addRecordWithMedia.mockResolvedValue({ ok: true, failedFiles: [] });
});

describe('마이탭 헤더 배치', () => {
  it('만들기 버튼이 있고 44px 터치 타깃이다', () => {
    open();
    const plus = screen.getByRole('button', { name: '게시물 만들기' });
    expect(plus.className).toMatch(/h-11/);
    expect(plus.className).toMatch(/w-11/);
  });

  it('아이디가 헤더 가운데 영역에 있고, 만들기가 그보다 앞에 온다', () => {
    open();
    const plus = screen.getByRole('button', { name: '게시물 만들기' });
    const id = screen.getByText('@chunhyang');
    // DOM 순서로 왼쪽 끝임을 센다. 시각 좌표는 jsdom이 계산하지 않는다.
    expect(plus.compareDocumentPosition(id) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(id.parentElement?.className).toMatch(/justify-center/);
  });

  it('기존 기록 남기기와 설정 진입점을 없애지 않는다', () => {
    open();
    expect(screen.getByRole('button', { name: '기록 남기기' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '설정' })).toBeTruthy();
  });
});

describe('게시물 만들기 3단계', () => {
  it('만들기를 누르면 첫 단계가 열린다', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: '게시물 만들기' }));
    expect(screen.getByTestId('post-composer')).toBeTruthy();
    expect(screen.getByText('새 게시물')).toBeTruthy();
    expect(screen.getByTestId('post-pick-files')).toBeTruthy();
  });

  it('사진만 올릴 수 있다고 명시하고 상한을 알린다', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: '게시물 만들기' }));
    expect(screen.getByText(/사진만 올릴 수 있어요/)).toBeTruthy();
    expect(screen.getByText(/최대 10장/)).toBeTruthy();
  });

  it('여행·스토리에서 고르기 두 갈래를 제공한다', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: '게시물 만들기' }));
    expect(screen.getByRole('tab', { name: '스토리에서' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: '여행에서' })).toBeTruthy();
  });

  it('사진이 없으면 정직하게 없다고 말한다', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: '게시물 만들기' }));
    expect(screen.getByText('고를 수 있는 사진이 아직 없어요.')).toBeTruthy();
  });

  it('기존 사진을 고르면 순서 단계로 넘어가 대표 사진을 알려준다', async () => {
    storeState.records = [record({
      id: 'r1',
      attachments: [{ type: 'photo', name: 'a.jpg', path: 'couple-1/r1/a.jpg' }],
    } as Partial<DailyRecord> & { id: string })];
    open();
    await userEvent.click(screen.getByRole('button', { name: '게시물 만들기' }));
    await userEvent.click(screen.getAllByTestId('post-source-photo')[0]);
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(screen.getByText('순서 정하기')).toBeTruthy();
    expect(screen.getByText('대표 사진')).toBeTruthy();
  });

  it('두 장이면 키보드로도 순서를 바꿀 수 있다', async () => {
    storeState.records = [
      record({ id: 'r1', time: '09:00', attachments: [{ type: 'photo', name: 'a.jpg', path: 'p/a.jpg' }] } as Partial<DailyRecord> & { id: string }),
      record({ id: 'r2', time: '10:00', attachments: [{ type: 'photo', name: 'b.jpg', path: 'p/b.jpg' }] } as Partial<DailyRecord> & { id: string }),
    ];
    open();
    await userEvent.click(screen.getByRole('button', { name: '게시물 만들기' }));
    const pickable = screen.getAllByTestId('post-source-photo');
    await userEvent.click(pickable[0]);
    await userEvent.click(pickable[1]);
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    // 2번째를 앞으로 보내면 대표가 바뀐다.
    await userEvent.click(screen.getByRole('button', { name: '2번째 사진을 앞으로' }));
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(2);
  });

  it('사진을 뺄 수 있다', async () => {
    storeState.records = [record({
      id: 'r1', attachments: [{ type: 'photo', name: 'a.jpg', path: 'p/a.jpg' }],
    } as Partial<DailyRecord> & { id: string })];
    open();
    await userEvent.click(screen.getByRole('button', { name: '게시물 만들기' }));
    await userEvent.click(screen.getAllByTestId('post-source-photo')[0]);
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    await userEvent.click(screen.getByRole('button', { name: '1번째 사진 빼기' }));
    expect(screen.queryByText('대표 사진')).toBeNull();
  });

  it('글을 쓰고 공유하면 기존 기록 경로로 저장된다', async () => {
    storeState.records = [record({
      id: 'r1', attachments: [{ type: 'photo', name: 'a.jpg', path: 'p/a.jpg' }],
    } as Partial<DailyRecord> & { id: string })];
    open();
    await userEvent.click(screen.getByRole('button', { name: '게시물 만들기' }));
    await userEvent.click(screen.getAllByTestId('post-source-photo')[0]);
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    await userEvent.type(screen.getByTestId('post-caption'), '우리 첫 게시물');
    await userEvent.click(screen.getByTestId('post-share'));

    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalledTimes(1));
    const [draft] = addRecordWithMedia.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(draft.log).toBe('우리 첫 게시물');
    expect(draft.isPrivate).toBe(false);
    // 게시물은 감정 추론을 하지 않는다.
    expect(draft.emotionFlow).toEqual([]);
  });

  it('나만 보기를 켜면 비공개로 저장된다', async () => {
    storeState.records = [record({
      id: 'r1', attachments: [{ type: 'photo', name: 'a.jpg', path: 'p/a.jpg' }],
    } as Partial<DailyRecord> & { id: string })];
    open();
    await userEvent.click(screen.getByRole('button', { name: '게시물 만들기' }));
    await userEvent.click(screen.getAllByTestId('post-source-photo')[0]);
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    await userEvent.click(screen.getByRole('switch', { name: /나만 보기/ }));
    await userEvent.click(screen.getByTestId('post-share'));
    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalled());
    const [draft] = addRecordWithMedia.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(draft.isPrivate).toBe(true);
  });
});

describe('프라이버시 경계', () => {
  it('비공개 기록의 사진은 고를 수 없다', async () => {
    storeState.records = [
      record({ id: 'shared', attachments: [{ type: 'photo', name: 'a.jpg', path: 'p/a.jpg' }] } as Partial<DailyRecord> & { id: string }),
      record({ id: 'secret', isPrivate: true, attachments: [{ type: 'photo', name: 's.jpg', path: 'p/s.jpg' }] } as Partial<DailyRecord> & { id: string }),
    ];
    open();
    await userEvent.click(screen.getByRole('button', { name: '게시물 만들기' }));
    // 공유 사진 하나만 고를 수 있다.
    expect(screen.getAllByTestId('post-source-photo')).toHaveLength(1);
  });

  it('연결 전에는 공개 범위를 고를 수 없고 비공개로 저장된다고 알린다', async () => {
    storeState.profile.couple.connected = false;
    storeState.records = [record({
      id: 'r1', attachments: [{ type: 'photo', name: 'a.jpg', path: 'p/a.jpg' }],
    } as Partial<DailyRecord> & { id: string })];
    open();
    await userEvent.click(screen.getByRole('button', { name: '게시물 만들기' }));
    await userEvent.click(screen.getAllByTestId('post-source-photo')[0]);
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(screen.queryByRole('switch', { name: /나만 보기/ })).toBeNull();
    expect(screen.getByText(/나만 볼 수 있게 저장돼요/)).toBeTruthy();
  });
});
