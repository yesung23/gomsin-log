import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { StoryViewer } from '@/features/story/StoryViewer';
import type { StoryCard } from '@/features/story/storyProjection';
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
    view({ onToggleBookmark, markedRecordIds: new Set<string>() });
    await userEvent.click(screen.getByRole('button', { name: '이따 이야기하기' }));
    expect(onToggleBookmark).toHaveBeenCalledWith('a', true);
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
