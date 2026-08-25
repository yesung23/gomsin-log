import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
        couple: { connected: true, status: coupleStatus, coupleId: 'c1', partnerName: '춘향' },
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
  __setOnDeviceSummaryPluginForTests(null);
  vi.unstubAllEnvs();
});

describe('기본값(기능 OFF)에서는 규칙 결과 그대로다', () => {
  it('플러그인을 부르지 않고 규칙 문장을 그린다', async () => {
    const plugin = stubPlugin();
    __setOnDeviceSummaryPluginForTests(plugin);
    surface = twoToday();
    records = surface;

    open('/story/partner');
    expect(screen.getByRole('button', { name: /오늘 시험 끝났어/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /점심 먹었어/ })).toBeTruthy();
    await waitFor(() => expect(plugin.availability).not.toHaveBeenCalled());
    expect(plugin.refineLines).not.toHaveBeenCalled();
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
    await waitFor(() => expect(plugin.refineLines).toHaveBeenCalled());
    // 원문은 모델 출력으로 바뀌지 않는다.
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
    await waitFor(() => expect(plugin.refineLines).toHaveBeenCalled());
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
    await waitFor(() => expect(plugin.refineLines).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /오늘 시험 끝났어/ })).toBeTruthy();
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
    expect(screen.getByRole('dialog', { name: '춘향의 놓친 하루' })).toBeTruthy();
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
    await waitFor(() => expect(screen.getByRole('button', { name: /점심 먹었어/ })).toBeTruthy());
  });
});
