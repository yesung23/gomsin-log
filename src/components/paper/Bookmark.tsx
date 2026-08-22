import { Bookmark as BookmarkIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * 이따 이야기하기 — 책갈피.
 *
 * 인스타의 저장(북마크)과 같은 자리, 같은 제스처, 같은 개념이다. "나중에 볼 것"을
 * 표시해 두는 것. 다른 점은 이 표시가 **상대에게도 보인다**는 것이고, 그건 숨기면
 * 의미가 없기 때문이다 -- 목적이 대화 예고이므로(PRODUCT_V3 §8).
 *
 * ## 공유 기록에만 붙는다
 *
 * 비공개 기록에는 붙을 수 없다. 붙는 순간 그 기록의 존재가 상대에게 알려지기 때문이다.
 * 그 판정은 호출부가 하고, 여기서는 `disabled`로만 받는다 -- 권한 판정을 두 곳에서 하면
 * 두 곳이 어긋난다.
 */
export function Bookmark({
  marked,
  onToggle,
  disabled = false,
  disabledReason,
  className,
}: {
  marked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
}) {
  const label = marked ? '이따 이야기하기 표시 해제' : '이따 이야기하기';
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={marked}
      aria-label={disabled && disabledReason ? `${label} — ${disabledReason}` : label}
      title={disabled ? disabledReason : undefined}
      className={cn(
        'press-response inline-flex min-h-11 min-w-11 items-center justify-center',
        'rounded-control transition-colors duration-[120ms]',
        marked ? 'text-coral-strong' : 'text-muted-foreground hover:text-foreground',
        disabled && 'opacity-50',
        className,
      )}
    >
      <BookmarkIcon size={18} strokeWidth={2} fill={marked ? 'currentColor' : 'none'} aria-hidden="true" />
    </button>
  );
}
