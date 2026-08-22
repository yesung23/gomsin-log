/**
 * 프로필 세 번째 칸에 무엇을 놓을지 — 기기 설정.
 *
 * 커플마다 기다리는 것이 다르다. 군 복무 커플에게는 전역이고, 주말부부에게는 다음 만남
 * 횟수이며, 그 둘 다 아닌 커플에게는 다음 기념일이다. 고르게 두면 **전역한 뒤 그 칸이
 * 자동으로 다른 것으로 바뀐다** -- 억지 리텐션 없이 조용한 전환이 한 칸에서 일어난다.
 *
 * 서버로 보내지 않는다. 표시 선택이며 §19의 허용 목록에도 이런 값이 없다.
 * 계정 범위인 이유는 손글씨 설정과 같다 -- 같은 기기를 두 사람이 쓸 수 있다.
 */
import type { ThirdSlotChoice } from '@/lib/coupleStats';

const KEY_PREFIX = 'gomsin.display.third-slot.';

const VALID: ThirdSlotChoice[] = ['discharge', 'anniversary', 'meetings'];

/** 군 정보가 있으면 전역, 없으면 기념일. `buildCoupleStats`가 실제로 없으면 조용히 대체한다. */
export function defaultThirdSlot(hasMilitary: boolean): ThirdSlotChoice {
  return hasMilitary ? 'discharge' : 'anniversary';
}

export function loadThirdSlot(userId: string, hasMilitary: boolean): ThirdSlotChoice {
  const fallback = defaultThirdSlot(hasMilitary);
  if (!userId || typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(`${KEY_PREFIX}${userId}`);
    return VALID.includes(raw as ThirdSlotChoice) ? (raw as ThirdSlotChoice) : fallback;
  } catch {
    return fallback;
  }
}

export function saveThirdSlot(userId: string, choice: ThirdSlotChoice): void {
  if (!userId || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(`${KEY_PREFIX}${userId}`, choice);
  } catch {
    // 저장 실패가 화면을 막지 않는다.
  }
}
