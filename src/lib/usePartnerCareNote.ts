import { useEffect, useRef, useState } from 'react';
import {
  activeCycleSupportSignal,
  fetchCycleSupportSignalsResultFromDB,
  localToday,
} from '@/lib/cycle';
import { signalsFrom } from '@/lib/cycleSupportLabels';
import type { CycleSupportSignal } from '@/types';

/**
 * 상대가 오늘 보낸 배려 신호 하나. 홈 레일의 쪽지가 읽는 것.
 *
 * ## 왜 홈에 있어야 하는가
 *
 * 계획서(#30)는 이것을 **인스타의 노트(Notes) 자리**에 두라고 했다. 그것이 이 기능이
 * 매일 보이는 유일한 길이기 때문이다. 지금은 `우리 → 오늘 내 상태` 로 두 번 들어가야
 * 나오는데, 두 번 들어가야 보이는 것은 **오늘 상대가 어떤지**를 알려 주지 못한다 --
 * 궁금해서 찾아본 사람에게만 보이고, 궁금하지 않았던 날에는 없는 것과 같다.
 *
 * ## 이 훅이 늘리는 노출은 없다
 *
 * 읽는 것은 상대가 **직접 골라 보낸** 신호뿐이다(`cycle_support_signals`). 주기 원본도,
 * 통증 정도도, 보낼까 하다 만 것도 여기 오지 않는다(§16 · §21). 자리를 옮길 뿐 범위는
 * `CycleSupportSection` 의 파트너 뷰와 같다.
 *
 * ## 없으면 아무것도 그리지 않는다
 *
 * "오늘은 신호가 없어요" 라고 말하면 **상대가 보내지 않았다는 사실**이 새어 나간다.
 * 보내지 않은 것은 말하지 않은 것이고, 말하지 않은 것을 앱이 대신 말하지 않는다.
 * 그래서 `null` 이면 자리 자체가 없다.
 */
/**
 * 쪽지에 뜰 신호 하나를 고른다. **내 것이 아니고, 오늘 것이고, 아직 살아 있는 것.**
 *
 * 훅 안의 인라인 필터로 두면 실행해 보는 테스트를 쓸 수 없다 -- 화면을 그리려면
 * 스토어와 네트워크가 필요하고, 남는 선택지는 소스를 뒤지는 테스트뿐인데 그런 테스트는
 * 버그가 있는 내내 초록이다.
 *
 * 세 조건은 각각 다른 실수를 막는다. `ownerId !== userId` 가 빠지면 **내가 보낸 것이
 * 내 홈에 상대의 쪽지처럼 뜬다.** 날짜가 빠지면 지난주에 힘들었다는 말이 오늘 것처럼
 * 걸려 있는다. 만료가 빠지면 상대가 거둬들인 말이 계속 남는다.
 */
export function selectPartnerCareNote(
  signals: CycleSupportSignal[],
  userId: string | undefined,
  today: string,
  nowIso: string,
): CycleSupportSignal | null {
  return activeCycleSupportSignal(signalsFrom(signals, userId, 'partner'), today, nowIso);
}

export function usePartnerCareNote({
  coupleId,
  connected,
  userId,
}: {
  coupleId?: string;
  connected: boolean;
  userId?: string;
}): CycleSupportSignal | null {
  const [note, setNote] = useState<CycleSupportSignal | null>(null);
  /*
    계정이 바뀌면 앞의 답을 버린다. 남겨 두면 방금 로그아웃한 사람의 상대가 보낸
    쪽지가 다음 사람의 홈에 한 프레임 떠 있게 된다.
  */
  const identity = `${userId || ''}:${coupleId || ''}`;
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;

  useEffect(() => {
    if (!coupleId || !connected || !userId) {
      setNote(null);
      return;
    }
    let cancelled = false;
    const mine = identity;
    void fetchCycleSupportSignalsResultFromDB(coupleId).then((result) => {
      if (cancelled || currentIdentity.current !== mine) return;
      if (!result.ok) {
        /*
          못 읽었으면 **아무것도 그리지 않는다.** 홈의 쪽지는 조용한 자리이므로 여기서
          오류를 띄우면 오늘 상대가 아무 말도 안 한 날에 앱이 대신 떠드는 것이 된다.
          같은 데이터의 오류 표시는 `/me` 가 진다 -- 거기는 사용자가 그것을 보러 간
          화면이다.
        */
        setNote(null);
        return;
      }
      setNote(selectPartnerCareNote(result.signals, userId, localToday(), new Date().toISOString()));
    });
    return () => { cancelled = true; };
  }, [coupleId, connected, userId, identity]);

  return note;
}
