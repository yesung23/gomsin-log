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
let coupleConnected = true;
let partnerUserId: string | undefined = PARTNER;

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
          connected: coupleConnected,
          status: coupleStatus,
          coupleId: 'c1',
          partnerUserId,
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
  fireEvent.click(await screen.findByRole('button', { name: '기기 AI로 긴 문장 줄이기' }));
  await Promise.resolve();
}

function safeRefinedText(text: string): string {
  const normalized = text.normalize('NFC').trim();
  if (normalized.length <= 38) return normalized;

  // Production accepts an excerpt only when omitted context starts at a real
  // whitespace boundary. Keep the fake model response inside that same
  // contract instead of cutting a Korean word in half.
  const boundary = [...normalized.matchAll(/\s/gu)]
    .map((match) => match.index)
    .filter((index) => index >= 8 && index <= 38)
    .at(-1);
  return boundary === undefined ? normalized : normalized.slice(0, boundary);
}

function longBody(prefix: string): string {
  return `${prefix} 오늘 있었던 일을 빠뜨리지 않도록 차근차근 길게 적어 두었어 꼭`;
}

type WireItem = { index: number; text: string };

const CURRENT_VERIFICATION_FAILURES: readonly [string, (items: WireItem[]) => unknown][] = [
  ['not_an_array', () => ({})],
  ['count_mismatch', (items) => [items[0]]],
  ['malformed_item', (items) => [items[0], null]],
  ['index_not_integer', (items) => [items[0], { ...items[1], index: 1.5 }]],
  ['index_out_of_range', (items) => [items[0], { ...items[1], index: 2 }]],
  ['duplicate_index', (items) => [items[0], { ...items[1], index: 0 }]],
  ['reordered', (items) => [{ ...items[1], index: 1 }, { ...items[0], index: 0 }]],
  ['text_not_a_string', (items) => [items[0], { index: 1, text: 123 }]],
  ['empty_text', (items) => [items[0], { index: 1, text: '   ' }]],
  ['text_too_long', (items) => [items[0], { index: 1, text: '가'.repeat(41) }]],
  ['semantic_mismatch', (items) => [items[0], { index: 1, text: '원문에 없는 관계 해석' }]],
];

function stubPlugin(over: Partial<OnDeviceSummaryPlugin> = {}): OnDeviceSummaryPlugin {
  return {
    availability: vi.fn(async () => ({ available: true, reason: 'ready' })),
    refineLines: vi.fn(async (options) => ({
      requestId: options.requestId,
      items: options.items.map((item) => ({ index: item.index, text: safeRefinedText(item.text) })),
    })),
    cancel: vi.fn(async () => undefined),
    ...over,
  };
}

const twoToday = () => [
  record({ id: 'a', log: longBody('오늘 시험 끝났어') }),
  record({ id: 'b', time: '13:00', log: longBody('점심 먹었어') }),
];

beforeEach(() => {
  vi.clearAllMocks();
  surface = [];
  records = [];
  coupleStatus = 'active';
  coupleConnected = true;
  partnerUserId = PARTNER;
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

describe('기능을 명시적으로 켜도 스토리를 여는 것만으로 모델을 실행하지 않는다', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_ON_DEVICE_DAILY_SUMMARY_ENABLED', 'true');
  });

  it('본문 없는 availability preflight가 끝난 뒤에만 CTA를 열고 클릭 전 generation은 0회다', async () => {
    let resolvePreflight: ((value: { available: boolean; reason: string }) => void) | undefined;
    const plugin = stubPlugin({
      availability: vi.fn()
        .mockImplementationOnce(() => new Promise((resolve) => { resolvePreflight = resolve; }))
        .mockResolvedValue({ available: true, reason: 'ready' }),
    });
    __setOnDeviceSummaryPluginForTests(plugin);
    surface = twoToday();
    records = surface;

    open('/story/partner');
    expect(screen.getByRole('button', { name: /오늘 시험 끝났어/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /점심 먹었어/ })).toBeTruthy();
    await waitFor(() => expect(plugin.availability).toHaveBeenCalledTimes(1));
    expect(plugin.availability).toHaveBeenCalledWith({ locale: 'ko_KR' });
    expect(vi.mocked(plugin.availability).mock.calls[0][0]).toEqual({ locale: 'ko_KR' });
    expect(screen.queryByRole('button', { name: '기기 AI로 긴 문장 줄이기' })).toBeNull();
    expect(plugin.refineLines).not.toHaveBeenCalled();

    resolvePreflight?.({ available: true, reason: 'ready' });
    expect(await screen.findByRole('button', { name: '기기 AI로 긴 문장 줄이기' })).toBeTruthy();
    expect(plugin.refineLines).not.toHaveBeenCalled();
  });

  it('CTA를 누르면 긴 문장 한 배치만 온디바이스에서 시작한다', async () => {
    const plugin = stubPlugin();
    __setOnDeviceSummaryPluginForTests(plugin);
    surface = twoToday();
    records = surface;

    open('/story/partner');
    await requestAiSummary();
    await waitFor(() => expect(plugin.refineLines).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: '긴 문장 줄이기 완료' })).toBeDisabled());
  });
});

describe('모든 기기의 즉시 baseline', () => {
  it.each([
    ['flag OFF iOS', 'false', true, 'ios'],
    ['web', 'true', false, 'web'],
    ['Android', 'true', true, 'android'],
  ] as const)('%s에서도 50개를 시간순으로 모두 유지하고 AI 표기나 native call을 만들지 않는다', async (
    _case,
    flag,
    native,
    platformName,
  ) => {
    vi.stubEnv('VITE_ON_DEVICE_DAILY_SUMMARY_ENABLED', flag);
    platform.native = native;
    platform.name = platformName;
    platform.pluginAvailable = true;
    const plugin = stubPlugin();
    __setOnDeviceSummaryPluginForTests(plugin);
    surface = Array.from({ length: 50 }, (_, index) => record({
      id: `r${index}`,
      time: `08:${String(index).padStart(2, '0')}`,
      log: longBody(`기록 ${index}`),
    }));
    records = surface;

    open('/story/partner');

    expect(screen.getByText('오늘 기록 50개 · 시간순 정리됨')).toBeTruthy();
    expect(screen.getByText(/기록 0 /)).toBeTruthy();
    expect(screen.queryByText(/기록 5 /)).toBeNull();
    expect(screen.getByRole('button', { name: '45개 더 보기' })).toBeTruthy();
    expect(screen.queryByText(/AI/)).toBeNull();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(plugin.availability).not.toHaveBeenCalled();
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
    await requestAiSummary();

    await waitFor(() => expect(screen.getByRole('button', { name: '긴 문장 줄이기 완료' })).toBeDisabled());
    expect(screen.getByRole('button', { name: /오늘 시험 끝났어/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /점심 먹었어/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: '긴 문장 줄이기 완료' })).toBeDisabled();
    // 줄이 늘거나 줄지 않는다.
    expect(screen.queryByRole('button', { name: /사진을 남겼어요\./ })).toBeNull();
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
      { index: 0, text: longBody('오늘 시험 끝났어') },
      { index: 1, text: longBody('점심 먹었어') },
    ]);
  });

  it('표지 줄을 눌러도 그 줄이 가리키는 것은 여전히 정확한 그 원본이다', async () => {
    const plugin = stubPlugin();
    __setOnDeviceSummaryPluginForTests(plugin);
    surface = twoToday();
    records = surface;

    open('/story/partner');
    await requestAiSummary();
    await waitFor(() => expect(screen.getByRole('button', { name: '긴 문장 줄이기 완료' })).toBeDisabled());

    // 검증된 발췌를 눌러도 `recordId`로 정확한 원본 카드가 열린다.
    await userEvent.click(screen.getByRole('button', { name: /점심 먹었어/ }));
    await waitFor(() => expect(screen.getByTestId('story-location').textContent).toBe('?at=b'));
    expect(screen.getByText(longBody('점심 먹었어'))).toBeTruthy();

    // 규칙 문장을 눌렀을 때와 같은 대상이다.
    __setOnDeviceSummaryPluginForTests(null);
  });

  it('공유된 원문 본문에 health/location 사실은 포함하되 ID·시각·메타데이터는 보내지 않는다', async () => {
    const plugin = stubPlugin();
    __setOnDeviceSummaryPluginForTests(plugin);
    const sharedBody = '생리통이 있어 서울역 근처 약국에 들렀고 집에 와서 따뜻한 물을 마시며 쉬었어';
    surface = [record({
      id: 'health-location-record',
      log: sharedBody,
      time: '14:30',
      attachments: [{
        type: 'photo',
        name: 'IMG_0001.JPG',
        url: 'https://private.example/signed-photo',
        latitude: 37.5547,
        longitude: 126.9706,
        exifTakenAt: '2026-08-22T14:29:00.000Z',
      } as never],
      cycleStartDate: '2026-08-20',
      healthRecordId: 'health-row-secret',
    } as Partial<DailyRecord>)];
    surface.push(record({ id: 'second-record', time: '16:00', log: '저녁에 통화할게' }));
    records = surface;

    open('/story/partner');
    await requestAiSummary();
    await waitFor(() => expect(plugin.refineLines).toHaveBeenCalledTimes(1));
    const sent = JSON.stringify(vi.mocked(plugin.refineLines).mock.calls[0][0].items);
    expect(sent).toContain(sharedBody);
    for (const forbidden of [
      'health-location-record', 'second-record', PARTNER, TODAY, '14:30', '16:00',
      '37.5547', '126.9706', 'IMG_0001.JPG', 'signed-photo', 'cycleStartDate',
      'health-row-secret', 'latitude', 'longitude', 'exifTakenAt', 'http',
    ]) {
      expect(sent).not.toContain(forbidden);
    }
  });

  it('긴 문장 후보 6개를 [5, 1]로 처리하고 baseline 6줄과 원본 이동을 모두 보존한다', async () => {
    const plugin = stubPlugin();
    __setOnDeviceSummaryPluginForTests(plugin);
    surface = Array.from({ length: 6 }, (_, i) => record({
      id: `r${i}`,
      time: `0${i}:00`,
      log: longBody(`긴 기록 ${i}`),
    }));
    records = surface;

    open('/story/partner');
    expect(screen.getByText('오늘 기록 6개 · 시간순 정리됨')).toBeTruthy();
    await requestAiSummary();
    await waitFor(() => expect(plugin.refineLines).toHaveBeenCalledTimes(2));
    expect(vi.mocked(plugin.refineLines).mock.calls.map(([options]) => options.items.length))
      .toEqual([5, 1]);
    await userEvent.click(screen.getByRole('button', { name: '1개 더 보기' }));
    await userEvent.click(screen.getByText(/긴 기록 5 /));
    await waitFor(() => expect(screen.getByTestId('story-location')).toHaveTextContent('?at=r5'));
    expect(screen.getByText(longBody('긴 기록 5'))).toBeTruthy();
  });

  it('모든 본문이 40 UTF-16 단위 이하면 CTA와 native call이 없다', async () => {
    const plugin = stubPlugin();
    __setOnDeviceSummaryPluginForTests(plugin);
    surface = [
      record({ id: 'short-a', log: '짧은 첫 기록' }),
      record({ id: 'short-b', time: '13:00', log: '짧은 둘째 기록' }),
    ];
    records = surface;

    open('/story/partner');

    expect(screen.getByText('오늘 기록 2개 · 시간순 정리됨')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '기기 AI로 긴 문장 줄이기' })).toBeNull();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(plugin.availability).not.toHaveBeenCalled();
    expect(plugin.refineLines).not.toHaveBeenCalled();
  });

  it('첨부-only 항목은 사실 문구로 남고 CTA와 native call이 없다', async () => {
    const plugin = stubPlugin();
    __setOnDeviceSummaryPluginForTests(plugin);
    surface = [
      record({ id: 'body', log: '직접 쓴 본문' }),
      record({
        id: 'photo-only',
        time: '13:00',
        log: '',
        attachments: [{ type: 'photo', name: 'private.jpg', url: 'https://private.example/photo.jpg' }],
      }),
    ];
    records = surface;

    open('/story/partner');

    expect(screen.queryByRole('button', { name: '기기 AI로 긴 문장 줄이기' })).toBeNull();
    expect(screen.getByRole('button', { name: /사진을 남겼어요/ })).toBeTruthy();
    expect(plugin.availability).not.toHaveBeenCalled();
    expect(plugin.refineLines).not.toHaveBeenCalled();
  });

  it('혼합 목록에서는 긴 문장 1~5개만 한 배치로 보내고 exact local recordId를 유지한다', async () => {
    const plugin = stubPlugin({
      refineLines: vi.fn(async (options) => ({
        requestId: options.requestId,
        items: options.items.map((item) => ({ index: item.index, text: safeRefinedText(item.text) })),
      })),
    });
    __setOnDeviceSummaryPluginForTests(plugin);
    const longA = longBody('첫 번째 긴 기록');
    const longB = longBody('두 번째 긴 기록');
    surface = [
      record({ id: 'short-a', time: '08:00', log: '짧은 기록' }),
      record({ id: 'long-a', time: '09:00', log: longA }),
      record({
        id: 'photo-only',
        time: '10:00',
        log: '',
        attachments: [{ type: 'photo', name: 'private.jpg', url: 'https://private.example/photo.jpg' }],
      }),
      record({ id: 'long-b', time: '11:00', log: longB }),
      record({ id: 'short-b', time: '12:00', log: '또 짧은 기록' }),
    ];
    records = surface;

    open('/story/partner');
    await requestAiSummary();
    await waitFor(() => expect(plugin.refineLines).toHaveBeenCalledTimes(1));
    expect(vi.mocked(plugin.refineLines).mock.calls[0][0].items).toEqual([
      { index: 0, text: longA },
      { index: 1, text: longB },
    ]);
    expect(screen.getByText('짧은 기록')).toBeTruthy();
    expect(screen.getByText('사진을 남겼어요')).toBeTruthy();
    expect(screen.getByText('또 짧은 기록')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /두 번째 긴 기록/ }));
    await waitFor(() => expect(screen.getByTestId('story-location')).toHaveTextContent('?at=long-b'));
    expect(screen.getByText(longB)).toBeTruthy();
  });

  it('120자를 넘긴 원문은 모델이 앞부분을 그대로 돌려도 suffix ellipsis를 강제한다', async () => {
    const plugin = stubPlugin({
      refineLines: vi.fn(async (options) => ({
        requestId: options.requestId,
        items: options.items.map((item) => ({
          index: item.index,
          text: item.index === 0 ? `${'가 '.repeat(19)}가` : safeRefinedText(item.text),
        })),
      })),
    });
    __setOnDeviceSummaryPluginForTests(plugin);
    surface = [
      record({ id: 'long', log: '가 '.repeat(61) }),
      record({ id: 'short', time: '13:00', log: '점심 먹었어' }),
    ];
    records = surface;

    open('/story/partner');
    await requestAiSummary();
    await waitFor(() => expect(screen.getByRole('button', { name: '긴 문장 줄이기 완료' })).toBeDisabled());
    expect(screen.getByText(`${'가 '.repeat(19)}가…`)).toBeTruthy();
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
    await waitFor(() => expect(screen.getByRole('button', { name: '긴 문장 줄이기 완료' })).toBeDisabled());
    await userEvent.click(screen.getByRole('button', { name: /점심 먹었어/ }));
    await waitFor(() => expect(screen.getByTestId('story-location').textContent).toBe(rulesTarget));
    expect(rulesTarget).toBe('?at=b');
  });

  it('?at= 이 여는 카드는 대체와 무관하다', async () => {
    const plugin = stubPlugin();
    __setOnDeviceSummaryPluginForTests(plugin);
    surface = twoToday();
    records = surface;

    open('/story/partner?at=b');
    expect(screen.getByText(longBody('점심 먹었어'))).toBeTruthy();
    await Promise.resolve();
    expect(plugin.refineLines).not.toHaveBeenCalled();
    // 딥링크는 표지 버튼을 거치지 않으므로 모델을 실행하지 않고 원문을 그대로 연다.
    expect(screen.getByText(longBody('점심 먹었어'))).toBeTruthy();
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

  it.each(CURRENT_VERIFICATION_FAILURES)(
    '현재 검증 실패 %s 하나라도 생기면 후보 전체를 버리고 baseline만 유지한다',
    async (_rejection, invalidItems) => {
      const plugin = stubPlugin({
        refineLines: vi.fn(async (options) => ({
          requestId: options.requestId,
          items: invalidItems(options.items.map((item) => ({
            index: item.index,
            text: safeRefinedText(item.text),
          }))),
        })),
      });
      __setOnDeviceSummaryPluginForTests(plugin);
      surface = twoToday();
      records = surface;

      open('/story/partner');
      await requestAiSummary();
      await waitFor(() => expect(plugin.refineLines).toHaveBeenCalled());
      expect(screen.getByRole('button', { name: /오늘 시험 끝났어/ })).toBeTruthy();
      expect(screen.getByRole('button', { name: /점심 먹었어/ })).toBeTruthy();
      expect(screen.queryByText('원문에 없는 관계 해석')).toBeNull();
      expect(screen.queryByText(`${safeRefinedText(surface[0].log)}…`)).toBeNull();
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(
        '기기 AI 결과를 안전하게 확인하지 못했어요. 시간순 정리를 그대로 보여드려요.',
      ));
    },
  );

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
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(
      '기기 AI가 응답하지 않았어요. 시간순 정리를 그대로 보여드려요.',
    ));
    expect(screen.getByRole('button', { name: '기기 AI로 긴 문장 줄이기' })).toBeTruthy();
  });

  it('화면을 떠나면 진행 중인 단일 배치를 취소한다', async () => {
    let resolveFirst: ((value: { requestId: string; items: { index: number; text: string }[] }) => void) | undefined;
    const plugin = stubPlugin({
      refineLines: vi.fn((options) => new Promise((resolve) => {
        resolveFirst = resolve;
      })),
    });
    __setOnDeviceSummaryPluginForTests(plugin);

    surface = twoToday();
    records = surface;

    const view = open('/story/partner');
    await requestAiSummary();
    await waitFor(() => expect(plugin.refineLines).toHaveBeenCalledTimes(1));
    const firstOptions = vi.mocked(plugin.refineLines).mock.calls[0][0];
    view.unmount();
    await waitFor(() => expect(plugin.cancel).toHaveBeenCalledWith({ requestId: firstOptions.requestId }));

    resolveFirst?.({
      requestId: firstOptions.requestId,
      items: firstOptions.items.map((item) => ({ index: item.index, text: safeRefinedText(item.text) })),
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(plugin.refineLines).toHaveBeenCalledTimes(1);
  });

  it('Segmenter 없이 긴 Unicode 후보를 안전하게 자를 수 없으면 preflight와 generation을 모두 생략한다', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(Intl, 'Segmenter');
    Object.defineProperty(Intl, 'Segmenter', { configurable: true, value: undefined });

    const plugin = stubPlugin();
    __setOnDeviceSummaryPluginForTests(plugin);

    try {
      const longLog = `${'a'.repeat(118)}👨‍👩‍👧‍👦b`;
      const recordsWithUnsafeCandidate = [
        record({ id: 'short', time: '08:00', log: '짧은 원문' }),
        record({ id: 'long', time: '09:00', log: longLog }),
      ];
      surface = recordsWithUnsafeCandidate;
      records = surface;

      open('/story/partner');
      expect(screen.queryByRole('button', { name: '기기 AI로 긴 문장 줄이기' })).toBeNull();
      expect(plugin.availability).not.toHaveBeenCalled();
      expect(plugin.refineLines).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /짧은 원문/ })).toBeTruthy();
    } finally {
      if (descriptor) Object.defineProperty(Intl, 'Segmenter', descriptor);
    }
  });
});

describe('실패 이유와 재시도 정책', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_ON_DEVICE_DAILY_SUMMARY_ENABLED', 'true');
  });

  it.each([
    ['device_not_eligible', '이 기기에서는 긴 문장 줄이기를 지원하지 않아요'],
    ['apple_intelligence_disabled', '기기 설정에서 Apple Intelligence를 켜 주세요'],
    ['model_not_ready', '기기 AI를 준비하는 중이에요'],
    ['locale_unsupported', '이 기기의 한국어 처리는 아직 지원하지 않아요'],
  ])('content-free preflight가 상세 가용성 사유를 구분한다: %s', async (reason, message) => {
    const plugin = stubPlugin({
      availability: vi.fn(async () => ({ available: false, reason })),
    });
    __setOnDeviceSummaryPluginForTests(plugin);
    surface = twoToday();
    records = surface;

    open('/story/partner');

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(message));
    expect(screen.getByRole('button', { name: /오늘 시험 끝났어/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '기기 AI로 긴 문장 줄이기' })).toBeNull();
    expect(plugin.refineLines).not.toHaveBeenCalled();
  });

  it('기능이 명시적으로 꺼져 있으면 내부 운영 상태를 노출하지 않는다', () => {
    vi.stubEnv('VITE_ON_DEVICE_DAILY_SUMMARY_ENABLED', 'false');
    __setOnDeviceSummaryPluginForTests(stubPlugin());
    surface = twoToday();
    records = surface;

    open('/story/partner');

    expect(screen.queryByRole('button', { name: /AI/ })).toBeNull();
    expect(screen.queryByText('AI 다듬기가 꺼져 있어요')).toBeNull();
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
    await waitFor(() => expect(plugin.availability).not.toHaveBeenCalled());
    await waitFor(() => expect(plugin.refineLines).not.toHaveBeenCalled());
    return plugin;
  }

  it('Partner Briefing이 같은 surface를 소유하면 legacy 플러그인을 전혀 호출하지 않는다', async () => {
    vi.stubEnv('VITE_PARTNER_BRIEFING_ENABLED', 'true');
    const plugin = stubPlugin();
    __setOnDeviceSummaryPluginForTests(plugin);
    surface = [
      record({ id: 'missed', date: '2026-08-21', log: longBody('어제 남긴 기록') }),
      record({ id: 'today', time: '13:00', log: longBody('오늘 남긴 기록') }),
    ];
    records = surface;

    open('/story/partner');

    expect(screen.getByTestId('partner-briefing-card')).toBeTruthy();
    await Promise.resolve();
    await waitFor(() => expect(plugin.availability).not.toHaveBeenCalled());
    expect(plugin.refineLines).not.toHaveBeenCalled();
  });

  it('Partner Briefing flag가 켜져도 오늘 기록만이면 Daily Summary가 맡는다', async () => {
    vi.stubEnv('VITE_PARTNER_BRIEFING_ENABLED', 'true');
    const plugin = stubPlugin();
    __setOnDeviceSummaryPluginForTests(plugin);
    surface = twoToday();
    records = surface;

    open('/story/partner');

    expect(screen.queryByTestId('partner-briefing-card')).toBeNull();
    await requestAiSummary();
    await waitFor(() => expect(plugin.refineLines).toHaveBeenCalledTimes(1));
  });

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
    expect(screen.queryByText(/AI/)).toBeNull();
  });

  it('순간이 하나뿐 -- 표지가 없다', async () => {
    surface = [record({ id: 'a' })];
    records = surface;
    await expectNoCall('/story/partner');
  });

  it('커플이 active가 아니다', async () => {
    coupleStatus = 'disconnected';
    coupleConnected = false;
    surface = twoToday();
    records = surface;
    await expectNoCall('/story/partner');
    expect(screen.queryByText(/AI/)).toBeNull();
  });

  it('현재 상대 신원이 아직 확인되지 않았다', async () => {
    partnerUserId = undefined;
    surface = twoToday();
    records = surface;
    await expectNoCall('/story/partner');
    expect(screen.queryByText(/AI/)).toBeNull();
  });

  it('표지는 있지만 적격한 상대 기록이 하나뿐이다', async () => {
    surface = [
      record({ id: 'partner' }),
      record({ id: 'unrelated', userId: 'unrelated-user', time: '13:00' }),
    ];
    records = surface;
    await expectNoCall('/story/partner');
    expect(screen.queryByText(/AI/)).toBeNull();
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
    expect(screen.queryByText(/AI/)).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: /점심 먹었어/ })).toBeTruthy());
  });
});
