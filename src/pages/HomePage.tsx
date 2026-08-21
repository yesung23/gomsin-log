import { MobileShell } from '@/components/MobileShell';
import { RoleHome } from '@/features/home/RoleHome';

/**
 * Two homes, because the two roles came here to do opposite things.
 *
 * 곰신 has their phone all day and is CAPTURING; 군화 gets a short window and is
 * CATCHING UP, usually just before a call. `RoleHome` pins the surfaces that
 * answer that (`HOME_CORE_BY_ROLE`) above an arrangeable widget layer, so the
 * screen says what it is for before it offers anything to rearrange -- which is
 * PRODUCT_V3 §6, 홈을 무관한 카드의 대시보드로 만들지 않는다.
 *
 * 군화 previously got `SoldierDashboard`, a hardcoded tree that could not be
 * changed at all. Removing it was right; the lesson drawn from it was not. "A
 * home must be customisable" merged two purposes into one engine, and that is how
 * the person with the scarce phone window ended up with no composer on their home
 * (§5.1 requires one for both roles). Nothing was deleted to fix this: everything
 * that was arrangeable still is, minus the four surfaces now pinned.
 */
export function HomePage() {
  return (
    <MobileShell>
      <RoleHome />
    </MobileShell>
  );
}
