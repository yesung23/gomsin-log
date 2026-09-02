import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
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
 * 3. **기존 사진도 새 기록 아래로 안전하게 복사된다.** 예전 기록의 Storage 경로를 새
 *    기록에 붙이지 않아 canonical path와 삭제 수명 경계를 지킨다.
 */

const mockNavigate = vi.fn();
const toastWarning = vi.hoisted(() => vi.fn());
const { downloadRecordPhotoForReuse } = vi.hoisted(() => ({
  downloadRecordPhotoForReuse: vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: toastWarning,
    info: vi.fn(),
  },
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@/lib/records', async () => {
  const actual = await vi.importActual<typeof import('@/lib/records')>('@/lib/records');
  return { ...actual, downloadRecordPhotoForReuse };
});

let storeState: AppState;
const addRecordWithMedia = vi.fn(async () => ({
  ok: true,
  failedFiles: [] as string[],
  recordId: 'post-1',
}));
const updateRecordMedia = vi.fn(async () => ({ ok: true, failedFiles: [] as string[] }));
const updateRecord = vi.fn(async () => ({ ok: true as const }));
const deleteRecord = vi.fn(async () => ({ ok: true as const }));

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: storeState,
    isReady: true,
    coupleLifecycle: 'connected',
    saveCoupleHighlight: vi.fn(),
    deleteCoupleHighlight: vi.fn(),
    addRecordWithMedia,
    updateRecord,
    deleteRecord,
    updateRecordMedia,
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
  localStorage.clear();
  storeState = baseState();
  addRecordWithMedia.mockResolvedValue({ ok: true, failedFiles: [], recordId: 'post-1' });
  updateRecordMedia.mockResolvedValue({ ok: true, failedFiles: [] });
  updateRecord.mockResolvedValue({ ok: true });
  deleteRecord.mockResolvedValue({ ok: true });
  downloadRecordPhotoForReuse.mockResolvedValue({
    file: new File(['photo'], 'a.jpg', { type: 'image/jpeg' }),
  });
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

  it('기존 기록 남기기와 설정 진입점을 없애지 않는다', async () => {
    open();
    expect(screen.getByRole('button', { name: '기록 남기기' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '마이 메뉴 열기' }));
    expect(screen.getByRole('button', { name: '설정 및 계정 관리' })).toBeTruthy();
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

  it('사진 한 장이면 불필요한 순서 단계를 건너뛴다', async () => {
    storeState.records = [record({
      id: 'r1',
      attachments: [{ type: 'photo', name: 'a.jpg', path: 'couple-1/r1/a.jpg' }],
    } as Partial<DailyRecord> & { id: string })];
    open();
    await userEvent.click(screen.getByRole('button', { name: '게시물 만들기' }));
    await userEvent.click(screen.getAllByTestId('post-source-photo')[0]);
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(screen.getByText('글 쓰기')).toBeTruthy();
    expect(screen.queryByText('순서 정하기')).toBeNull();
  });

  it('두 장이면 키보드로도 순서를 바꿀 수 있다', async () => {
    storeState.records = [
      record({ id: 'r1', time: '09:00', attachments: [{ type: 'photo', name: 'a.jpg', path: 'couple-1/r1/a.jpg' }] } as Partial<DailyRecord> & { id: string }),
      record({ id: 'r2', time: '10:00', attachments: [{ type: 'photo', name: 'b.jpg', path: 'couple-1/r2/b.jpg' }] } as Partial<DailyRecord> & { id: string }),
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

    downloadRecordPhotoForReuse.mockImplementation(async (attachment: { name: string }) => ({
      file: new File(['photo'], attachment.name, { type: 'image/jpeg' }),
    }));
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    await userEvent.click(screen.getByTestId('post-share'));
    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalled());
    const files = addRecordWithMedia.mock.calls[0][1] as File[];
    expect(files.map((file) => file.name)).toEqual(['a.jpg', 'b.jpg']);
  });

  it('사진을 뺄 수 있다', async () => {
    storeState.records = [
      record({ id: 'r1', attachments: [{ type: 'photo', name: 'a.jpg', path: 'couple-1/r1/a.jpg' }] } as Partial<DailyRecord> & { id: string }),
      record({ id: 'r2', attachments: [{ type: 'photo', name: 'b.jpg', path: 'couple-1/r2/b.jpg' }] } as Partial<DailyRecord> & { id: string }),
    ];
    open();
    await userEvent.click(screen.getByRole('button', { name: '게시물 만들기' }));
    await userEvent.click(screen.getAllByTestId('post-source-photo')[0]);
    await userEvent.click(screen.getAllByTestId('post-source-photo')[1]);
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    await userEvent.click(screen.getByRole('button', { name: '1번째 사진 빼기' }));
    expect(screen.getAllByRole('button', { name: /사진 빼기/ })).toHaveLength(1);
  });

  it('글을 쓰고 공유하면 기존 사진을 새 파일로 복사해 저장한다', async () => {
    storeState.records = [record({
      id: 'r1', attachments: [{ type: 'photo', name: 'a.jpg', path: 'couple-1/r1/a.jpg' }],
    } as Partial<DailyRecord> & { id: string })];
    open();
    await userEvent.click(screen.getByRole('button', { name: '게시물 만들기' }));
    await userEvent.click(screen.getAllByTestId('post-source-photo')[0]);
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    await userEvent.type(screen.getByTestId('post-caption'), '우리 첫 게시물');
    await userEvent.click(screen.getByTestId('post-share'));

    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalledTimes(1));
    const [draft, files, options] = addRecordWithMedia.mock.calls[0] as unknown as [
      Record<string, unknown>, File[], Record<string, unknown>,
    ];
    expect(draft.log).toBe('우리 첫 게시물');
    expect(draft.isPrivate).toBe(false);
    expect(draft.isProfilePost).toBe(true);
    // 게시물은 감정 추론을 하지 않는다.
    expect(draft.emotionFlow).toEqual([]);
    expect(downloadRecordPhotoForReuse).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'couple-1/r1/a.jpg' }),
      'couple-1',
      'r1',
    );
    expect(files).toHaveLength(1);
    expect(files[0]).toBeInstanceOf(File);
    expect(options).toEqual({ expectedCoupleId: 'couple-1', allOrNothingMedia: true });
  });

  it('같은 프레임에 공유를 두 번 눌러도 게시물은 한 번만 만든다', async () => {
    storeState.records = [record({
      id: 'r1', attachments: [{ type: 'photo', name: 'a.jpg', path: 'couple-1/r1/a.jpg' }],
    } as Partial<DailyRecord> & { id: string })];
    let release: (() => void) | undefined;
    addRecordWithMedia.mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({ ok: true, failedFiles: [], recordId: 'post-1' });
    }));
    open();
    await userEvent.click(screen.getByRole('button', { name: '게시물 만들기' }));
    await userEvent.click(screen.getAllByTestId('post-source-photo')[0]);
    await userEvent.click(screen.getByRole('button', { name: '다음' }));

    const share = screen.getByTestId('post-share');
    act(() => {
      share.click();
      share.click();
    });

    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalledTimes(1));
    await act(async () => { release?.(); });
  });

  it('나만 보기를 켜면 비공개로 저장된다', async () => {
    storeState.records = [record({
      id: 'r1', attachments: [{ type: 'photo', name: 'a.jpg', path: 'couple-1/r1/a.jpg' }],
    } as Partial<DailyRecord> & { id: string })];
    open();
    await userEvent.click(screen.getByRole('button', { name: '게시물 만들기' }));
    await userEvent.click(screen.getAllByTestId('post-source-photo')[0]);
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    await userEvent.click(screen.getByRole('switch', { name: /나만 보기/ }));
    await userEvent.click(screen.getByTestId('post-share'));
    await waitFor(() => expect(addRecordWithMedia).toHaveBeenCalled());
    const [draft] = addRecordWithMedia.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(draft.isPrivate).toBe(true);
  });

  it('기존 사진 다운로드가 실패하면 기록을 만들지 않고 초안을 보존한다', async () => {
    storeState.records = [record({
      id: 'r1', attachments: [{ type: 'photo', name: 'a.jpg', path: 'couple-1/r1/a.jpg' }],
    } as Partial<DailyRecord> & { id: string })];
    downloadRecordPhotoForReuse.mockResolvedValueOnce({ error: '기존 사진을 불러오지 못했어요.' });
    open();
    await userEvent.click(screen.getByRole('button', { name: '게시물 만들기' }));
    await userEvent.click(screen.getAllByTestId('post-source-photo')[0]);
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    await userEvent.type(screen.getByTestId('post-caption'), '보존할 글');
    await userEvent.click(screen.getByTestId('post-share'));

    await waitFor(() => expect(downloadRecordPhotoForReuse).toHaveBeenCalled());
    expect(addRecordWithMedia).not.toHaveBeenCalled();
    expect(screen.getByTestId('post-composer')).toBeTruthy();
    expect((screen.getByTestId('post-caption') as HTMLTextAreaElement).value).toBe('보존할 글');
  });

  it('사진 업로드 실패는 같은 비공개 기록으로 재시도하고 중복 기록을 만들지 않는다', async () => {
    storeState.records = [record({
      id: 'r1', attachments: [{ type: 'photo', name: 'a.jpg', path: 'couple-1/r1/a.jpg' }],
    } as Partial<DailyRecord> & { id: string })];
    addRecordWithMedia.mockResolvedValueOnce({
      ok: true,
      failedFiles: ['a.jpg'],
      recordId: 'post-retry-1',
    });
    open();
    await userEvent.click(screen.getByRole('button', { name: '게시물 만들기' }));
    await userEvent.click(screen.getAllByTestId('post-source-photo')[0]);
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    await userEvent.type(screen.getByTestId('post-caption'), '한 번만 저장할 글');
    await userEvent.click(screen.getByTestId('post-share'));

    await waitFor(() => expect(toastWarning).toHaveBeenCalledWith(
      expect.stringMatching(/나만 보기로 보관했어요/),
    ));
    expect(updateRecord).not.toHaveBeenCalled();
    expect(deleteRecord).not.toHaveBeenCalled();
    expect(screen.getByTestId('post-share').textContent).toContain('사진 다시 올리기');
    await userEvent.click(screen.getByTestId('post-share'));

    await waitFor(() => expect(updateRecordMedia).toHaveBeenCalledWith('post-retry-1', {
      addFiles: expect.any(Array),
      allOrNothing: true,
    }));
    expect(updateRecord).toHaveBeenLastCalledWith('post-retry-1', {
      isPrivate: false,
      isProfilePost: true,
    });
    expect(addRecordWithMedia).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId('post-composer')).toBeNull());
  });

  it('새로고침 뒤에도 비공개 초안의 exact record id와 공개 의도를 복구한다', async () => {
    storeState.records = [record({
      id: 'r1', attachments: [{ type: 'photo', name: 'a.jpg', path: 'couple-1/r1/a.jpg' }],
    } as Partial<DailyRecord> & { id: string })];
    addRecordWithMedia.mockResolvedValueOnce({
      ok: true,
      failedFiles: ['a.jpg'],
      recordId: 'post-retry-1',
    });
    const first = open();
    await userEvent.click(screen.getByRole('button', { name: '게시물 만들기' }));
    await userEvent.click(screen.getAllByTestId('post-source-photo')[0]);
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    await userEvent.type(screen.getByTestId('post-caption'), '새로고침 뒤에도 남을 글');
    await userEvent.click(screen.getByTestId('post-share'));
    await waitFor(() => expect(toastWarning).toHaveBeenCalled());

    first.unmount();
    storeState.records = [
      record({
        id: 'r1', attachments: [{ type: 'photo', name: 'a.jpg', path: 'couple-1/r1/a.jpg' }],
      } as Partial<DailyRecord> & { id: string }),
      record({ id: 'post-retry-1', log: '새로고침 뒤에도 남을 글', isPrivate: true }),
    ];
    open();
    const resume = await screen.findByRole('button', { name: '게시물 사진 이어서 올리기' });
    expect(localStorage.getItem('gomsinlog.post-retry.v1:user-me')).toBeTruthy();
    await userEvent.click(resume);
    await userEvent.click(screen.getAllByTestId('post-source-photo')[0]);
    expect(screen.getAllByTestId('post-source-photo')[0].getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(screen.getByTestId('post-composer').textContent).toContain('글 쓰기');
    expect(screen.getByText(/글은 이미 저장했어요/)).toBeTruthy();
    expect(screen.getByTestId('post-share').textContent).toContain('사진 다시 올리기');
    await userEvent.click(screen.getByTestId('post-share'));
    await waitFor(() => expect(updateRecordMedia).toHaveBeenCalledWith('post-retry-1', {
      addFiles: expect.any(Array),
      allOrNothing: true,
    }));
    expect(updateRecord).toHaveBeenLastCalledWith('post-retry-1', {
      isPrivate: false,
      isProfilePost: true,
    });
    await waitFor(() => expect(localStorage.getItem('gomsinlog.post-retry.v1:user-me')).toBeNull());
  });

  it('사진 첨부 후 공개 범위 갱신이 실패하면 publication 단계로 보존되어 사진 재업로드 없이 공개만 재시도한다', async () => {
    storeState.records = [record({
      id: 'r1', attachments: [{ type: 'photo', name: 'a.jpg', path: 'couple-1/r1/a.jpg' }],
    } as Partial<DailyRecord> & { id: string })];
    addRecordWithMedia.mockResolvedValueOnce({
      ok: true,
      failedFiles: ['a.jpg'],
      recordId: 'post-retry-1',
    });
    updateRecord.mockResolvedValueOnce({ ok: false, reason: 'server', error: '공개 실패' });
    open();
    await userEvent.click(screen.getByRole('button', { name: '게시물 만들기' }));
    await userEvent.click(screen.getAllByTestId('post-source-photo')[0]);
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    await userEvent.type(screen.getByTestId('post-caption'), '한 번만 저장할 글');
    await userEvent.click(screen.getByTestId('post-share'));

    await waitFor(() => expect(toastWarning).toHaveBeenCalled());
    expect(screen.getByTestId('post-share').textContent).toContain('사진 다시 올리기');
    await userEvent.click(screen.getByTestId('post-share'));

    await waitFor(() => expect(updateRecordMedia).toHaveBeenCalledWith('post-retry-1', {
      addFiles: expect.any(Array),
      allOrNothing: true,
    }));
    expect(updateRecord).toHaveBeenCalledWith('post-retry-1', {
      isPrivate: false,
      isProfilePost: true,
    });

    // publication 실패 후 retry state가 publication 단계로 보존되어 있어야 함
    const stored = JSON.parse(localStorage.getItem('gomsinlog.post-retry.v1:user-me') || 'null');
    expect(stored).toEqual({
      recordId: 'post-retry-1',
      coupleId: 'couple-1',
      desiredPrivate: false,
      phase: 'publication',
    });

    // updateRecordMedia가 다시 불리지 않고 updateRecord만 재호출되어 완료됨
    updateRecord.mockResolvedValueOnce({ ok: true });
    await userEvent.click(screen.getByTestId('post-share'));

    await waitFor(() => expect(updateRecord).toHaveBeenCalledTimes(2));
    expect(updateRecordMedia).toHaveBeenCalledTimes(1);
    expect(addRecordWithMedia).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId('post-composer')).toBeNull());
    expect(localStorage.getItem('gomsinlog.post-retry.v1:user-me')).toBeNull();
  });

  it('새로고침 뒤 publication retry 상태를 복구해 사진 재선택 없이 공개만 재시도한다', async () => {
    localStorage.setItem('gomsinlog.post-retry.v1:user-me', JSON.stringify({
      recordId: 'post-pub-1',
      coupleId: 'couple-1',
      desiredPrivate: false,
      phase: 'publication',
    }));
    storeState.records = [
      record({
        id: 'post-pub-1',
        log: '이미 사진이 올라간 글',
        isPrivate: true,
        attachments: [{ type: 'photo', name: 'uploaded.jpg', path: 'couple-1/post-pub-1/uploaded.jpg' }],
      } as Partial<DailyRecord> & { id: string }),
    ];

    open();
    const resume = await screen.findByRole('button', { name: '게시물 다시 올리기' });
    await userEvent.click(resume);

    // 사진 선택 없이 글 쓰기(caption) 단계로 바로 열림
    expect(screen.getByTestId('post-composer').textContent).toContain('글 쓰기');
    expect(screen.getByText(/사진은 이미 저장했어요/)).toBeTruthy();
    expect(screen.getByTestId('post-share').textContent).toContain('게시물 다시 올리기');

    await userEvent.click(screen.getByTestId('post-share'));

    await waitFor(() => expect(updateRecord).toHaveBeenCalledWith('post-pub-1', {
      isPrivate: false,
      isProfilePost: true,
    }));
    expect(updateRecordMedia).not.toHaveBeenCalled();
    expect(addRecordWithMedia).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId('post-composer')).toBeNull());
    expect(localStorage.getItem('gomsinlog.post-retry.v1:user-me')).toBeNull();
  });

  it('phase 없는 구버전 저장 항목은 하위 호환성을 위해 media 단계로 취급한다', async () => {
    localStorage.setItem('gomsinlog.post-retry.v1:user-me', JSON.stringify({
      recordId: 'post-legacy-1',
      coupleId: 'couple-1',
      desiredPrivate: false,
    }));
    storeState.records = [
      record({
        id: 'r1',
        attachments: [{ type: 'photo', name: 'a.jpg', path: 'couple-1/r1/a.jpg' }],
      } as Partial<DailyRecord> & { id: string }),
      record({
        id: 'post-legacy-1',
        log: '구버전 재시도 글',
        isPrivate: true,
      } as Partial<DailyRecord> & { id: string }),
    ];

    open();
    const resume = await screen.findByRole('button', { name: '게시물 사진 이어서 올리기' });
    await userEvent.click(resume);
    await userEvent.click(screen.getAllByTestId('post-source-photo')[0]);
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(screen.getByTestId('post-share').textContent).toContain('사진 다시 올리기');
    await userEvent.click(screen.getByTestId('post-share'));

    await waitFor(() => expect(updateRecordMedia).toHaveBeenCalledWith('post-legacy-1', {
      addFiles: expect.any(Array),
      allOrNothing: true,
    }));
    expect(updateRecord).toHaveBeenCalledWith('post-legacy-1', {
      isPrivate: false,
      isProfilePost: true,
    });
    await waitFor(() => expect(localStorage.getItem('gomsinlog.post-retry.v1:user-me')).toBeNull());
  });

  it('publication retry 중 닫기를 누르면 원격 상태를 증명할 수 없어 삭제하지 않고 retry metadata를 보존한다', async () => {
    localStorage.setItem('gomsinlog.post-retry.v1:user-me', JSON.stringify({
      recordId: 'post-pub-1',
      coupleId: 'couple-1',
      desiredPrivate: false,
      phase: 'publication',
    }));
    storeState.records = [
      record({
        id: 'post-pub-1',
        log: '이미 사진이 올라간 글',
        isPrivate: true,
        attachments: [{ type: 'photo', name: 'uploaded.jpg', path: 'couple-1/post-pub-1/uploaded.jpg' }],
      } as Partial<DailyRecord> & { id: string }),
    ];

    open();
    const resume = await screen.findByRole('button', { name: '게시물 다시 올리기' });
    await userEvent.click(resume);
    expect(screen.getByTestId('post-composer')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: '게시물 만들기 닫기' }));

    await waitFor(() => expect(deleteRecord).not.toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId('post-composer')).toBeNull());
    expect(localStorage.getItem('gomsinlog.post-retry.v1:user-me')).toEqual(JSON.stringify({
      recordId: 'post-pub-1',
      coupleId: 'couple-1',
      desiredPrivate: false,
      phase: 'publication',
    }));
  });
});

describe('작성 중 초안은 리렌더에도 살아남는다', () => {
  /**
   * 실기기에서 관찰한 결함의 회귀 테스트.
   *
   * 초안 상태가 시트 안에 있으면 부모 리렌더로 시트가 리마운트될 때 고른 사진과 쓰던 글이
   * 사라지고, 언마운트 cleanup 이 `revokeObjectURL` 을 호출해 아직 올리지 않은 파일의
   * 미리보기까지 죽었다. 증상은 "공유를 눌렀는데 글이 placeholder 로 돌아가고 아무것도
   * 저장되지 않는다" 였다. 그래서 초안은 부모가 소유한다.
   */
  it('스토어가 갱신돼 다시 렌더돼도 담은 사진과 쓴 글이 유지된다', async () => {
    storeState.records = [record({
      id: 'r1', attachments: [{ type: 'photo', name: 'a.jpg', path: 'couple-1/r1/a.jpg' }],
    } as Partial<DailyRecord> & { id: string })];
    const view = open();
    await userEvent.click(screen.getByRole('button', { name: '게시물 만들기' }));
    await userEvent.click(screen.getAllByTestId('post-source-photo')[0]);
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    await userEvent.type(screen.getByTestId('post-caption'), '살아남아야 하는 글');

    // 스토어 갱신을 모사한 재렌더. 초안이 시트 안에 있으면 여기서 전부 사라졌다.
    storeState = { ...storeState, records: [...storeState.records] } as AppState;
    view.rerender(<MemoryRouter><PaperProfile /></MemoryRouter>);

    expect((screen.getByTestId('post-caption') as HTMLTextAreaElement).value)
      .toBe('살아남아야 하는 글');
    // 담은 사진도 그대로 있으므로 공유가 가능한 상태여야 한다.
    expect(screen.getByTestId('post-share')).toBeTruthy();
  });

  it('배경을 눌러도 작성 중 초안이 사라지지 않는다', async () => {
    /*
      실기기에서 관찰한 결함의 회귀 테스트.

      단계마다 시트 높이가 달라지므로(순서 정하기는 사진 수만큼 길고 글 쓰기는 짧다) 같은
      자리를 눌렀는데 앞 단계에서는 시트 안, 뒤 단계에서는 배경이 된다. 그 한 번의 탭으로
      고른 사진과 쓰던 글이 전부 사라졌고, 사용자에게는 "공유를 눌렀는데 저장이 안 된다"로
      보였다. 버리는 문은 ✕ 하나여야 한다.
    */
    storeState.records = [record({
      id: 'r1', attachments: [{ type: 'photo', name: 'a.jpg', path: 'couple-1/r1/a.jpg' }],
    } as Partial<DailyRecord> & { id: string })];
    open();
    await userEvent.click(screen.getByRole('button', { name: '게시물 만들기' }));
    await userEvent.click(screen.getAllByTestId('post-source-photo')[0]);
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    await userEvent.type(screen.getByTestId('post-caption'), '배경을 눌러도 남아야 한다');

    // 시트 밖 배경(dialog 의 부모)을 누른다.
    const backdrop = screen.getByTestId('post-composer').parentElement!;
    await userEvent.click(backdrop);

    // 시트가 그대로 열려 있고 글도 남아 있어야 한다.
    expect(screen.getByTestId('post-composer')).toBeTruthy();
    expect((screen.getByTestId('post-caption') as HTMLTextAreaElement).value)
      .toBe('배경을 눌러도 남아야 한다');
  });

  it('닫으면 초안이 비워져 다음에 열 때 빈 상태로 시작한다', async () => {
    storeState.records = [
      record({ id: 'r1', attachments: [{ type: 'photo', name: 'a.jpg', path: 'couple-1/r1/a.jpg' }] } as Partial<DailyRecord> & { id: string }),
      record({ id: 'r2', attachments: [{ type: 'photo', name: 'b.jpg', path: 'couple-1/r2/b.jpg' }] } as Partial<DailyRecord> & { id: string }),
    ];
    open();
    await userEvent.click(screen.getByRole('button', { name: '게시물 만들기' }));
    await userEvent.click(screen.getAllByTestId('post-source-photo')[0]);
    await userEvent.click(screen.getAllByTestId('post-source-photo')[1]);
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(screen.getByText('대표 사진')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: '이전 단계' }));
    await userEvent.click(screen.getByRole('button', { name: '게시물 만들기 닫기' }));

    await userEvent.click(screen.getByRole('button', { name: '게시물 만들기' }));
    // 담은 것이 없으므로 순서 단계로 갈 "다음" 버튼이 없다.
    expect(screen.queryByRole('button', { name: '다음' })).toBeNull();
  });
});

describe('프라이버시 경계', () => {
  it('비공개 기록의 사진은 고를 수 없다', async () => {
    storeState.records = [
      record({ id: 'shared', attachments: [{ type: 'photo', name: 'a.jpg', path: 'couple-1/shared/a.jpg' }] } as Partial<DailyRecord> & { id: string }),
      record({ id: 'secret', isPrivate: true, attachments: [{ type: 'photo', name: 's.jpg', path: 'couple-1/secret/s.jpg' }] } as Partial<DailyRecord> & { id: string }),
    ];
    open();
    await userEvent.click(screen.getByRole('button', { name: '게시물 만들기' }));
    // 공유 사진 하나만 고를 수 있다.
    expect(screen.getAllByTestId('post-source-photo')).toHaveLength(1);
  });

  it('연결 전에는 공개 범위를 고를 수 없고 비공개로 저장된다고 알린다', async () => {
    storeState.profile.couple.connected = false;
    storeState.records = [record({
      id: 'r1', attachments: [{ type: 'photo', name: 'a.jpg', path: 'couple-1/r1/a.jpg' }],
    } as Partial<DailyRecord> & { id: string })];
    open();
    await userEvent.click(screen.getByRole('button', { name: '게시물 만들기' }));
    await userEvent.click(screen.getAllByTestId('post-source-photo')[0]);
    await userEvent.click(screen.getByRole('button', { name: '다음' }));
    expect(screen.queryByRole('switch', { name: /나만 보기/ })).toBeNull();
    expect(screen.getByText(/나만 볼 수 있게 저장돼요/)).toBeTruthy();
  });
});
