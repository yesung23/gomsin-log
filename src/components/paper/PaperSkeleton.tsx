import { cn } from '@/lib/utils';

/**
 * 기다리는 중 — 종이로.
 *
 * ## label은 여전히 필수다
 *
 * `Skeleton`이 label을 요구하는 이유는 시각이 아니었다. 공유 상태가 확인되기 전의 빈
 * 목록은 "아무것도 공유되지 않았다"가 아니고, 그렇게 말하는 것은 사용자 자기 데이터에
 * 관한 거짓말이다. 종이로 옮겨 그리는 것이 그 이유를 바꾸지 않는다.
 *
 * ## shimmer를 쓰지 않는다
 *
 * 반짝이며 지나가는 하이라이트는 유리와 빛의 문법이다. 종이는 빛나지 않는다. 그리고
 * `prefers-reduced-motion`에서 애니메이션이 꺼지면 정적 블록만 남는데, 그 상태가 이미
 * 올바른 로딩 표현이라는 것이 `Skeleton` 주석의 결론이었다. 그러면 처음부터 정적이어도 된다.
 */
export function PaperSkeleton({
  label,
  lines = 2,
  className,
}: {
  /** 무엇을 기다리는지. 선택이 아니다. */
  label: string;
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn('space-y-2', className)} aria-busy="true" aria-live="polite">
      {Array.from({ length: lines }).map((_, index) => (
        <div
          key={index}
          className="h-4 rounded-control bg-muted"
          // 줄마다 길이가 다르면 글이 있던 자리로 읽힌다. 균일한 막대는 표로 읽힌다.
          style={{ width: index === lines - 1 ? '62%' : '100%' }}
        />
      ))}
      <p className="text-caption text-muted-foreground">{label}</p>
    </div>
  );
}
