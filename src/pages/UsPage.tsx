import { MobileShell } from '@/components/MobileShell';
import { PaperProfile } from '@/features/us/PaperProfile';

/**
 * 우리 — 인스타 프로필 (2026-08-23).
 *
 * 앞선 화면은 앱바 아래에 카드와 목록 행을 쌓은 것이었고, 뒤에 괘선을 깔아도 그것은
 * 여전히 목록 화면이었다. `PaperProfile` 은 인스타 프로필의 골격을 그대로 쓴다 --
 * 아바타와 3통계, 소개, 편집/공유 두 버튼, 하이라이트 원, 탭 줄, 3열 격자.
 *
 * 자리는 그대로 두고 뜻만 바꿨다: 게시물 → 함께한 날, 팔로워 → 만남까지, 팔로잉 →
 * 전역까지. §16이 팔로우 개념 자체를 금지하므로 **자리만 빌리고 개념은 빌리지 않았다** --
 * 세 숫자는 전부 두 사람 사이의 시간이고 다른 사람이 등장하지 않는다.
 *
 * 격자·요일 비정렬·조용한 칸은 `monthTexture` 와 `MonthGrid` 가 그대로 소유한다(§10).
 */
export function UsPage() {
  return (
    <MobileShell>
      <PaperProfile />
    </MobileShell>
  );
}
