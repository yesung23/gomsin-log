import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * 상대의 하루로 들어가는 문.
 *
 * ## 링은 언제나 두 개다
 *
 * 인스타그램의 링은 N개라서 가로 스크롤이 생기고, 스크롤이 있어서 정렬이 필요하고,
 * 정렬이 있어서 알고리즘이 생긴다. 이 앱은 링이 정확히 둘(상대·나)이라 그 사슬이 아예
 * 시작되지 않는다. "SNS가 아니다"를 카피가 아니라 구조로 보장하는 방법이고, 그래서
 * 이 컴포넌트는 배열을 받지 않는다.
 *
 * ## 그라디언트를 쓰지 않는다
 *
 * 인스타의 보라-주황 그라디언트는 그 서비스의 식별 표지다. 여기서는 코랄 단색 잉크로
 * 그린 원이다 -- 종이 위에 펜으로 한 바퀴 두른 모양이며, 법적으로도 시각적으로도
 * 남의 것을 베끼지 않는다.
 *
 * ## 미읽음은 보는 사람만 아는 사실이다
 *
 * `state`는 뷰어의 로컬 상태에서만 온다. 이 컴포넌트는 서버 값을 받지 않고, 작성자에게
 * 전달되는 경로도 없다. 곰신이 알 수 있는 것은 "닿았다"까지이고 "읽었다"는 영원히
 * 알 수 없다(PRODUCT_V3 §14.3).
 *
 * ## `idle`은 빈 자리가 아니다
 *
 * 상대가 아직 아무것도 남기지 않았거나 아직 연결되지 않았을 때도 링은 그 자리에 있다.
 * 사라지면 화면이 "없는 것"이 되고, 남아 있으면 "아직 오지 않은 것"이 된다. 홈의 높이가
 * 콘텐츠 양에 흔들리지 않는 이유이기도 하다.
 */
export type InkRingState = 'unread' | 'read' | 'idle';

const STROKE: Record<InkRingState, string> = {
  // 잉크. 방금 두른 한 바퀴.
  unread: 'var(--color-coral-strong)',
  // 연필. 지나간 자국.
  read: 'var(--color-border)',
  // 아직 그리지 않은 자리.
  idle: 'var(--color-border)',
};

export function InkRing({
  state,
  size = 80,
  children,
  className,
}: {
  state: InkRingState;
  size?: number;
  children: ReactNode;
  className?: string;
}) {
  const radius = size / 2 - 2;
  return (
    <span
      // 링이 몇 개인지, 어떤 상태인지가 이 앱에서 세어야 하는 사실이다. 링이 셋이 되는
      // 순간 정렬이 필요해지고 정렬이 있으면 알고리즘이 생기므로, 테스트가 그것을 센다.
      data-ink-ring={state}
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      {/*
        손으로 그린 원.

        `<circle>`이 아니라 두 개의 호를 이어 붙인 path다. 완벽한 원은 인쇄된 도형으로
        읽히고, 시작점과 끝점이 살짝 어긋난 원은 사람이 그은 선으로 읽힌다. 어긋남은
        고정값이라 렌더마다 흔들리지 않는다 -- 움직이는 손글씨는 장식이지 질감이 아니다.
      */}
      <svg
        className="absolute inset-0"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
        focusable="false"
      >
        <path
          d={`M ${size / 2} ${size / 2 - radius}
              A ${radius} ${radius} 0 1 1 ${size / 2 - 0.6} ${size / 2 - radius}
              A ${radius * 1.01} ${radius * 0.99} 0 0 1 ${size / 2 + 1.4} ${size / 2 - radius + 0.8}`}
          fill="none"
          stroke={STROKE[state]}
          strokeWidth={state === 'unread' ? 2.5 : 1.5}
          strokeLinecap="round"
          opacity={state === 'idle' ? 0.5 : 1}
        />
      </svg>
      <span
        className="overflow-hidden rounded-full bg-muted"
        style={{ width: size - 12, height: size - 12 }}
      >
        {children}
      </span>
    </span>
  );
}
