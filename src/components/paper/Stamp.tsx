import { Heart, HandHeart } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * 반응 — 종이에 찍는 도장.
 *
 * ## props에 개수가 없다
 *
 * 인스타의 하트에는 숫자가 따라붙는다. 여기에는 없고, 없다는 사실이 이 파일의 요점이다.
 * 세는 순간 반응은 경쟁이 되고, 경쟁은 이 제품이 만들지 않기로 한 것이다
 * (PRODUCT_V3 §16 `좋아요 수 · 반응 개수 표시`). 슬롯을 두지 않으면 나중에 "이것만
 * 추가하자"가 나올 자리도 없다.
 *
 * ## 어휘를 늘리지 않는다
 *
 * `공감`과 `토닥이기` 둘뿐이다. PRODUCT_V3 §7.3이 이 어휘를 의도적으로 작게 유지하라고
 * 못 박았다. 종류가 늘면 고르는 일이 되고, 고르는 일이 되면 부담이 된다.
 *
 * ## 아직 배선되지 않았다
 *
 * 뷰어 반응은 데이터 모델에 존재하지 않는다 -- 서버 테이블과 RLS가 필요하고 그것은
 * migration gate 대상이다. 이 컴포넌트는 그 게이트를 통과했을 때 카드 액션 줄에 붙일
 * 준비로 먼저 만들어 두는 것이며, 지금은 어디에서도 렌더되지 않는다.
 */
export type StampKind = 'empathy' | 'comfort';

const STAMP: Record<StampKind, { label: string; Icon: typeof Heart }> = {
  empathy: { label: '공감', Icon: Heart },
  comfort: { label: '토닥이기', Icon: HandHeart },
};

export function Stamp({
  kind,
  pressed,
  onToggle,
  disabled = false,
  disabledReason,
  className,
}: {
  kind: StampKind;
  pressed: boolean;
  onToggle: () => void;
  disabled?: boolean;
  /** 왜 누를 수 없는지. 비활성 컨트롤이 이유 없이 죽어 있으면 고장으로 읽힌다. */
  disabledReason?: string;
  className?: string;
}) {
  const { label, Icon } = STAMP[kind];
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={disabled && disabledReason ? `${label} — ${disabledReason}` : label}
      title={disabled ? disabledReason : undefined}
      className={cn(
        // 44px는 보이는 크기가 아니라 누를 수 있는 크기다(DESIGN_V2 원칙 5).
        'press-response inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5',
        'rounded-control px-3 text-label font-semibold',
        'transition-[color,background-color] duration-[120ms]',
        pressed ? 'bg-coral/15 text-coral-strong' : 'text-muted-foreground hover:text-foreground',
        disabled && 'opacity-50',
        className,
      )}
    >
      <Icon
        size={16}
        strokeWidth={pressed ? 2.5 : 2}
        // 찍힌 도장은 채워진다. 잉크가 종이에 남은 상태다.
        fill={pressed ? 'currentColor' : 'none'}
        aria-hidden="true"
      />
      <span>{label}</span>
    </button>
  );
}
