/**
 * 손글씨를 켤 것인가 — 기기 설정.
 *
 * ## 왜 서버로 보내지 않는가
 *
 * 이것은 그 사람의 눈과 그 기기의 화면에 관한 값이지, 커플이 공유하는 사실이 아니다.
 * 큰 화면의 태블릿에서는 켜고 작은 폰에서는 끄는 것이 자연스럽고, 계정에 묶어 두면
 * 그 자연스러움이 사라진다. 그리고 §19는 화면 이름과 이벤트 종류만 허용하므로 이 값이
 * 서버로 갈 이유가 애초에 없다.
 *
 * ## 왜 계정 범위인가
 *
 * 같은 기기를 두 사람이 쓰는 상황(가족 폰, 공용 태블릿)에서 한쪽의 선택이 다른 쪽에
 * 적용되면 안 된다. `notifications.ts`가 같은 이유로 같은 모양을 쓴다.
 *
 * ## 왜 기본이 켬인가
 *
 * 손글씨는 이 제품의 정체성이고, 끄는 것은 그것이 벽이 되는 사람을 위한 장치다.
 * 기본을 끔으로 두면 접근성 장치가 아니라 숨은 기능이 된다.
 */

const KEY_PREFIX = 'gomsin.display.handwriting.';

export const HANDWRITING_DEFAULT = true;

function key(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

export function loadHandwritingEnabled(userId: string): boolean {
  if (!userId || typeof localStorage === 'undefined') return HANDWRITING_DEFAULT;
  try {
    const raw = localStorage.getItem(key(userId));
    // 저장된 적이 없으면 기본값이다. `'false'`만 끔으로 읽는다 -- 손상된 값이
    // 조용히 끔이 되면 사용자가 끈 적 없는 설정이 꺼진 채로 남는다.
    if (raw === null) return HANDWRITING_DEFAULT;
    return raw !== 'false';
  } catch {
    return HANDWRITING_DEFAULT;
  }
}

export function saveHandwritingEnabled(userId: string, enabled: boolean): void {
  if (!userId || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key(userId), enabled ? 'true' : 'false');
  } catch {
    // 저장 실패가 화면을 막지 않는다. 이번 세션에는 적용되고 다음에 기본값으로 돌아온다.
  }
}

/**
 * 설정을 화면에 반영한다.
 *
 * `data-hand`를 프레임이 아니라 `<html>`에 건다. `data-astryx-theme`는 프레임에 있는데,
 * 그건 셸 밖에서 렌더된 화면이 프레임 없는 컴포넌트 테마를 주워가지 못하게 하려는 것이다.
 * 손글씨는 반대다 -- 셸 안이든 밖이든 같은 사람의 같은 눈이므로 전역이어야 하고, 그렇게
 * 하면 프레임을 손으로 복제하는 OnboardingPage에 배선을 한 번 더 하지 않아도 된다.
 *
 * 끔일 때만 속성을 단다. 켬이 기본이므로 속성이 없는 상태가 곧 켬이고, 그래서 첫 페인트가
 * 이 함수를 기다리지 않는다.
 */
export function applyHandwritingAttribute(enabled: boolean): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (enabled) root.removeAttribute('data-hand');
  else root.setAttribute('data-hand', 'off');
}
