import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { X, ChevronLeft, ChevronRight, ArrowUpRight, BookmarkPlus, Check } from 'lucide-react';
import type { StoryCard } from '@/features/story/storyProjection';
import { RecordMediaGallery } from '@/components/media/RecordMediaGallery';
import { PaperCard, Bookmark, FoldDivider } from '@/components/paper';
import { cn } from '@/lib/utils';

/**
 * 스토리 뷰어 — 상대의 하루를 하나씩 넘겨 본다.
 *
 * ## 자동으로 넘어가지 않는다
 *
 * 인스타의 스토리는 6초마다 넘어간다. 여기에는 타이머가 없고, 없는 것이 이 파일에서
 * 가장 중요한 결정이다. 이유가 셋이다.
 *
 *   1. 자동 진행은 원본을 *스치게* 만든다. 이 앱은 원본을 *읽게* 하려고 존재한다
 *      (PRODUCT_V3 §3 원칙 1).
 *   2. 사흘을 못 본 사람에게 12개의 순간이 있으면 타이머는 72초 만에 전부 지나간다.
 *      §6.1이 정의한 "마지막 확인 이후 놓친 구간"이 통째로 사라진다.
 *   3. WCAG 2.2.2 -- 5초 넘게 자동 진행되는 콘텐츠에는 정지 수단이 필요하다.
 *
 * 그래서 상단 막대는 시간이 흐르는 표시가 아니라 **위치 표시**다. 넘길 이유는 타이머가
 * 아니라 콘텐츠가 만든다.
 *
 * ## 조회수도, 본 사람도 없다
 *
 * 이 컴포넌트는 "누가 봤는지"를 어디에도 보내지 않는다. 서버로 가는 유일한 쓰기는
 * `onAcknowledge`(내가 다 읽었다는 나 자신의 영수증)와 책갈피뿐이다. 곰신이 알 수 있는
 * 것은 "닿았다"까지이고 "읽었다"는 영원히 알 수 없다(§14.3).
 *
 * ## 반응 도장이 아직 없는 이유
 *
 * 뷰어 반응(`공감`/`토닥이기`)은 데이터 모델에 존재하지 않는다. 서버 테이블과 RLS가
 * 필요하고 그것은 migration gate 대상이므로 이 단계에서 만들지 않는다.
 * `src/components/paper/Stamp.tsx`가 이미 있고 테스트도 있으니, 모델이 생기면 카드
 * 액션 줄에 붙이면 된다.
 */

export type StoryMode = 'today' | 'mine' | 'archive' | 'highlight';

export interface StoryViewerProps {
  cards: StoryCard[];
  initialIndex: number;
  mode: StoryMode;
  /** 헤더에 적는 이름. `춘향의 오늘` / `나의 오늘` / `8월 14일`. */
  title: string;
  onClose: () => void;
  /** 정확한 원본으로. 근사치로 대체하지 않는다. */
  onOpenRecord: (recordId: string) => void;
  /** 사진 스토리의 원본을 프로필 하이라이트 편집기로 가져온다. */
  onAddToHighlight?: (recordId: string) => void;
  /** 속표지의 줄을 눌렀을 때. 그 줄이 가리키는 카드로 이동한다. */
  onJumpToRecord?: (recordId: string) => void;
  /** 책갈피 토글. `archive`에서는 넘기지 않는다. */
  onToggleBookmark?: (recordId: string, next: boolean) => void;
  markedRecordIds?: ReadonlySet<string>;
  /** 닫는 카드의 `다 읽었어요`. `today`에서만 온다. */
  onAcknowledge?: () => void;
  acknowledgeDisabledReason?: string;
  bookmarkDisabledReason?: string;
  /** 미디어 복호에 필요한 커플 범위. */
  coupleId?: string;
}

export function StoryViewer({
  cards,
  initialIndex,
  mode,
  title,
  onClose,
  onOpenRecord,
  onAddToHighlight,
  onJumpToRecord,
  onToggleBookmark,
  markedRecordIds,
  onAcknowledge,
  acknowledgeDisabledReason,
  bookmarkDisabledReason,
  coupleId,
}: StoryViewerProps) {
  const [index, setIndex] = useState(
    () => Math.min(Math.max(initialIndex, 0), Math.max(cards.length - 1, 0)),
  );
  /** 홀드하면 UI를 감추고 사진만 남긴다. 멈출 타이머가 없으므로 용도가 이것뿐이다. */
  const [bare, setBare] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const card = cards[index];
  const total = cards.length;

  const go = useCallback((target: number) => {
    setIndex(Math.min(Math.max(target, 0), total - 1));
  }, [total]);

  /*
    마지막에서는 넘어가지 않는다.

    처음에는 "한 번 더 누르면 닫힘"으로 만들었다가 되돌렸다. 그러면 마지막 카드에서
    화살표·헤더의 X·카드 안의 버튼 셋이 전부 "닫기"가 되어, 스크린리더에는 같은 이름의
    컨트롤 셋으로 들린다. 그리고 다음을 보려던 손가락이 화면을 닫아 버린다.

    끝에서 나가는 길은 닫는 카드가 소유한다 -- `다 읽었어요`이거나 `닫기`이거나.
  */
  const next = useCallback(() => go(index + 1), [index, go]);
  const previous = useCallback(() => go(index - 1), [index, go]);

  /*
    키보드만으로 전 구간을 돌 수 있어야 한다.

    제스처만 있는 전체화면은 스크린리더·키보드 사용자를 잃는다. 이 저장소는 접근성을
    테스트로 강제하고 있으므로 여기서도 같은 기준을 지킨다. WCAG 2.1 SC 2.1.1.
  */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); next(); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); previous(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, previous, onClose]);

  /*
    열리면 포커스를 안으로 가져온다.

    가져오지 않으면 다음 Tab이 뒤에 남은 화면의 컨트롤로 들어가고, 스크린리더 사용자는
    자기가 무엇을 열었는지 듣지 못한다. WCAG 2.1 SC 2.4.3.
  */
  useEffect(() => { containerRef.current?.focus(); }, []);

  /** 카드가 바뀌면 무엇이 보이는지 말한다. SC 4.1.3. */
  const announcement = useMemo(() => {
    if (!card) return '';
    const position = `${total}개 중 ${index + 1}번째`;
    if (card.kind === 'cover') return `${position}, 목차`;
    if (card.kind === 'missing') return `${position}, 볼 수 없는 기록`;
    if (card.kind === 'closing') return `${position}, 마지막`;
    return `${position}, ${card.record.time}`;
  }, [card, index, total]);

  const startHold = () => { holdTimer.current = setTimeout(() => setBare(true), 400); };
  const endHold = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
    setBare(false);
  };

  if (!card) return null;

  const marked = card.kind === 'moment' && markedRecordIds?.has(card.record.id) === true;

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid="story-viewer"
      className="fixed inset-0 z-50 flex flex-col bg-background outline-none"
    >
      <p className="sr-only" aria-live="polite">{announcement}</p>

      {/*
        위치 표시.

        칸이 채워지는 애니메이션이 없다. 시간이 흐르지 않기 때문이고, 흐르는 것처럼
        보이면 사용자가 서두른다.
      */}
      <div className={cn('flex gap-1 px-4 pt-3 transition-opacity', bare && 'opacity-0')}>
        {cards.map((_, position) => (
          <span
            key={position}
            className={cn('h-0.5 flex-1 rounded-full', position <= index ? 'bg-coral-strong' : 'bg-border')}
          />
        ))}
      </div>

      <div className={cn('flex items-center justify-between gap-2 px-4 py-3 transition-opacity', bare && 'opacity-0')}>
        <div className="min-w-0">
          <p className="text-emphasis text-foreground truncate">{title}</p>
          {card.kind === 'moment' ? (
            <p className="text-caption text-muted-foreground">{card.record.time}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="스토리 닫기"
          className="press-response -mr-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-control text-muted-foreground"
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>

      <div
        className="relative flex-1 overflow-y-auto px-4 pb-4"
        onPointerDown={startHold}
        onPointerUp={endHold}
        onPointerCancel={endHold}
        onPointerLeave={endHold}
      >
        {card.kind === 'cover' ? (
          <CoverCard card={card} onJump={onJumpToRecord} />
        ) : card.kind === 'missing' ? (
          <MissingCard />
        ) : card.kind === 'closing' ? (
          <ClosingCard
            card={card}
            mode={mode}
            title={title}
            onAcknowledge={onAcknowledge}
            disabledReason={acknowledgeDisabledReason}
            onClose={onClose}
          />
        ) : (
          <MomentCard record={card.record} coupleId={coupleId} />
        )}
      </div>

      {card.kind === 'moment' ? (
        <div className={cn('flex items-center gap-1 border-t border-border px-3 py-2 transition-opacity', bare && 'opacity-0')}>
          {mode !== 'archive' && mode !== 'highlight' && onToggleBookmark ? (
            <Bookmark
              marked={marked}
              onToggle={() => onToggleBookmark(card.record.id, !marked)}
              disabled={Boolean(bookmarkDisabledReason)}
              disabledReason={bookmarkDisabledReason}
            />
          ) : null}
          <span className="flex-1" />
          {onAddToHighlight && !card.record.isPrivate && card.record.attachments?.some((attachment) => attachment.type === 'photo') ? (
            <button
              type="button"
              onClick={() => onAddToHighlight(card.record.id)}
              aria-label="하이라이트에 추가"
              className="press-response inline-flex min-h-11 items-center gap-1 rounded-control px-3 text-label font-semibold text-foreground"
            >
              <BookmarkPlus size={16} aria-hidden="true" />
              하이라이트
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onOpenRecord(card.record.id)}
            className="press-response inline-flex min-h-11 items-center gap-1 rounded-control px-3 text-label font-semibold text-foreground"
          >
            원본 보기
            <ArrowUpRight size={15} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {/*
        좌우 이동.

        인스타처럼 화면 절반을 탭 영역으로 쓰지 않는다. 그 방식은 사진을 확대하려는
        탭과 구분되지 않고, 스크린리더에는 이름 없는 큰 영역 둘로 들린다. 대신 이름이
        있는 44px 버튼 둘을 가장자리에 둔다.
      */}
      <div className={cn('flex items-center justify-between px-2 pb-3 transition-opacity', bare && 'opacity-0')}>
        <button
          type="button"
          onClick={previous}
          disabled={index === 0}
          aria-label="이전 순간"
          className="press-response inline-flex min-h-11 min-w-11 items-center justify-center rounded-control text-muted-foreground disabled:opacity-30"
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
        <span className="text-caption text-muted-foreground" aria-hidden="true">
          {index + 1} / {total}
        </span>
        <button
          type="button"
          onClick={next}
          disabled={index >= total - 1}
          aria-label="다음 순간"
          className="press-response inline-flex min-h-11 min-w-11 items-center justify-center rounded-control text-muted-foreground disabled:opacity-30"
        >
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function CoverCard({
  card,
  onJump,
}: {
  card: Extract<StoryCard, { kind: 'cover' }>;
  onJump?: (recordId: string) => void;
}) {
  return (
    <PaperCard className="mt-2">
      <p className="text-caption text-muted-foreground">{card.rangeLabel}</p>
      <FoldDivider className="my-4" />
      <ul className="space-y-3">
        {card.lines.map((line) => (
          <li key={line.recordId}>
            <button
              type="button"
              onClick={() => onJump?.(line.recordId)}
              className="press-response-row flex w-full min-h-11 items-baseline gap-3 rounded-control text-left"
            >
              <span className="shrink-0 text-caption text-muted-foreground tabular-nums">{line.time}</span>
              {/* 사용자가 쓴 글이므로 손글씨다. 시간은 앱이 아는 사실이므로 인쇄체다. */}
              <span className="hand-text text-body text-foreground">{line.text}</span>
            </button>
          </li>
        ))}
      </ul>
    </PaperCard>
  );
}

function MomentCard({
  record,
  coupleId,
}: {
  record: Extract<StoryCard, { kind: 'moment' }>['record'];
  coupleId?: string;
}) {
  const attachments = record.attachments ?? [];
  const body = (record.log ?? '').trim();

  /*
    사진이 없으면 종이 카드가 된다.

    사진 자리를 비워 두면 구멍이 되고, 글이 그 자리를 차지하면 글이 주인공인 하루가 된다.
    2026-08-20에 되돌린 인스타형 피드가 실패한 이유가 정확히 밀도였고, 이 분기가 그
    재발 조건을 없앤다.
  */
  if (attachments.length === 0) {
    return (
      <PaperCard className="mt-2">
        {/* 자르지 않는다. 요약을 보여주는 화면이 아니다. */}
        <p className="hand-text text-body whitespace-pre-wrap break-keep text-foreground">
          {body || '순간을 남겼어요'}
        </p>
      </PaperCard>
    );
  }

  return (
    <div className="mt-2 space-y-3">
      <RecordMediaGallery attachments={attachments} recordId={record.id} coupleId={coupleId} />
      {body ? (
        <p className="hand-text text-body whitespace-pre-wrap break-keep text-foreground">{body}</p>
      ) : null}
    </div>
  );
}

function MissingCard() {
  return (
    <PaperCard className="mt-2 text-center">
      {/*
        대체하지 않는다.

        삭제됐거나 비공개로 바뀐 기록 자리에 비슷한 기록을 넣는 것은 §6.4가 금지한다.
        왜 볼 수 없는지는 말하지 않는다 -- 삭제인지 비공개 전환인지를 구분해 알리면
        그 자체가 상대에 대한 정보가 된다.
      */}
      <p className="text-body text-muted-foreground">이 기록은 더 이상 볼 수 없어요</p>
    </PaperCard>
  );
}

function ClosingCard({
  card,
  mode,
  title,
  onAcknowledge,
  disabledReason,
  onClose,
}: {
  card: Extract<StoryCard, { kind: 'closing' }>;
  mode: StoryMode;
  title: string;
  onAcknowledge?: () => void;
  disabledReason?: string;
  onClose: () => void;
}): ReactNode {
  return (
    <PaperCard className="mt-2 text-center">
      <p className="text-body text-foreground">여기까지가 {title}이에요</p>
      {card.unreadableCount > 0 ? (
        /*
          개수만 말한다.

          복호화 실패는 권한 문제가 아니라 기기 상태 문제이므로 개수 표시가 허용된다.
          권한이 막은 기록은 애초에 여기까지 오지 않으므로 표시할 개수 자체가 없다(§6.4).
        */
        <p className="mt-2 text-caption text-muted-foreground">
          열 수 없는 기록 {card.unreadableCount}개
        </p>
      ) : null}

      {mode === 'today' && onAcknowledge ? (
        <button
          type="button"
          onClick={onAcknowledge}
          disabled={Boolean(disabledReason)}
          title={disabledReason}
          data-testid="story-acknowledge"
          className="press-response mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-coral-strong px-5 text-label font-semibold text-coral-strong-foreground disabled:opacity-60"
        >
          <Check size={16} aria-hidden="true" />
          다 읽었어요
        </button>
      ) : (
        <button
          type="button"
          onClick={onClose}
          className="press-response mt-6 inline-flex min-h-11 items-center justify-center rounded-control border border-border px-5 text-label font-semibold text-foreground"
        >
          닫기
        </button>
      )}
      {disabledReason ? (
        <p className="mt-2 text-caption text-muted-foreground">{disabledReason}</p>
      ) : null}
    </PaperCard>
  );
}
