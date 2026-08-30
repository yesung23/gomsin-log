import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { StoryRoute } from '@/features/story/StoryRoute';
import type { CoupleHighlight, DailyRecord, TalkAboutMark } from '@/types';
import { toast } from 'sonner';
import { __setOnDeviceBriefingPluginForTests } from '@/lib/partnerBriefing/nativeOnDeviceBriefing';

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
    authorRole: 'gomsin', log: '오늘 시험 끝났어', isPrivate: false,
    createdAt: '2026-08-22T00:00:00.000Z', ...over,
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
let appLocale: 'ko' | 'en' = 'ko';
let profileId = 'me';
let partnerUserId: string | undefined = 'partner-id';

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
        id: profileId, role: 'soldier',
        couple: {
          connected: true,
          status: 'active',
          coupleId: 'c1',
          partnerUserId,
          partnerName: '춘향',
        },
      },
      authenticatedUser: { id: 'me' },
      locale: appLocale,
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

function tree(path: string) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/story/partner" element={<StoryRoute mode="today" />} />
        <Route path="/story/mine" element={<StoryRoute mode="mine" />} />
        <Route path="/story/day/:date" element={<StoryRoute mode="archive" />} />
        <Route path="/story/highlight/:highlightId" element={<StoryRoute mode="highlight" />} />
      </Routes>
    </MemoryRouter>
  );
}

function open(path: string) {
  const view = render(tree(path));
  return {
    ...view,
    /** Re-render the SAME tree, so module-level store changes reach the component
     *  without unmounting it -- which is exactly what a late partner binding does. */
    refresh: () => view.rerender(tree(path)),
  };
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
  appLocale = 'ko';
  profileId = 'me';
  partnerUserId = 'partner-id';
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  __setOnDeviceBriefingPluginForTests(null);
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

  describe('Partner Briefing feature flag', () => {
    const eightRecords = () => Array.from({ length: 8 }, (_, index) => record({
      id: `brief-${index + 1}`,
      time: `${String(9 + index).padStart(2, '0')}:00`,
      log: `기록 ${index + 1}`,
      createdAt: `2026-08-22T${String(index).padStart(2, '0')}:00:00.000Z`,
    }));

    function nativeBriefingPlugin() {
      return {
        availability: vi.fn(async () => ({ availability: 'ready' })),
        capability: vi.fn(async () => ({
          envelope: {
            maxContextUtf8Bytes: 4096,
            promptOverheadUtf8Bytes: 256,
            responseReserveUtf8Bytes: 512,
            maxInputTextGraphemes: 1000,
            maxItems: 64,
            maxCandidatesPerItem: 32,
          },
        })),
        selectExtracts: vi.fn(async (options: {
          requestId: string;
          items: readonly { itemOrdinal: number }[];
        }) => ({
          requestId: options.requestId,
          output: {
            version: 1,
            choices: options.items.map((item) => ({
              itemOrdinal: item.itemOrdinal,
              candidateOrdinal: 0,
            })),
          },
        })),
        cancel: vi.fn(async () => undefined),
      };
    }

    it('기본 OFF에서는 기존 표지를 유지하고 브리핑을 넣지 않는다', () => {
      const plugin = nativeBriefingPlugin();
      __setOnDeviceBriefingPluginForTests(plugin);
      surface = [record({ id: 'a' }), record({ id: 'b', time: '13:00', log: '점심' })];
      records = surface;

      open('/story/partner');

      expect(screen.queryByTestId('partner-briefing-card')).toBeNull();
      expect(screen.getByRole('button', { name: /오늘 시험 끝났어/ })).toBeTruthy();
      expect(screen.getByRole('button', { name: /점심/ })).toBeTruthy();
      expect(plugin.availability).not.toHaveBeenCalled();
    });

    it('ON에서는 iOS provider를 호출하되 원본 이동과 확인 의미론을 바꾸지 않는다', async () => {
      vi.stubEnv('VITE_PARTNER_BRIEFING_ENABLED', 'true');
      const plugin = nativeBriefingPlugin();
      __setOnDeviceBriefingPluginForTests(plugin);
      surface = [record({ id: 'native-a', log: '정확한 원본 A' }), record({
        id: 'native-b',
        time: '13:00',
        log: '정확한 원본 B',
      })];
      records = surface;

      open('/story/partner');

      await waitFor(() => expect(plugin.selectExtracts).toHaveBeenCalled());
      expect(acknowledge).not.toHaveBeenCalled();
      await userEvent.click(screen.getByTestId('partner-briefing-expand'));
      await userEvent.click(screen.getAllByRole('button', { name: '원본 보기' })[0]);
      expect(mockNavigate).toHaveBeenCalledWith('/record?record=native-a');
      expect(acknowledge).not.toHaveBeenCalled();
    });

    it('ON에서는 브리핑 한 장 뒤에 8개 원본을 모두 보존하고 기존 표지는 겹치지 않는다', async () => {
      vi.stubEnv('VITE_PARTNER_BRIEFING_ENABLED', 'true');
      surface = eightRecords();
      records = surface;

      open('/story/partner');

      expect(screen.getByTestId('partner-briefing-card')).toBeTruthy();
      expect(screen.getByText('순간 8개')).toBeTruthy();
      expect(screen.getByText('1 / 10')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /기록 1/ })).toBeNull();

      await userEvent.click(screen.getByTestId('partner-briefing-expand'));
      expect(screen.getAllByRole('button', { name: '원본 보기' })).toHaveLength(8);

      await userEvent.click(screen.getByRole('button', { name: '다음 순간' }));
      expect(screen.getByText('기록 1')).toBeTruthy();
    });

    it('?at=은 브리핑 prefix 뒤에서도 정확한 원본 또는 정확한 부재 카드를 연다', () => {
      vi.stubEnv('VITE_PARTNER_BRIEFING_ENABLED', 'true');
      surface = [record({ id: 'a', log: '첫 기록' }), record({ id: 'b', time: '13:00', log: '정확한 둘째' })];
      records = surface;

      const exact = open('/story/partner?at=b');
      expect(screen.getByText('정확한 둘째')).toBeTruthy();
      expect(screen.queryByText('첫 기록')).toBeNull();
      exact.unmount();

      open('/story/partner?at=gone');
      expect(screen.getByText('이 기록은 더 이상 볼 수 없어요')).toBeTruthy();
      expect(screen.queryByText('첫 기록')).toBeNull();
    });

    it('브리핑의 원본 보기는 exact recordId로 이동하고 열람만으로 확인하지 않는다', async () => {
      vi.stubEnv('VITE_PARTNER_BRIEFING_ENABLED', 'true');
      surface = [record({ id: 'exact-a', log: '정확한 원본' }), record({ id: 'exact-b', time: '13:00' })];
      records = surface;

      open('/story/partner');
      await userEvent.click(screen.getByTestId('partner-briefing-expand'));
      await userEvent.click(screen.getAllByRole('button', { name: '원본 보기' })[0]);

      expect(mockNavigate).toHaveBeenCalledWith('/record?record=exact-a');
      expect(acknowledge).not.toHaveBeenCalled();
    });

    it('기기 언어가 영어면 같은 브리핑을 영어 UI로 표시한다', () => {
      vi.stubEnv('VITE_PARTNER_BRIEFING_ENABLED', 'true');
      appLocale = 'en';
      surface = [record({ id: 'a' }), record({ id: 'b', time: '13:00' })];
      records = surface;

      open('/story/partner');

      expect(screen.getByText('Since you last checked')).toBeTruthy();
      expect(screen.getByText('2 moments')).toBeTruthy();
    });

    /*
      플래그가 아니라 브리핑이 표지를 대체한다.

      전에는 `VITE_PARTNER_BRIEFING_ENABLED`가 켜졌다는 사실만으로 표지를 없앴다. 그런데
      브리핑이 없는 상태는 예외가 아니라 정상 경로에 있다 -- `partnerUserId`가 아직
      안 붙었을 때, 기록 시각이 정규화를 통과하지 못했을 때, 볼 기록이 없을 때. 그때
      화면에는 브리핑도 표지도 없이 원본 카드만 남았다. 기능 플래그를 켜는 일이 첫 화면을
      없애는 일이 되어서는 안 된다.
    */
    describe('브리핑이 없으면 기존 목차가 그대로 남는다', () => {
      it('partnerUserId가 아직 안 붙었으면 표지를 유지한다', () => {
        vi.stubEnv('VITE_PARTNER_BRIEFING_ENABLED', 'true');
        partnerUserId = undefined;
        surface = [record({ id: 'a', log: '첫 기록' }), record({ id: 'b', time: '13:00', log: '둘째 기록' })];
        records = surface;

        open('/story/partner');

        // 브리핑은 없다.
        expect(screen.queryByTestId('partner-briefing-card')).toBeNull();
        // 그러나 첫 장은 비어 있지 않다: 표지가 돌아와 있고 원본은 모두 그 뒤에 있다.
        // 카드는 [표지, 원본 2, 닫는 장] = 4.
        expect(screen.getByText('1 / 4')).toBeTruthy();
        // 표지의 증거는 그 줄들이다: 표지만이 기록마다 점프 버튼을 낸다.
        expect(screen.getByRole('button', { name: /첫 기록/ })).toBeTruthy();
        expect(screen.getByRole('button', { name: /둘째 기록/ })).toBeTruthy();
      });

      it('시각이 정규화를 통과하지 못해도 표지를 유지한다', () => {
        vi.stubEnv('VITE_PARTNER_BRIEFING_ENABLED', 'true');
        // '9:00'은 유효한 24시간 표기가 아니다 -> normalize가 corpus 전체를 fail-closed.
        surface = [record({ id: 'a', time: '9:00', log: '첫 기록' }), record({ id: 'b', time: '13:00', log: '둘째 기록' })];
        records = surface;

        open('/story/partner');

        expect(screen.queryByTestId('partner-briefing-card')).toBeNull();
        expect(screen.getByText('1 / 4')).toBeTruthy();
        expect(screen.getByRole('button', { name: /첫 기록/ })).toBeTruthy();
      });

      it('브리핑이 준비되면 표지는 물러난다', () => {
        vi.stubEnv('VITE_PARTNER_BRIEFING_ENABLED', 'true');
        surface = [record({ id: 'a', log: '첫 기록' }), record({ id: 'b', time: '13:00', log: '둘째 기록' })];
        records = surface;

        open('/story/partner');

        // 표지와 브리핑이 겹쳐서 두 장이 되지 않는다: 앞 장은 언제나 정확히 한 장이고,
        // 카드 수는 표지일 때와 같은 4다 -- 그래서 늦게 도착해도 위치가 밀리지 않는다.
        expect(screen.getByTestId('partner-briefing-card')).toBeTruthy();
        // 표지는 물러났다: 첫 장에 표지의 점프 줄이 없다.
        expect(screen.queryByRole('button', { name: /첫 기록/ })).toBeNull();
        expect(screen.getByText('1 / 4')).toBeTruthy();
      });
    });

    it('브리핑이 늦게 도착해도 읽던 자리를 잃지 않는다', async () => {
      vi.stubEnv('VITE_PARTNER_BRIEFING_ENABLED', 'true');
      // 처음에는 partner가 아직 안 붙어 브리핑이 없다 -> 표지 + 원본 2장.
      partnerUserId = undefined;
      surface = [record({ id: 'a', log: '첫 기록' }), record({ id: 'b', time: '13:00', log: '둘째 기록' })];
      records = surface;

      const view = open('/story/partner');
      expect(screen.queryByTestId('partner-briefing-card')).toBeNull();

      // 사용자가 두 번째 원본까지 읽어 내려간다.
      await userEvent.click(screen.getByRole('button', { name: '다음 순간' }));
      await userEvent.click(screen.getByRole('button', { name: '다음 순간' }));
      expect(screen.getByText('3 / 4')).toBeTruthy();
      expect(screen.getByText('둘째 기록')).toBeTruthy();

      // 그 사이에 partner가 붙어 브리핑이 생긴다.
      partnerUserId = 'partner-id';
      view.refresh();

      // 브리핑은 들어왔지만 사용자는 있던 자리에 그대로 있다. key에 브리핑 유무를 넣으면
      // 여기서 StoryViewer가 다시 마운트되어 첫 장으로 돌아간다.
      expect(screen.getByText('3 / 4')).toBeTruthy();
      expect(screen.getByText('둘째 기록')).toBeTruthy();
      expect(screen.queryByText('1 / 4')).toBeNull();

      // 그리고 앞 장은 표지가 아니라 브리핑으로 바뀌어 있다.
      await userEvent.click(screen.getByRole('button', { name: '이전 순간' }));
      await userEvent.click(screen.getByRole('button', { name: '이전 순간' }));
      expect(screen.getByTestId('partner-briefing-card')).toBeTruthy();
    });

    it('브리핑이 사라져도 목차로 되돌아가고 자리를 잃지 않는다', async () => {
      vi.stubEnv('VITE_PARTNER_BRIEFING_ENABLED', 'true');
      surface = [record({ id: 'a', log: '첫 기록' }), record({ id: 'b', time: '13:00', log: '둘째 기록' })];
      records = surface;

      const view = open('/story/partner');
      expect(screen.getByTestId('partner-briefing-card')).toBeTruthy();

      await userEvent.click(screen.getByRole('button', { name: '다음 순간' }));
      await userEvent.click(screen.getByRole('button', { name: '다음 순간' }));
      expect(screen.getByText('3 / 4')).toBeTruthy();

      // 연결이 풀려 브리핑 자격이 사라진다.
      partnerUserId = undefined;
      view.refresh();

      expect(screen.queryByTestId('partner-briefing-card')).toBeNull();
      expect(screen.getByText('3 / 4')).toBeTruthy();
      expect(screen.getByText('둘째 기록')).toBeTruthy();
    });

    it('?at= 초기 위치는 브리핑 도착 전후가 같다', () => {
      vi.stubEnv('VITE_PARTNER_BRIEFING_ENABLED', 'true');
      partnerUserId = undefined;
      surface = [record({ id: 'a', log: '첫 기록' }), record({ id: 'b', time: '13:00', log: '둘째 기록' })];
      records = surface;

      const view = open('/story/partner?at=b');
      // 표지 fallback에서도 정확한 원본이 열린다.
      expect(screen.getByText('둘째 기록')).toBeTruthy();
      expect(screen.getByText('3 / 4')).toBeTruthy();

      partnerUserId = 'partner-id';
      view.refresh();

      // 브리핑이 앞 장을 차지해도 ?at= 이 가리키는 자리는 그대로다.
      expect(screen.getByText('둘째 기록')).toBeTruthy();
      expect(screen.getByText('3 / 4')).toBeTruthy();
    });

    it('닫는 카드 위치도 브리핑 도착 전후가 같다', async () => {
      vi.stubEnv('VITE_PARTNER_BRIEFING_ENABLED', 'true');
      partnerUserId = undefined;
      surface = [record({ id: 'a', log: '첫 기록' }), record({ id: 'b', time: '13:00', log: '둘째 기록' })];
      records = surface;

      const view = open('/story/partner');
      for (let i = 0; i < 3; i += 1) {
        await userEvent.click(screen.getByRole('button', { name: '다음 순간' }));
      }
      expect(screen.getByText('4 / 4')).toBeTruthy();
      expect(screen.getByRole('button', { name: '다 읽었어요' })).toBeTruthy();

      partnerUserId = 'partner-id';
      view.refresh();

      expect(screen.getByText('4 / 4')).toBeTruthy();
      expect(screen.getByRole('button', { name: '다 읽었어요' })).toBeTruthy();
    });

    it('표지 fallback에서도 정확한 원본으로 점프한다', async () => {
      vi.stubEnv('VITE_PARTNER_BRIEFING_ENABLED', 'true');
      partnerUserId = undefined;
      surface = [record({ id: 'a', log: '첫 기록' }), record({ id: 'b', time: '13:00', log: '둘째 기록' })];
      records = surface;

      open('/story/partner');
      // 표지 줄을 누르면 그 카드로 이동한다. 대체하지 않고 정확한 원본이어야 한다.
      await userEvent.click(screen.getByRole('button', { name: /둘째 기록/ }));

      expect(screen.getByText('둘째 기록')).toBeTruthy();
      expect(acknowledge).not.toHaveBeenCalled();
    });

    it('브리핑 생성·교체·확장·원본 이동 어느 것도 CONFIRMED를 쓰지 않는다', async () => {
      vi.stubEnv('VITE_PARTNER_BRIEFING_ENABLED', 'true');
      partnerUserId = undefined;
      surface = [record({ id: 'a', log: '첫 기록' }), record({ id: 'b', time: '13:00', log: '둘째 기록' })];
      records = surface;

      const view = open('/story/partner');
      // 표지 fallback
      expect(acknowledge).not.toHaveBeenCalled();

      // 브리핑이 도착해 앞 장을 교체
      partnerUserId = 'partner-id';
      view.refresh();
      expect(screen.getByTestId('partner-briefing-card')).toBeTruthy();
      expect(acknowledge).not.toHaveBeenCalled();

      // 확장
      await userEvent.click(screen.getByTestId('partner-briefing-expand'));
      expect(acknowledge).not.toHaveBeenCalled();

      // 원본 이동
      await userEvent.click(screen.getAllByRole('button', { name: '원본 보기' })[0]);
      expect(mockNavigate).toHaveBeenCalledWith('/record?record=a');
      expect(acknowledge).not.toHaveBeenCalled();
    });

    it('명시적인 다 읽었어요에서만 acknowledge가 불린다', async () => {
      vi.stubEnv('VITE_PARTNER_BRIEFING_ENABLED', 'true');
      surface = [record({ id: 'a', log: '첫 기록' }), record({ id: 'b', time: '13:00', log: '둘째 기록' })];
      records = surface;

      open('/story/partner');
      for (let i = 0; i < 3; i += 1) {
        await userEvent.click(screen.getByRole('button', { name: '다음 순간' }));
      }
      expect(acknowledge).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole('button', { name: '다 읽었어요' }));
      expect(acknowledge).toHaveBeenCalledTimes(1);
    });

    /*
      읽을 수 있는 원본이 정확히 1개일 때.

      표지는 `readable.length > 1`일 때만 생긴다. 그래서 원본이 하나면 브리핑 유무에 따라
      목록 길이가 실제로 달라진다:

        브리핑 없음: [원본, 닫는 장]
        브리핑 있음: [브리핑, 원본, 닫는 장]

      StoryViewer가 숫자 index만 들고 있으면 앞에 한 장이 끼어드는 순간 index 0이 원본에서
      브리핑으로, index 1이 닫는 장에서 원본으로 밀린다. 사용자는 아무것도 누르지 않았는데
      다른 카드를 보게 된다. 반대로 브리핑이 사라지면 뒤로 밀린다.
    */
    describe('원본이 하나뿐일 때도 보던 카드를 유지한다', () => {
      const single = () => [record({ id: 'only', log: '유일한 기록' })];

      it('원본을 보는 중 브리핑이 도착해도 같은 원본을 유지한다', () => {
        vi.stubEnv('VITE_PARTNER_BRIEFING_ENABLED', 'true');
        partnerUserId = undefined;
        surface = single();
        records = surface;

        const view = open('/story/partner');
        // 표지가 없으므로 첫 장이 곧 원본이다.
        expect(screen.getByText('유일한 기록')).toBeTruthy();
        expect(screen.getByText('1 / 2')).toBeTruthy();

        partnerUserId = 'partner-id';
        view.refresh();

        // 앞에 브리핑이 끼어들었지만 보고 있던 것은 그대로 원본이어야 한다.
        expect(screen.getByText('유일한 기록')).toBeTruthy();
        expect(screen.getByText('2 / 3')).toBeTruthy();
        expect(acknowledge).not.toHaveBeenCalled();
      });

      it('닫는 장을 보는 중 브리핑이 도착해도 닫는 장을 유지한다', async () => {
        vi.stubEnv('VITE_PARTNER_BRIEFING_ENABLED', 'true');
        partnerUserId = undefined;
        surface = single();
        records = surface;

        const view = open('/story/partner');
        await userEvent.click(screen.getByRole('button', { name: '다음 순간' }));
        expect(screen.getByText('2 / 2')).toBeTruthy();
        expect(screen.getByRole('button', { name: '다 읽었어요' })).toBeTruthy();

        partnerUserId = 'partner-id';
        view.refresh();

        expect(screen.getByRole('button', { name: '다 읽었어요' })).toBeTruthy();
        expect(screen.getByText('3 / 3')).toBeTruthy();
        expect(screen.queryByText('유일한 기록')).toBeNull();
        expect(acknowledge).not.toHaveBeenCalled();
      });

      it('원본을 보는 중 브리핑이 사라져도 같은 원본을 유지한다', async () => {
        vi.stubEnv('VITE_PARTNER_BRIEFING_ENABLED', 'true');
        surface = single();
        records = surface;

        const view = open('/story/partner');
        expect(screen.getByTestId('partner-briefing-card')).toBeTruthy();
        await userEvent.click(screen.getByRole('button', { name: '다음 순간' }));
        expect(screen.getByText('유일한 기록')).toBeTruthy();
        expect(screen.getByText('2 / 3')).toBeTruthy();

        partnerUserId = undefined;
        view.refresh();

        expect(screen.getByText('유일한 기록')).toBeTruthy();
        expect(screen.getByText('1 / 2')).toBeTruthy();
        expect(acknowledge).not.toHaveBeenCalled();
      });

      it('닫는 장을 보는 중 브리핑이 사라져도 닫는 장을 유지한다', async () => {
        vi.stubEnv('VITE_PARTNER_BRIEFING_ENABLED', 'true');
        surface = single();
        records = surface;

        const view = open('/story/partner');
        await userEvent.click(screen.getByRole('button', { name: '다음 순간' }));
        await userEvent.click(screen.getByRole('button', { name: '다음 순간' }));
        expect(screen.getByText('3 / 3')).toBeTruthy();
        expect(screen.getByRole('button', { name: '다 읽었어요' })).toBeTruthy();

        partnerUserId = undefined;
        view.refresh();

        expect(screen.getByRole('button', { name: '다 읽었어요' })).toBeTruthy();
        expect(screen.getByText('2 / 2')).toBeTruthy();
        expect(acknowledge).not.toHaveBeenCalled();
      });

      it('?at= 로 연 정확한 원본은 브리핑 도착·소멸 후에도 그 원본이다', () => {
        vi.stubEnv('VITE_PARTNER_BRIEFING_ENABLED', 'true');
        partnerUserId = undefined;
        surface = single();
        records = surface;

        const view = open('/story/partner?at=only');
        expect(screen.getByText('유일한 기록')).toBeTruthy();

        partnerUserId = 'partner-id';
        view.refresh();
        expect(screen.getByText('유일한 기록')).toBeTruthy();

        partnerUserId = undefined;
        view.refresh();
        expect(screen.getByText('유일한 기록')).toBeTruthy();
        expect(acknowledge).not.toHaveBeenCalled();
      });

      it('전환 뒤에도 빈 화면이 되지 않고 명시적 확인만 acknowledge를 부른다', async () => {
        vi.stubEnv('VITE_PARTNER_BRIEFING_ENABLED', 'true');
        surface = single();
        records = surface;

        const view = open('/story/partner');
        // 마지막 카드에서 브리핑이 사라지면 목록이 3 -> 2로 줄어든다.
        await userEvent.click(screen.getByRole('button', { name: '다음 순간' }));
        await userEvent.click(screen.getByRole('button', { name: '다음 순간' }));

        partnerUserId = undefined;
        view.refresh();

        // 뷰어는 여전히 무언가를 보여준다. 범위를 벗어나 사라지지 않는다.
        expect(screen.getByTestId('story-viewer')).toBeTruthy();
        expect(screen.getByText('2 / 2')).toBeTruthy();
        expect(acknowledge).not.toHaveBeenCalled();

        await userEvent.click(screen.getByRole('button', { name: '다 읽었어요' }));
        expect(acknowledge).toHaveBeenCalledTimes(1);
      });
    });

    it('profile.id가 늦게 동기화돼도 authenticatedUser.id를 canonical viewer로 사용한다', () => {
      vi.stubEnv('VITE_PARTNER_BRIEFING_ENABLED', 'true');
      profileId = 'stale-profile-id';
      surface = [record({ id: 'a' }), record({ id: 'b', time: '13:00' })];
      records = surface;

      open('/story/partner');

      expect(screen.getByTestId('partner-briefing-card')).toBeTruthy();
      expect(screen.getByText('순간 2개')).toBeTruthy();
    });
  });
});

describe('/story/mine', () => {
  it('Partner Briefing flag가 켜져도 내 스토리에는 브리핑을 넣지 않는다', () => {
    vi.stubEnv('VITE_PARTNER_BRIEFING_ENABLED', 'true');
    records = [record({ id: 'mine', userId: 'me', log: '내 기록' })];
    open('/story/mine');
    expect(screen.queryByTestId('partner-briefing-card')).toBeNull();
    expect(screen.getByText('내 기록')).toBeTruthy();
  });

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
