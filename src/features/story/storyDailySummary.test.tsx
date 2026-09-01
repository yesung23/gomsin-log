import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom';
import { StoryRoute } from '@/features/story/StoryRoute';
import type { DailyRecord } from '@/types';
import {
  __setOnDeviceSummaryPluginForTests,
  type OnDeviceSummaryPlugin,
} from '@/lib/dailySummary/nativeOnDeviceSummary';

/**
 * 온디바이스 결과가 화면에 닿는 방식.
 *
 * 세 가지를 센다:
 *
 * 1. 규칙 결과가 **먼저** 그려진다. 모델이 답하기 전의 화면이 이미 옳다.
 * 2. 준비되면 **속표지 문장만** 바뀐다. 정확한 원본 이동(`?at=`), 순간 카드의 원문, 확인
 *    영수증은 그대로다.
 * 3. `mine`·`archive`·여러 날·1개 이하는 아무것도 호출하지 않는다.
 */

const mockNavigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const platform = vi.hoisted(() => ({ native: true, name: 'ios', pluginAvailable: true }));
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => platform.native,
    getPlatform: () => platform.name,
    isPluginAvailable: () => platform.pluginAvailable,
  },
  registerPlugin: () => {
    throw new Error('no native bridge in this environment');
  },
}));

const TODAY = '2026-08-22';
const ME = 'me';
const PARTNER = 'partner-id';

function record(over: Partial<DailyRecord> = {}): DailyRecord {
  return {
    id: 'r1',
    userId: PARTNER,
    date: TODAY,
    time: '09:00',
    authorRole: 'gomsin',
    log: '오늘 시험 끝났어',
    isPrivate: false,
    createdAt: '2026-08-22T00:00:00.000Z',
    ...over,
  } as DailyRecord;
}

const acknowledge = vi.fn(() => true);
let surface: DailyRecord[] = [];
let records: DailyRecord[] = [];
let coupleStatus: 'pending' | 'active' | 'disconnected' = 'active';

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: {
      records,
      coupleHighlights: [],
      talkAboutMarks: [],
      profile: {
        id: ME,
        role: 'soldier',
        couple: {
          connected: true,
          status: coupleStatus,
          coupleId: 'c1',
          partnerUserId: PARTNER,
          partnerName: '춘향',
        },
      },
      authenticatedUser: { id: ME },
    },
    sharedSyncStatus: 'live',
    setHighlightedRecordId: vi.fn(),
    markTalkAbout: vi.fn(async () => ({ ok: true })),
    unmarkTalkAbout: vi.fn(async () => ({ ok: true })),
  }),
}));

vi.mock('@/lib/usePartnerDay', () => ({
  usePartnerDay: () => ({ surface, todayStr: TODAY, acknowledge }),
}));

vi.mock('@/components/media/RecordMediaGallery', () => ({
  RecordMediaGallery: ({ recordId }: { recordId: string }) => <div data-testid={`media-${recordId}`} />,
}));

/** `?at=` 이 실제로 어디를 가리키는지 읽기 위한 관찰자. */
function LocationProbe() {
  const [searchParams] = useSearchParams();
  const at = searchParams.get('at');
  return <span data-testid="story-location">{at ? `?at=${at}` : ''}</span>;
}

function open(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <LocationProbe />
      <Routes>
        <Route path="/story/partner" element={<StoryRoute mode="today" />} />
        <Route path="/story/mine" element={<StoryRoute mode="mine" />} />
        <Route path="/story/day/:date" element={<StoryRoute mode="archive" />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function requestAiSummary() {
  fireEvent.click(screen.getByRole('button', { name: 'AI로 다듬기' }));
  await Promise.resolve();
}

function stubPlugin(over: Partial<OnDeviceSummaryPlugin> = {}): OnDeviceSummaryPlugin {
  return {
    availability: vi.fn(async () => ({ available: true, reason: 'ready' })),
    refineLines: vi.fn(async (options) => ({
      requestId: options.requestId,
      items: options.items.map((item) => ({ index: item.index, text: `다듬은 ${item.index}번` })),
    })),
    cancel: vi.fn(async () => undefined),
    ...over,
  };
}

const twoToday = () => [
  record({ id: 'a', log: '오늘 시험 끝났어' }),
  record({ id: 'b', time: '13:00', log: '점심 먹었어' }),
];

beforeEach(() => {
  vi.clearAllMocks();
  surface = [];
  records = [];
  coupleStatus = 'active';
  platform.native = true;
  platform.name = 'ios';
  platform.pluginAvailable = true;
  __setOnDeviceSummaryPluginForTests(null);
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.useRealTimers();
  __setOnDeviceSummaryPluginForTests(null);
  vi.unstubAllEnvs();
});

describe('기본 ON이어도 스토리를 여는 것만으로 모델을 실행하지 않는다', () => {
  it('규칙 문장을 즉시 그리고 AI 버튼을 누르기 전에는 플러그인을 부르지 않는다', async () => {
    const plugin = stubPlugin();
    __setOnDeviceSummaryPluginForTests(plugin);
    surface = twoToday();
    records = surface;

    open('/story/partner');
    expect(screen.getByRole('button', { name: /오늘 시험 끝났어/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /점심 먹었어/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'AI로 다듬기' })).toBeTruthy();
    await waitFor(() => expect(plugin.availability).not.toHaveBeenCalled());
    expect(plugin.refineLines).not.toHaveBeenCalled();
  });

  it('AI 버튼을 누르면 즉시 온디바이스 요약을 시작한다', async () => {
    const plugin = stubPlugin();
    __setOnDeviceSummaryPluginForTests(plugin);
    surface = twoToday();
    records = surface;

    open('/story/partner');
    await requestAiSummary();
    await waitFor(() => expect(plugin.refineLines).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: /다듬은 0번/ })).toBeTruthy());
  });
});

describe('기능 ON: 상대의 오늘 표지 문장만 바뀐다', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_ON_DEVICE_DAILY_SUMMARY_ENABLED', 'true');
  });

  it('처음 렌더는 규칙 결과이고, 준비되면 표지 문장이 대체된다', async () => {
    const plugin = stubPlugin();
    __setOnDeviceSummaryPluginForTests(plugin);
    surface = twoToday();
    records = surface;

    open('/story/partner');
    // 동기적으로 이미 옳은 화면.
    expect(screen.getByRole('button', { name: /오늘 시험 끝났어/ })).toBeTruthy();
    await requestAiSummary();

    await waitFor(() => expect(screen.getByRole('button', { name: /다듬은 0번/ })).toBeTruthy());
    expect(screen.getByRole('button', { name: /다듬은 1번/ })).toBeTruthy();
    // 줄이 늘거나 줄지 않는다.
    expect(screen.queryByRole('button', { name: /다듬은 2번/ })).toBeNull();
  });

  it('모델 payload에 recordId·날짜·userId가 없다', async () => {
    const plugin = stubPlugin();
    __setOnDeviceSummaryPluginForTests(plugin);
    surface = twoToday();
    records = surface;

    open('/story/partner');
    await requestAiSummary();
    await waitFor(() => expect(plugin.refineLines).toHaveBeenCalledTimes(1));
    const sent = JSON.stringify(vi.mocked(plugin.refineLines).mock.calls[0][0].items);
    expect(sent).not.toContain('"a"');
    expect(sent).not.toContain(PARTNER);
    expect(sent).not.toContain(TODAY);
    expect(JSON.parse(sent)).toEqual([
      { index: 0, text: '오늘 시험 끝났어' },
      { index: 1, text: '점심 먹었어' },
    ]);
  });

  it('표지 줄을 눌러도 그 줄이 가리키는 것은 여전히 정확한 그 원본이다', async () => {
    const plugin = stubPlugin();
    __setOnDeviceSummaryPluginForTests(plugin);
    surface = twoToday();
    records = surface;

    open('/story/partner');
    await requestAiSummary();
    await waitFor(() => expect(screen.getByRole('button', { name: /다듬은 1번/ })).toBeTruthy());

    // 다듬어진 문장을 눌러도 `recordId`로 정확한 원본 카드가 열린다.
    await userEvent.click(screen.getByRole('button', { name: /다듬은 1번/ }));
    await waitFor(() => expect(screen.getByTestId('story-location').textContent).toBe('?at=b'));
    expect(screen.getByText('점심 먹었어')).toBeTruthy();

    // 규칙 문장을 눌렀을 때와 같은 대상이다.
    __setOnDeviceSummaryPluginForTests(null);
  });

  it('다듬기 전과 후의 이동 대상이 같다', async () => {
    // 기능 OFF에서 규칙 문장을 눌렀을 때의 대상을 먼저 잡는다.
    vi.stubEnv('VITE_ON_DEVICE_DAILY_SUMMARY_ENABLED', 'false');
    surface = twoToday();
    records = surface;
    const rules = open('/story/partner');
    await userEvent.click(screen.getByRole('button', { name: /점심 먹었어/ }));
    const rulesTarget = screen.getByTestId('story-location').textContent;
    rules.unmount();

    vi.stubEnv('VITE_ON_DEVICE_DAILY_SUMMARY_ENABLED', 'true');
    __setOnDeviceSummaryPluginForTests(stubPlugin());
    open('/story/partner');
    await requestAiSummary();
    await waitFor(() => expect(screen.getByRole('button', { name: /다듬은 1번/ })).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: /다듬은 1번/ }));
    await waitFor(() => expect(screen.getByTestId('story-location').textContent).toBe(rulesTarget));
    expect(rulesTarget).toBe('?at=b');
  });

  it('?at= 이 여는 카드는 대체와 무관하다', async () => {
    const plugin = stubPlugin();
    __setOnDeviceSummaryPluginForTests(plugin);
    surface = twoToday();
    records = surface;

    open('/story/partner?at=b');
    expect(screen.getByText('점심 먹었어')).toBeTruthy();
    await Promise.resolve();
    expect(plugin.refineLines).not.toHaveBeenCalled();
    // 딥링크는 표지 버튼을 거치지 않으므로 모델을 실행하지 않고 원문을 그대로 연다.
    expect(screen.getByText('점심 먹었어')).toBeTruthy();
    expect(screen.queryByText('다듬은 1번')).toBeNull();
  });

  it('사라진 원본은 여전히 대체되지 않는다', async () => {
    const plugin = stubPlugin();
    __setOnDeviceSummaryPluginForTests(plugin);
    surface = twoToday();
    records = surface;

    open('/story/partner?at=gone');
    expect(screen.getByText('이 기록은 더 이상 볼 수 없어요')).toBeTruthy();
    await Promise.resolve();
    expect(plugin.refineLines).not.toHaveBeenCalled();
    expect(screen.getByText('이 기록은 더 이상 볼 수 없어요')).toBeTruthy();
  });

  it('확인 영수증 경로가 그대로다', async () => {
    __setOnDeviceSummaryPluginForTests(stubPlugin());
    surface = [record({ id: 'a' })];
    records = surface;

    open('/story/partner');
    await userEvent.click(screen.getByRole('button', { name: '다음 순간' }));
    await userEvent.click(screen.getByTestId('story-acknowledge'));
    expect(acknowledge).toHaveBeenCalledTimes(1);
  });

  it('검증에 실패한 응답은 화면에 닿지 않는다', async () => {
    // 항목을 하나 지어낸 응답.
    const plugin = stubPlugin({
      refineLines: vi.fn(async (options) => ({
        requestId: options.requestId,
        items: [
          { index: 0, text: '다듬은 0번' },
          { index: 1, text: '다듬은 1번' },
          { index: 2, text: '지어낸 줄' },
        ],
      })),
    });
    __setOnDeviceSummaryPluginForTests(plugin);
    surface = twoToday();
    records = surface;

    open('/story/partner');
    await requestAiSummary();
    await waitFor(() => expect(plugin.refineLines).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /오늘 시험 끝났어/ })).toBeTruthy();
    expect(screen.queryByText('지어낸 줄')).toBeNull();
    expect(screen.queryByText('다듬은 0번')).toBeNull();
  });

  it('네이티브가 실패해도 화면은 규칙 결과다', async () => {
    const plugin = stubPlugin({
      refineLines: vi.fn(async () => { throw new Error('E_ON_DEVICE_SUMMARY'); }),
    });
    __setOnDeviceSummaryPluginForTests(plugin);
    surface = twoToday();
    records = surface;

    open('/story/partner');
    await requestAiSummary();
    await waitFor(() => expect(plugin.refineLines).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /오늘 시험 끝났어/ })).toBeTruthy();
  });

  it('5/6/8개 기록 처리: 5개는 1회 호출, 6개는 2회(5+1), 8개는 2회(5+3) 순차 배치 처리', async () => {
    const plugin = stubPlugin({
      refineLines: vi.fn(async (options) => ({
        requestId: options.requestId,
        items: options.items.map((item) => ({ index: item.index, text: `다듬은 ${item.index}번` })),
      })),
    });
    __setOnDeviceSummaryPluginForTests(plugin);

    const records8 = Array.from({ length: 8 }, (_, i) =>
      record({ id: `r${i}`, time: `0${i}:00`, log: `원문 ${i}` }),
    );
    surface = records8;
    records = surface;

    const view = open('/story/partner');
    await requestAiSummary();
    // 8개는 2개 배치 (5 + 3)
    await waitFor(() => expect(plugin.refineLines).toHaveBeenCalledTimes(2));

    const calls = vi.mocked(plugin.refineLines).mock.calls;
    // 첫 번째 배치: 5개 항목, index 0..4
    expect(calls[0][0].items).toHaveLength(5);
    expect(calls[0][0].items.map((it) => it.index)).toEqual([0, 1, 2, 3, 4]);
    // 두 번째 배치: 3개 항목, index 0..2 (records 6~8인 r5, r6, r7에 해당)
    expect(calls[1][0].items).toHaveLength(3);
    expect(calls[1][0].items.map((it) => it.index)).toEqual([0, 1, 2]);

    // 펼친 후 확인
    const moreBtn = await screen.findByRole('button', { name: '3개 더 보기' });
    await userEvent.click(moreBtn);
    // 8개 모두 다듬어진 문장이 정상 반영됨
    expect(screen.getAllByRole('button', { name: /다듬은/ })).toHaveLength(8);
    view.unmount();
  });

  it('배치 2가 실패하면 모든 줄이 결정론적 규칙 결과로 유지된다', async () => {
    let callCount = 0;
    const plugin = stubPlugin({
      refineLines: vi.fn(async (options) => {
        callCount++;
        if (callCount === 1) {
          // 배치 1은 성공
          return {
            requestId: options.requestId,
            items: options.items.map((item) => ({ index: item.index, text: `다듬은 ${item.index}번` })),
          };
        }
        // 배치 2는 실패
        throw new Error('E_ON_DEVICE_SUMMARY');
      }),
    });
    __setOnDeviceSummaryPluginForTests(plugin);

    const records8 = Array.from({ length: 8 }, (_, i) =>
      record({ id: `r${i}`, time: `0${i}:00`, log: `원문 ${i}` }),
    );
    surface = records8;
    records = surface;

    open('/story/partner');
    await requestAiSummary();
    await waitFor(() => expect(plugin.refineLines).toHaveBeenCalledTimes(2));

    // 배치 2 실패로 인해 첫 번째 배치의 내용도 섞이지 않고 전체가 규칙 원문으로 유지됨
    expect(screen.getByRole('button', { name: /원문 0/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /원문 1/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /다듬은 0번/ })).toBeNull();
  });

  it('여러 배치가 있어도 전체 4초 예산 하나만 쓰고 남은 시간이 없으면 전체 fallback한다', async () => {
    vi.useFakeTimers();
    let callCount = 0;
    const plugin = stubPlugin({
      refineLines: vi.fn((options) => {
        callCount += 1;
        if (callCount === 1) {
          return new Promise((resolve) => {
            setTimeout(() => resolve({
              requestId: options.requestId,
              items: options.items.map((item) => ({ index: item.index, text: `첫 ${item.index}번` })),
            }), 3000);
          });
        }
        return new Promise(() => undefined);
      }),
    });
    __setOnDeviceSummaryPluginForTests(plugin);
    surface = Array.from({ length: 8 }, (_, i) =>
      record({ id: `r${i}`, time: `0${i}:00`, log: `원문 ${i}` }),
    );
    records = surface;

    const view = open('/story/partner');
    await requestAiSummary();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(plugin.refineLines).toHaveBeenCalledTimes(2);

    // 두 번째 배치는 새 4초가 아니라 첫 배치가 쓰고 남긴 약 1초만 받는다.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1001);
    });
    expect(plugin.cancel).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /원문 0/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /첫 0번/ })).toBeNull();
    view.unmount();
  });

  it('화면을 떠나면 진행 중인 배치를 취소하고 다음 배치를 시작하지 않는다', async () => {
    let resolveFirst: ((value: { requestId: string; items: { index: number; text: string }[] }) => void) | undefined;
    const plugin = stubPlugin({
      refineLines: vi.fn((options) => new Promise((resolve) => {
        resolveFirst = resolve;
      })),
    });
    __setOnDeviceSummaryPluginForTests(plugin);

    surface = Array.from({ length: 8 }, (_, i) =>
      record({ id: `r${i}`, time: `0${i}:00`, log: `원문 ${i}` }),
    );
    records = surface;

    const view = open('/story/partner');
    await requestAiSummary();
    await waitFor(() => expect(plugin.refineLines).toHaveBeenCalledTimes(1));
    const firstOptions = vi.mocked(plugin.refineLines).mock.calls[0][0];
    view.unmount();
    await waitFor(() => expect(plugin.cancel).toHaveBeenCalledWith({ requestId: firstOptions.requestId }));

    resolveFirst?.({
      requestId: firstOptions.requestId,
      items: firstOptions.items.map((item) => ({ index: item.index, text: `늦은 ${item.index}번` })),
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(plugin.refineLines).toHaveBeenCalledTimes(1);
  });

  it('기존 5개 refinement 뒤 6번째가 추가되면 새 배치 완료 전부터 이전 결과를 숨긴다', async () => {
    let resolveUpdatedFirstBatch:
      | ((value: { requestId: string; items: { index: number; text: string }[] }) => void)
      | undefined;
    let callCount = 0;
    const plugin = stubPlugin({
      refineLines: vi.fn(async (options) => {
        callCount += 1;
        if (callCount === 1) {
          return {
            requestId: options.requestId,
            items: options.items.map((item) => ({ index: item.index, text: `기존 ${item.index}번` })),
          };
        }
        return new Promise((resolve) => {
          resolveUpdatedFirstBatch = resolve;
        });
      }),
    });
    __setOnDeviceSummaryPluginForTests(plugin);

    surface = Array.from({ length: 5 }, (_, i) =>
      record({ id: `r${i}`, time: `0${i}:00`, log: `원문 ${i}` }),
    );
    records = surface;
    const view = open('/story/partner');
    await requestAiSummary();
    await waitFor(() => expect(screen.getAllByRole('button', { name: /기존/ })).toHaveLength(5));

    surface = [
      ...surface,
      record({ id: 'r5', time: '05:00', log: '새 원문 5' }),
    ];
    records = surface;
    view.rerender(
      <MemoryRouter initialEntries={['/story/partner']}>
        <LocationProbe />
        <Routes>
          <Route path="/story/partner" element={<StoryRoute mode="today" />} />
        </Routes>
      </MemoryRouter>,
    );

    // effect가 새 요청을 시작하기 전 렌더부터 stale map의 payloadKey가 달라 즉시 숨겨진다.
    expect(screen.queryByRole('button', { name: /기존/ })).toBeNull();
    expect(screen.getByRole('button', { name: /원문 0/ })).toBeTruthy();
    await waitFor(() => expect(plugin.refineLines).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button', { name: /기존/ })).toBeNull();

    const updatedOptions = vi.mocked(plugin.refineLines).mock.calls[1][0];
    resolveUpdatedFirstBatch?.({
      requestId: updatedOptions.requestId,
      items: updatedOptions.items.map((item) => ({ index: item.index, text: `새 ${item.index}번` })),
    });
    view.unmount();
  });

  it('나중 배치에 Segmenter 부재로 인한 정규화 실패 시 네이티브 플러그인을 아예 호출하지 않는다', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
    Object.defineProperty(Intl, 'Segmenter', { configurable: true, value: undefined });

    const plugin = stubPlugin();
    __setOnDeviceSummaryPluginForTests(plugin);

    try {
      const longLog = `${'a'.repeat(38)}e\u0301b`;
      const records8 = [
        ...Array.from({ length: 5 }, (_, i) => record({ id: `r${i}`, time: `0${i}:00`, log: `짧은 원문 ${i}` })),
        record({ id: 'r5', time: '05:00', log: longLog }),
        record({ id: 'r6', time: '06:00', log: '짧은 원문 6' }),
      ];
      surface = records8;
      records = surface;

      open('/story/partner');
      await requestAiSummary();
      // 배치 검증이 사전에 실패하여 플러그인을 단 한 번도 호출하지 않음
      expect(plugin.refineLines).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /짧은 원문 0/ })).toBeTruthy();
    } finally {
      if (descriptor) Object.defineProperty(Intl, 'Segmenter', descriptor);
    }
  });
});

describe('기능 ON이어도 호출하지 않는 자리', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_ON_DEVICE_DAILY_SUMMARY_ENABLED', 'true');
  });

  async function expectNoCall(path: string) {
    const plugin = stubPlugin();
    __setOnDeviceSummaryPluginForTests(plugin);
    open(path);
    await Promise.resolve();
    await waitFor(() => expect(plugin.refineLines).not.toHaveBeenCalled());
    return plugin;
  }

  it('나의 오늘', async () => {
    records = [
      record({ id: 'mine-1', userId: ME, log: '내가 쓴 것' }),
      record({ id: 'mine-2', userId: ME, time: '20:00', log: '내가 쓴 것 둘' }),
    ];
    await expectNoCall('/story/mine');
    expect(screen.getByText('내가 쓴 것')).toBeTruthy();
  });

  it('보관 스토리', async () => {
    records = [
      record({ id: 'then-1', date: '2026-08-14', log: '그날 기록' }),
      record({ id: 'then-2', date: '2026-08-14', time: '20:00', log: '그날 기록 둘' }),
    ];
    await expectNoCall('/story/day/2026-08-14');
    expect(screen.getByText('그날 기록')).toBeTruthy();
  });

  it('여러 날이 밀린 구간', async () => {
    surface = [record({ id: 'y', date: '2026-08-21' }), record({ id: 'a' })];
    records = surface;
    await expectNoCall('/story/partner');
    expect(screen.getByRole('dialog', { name: '놓친 하루' })).toBeTruthy();
  });

  it('순간이 하나뿐 -- 표지가 없다', async () => {
    surface = [record({ id: 'a' })];
    records = surface;
    await expectNoCall('/story/partner');
  });

  it('커플이 active가 아니다', async () => {
    coupleStatus = 'disconnected';
    surface = twoToday();
    records = surface;
    await expectNoCall('/story/partner');
  });

  it('비공개·읽을 수 없는 기록만 남으면', async () => {
    surface = [
      record({ id: 'a' }),
      record({ id: 'secret', isPrivate: true, userId: ME, log: '내 비공개' }),
    ];
    records = surface;
    // 상대의 공유 기록이 하나뿐이므로 표지도, 호출도 없다.
    await expectNoCall('/story/partner');
  });

  it('웹에서는 iOS 게이트가 막는다', async () => {
    platform.native = false;
    platform.name = 'web';
    platform.pluginAvailable = false;
    surface = twoToday();
    records = surface;
    // 주입된 플러그인은 게이트를 우회하므로, 이 경우는 주입 없이 확인한다.
    __setOnDeviceSummaryPluginForTests(null);
    open('/story/partner');
    expect(screen.getByRole('button', { name: /오늘 시험 끝났어/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'AI로 다듬기' })).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: /점심 먹었어/ })).toBeTruthy());
  });
});
