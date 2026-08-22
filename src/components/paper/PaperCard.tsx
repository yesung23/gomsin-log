import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * 사진이 없는 날의 종이.
 *
 * ## `Card`를 대체하지 않는다
 *
 * `Card`는 홈 위젯의 표면이고, 이것은 전체화면 안에 놓인 한 장의 종이다. 둘 다
 * `bg-card`를 쓰지만 역할이 다르다 -- `Card`는 테두리로 자기를 구분하고, 이것은
 * 여백으로 구분한다. 전체화면에서 테두리를 그리면 화면 안에 액자가 하나 더 생긴다.
 *
 * ## 왜 이것이 밀도 실패를 막는가
 *
 * 사진을 잘 올리지 않는 커플에게 사진 자리가 비면 구멍이 된다. 그 자리를 글이 대신
 * 차지하면 구멍이 아니라 **글이 주인공인 하루**가 된다. 2026-08-20에 되돌린 인스타형
 * 피드가 실패한 이유가 정확히 밀도였고, 이 컴포넌트가 그 재발 조건을 없앤다.
 */
export function PaperCard({ children, className }: { children: ReactNode; className?: string }) {
  // 결이 없다. body에만 결이 있고 이 종이는 그 위에 놓인 매끈한 한 장이다.
  return <div className={cn('rounded-surface bg-card px-6 py-8', className)}>{children}</div>;
}
