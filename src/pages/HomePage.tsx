import { MobileShell } from '@/components/MobileShell';
import { PaperHome } from '@/features/home/PaperHome';

/**
 * 홈 — 노트에 그린 인스타그램 (2026-08-23).
 *
 * 앞선 홈은 `RoleHome` 이었다. 역할별로 코어 표면을 고정하고 그 아래 끌어 옮기는 위젯을
 * 두는 대시보드였고, 뒤에 괘선을 깔아도 그것은 **여전히 위젯 대시보드**였다. 인스타의
 * 홈에는 배치할 것이 없다 -- 레일과 피드가 있을 뿐이다.
 *
 * `PaperHome` 은 그 골격을 그대로 쓴다: 헤더 56px, 스토리 레일 106px, 포스트(사진/글 →
 * 캡션 → 시간·원본·책갈피 44px). 이 숫자들이 인스타를 인스타로 보이게 하고,
 * 바뀌는 것은 그 안이 무엇으로 그려졌는가뿐이다.
 *
 * 역할차는 사라지지 않았다. 자리를 다르게 주는 대신 **같은 화면에서 다른 링을 먼저 누르게**
 * 한다 -- 왼쪽 링의 `+` 가 곰신의 1차 행동(기록), 오른쪽 링이 군화의 1차 행동(놓친 하루).
 * §5.2가 요구한 것이 그것이고, `RoleHome` 은 그 요구를 두 개의 다른 화면으로 풀었다.
 */
export function HomePage() {
  return (
    <MobileShell>
      <PaperHome />
    </MobileShell>
  );
}
