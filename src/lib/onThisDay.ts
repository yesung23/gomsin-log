import type { DailyRecord } from '@/types';

/** 되돌아볼 수 있는 가장 먼 해. 이 앱이 그만큼 오래된 커플을 아직 갖고 있지 않아도 된다. */
const MAX_YEARS_BACK = 10;

export interface OnThisDay {
  yearsAgo: number;
  record: DailyRecord;
}

/**
 * 오늘과 **같은 날짜**의 지난 기록 하나.
 *
 * ## 왜 이것이 있어야 하는가
 *
 * 이 제품이 파는 것은 쌓인 시간이다. 그런데 쌓인 것이 **스스로 돌아오는 장치**가 하나도
 * 없으면, 사용자는 자기가 쌓고 있다는 사실을 알 방법이 검색뿐이다 -- 그리고 검색은
 * 이미 무엇을 찾는지 아는 사람만 쓴다. 작년 오늘 무슨 말을 했는지는 아무도 찾아보지
 * 않는다. 찾아볼 생각을 하지 못하기 때문이다.
 *
 * ## 고르는 규칙
 *
 * 가장 **가까운** 해를 고른다. 3년 전과 1년 전에 둘 다 기록이 있으면 1년 전이다 --
 * 멀수록 좋은 것이 아니라, 오늘과 이어지는 것이 좋은 것이다.
 *
 * 그날 여러 개를 남겼으면 **그날의 첫 기록**을 고른다. 하루의 시작이 그날을 대표하고,
 * 마지막 것을 고르면 자기 전에 남긴 짧은 한 줄이 그해의 그날 전체가 된다.
 *
 * ## 2월 29일
 *
 * 문자열로 맞춘다. `2025-02-29` 는 존재하지 않는 날짜지만 여기서는 그저 **아무 기록과도
 * 맞지 않는 열쇠**일 뿐이라 아무 일도 일어나지 않는다. 날짜 객체로 계산하면 그 날이
 * 3월 1일로 굴러가 엉뚱한 날의 기록이 "작년 오늘" 로 뜬다.
 */
export function selectOnThisDay(
  records: readonly DailyRecord[],
  todayStr: string,
): OnThisDay | null {
  const year = Number.parseInt(todayStr.slice(0, 4), 10);
  const monthDay = todayStr.slice(4); // `-MM-DD`
  if (!Number.isFinite(year)) return null;

  for (let yearsAgo = 1; yearsAgo <= MAX_YEARS_BACK; yearsAgo += 1) {
    const key = `${year - yearsAgo}${monthDay}`;
    const thatDay = records
      .filter((record) => record.date === key)
      .sort((a, b) => a.time.localeCompare(b.time));
    if (thatDay.length > 0) return { yearsAgo, record: thatDay[0] };
  }
  return null;
}

/**
 * 한 줄에 쓰는 말. **조용해야 한다.**
 *
 * 계획서가 이것을 "지면 위 조용한 한 줄" 이라고 했다. 카드로 만들면 오늘 남길 것보다
 * 작년이 위에 오고, 그러면 이 앱은 추억을 파는 앱이 된다 -- 오늘을 남기게 하는 앱이
 * 아니라. 그래서 배지도, 아이콘도, 느낌표도 없다.
 */
export function onThisDayLabel(found: OnThisDay): string {
  return found.yearsAgo === 1 ? '1년 전 오늘' : `${found.yearsAgo}년 전 오늘`;
}
