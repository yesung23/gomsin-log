import type { CycleSupportKind, CycleSupportSignal } from '@/types';

/**
 * 배려 신호가 사람에게 보이는 문장. **한 곳에서만 정한다.**
 *
 * 같은 신호가 세 자리에 나온다 -- 보내기 전 미리보기, `/me` 의 상대 카드, 홈 레일의
 * 쪽지. 자리마다 문장을 따로 두면 홈에서 본 것과 `/me` 에서 본 것이 달라지고, 사용자는
 * 둘 중 어느 쪽이 상대가 실제로 고른 것인지 알 수 없게 된다.
 *
 * 이 표면에는 이미 그 결함이 한 번 있었다 -- 미리보기가 payload 와 어긋나서, 꺼 놓은
 * 공유를 설명하는 문장이 떴다. 그래서 어휘는 하나다.
 *
 * ## 어휘를 늘리지 않는 이유
 *
 * 한때 통증 정도를 따로 받는 안이 있었고(`조금 아파요`/`많이 아파요`) 독립 검토가
 * 거절했다. 서버가 보는 칸에 있는 정도 척도는 개인 HRK 영역의 통증 수준을 다시 말하는
 * 것이기 때문이다. `오늘은 몸이 힘들어요` 는 오늘이 힘들다고만 말한다 -- 배려 신호에
 * 필요한 것은 그것이 전부다.
 */
export const CYCLE_SUPPORT_LABEL: Record<CycleSupportKind, string> = {
  resting: '오늘은 쉬어가고 싶어요',
  need_space: '조용한 시간이 필요해요',
  would_like_support: '따뜻한 응원을 받고 싶어요',
  check_in_later: '나중에 안부를 물어봐 주세요',
  feeling_unwell: '오늘은 몸이 힘들어요',
};

/**
 * 어느 쪽의 신호를 보고 있는가. **한 곳에서만 정한다.**
 *
 * 같은 판정이 세 자리에 있었다 -- `/me` 의 내 카드, `/me` 의 상대 카드, 홈 레일의
 * 쪽지. 셋 다 `ownerId === userId` 한 줄이고, 셋 중 하나에서 부호가 뒤집히면
 * **내가 보낸 말이 상대가 한 말로 화면에 뜬다.** 조용히 틀리는 종류이고, 세 자리에
 * 흩어져 있으면 하나를 고칠 때 나머지를 같이 보게 되지 않는다.
 *
 * `userId` 가 없으면 빈 목록이다. `ownerId !== undefined` 는 언제나 참이므로, 이
 * 가드가 없으면 로그아웃 직후 한 프레임 동안 남의 신호가 남는다.
 */
export function signalsFrom(
  signals: readonly CycleSupportSignal[],
  userId: string | undefined,
  side: 'mine' | 'partner',
): CycleSupportSignal[] {
  if (!userId) return [];
  return signals.filter((signal) => (side === 'mine'
    ? signal.ownerId === userId
    : signal.ownerId !== userId));
}
