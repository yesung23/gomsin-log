import { cn } from '@/lib/utils';

/**
 * 접힌 자국.
 *
 * 실선 대신 쓴다. 같은 `--border` 색을 쓰되 점선으로 끊어 두면 인쇄된 괘선이 아니라
 * 종이를 접었다 편 자국으로 읽힌다. 색을 새로 만들지 않는 것이 중요하다 -- 회색 괘선이
 * 따뜻한 페이지에서 더러워 보이는 이유는 이미 `--border` 주석이 설명하고 있다.
 */
export function FoldDivider({ className }: { className?: string }) {
  // `<hr>`은 이미 separator다. 역할을 다시 붙이면 스크린리더가 두 번 말한다.
  return <hr className={cn('border-0 border-t border-dashed border-border', className)} />;
}
