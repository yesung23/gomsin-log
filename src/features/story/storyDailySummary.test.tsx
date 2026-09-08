import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { StoryRoute } from '@/features/story/StoryRoute';
import type { DailyRecord } from '@/types';
import {
  __setOnDeviceSummaryPluginForTests,
  type OnDeviceSummaryPlugin,
} from '@/lib/dailySummary/nativeOnDeviceSummary';

const mockNavigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => false,
    getPlatform: () => 'web',
    isPluginAvailable: () => false,
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
      locale: 'ko',
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

function open(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/story/partner" element={<StoryRoute mode="today" />} />
        <Route path="/story/mine" element={<StoryRoute mode="mine" />} />
        <Route path="/story/day/:date" element={<StoryRoute mode="archive" />} />
      </Routes>
    </MemoryRouter>,
  );
}

function legacyPlugin(): OnDeviceSummaryPlugin {
  return {
    availability: vi.fn(async () => ({ available: true, reason: 'ready' })),
    refineLines: vi.fn(async (options) => ({
      requestId: options.requestId,
      items: options.items,
    })),
    cancel: vi.fn(async () => undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  surface = [];
  records = [];
  coupleStatus = 'active';
  __setOnDeviceSummaryPluginForTests(null);
});

afterEach(() => {
  __setOnDeviceSummaryPluginForTests(null);
  vi.unstubAllEnvs();
});

describe('상대 스토리의 canonical summary contract', () => {
  it('AI refinement flag가 꺼져도 deterministic PartnerBriefing이 즉시 존재한다', () => {
    vi.stubEnv('VITE_PARTNER_BRIEFING_ENABLED', 'false');
    surface = [
      record({ id: 'a', log: '오늘 학교 갔어. 점심에 친구랑 마라탕 먹었어.' }),
      record({ id: 'b', time: '13:00', log: '집 오는 길에 비가 많이 왔어.' }),
    ];
    records = surface;

    open('/story/partner');

    expect(screen.getByTestId('partner-briefing-card')).toBeTruthy();
    expect(screen.getByText('총 2개의 기록이 있습니다.')).toBeTruthy();
  });

  it('legacy dailySummary native plugin은 더 이상 production Story caller에서 호출되지 않는다', async () => {
    vi.stubEnv('VITE_ON_DEVICE_DAILY_SUMMARY_ENABLED', 'true');
    const plugin = legacyPlugin();
    __setOnDeviceSummaryPluginForTests(plugin);
    surface = [record({ id: 'a' }), record({ id: 'b', time: '13:00', log: '점심 먹었어' })];
    records = surface;

    open('/story/partner');

    expect(screen.getByTestId('partner-briefing-card')).toBeTruthy();
    await waitFor(() => expect(plugin.availability).not.toHaveBeenCalled());
    expect(plugin.refineLines).not.toHaveBeenCalled();
  });

  it('브리핑 상세의 각 조각은 정확한 sourceRecordId로 원본을 연다', async () => {
    surface = [
      record({ id: 'a', log: '오전에 수업 들었어.' }),
      record({ id: 'b', time: '13:00', log: '점심에 친구랑 마라탕 먹었어.' }),
    ];
    records = surface;
    open('/story/partner');

    await userEvent.click(screen.getByTestId('partner-briefing-expand'));
    const originalButtons = screen.getAllByRole('button', { name: '원본 보기' });
    expect(originalButtons).toHaveLength(2);
    await userEvent.click(originalButtons[1]);
    expect(mockNavigate).toHaveBeenCalledWith('/record?record=b');
  });

  it('PartnerBriefing을 만들 수 없는 identity/couple 상태면 기존 deterministic cover가 fallback으로 남는다', () => {
    coupleStatus = 'disconnected';
    surface = [record({ id: 'a' }), record({ id: 'b', time: '13:00', log: '점심 먹었어' })];
    records = surface;

    open('/story/partner');

    expect(screen.queryByTestId('partner-briefing-card')).toBeNull();
    expect(screen.getByRole('button', { name: /오늘 시험 끝났어/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /점심 먹었어/ })).toBeTruthy();
  });

  it('한 개 기록도 PartnerBriefing으로 요약되고 원본 순간은 사라지지 않는다', async () => {
    surface = [record({ id: 'only', log: '오후에 운동했어.' })];
    records = surface;
    open('/story/partner');

    expect(screen.getByTestId('partner-briefing-card')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '다음 순간' }));
    expect(screen.getByText('오후에 운동했어.')).toBeTruthy();
  });

  it('여러 날 OUTSTANDING surface도 같은 PartnerBriefing 계약을 사용한다', () => {
    surface = [
      record({ id: 'y', date: '2026-08-21', log: '어제 기록' }),
      record({ id: 't', log: '오늘 기록' }),
    ];
    records = surface;
    open('/story/partner');

    expect(screen.getByRole('dialog', { name: '놓친 하루' })).toBeTruthy();
    expect(screen.getByTestId('partner-briefing-card')).toBeTruthy();
    expect(screen.getByText('2일 동안 총 2개의 기록이 있습니다.')).toBeTruthy();
  });

  it('mine/archive는 unified partner briefing 범위 밖이며 기존 원본 스토리를 유지한다', () => {
    records = [
      record({ id: 'mine-1', userId: ME, log: '내가 쓴 것' }),
      record({ id: 'then-1', date: '2026-08-14', log: '그날 기록' }),
    ];

    const mine = open('/story/mine');
    expect(screen.queryByTestId('partner-briefing-card')).toBeNull();
    expect(screen.getByText('내가 쓴 것')).toBeTruthy();
    mine.unmount();

    open('/story/day/2026-08-14');
    expect(screen.queryByTestId('partner-briefing-card')).toBeNull();
    expect(screen.getByText('그날 기록')).toBeTruthy();
  });
});
