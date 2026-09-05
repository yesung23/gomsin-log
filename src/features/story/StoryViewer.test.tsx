import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { StoryViewer } from '@/features/story/StoryViewer';
import type { StoryCard } from '@/features/story/storyProjection';
import type { PartnerBriefing } from '@/lib/partnerBriefing/contract';
import type { DailyRecord } from '@/types';

vi.mock('@/components/media/RecordMediaGallery', () => ({
  RecordMediaGallery: ({ recordId, fit }: { recordId: string; fit?: string }) => (
    <div data-testid={`media-${recordId}`} data-fit={fit} />
  ),
}));

const SOURCE = readFileSync('src/features/story/StoryViewer.tsx', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');

function record(over: Partial<DailyRecord> = {}): DailyRecord {
  return {
    id: 'r1', userId: 'partner', date: '2026-08-22', time: '09:00',
    authorRole: 'gomsin', log: '오늘 시험 끝났어', isPrivate: false, ...over,
  } as DailyRecord;
}

const CARDS: StoryCard[] = [
  { kind: 'moment', record: record({ id: 'a', time: '09:00' }) },
  { kind: 'moment', record: record({ id: 'b', time: '13:00', log: '점심 먹었어' }) },
  { kind: 'closing', momentCount: 2, unreadableCount: 0 },
];

function mockBriefing(overrides: Partial<PartnerBriefing> = {}): PartnerBriefing {
  return {
    version: 1,
    sourceCount: 2,
    generation: 'deterministic',
    rangeLabel: '8월 22일',
    overview: {
      text: '총 2개의 기록이 있습니다.',
      sourceRecordIds: ['a', 'b'],
    },
    days: [
      {
        date: '2026-08-22',
        sections: [
          {
            period: 'morning',
            items: [
              { parts: [{ text: '오늘 시험 끝났어', sourceRecordId: 'a' }] },
            ],
          },
          {
            period: 'afternoon',
            items: [
              { parts: [{ text: '점심 먹었어', sourceRecordId: 'b' }] },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function view(props: Partial<Parameters<typeof StoryViewer>[0]> = {}) {
  return render(
    <StoryViewer
      cards={CARDS} initialIndex={0} mode="today" title="춘향의 오늘"
      onClose={vi.fn()} onOpenRecord={vi.fn()} {...props}
    />,
  );
}

afterEach(() => vi.useRealTimers());

describe('스토리는 저절로 넘어가지 않는다', () => {
  it('전체 화면 진행 표시와 이동 버튼을 iPhone 안전영역 안에 둔다', () => {
    view();
    const viewer = screen.getByTestId('story-viewer');

    expect(viewer).toHaveClass('pt-[env(safe-area-inset-top,0px)]');
    expect(viewer).toHaveClass('pb-[env(safe-area-inset-bottom,0px)]');
  });

  it('시간이 지나도 같은 카드에 머문다', () => {
    /*
      인스타의 스토리는 6초마다 넘어간다. 여기에 타이머가 없는 것이 이 화면의 가장 중요한
      결정이다 -- 자동 진행은 원본을 스치게 만들고, 사흘 놓친 사람의 12개 순간을 72초에
      지나가게 하며, WCAG 2.2.2에 걸린다.
    */
    vi.useFakeTimers();
    view();
    expect(screen.getByText('1 / 3')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByText('1 / 3')).toBeTruthy();
  });

  it('소스에 자동 진행 장치가 없다', () => {
    expect(SOURCE).not.toMatch(/setInterval|requestAnimationFrame/);
  });
});

describe('A paper-home 시각 언어', () => {
  it('공책 표면 위에 손으로 그린 원본 패널과 잉크 위치 표시를 쓴다', () => {
    const { container } = view();
    const viewer = screen.getByTestId('story-viewer');
    const storyPanel = screen.getByText('오늘 시험 끝났어').parentElement;
    const position = screen.getByTestId('story-position');
    const marks = position.querySelectorAll('[data-story-position-state]');

    expect(viewer).toHaveClass('paper-texture-layer');
    expect(viewer).not.toHaveClass('bg-background');
    expect(storyPanel).toHaveClass('ink-box');
    expect(storyPanel).not.toHaveClass('bg-card', 'rounded-surface');
    expect(screen.getByText('오늘 시험 끝났어')).toHaveClass('[overflow-wrap:anywhere]');
    expect(position).toHaveAttribute('aria-hidden', 'true');
    expect(marks).toHaveLength(3);
    expect(marks[0]).toHaveAttribute('data-story-position-state', 'current');
    expect(marks[0].getAttribute('style')).toContain('var(--ink-accent)');
    expect(marks[1]).toHaveAttribute('data-story-position-state', 'upcoming');
    expect(marks[1].getAttribute('style')).toContain('var(--ink-faint)');
    expect(container.querySelector('.ink-rule')).toBeInTheDocument();
  });

  it('아이콘만 보이는 chrome은 이름과 44px 표적을 유지한다', () => {
    view();

    for (const name of ['스토리 닫기', '이전 순간', '다음 순간']) {
      const action = screen.getByRole('button', { name });
      const icon = action.querySelector('svg');
      expect(action).toHaveClass('min-h-11', 'min-w-11');
      expect(action).toHaveAccessibleName(name);
      expect(action).toHaveTextContent('');
      expect(icon).toHaveClass('pen-icon');
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    }
  });
});

describe('이동', () => {
  it('버튼으로 앞뒤로 간다', async () => {
    view();
    await userEvent.click(screen.getByRole('button', { name: '다음 순간' }));
    expect(screen.getByText('2 / 3')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '이전 순간' }));
    expect(screen.getByText('1 / 3')).toBeTruthy();
  });

  it('키보드만으로 처음부터 끝까지 간다', async () => {
    // 제스처만 있는 전체화면은 스크린리더·키보드 사용자를 잃는다. SC 2.1.1.
    view();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByText('2 / 3')).toBeTruthy();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByText('3 / 3')).toBeTruthy();
  });

  it('마지막에서 한 번 더 눌러도 닫히지 않는다', async () => {
    // 다음을 보려던 손가락이 화면을 닫아 버리면 안 된다. 나가는 길은 닫는 카드가 소유한다.
    const onClose = vi.fn();
    view({ initialIndex: 2, onClose });
    await userEvent.keyboard('{ArrowRight}');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('3 / 3')).toBeTruthy();
  });

  it('Esc로 닫는다', async () => {
    const onClose = vi.fn();
    view({ onClose });
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('첫 카드에서 이전은 비활성이다', () => {
    view();
    expect(screen.getByRole('button', { name: '이전 순간' })).toBeDisabled();
  });

  it('마지막에서 다음 화살표는 비활성이다', () => {
    // 갈 곳이 없는 화살표를 살려 두면 스크린리더가 거짓을 말한다.
    view({ initialIndex: 2 });
    expect(screen.getByRole('button', { name: '다음 순간' })).toBeDisabled();
  });

  it('닫는 컨트롤의 이름이 겹치지 않는다', () => {
    // 같은 이름의 컨트롤이 여럿이면 스크린리더 사용자는 무엇을 누르는지 알 수 없다.
    view({ initialIndex: 2 });
    expect(screen.getByRole('button', { name: '스토리 닫기' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '닫기' })).toHaveLength(1);
  });

  it('요청한 카드에서 시작한다', () => {
    view({ initialIndex: 1 });
    expect(screen.getByText('2 / 3')).toBeTruthy();
  });

  it('실시간 선행 추가와 재정렬에도 읽던 정확한 원본에 머문다', async () => {
    const onOpenRecord = vi.fn();
    const { rerender } = view({ initialIndex: 1, onOpenRecord });
    expect(screen.getByText('점심 먹었어')).toBeInTheDocument();

    const changedCards: StoryCard[] = [
      { kind: 'moment', record: record({ id: 'new', time: '08:00', log: '새로 도착한 기록' }) },
      CARDS[0],
      CARDS[1],
      CARDS[2],
    ];
    rerender(
      <StoryViewer
        cards={changedCards}
        initialIndex={1}
        mode="today"
        title="춘향의 오늘"
        onClose={vi.fn()}
        onOpenRecord={onOpenRecord}
      />,
    );

    expect(screen.getByText('점심 먹었어')).toBeInTheDocument();
    expect(screen.queryByText('오늘 시험 끝났어')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '원본 보기' }));
    expect(onOpenRecord).toHaveBeenCalledWith('b');
  });

  it('읽던 원본이 사라지면 옆 카드를 대신 열지 않고 안내로 포커스를 옮긴다', async () => {
    const { rerender } = view({ initialIndex: 1 });
    expect(screen.getByText('점심 먹었어')).toBeInTheDocument();
    screen.getByRole('button', { name: '원본 보기' }).focus();

    rerender(
      <StoryViewer
        cards={[CARDS[0], CARDS[2]]}
        initialIndex={1}
        mode="today"
        title="춘향의 오늘"
        onClose={vi.fn()}
        onOpenRecord={vi.fn()}
      />,
    );

    expect(screen.getByTestId('story-current-unavailable')).toBeInTheDocument();
    expect(screen.getByText('이 기록은 더 이상 볼 수 없어요')).toBeInTheDocument();
    expect(screen.queryByText('오늘 시험 끝났어')).not.toBeInTheDocument();
    expect(screen.queryByTestId('story-acknowledge')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '원본 보기' })).not.toBeInTheDocument();
    const unavailableHeading = screen.getByRole('heading', { name: '이 기록은 더 이상 볼 수 없어요' });
    await act(async () => undefined);
    expect(unavailableHeading).toHaveFocus();
  });

  it('읽던 원본이 같은 ID의 부재 카드로 바뀌어도 안내로 포커스를 옮긴다', async () => {
    const { rerender } = view({ initialIndex: 1 });
    screen.getByRole('button', { name: '원본 보기' }).focus();

    rerender(
      <StoryViewer
        cards={[CARDS[0], { kind: 'missing', recordId: 'b' }, CARDS[2]]}
        initialIndex={1}
        mode="today"
        title="춘향의 오늘"
        onClose={vi.fn()}
        onOpenRecord={vi.fn()}
      />,
    );

    const unavailableHeading = screen.getByRole('heading', { name: '이 기록은 더 이상 볼 수 없어요' });
    await act(async () => undefined);
    expect(unavailableHeading).toHaveFocus();
    expect(screen.queryByRole('button', { name: '원본 보기' })).not.toBeInTheDocument();
  });
});

describe('확인은 읽기의 끝에서만 일어난다', () => {
  it('마지막 카드 전에는 확인 버튼이 없다', async () => {
    const onAcknowledge = vi.fn();
    view({ onAcknowledge });
    expect(screen.queryByTestId('story-acknowledge')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '다음 순간' }));
    expect(screen.queryByTestId('story-acknowledge')).toBeNull();
    expect(onAcknowledge).not.toHaveBeenCalled();
  });

  it('마지막 카드에서 누르면 확인된다', async () => {
    const onAcknowledge = vi.fn();
    view({ initialIndex: 2, onAcknowledge });
    await userEvent.click(screen.getByTestId('story-acknowledge'));
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });

  it('그냥 나가면 아무것도 확정되지 않는다', async () => {
    // 마지막 카드까지 갔어도 누르지 않았다면 확인이 아니다. 지금 계약 그대로다.
    const onAcknowledge = vi.fn();
    const onClose = vi.fn();
    view({ initialIndex: 2, onAcknowledge, onClose });
    await userEvent.click(screen.getByRole('button', { name: '스토리 닫기' }));
    expect(onClose).toHaveBeenCalled();
    expect(onAcknowledge).not.toHaveBeenCalled();
  });

  it('저장할 수 없으면 이유를 말하고 막는다', () => {
    view({ initialIndex: 2, onAcknowledge: vi.fn(), acknowledgeDisabledReason: '지금은 확인을 저장할 수 없어요' });
    expect(screen.getByTestId('story-acknowledge')).toBeDisabled();
    expect(screen.getByText('지금은 확인을 저장할 수 없어요')).toBeTruthy();
  });

  it('보관 모드에는 확인이 없다', () => {
    // 지나간 하루를 오늘 "확인"하는 것은 의미가 없고, 영수증을 앞으로 밀어 버린다.
    view({ initialIndex: 2, mode: 'archive', onAcknowledge: vi.fn(), title: '8월 14일' });
    expect(screen.queryByTestId('story-acknowledge')).toBeNull();
  });
});

describe('책갈피', () => {
  it('오늘 스토리에서는 붙일 수 있다', async () => {
    const onToggleBookmark = vi.fn();
    view({ onToggleBookmark, talkAboutStateByRecordId: new Map([['a', 'none']]) });
    await userEvent.click(screen.getByRole('button', { name: '이따 이야기하기' }));
    expect(onToggleBookmark).toHaveBeenCalledWith('a', true);
  });

  it('상대만 표시했으면 내 표시는 눌리지 않고 나도 표시하는 동작을 준다', async () => {
    const onToggleBookmark = vi.fn();
    view({
      onToggleBookmark,
      bookmarkPartnerName: '몽룡',
      talkAboutStateByRecordId: new Map([['a', 'partner_only']]),
    });

    const action = screen.getByRole('button', {
      name: '몽룡님이 표시했어요. 나도 이따 이야기하기',
    });
    expect(action).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(action);
    expect(onToggleBookmark).toHaveBeenCalledWith('a', true);
  });

  it('둘 다 표시했으면 상대도 표시했음을 말하고 내 표시만 빼는 동작을 준다', async () => {
    const onToggleBookmark = vi.fn();
    view({
      onToggleBookmark,
      bookmarkPartnerName: '몽룡',
      talkAboutStateByRecordId: new Map([['a', 'both']]),
    });

    const action = screen.getByRole('button', {
      name: '몽룡님도 표시했어요. 이따 이야기하기 표시 해제',
    });
    expect(action).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(action);
    expect(onToggleBookmark).toHaveBeenCalledWith('a', false);
  });

  it('보관 모드에서는 사라진다', () => {
    /*
      3개월 전 기록에 오늘 표시가 붙으면 그건 알림이 되고, 알림은 "왜 지금 봤어?"라는
      관찰 질문을 만든다. 과거는 조용해야 한다.
    */
    view({ mode: 'archive', onToggleBookmark: undefined });
    expect(screen.queryByRole('button', { name: '이따 이야기하기' })).toBeNull();
  });

  it('사진과 글 아래의 스크롤 본문 안에 놓인다', () => {
    const { container } = view({
      onToggleBookmark: vi.fn(),
      cards: [{
        kind: 'moment',
        record: record({ attachments: [{ type: 'photo', name: '사진.jpg' }] }),
      }],
    });
    const bookmark = screen.getByRole('button', { name: '이따 이야기하기' });
    expect(container.querySelector('.overflow-y-auto')?.contains(bookmark)).toBe(true);
    expect(screen.getByTestId('media-r1')).toHaveAttribute('data-fit', 'contain');
  });

  it('책갈피를 길게 눌러도 스토리 UI 숨김 제스처가 시작되지 않는다', () => {
    vi.useFakeTimers();
    view({ onToggleBookmark: vi.fn() });
    const bookmark = screen.getByRole('button', { name: '이따 이야기하기' });

    fireEvent.pointerDown(bookmark);
    act(() => { vi.advanceTimersByTime(500); });

    expect(bookmark.parentElement).not.toHaveClass('opacity-0');
  });
});

describe('없는 것', () => {
  it('조회수도 본 사람도 표시하지 않는다', () => {
    for (const forbidden of ['viewed_by', 'seen_at', 'view_count', 'viewerCount', '조회', '읽음']) {
      expect(SOURCE, forbidden).not.toContain(forbidden);
    }
  });

  it('답장 입력창이 없다', () => {
    // 자체 채팅은 FROZEN이고 출구는 앱 밖의 통화다.
    view();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('부재와 목차', () => {
  it('볼 수 없는 기록은 사실대로 말하고 대체하지 않는다', () => {
    view({ cards: [{ kind: 'missing', recordId: 'gone' }, ...CARDS], initialIndex: 0 });
    expect(screen.getByText('이 기록은 더 이상 볼 수 없어요')).toBeTruthy();
    // 왜 볼 수 없는지는 말하지 않는다 -- 삭제인지 비공개 전환인지가 그 자체로 정보다.
    expect(screen.queryByText(/삭제|비공개/)).toBeNull();
  });

  it('목차의 줄을 누르면 그 원본으로 요청한다', async () => {
    const onJumpToRecord = vi.fn();
    view({
      cards: [
        { kind: 'cover', rangeLabel: '오늘', lines: [{ recordId: 'b', text: '점심 먹었어', time: '13:00', date: '2026-08-22' }] },
        ...CARDS,
      ],
      initialIndex: 0,
      onJumpToRecord,
    });
    await userEvent.click(screen.getByText('점심 먹었어'));
    expect(onJumpToRecord).toHaveBeenCalledWith('b');
  });

  it('5개 이하 줄이면 더 보기 버튼 없이 모든 줄이 표시된다', () => {
    const lines = Array.from({ length: 5 }, (_, i) => ({
      recordId: `r${i}`,
      text: `줄 ${i}`,
      time: `0${i}:00`,
      date: '2026-08-22',
    }));
    view({
      cards: [{ kind: 'cover', rangeLabel: '오늘', lines }, ...CARDS],
      initialIndex: 0,
    });
    for (let i = 0; i < 5; i++) {
      expect(screen.getByText(`줄 ${i}`)).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: /더 보기|접기/ })).toBeNull();
  });

  it('정확히 8개 줄: 초기 5개 + 3개 더 보기, 펼치기/접기 및 확장 줄 이동 검증', async () => {
    const onJumpToRecord = vi.fn();
    const lines = Array.from({ length: 8 }, (_, i) => ({
      recordId: `r${i}`,
      text: `줄 ${i}`,
      time: `0${i}:00`,
      date: '2026-08-22',
    }));
    view({
      cards: [{ kind: 'cover', rangeLabel: '오늘', lines }, ...CARDS],
      initialIndex: 0,
      onJumpToRecord,
    });

    // 초기 상태: 0~4번 5개 노출, 5~7번 미노출
    for (let i = 0; i < 5; i++) {
      expect(screen.getByText(`줄 ${i}`)).toBeTruthy();
    }
    expect(screen.queryByText('줄 5')).toBeNull();
    expect(screen.queryByText('줄 7')).toBeNull();

    const moreButton = screen.getByRole('button', { name: '3개 더 보기' });
    expect(moreButton).toBeTruthy();
    expect(moreButton).toHaveAttribute('aria-expanded', 'false');
    expect(moreButton.className).toContain('min-h-11');

    // 펼치기
    await userEvent.click(moreButton);
    expect(screen.getByText('줄 5')).toBeTruthy();
    expect(screen.getByText('줄 7')).toBeTruthy();
    const foldButton = screen.getByRole('button', { name: '접기' });
    expect(foldButton).toBeTruthy();
    expect(foldButton).toHaveAttribute('aria-expanded', 'true');
    expect(foldButton.className).toContain('min-h-11');

    // 확장된 줄(예: 8번째 줄, r7) 클릭 시 원본 점프
    await userEvent.click(screen.getByText('줄 7'));
    expect(onJumpToRecord).toHaveBeenCalledWith('r7');

    // 접기
    await userEvent.click(foldButton);
    expect(screen.getByRole('button', { name: '3개 더 보기' })).toBeTruthy();
    expect(screen.queryByText('줄 5')).toBeNull();
    expect(screen.queryByText('줄 7')).toBeNull();
  });

  it('열 수 없는 기록 수를 닫는 카드에서 말한다', () => {
    view({ cards: [{ kind: 'closing', momentCount: 2, unreadableCount: 3 }], initialIndex: 0 });
    expect(screen.getByText('열 수 없는 기록 3개')).toBeTruthy();
  });
});

describe('시간순 baseline과 선택형 기기 AI 상태', () => {
  const cover: StoryCard = {
    kind: 'cover',
    rangeLabel: '오늘',
    lines: Array.from({ length: 8 }, (_, index) => ({
      recordId: `r${index}`,
      text: `줄 ${index}`,
      time: `0${index}:00`,
      date: '2026-08-22',
    })),
  };

  it('모델과 무관하게 전체 개수와 시간순 정리 상태를 사실대로 표시한다', () => {
    view({ cards: [cover], initialIndex: 0 });
    expect(screen.getByText('오늘 기록 8개 · 시간순 정리됨')).toBeTruthy();
    expect(screen.queryByText(/AI/)).toBeNull();
  });

  it('running은 role=status로 baseline이 계속 보인다는 사실을 알리고 모션에 의존하지 않는다', () => {
    view({
      cards: [cover],
      initialIndex: 0,
      onRefineCover: vi.fn(),
      coverRefinementStatus: 'running',
    });

    expect(screen.getByRole('status')).toHaveTextContent(
      '기기 AI로 긴 문장 줄이는 중 · 기본 시간순 정리는 계속 보여요',
    );
    const action = screen.getByRole('button', { name: '긴 문장 줄이는 중' });
    expect(action).toHaveAttribute('aria-busy', 'true');
    expect(action.querySelector('svg')).toHaveClass('motion-safe:animate-spin', 'motion-reduce:hidden');
  });

  it('success를 role=status로 알린다', () => {
    view({
      cards: [cover],
      initialIndex: 0,
      onRefineCover: vi.fn(),
      coverRefinementStatus: 'applied',
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      '기기 AI로 긴 문장 줄이기 완료 · 원문 연결은 그대로예요',
    );
  });

  it('fallback을 role=status로 알리고 baseline 유지와 같은 CTA 재시도를 제공한다', () => {
    view({
      cards: [cover],
      initialIndex: 0,
      onRefineCover: vi.fn(),
      coverRefinementStatus: 'fallback',
      coverRefinementReason: 'timeout',
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      '기기 AI가 제시간에 끝나지 않았어요. 시간순 정리를 그대로 보여드려요.',
    );
    expect(screen.getByRole('button', { name: '기기 AI로 긴 문장 줄이기' })).toBeTruthy();
  });
});

describe('접근성', () => {
  it('대화상자로 알리고 이름을 준다', () => {
    view();
    expect(screen.getByRole('dialog', { name: '춘향의 오늘' })).toHaveAttribute('aria-modal', 'true');
  });

  it('카드가 바뀌면 무엇이 보이는지 말한다', async () => {
    const { container } = view();
    const live = container.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toContain('3개 중 1번째');
    await userEvent.click(screen.getByRole('button', { name: '다음 순간' }));
    expect(live?.textContent).toContain('3개 중 2번째');
  });

  it('작성자 이름을 반복하지 않고 시간을 분까지만 표시한다', () => {
    view({
      title: '오늘',
      cards: [{ kind: 'moment', record: record({ time: '9:07:33' }) }],
    });
    expect(screen.getByText('09:07')).toBeTruthy();
    expect(screen.queryByText(/춘향/)).toBeNull();
    expect(screen.queryByText('9:07:33')).toBeNull();
  });
});

describe('사용자가 쓴 글에만 손글씨', () => {
  it('본문은 손글씨, 시간은 인쇄체', () => {
    view();
    expect(screen.getByText('오늘 시험 끝났어')).toHaveClass('hand-text', 'record-copy');
    expect(screen.getByText('09:00')).not.toHaveClass('hand-text', 'record-copy');
  });
});

describe('파트너 브리핑 화면 지원 (Phase B3 Gate)', () => {
  it('briefing이 있으면 0번에서 브리핑으로 시작하고 Next 전까지 원본 카드가 노출되지 않는다', () => {
    const briefing = mockBriefing();
    const { container } = view({ briefing, cards: CARDS, initialIndex: 0 });

    // 1 / 4 표시
    expect(screen.getByText('1 / 4')).toBeTruthy();
    expect(screen.getByTestId('partner-briefing-card')).toBeTruthy();
    expect(screen.getByText('총 2개의 기록이 있습니다.')).toBeTruthy();

    // 원본 카드의 순간 전용 컨트롤 및 시간 헤더 미노출
    expect(screen.queryByRole('button', { name: '이따 이야기하기' })).toBeNull();
    expect(screen.queryByText('09:00')).toBeNull();

    // 스크린리더 공지
    const live = container.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toContain('4개 중 1번째, 브리핑');
  });

  it('Next 이동 시 정확한 첫 번째 원본 순간에 도달하고 이후 closing 카드가 유지된다', async () => {
    const onAcknowledge = vi.fn();
    const briefing = mockBriefing();
    view({ briefing, cards: CARDS, initialIndex: 0, onAcknowledge });

    // 브리핑 -> 첫 순간 (a)
    await userEvent.click(screen.getByRole('button', { name: '다음 순간' }));
    expect(screen.getByText('2 / 4')).toBeTruthy();
    expect(screen.getByText('09:00')).toBeTruthy();
    expect(screen.getByText('오늘 시험 끝났어')).toBeTruthy();

    // 첫 순간 -> 둘째 순간 (b)
    await userEvent.click(screen.getByRole('button', { name: '다음 순간' }));
    expect(screen.getByText('3 / 4')).toBeTruthy();
    expect(screen.getByText('13:00')).toBeTruthy();
    expect(screen.getByText('점심 먹었어')).toBeTruthy();

    // 둘째 순간 -> 닫는 카드 (closing)
    await userEvent.click(screen.getByRole('button', { name: '다음 순간' }));
    expect(screen.getByText('4 / 4')).toBeTruthy();
    expect(screen.getByText('여기까지가 춘향의 오늘이에요')).toBeTruthy();
    expect(screen.getByTestId('story-acknowledge')).toBeTruthy();
  });

  it('PartnerBriefingCard의 원본 보기 클릭 시 exact sourceRecordId로 onOpenRecord가 호출된다', async () => {
    const onOpenRecord = vi.fn();
    const briefing = mockBriefing();
    view({ briefing, cards: CARDS, initialIndex: 0, onOpenRecord });

    // 자세히 보기 펼치기
    await userEvent.click(screen.getByTestId('partner-briefing-expand'));
    const viewButtons = screen.getAllByRole('button', { name: '원본 보기' });
    expect(viewButtons).toHaveLength(2);

    // 첫 번째 항목 클릭 -> 'a'
    await userEvent.click(viewButtons[0]);
    expect(onOpenRecord).toHaveBeenCalledTimes(1);
    expect(onOpenRecord).toHaveBeenLastCalledWith('a');

    // 두 번째 항목 클릭 -> 'b'
    await userEvent.click(viewButtons[1]);
    expect(onOpenRecord).toHaveBeenCalledTimes(2);
    expect(onOpenRecord).toHaveBeenLastCalledWith('b');
  });

  it('브리핑 펼치기/접기/이동/닫기는 onAcknowledge를 호출하지 않는다', async () => {
    const onAcknowledge = vi.fn();
    const onClose = vi.fn();
    const briefing = mockBriefing();
    view({ briefing, cards: CARDS, initialIndex: 0, onAcknowledge, onClose });

    const expandBtn = screen.getByTestId('partner-briefing-expand');
    await userEvent.click(expandBtn);
    expect(onAcknowledge).not.toHaveBeenCalled();

    await userEvent.click(expandBtn);
    expect(onAcknowledge).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: '다음 순간' }));
    expect(onAcknowledge).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: '스토리 닫기' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onAcknowledge).not.toHaveBeenCalled();
  });

  it('onAcknowledge는 오직 closing 카드의 명시적 확인 버튼에서만 호출된다', async () => {
    const onAcknowledge = vi.fn();
    const briefing = mockBriefing();
    view({ briefing, cards: CARDS, initialIndex: 3, onAcknowledge });

    expect(screen.getByText('4 / 4')).toBeTruthy();
    await userEvent.click(screen.getByTestId('story-acknowledge'));
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });

  it('combined 시퀀스에서 진행 표시 및 화살표 비활성 상태가 정확하다', () => {
    const briefing = mockBriefing();

    // 0번 (브리핑): 이전 비활성, 다음 활성
    const { unmount } = view({ briefing, cards: CARDS, initialIndex: 0 });
    expect(screen.getByText('1 / 4')).toBeTruthy();
    expect(screen.getByRole('button', { name: '이전 순간' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '다음 순간' })).not.toBeDisabled();
    unmount();

    // 마지막 3번 (closing): 이전 활성, 다음 비활성
    view({ briefing, cards: CARDS, initialIndex: 3 });
    expect(screen.getByText('4 / 4')).toBeTruthy();
    expect(screen.getByRole('button', { name: '이전 순간' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: '다음 순간' })).toBeDisabled();
  });

  it('initialIndex가 combined 시퀀스의 raw moment를 가리키면 정확한 카드를 열고 엉뚱한 기록으로 밀리지 않는다', async () => {
    const briefing = mockBriefing();

    // initialIndex = 1 -> 첫 번째 카드 (a)
    const { unmount } = view({ briefing, cards: CARDS, initialIndex: 1 });
    expect(screen.getByText('2 / 4')).toBeTruthy();
    expect(screen.getByText('09:00')).toBeTruthy();
    expect(screen.getByText('오늘 시험 끝났어')).toBeTruthy();
    expect(screen.queryByTestId('partner-briefing-card')).toBeNull();
    unmount();

    // initialIndex = 2 -> 두 번째 카드 (b)
    view({ briefing, cards: CARDS, initialIndex: 2 });
    expect(screen.getByText('3 / 4')).toBeTruthy();
    expect(screen.getByText('13:00')).toBeTruthy();
    expect(screen.getByText('점심 먹었어')).toBeTruthy();

    // 이전 순간 클릭 시 브리핑으로 역방향 이동 가능
    await userEvent.click(screen.getByRole('button', { name: '이전 순간' }));
    expect(screen.getByText('2 / 4')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '이전 순간' }));
    expect(screen.getByText('1 / 4')).toBeTruthy();
    expect(screen.getByTestId('partner-briefing-card')).toBeTruthy();
  });

  it('briefing만 있고 cards=[]인 경우에도 안전하게 렌더된다', () => {
    const briefing = mockBriefing();
    const { container } = view({ briefing, cards: [], initialIndex: 0 });

    expect(screen.getByTestId('partner-briefing-card')).toBeTruthy();
    expect(screen.getByText('1 / 1')).toBeTruthy();
    expect(screen.getByRole('button', { name: '이전 순간' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '다음 순간' })).toBeDisabled();

    const live = container.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toContain('1개 중 1번째, 브리핑');
  });

  it('briefing도 없고 cards도 없으면 null을 반환한다', () => {
    const { container } = view({ briefing: null, cards: [], initialIndex: 0 });
    expect(container.firstChild).toBeNull();
  });

  it('briefingLocale props가 PartnerBriefingCard에 전달된다', async () => {
    const briefing = mockBriefing({
      rangeLabel: 'August 22',
      overview: { text: '2 records in total.', sourceRecordIds: ['a', 'b'] },
    });
    view({ briefing, cards: CARDS, briefingLocale: 'en', initialIndex: 0 });

    expect(screen.getByText('Since you last checked')).toBeTruthy();
    expect(screen.getByText('2 moments')).toBeTruthy();
    expect(screen.getByRole('button', { name: /See details/i })).toBeTruthy();
  });
});
