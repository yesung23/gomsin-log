/**
 * 고른 날들을 **연속된 덩어리**로 묶는다.
 *
 * ## 왜 이것이 필요한가
 *
 * 커플 일정은 두 모양으로 온다. 휴가 3박 4일처럼 **붙어 있는 것**과, 이번 달에 면회가
 * 세 번인 것처럼 **흩어진 것**이다. 앞의 것을 하루씩 네 건으로 저장하면 같은 일정이
 * 격자에 네 번 찍히고, 뒤의 것을 한 건의 기간으로 저장하면 사이에 낀 아무 일 없는 날까지
 * 일정이 있는 것이 된다. **둘 다 틀린다.**
 *
 * 이벤트 모델은 이미 `startDate` + `endDate` 범위다. 그래서 규칙은 하나로 정리된다:
 * 고른 날들을 연속 구간으로 자르고, **구간 하나가 일정 하나**가 된다.
 *
 *     8/14 8/15 8/16        →  한 건 (8/14 ~ 8/16)
 *     8/14 8/20 8/27        →  세 건 (각각 하루)
 *     8/14 8/15  8/20       →  두 건 (8/14~8/15, 8/20 하루)
 *
 * 하루짜리는 `end` 를 주지 않는다. 시작일과 같은 종료일을 저장하면 하루짜리 일정이
 * 기간 일정처럼 읽히고, 기존 데이터와도 모양이 달라진다.
 */
export interface DateRun {
  start: string;
  /** 하루짜리면 없다. */
  end?: string;
}

/** 하루 뒤의 날짜. 로컬 자정 기준이라 시간대가 끼어들지 않는다. */
export function nextDay(date: string): string {
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + 1);
  const year = next.getFullYear();
  const month = String(next.getMonth() + 1).padStart(2, '0');
  const day = String(next.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * `YYYY-MM-DD` 목록을 연속 구간들로. 입력 순서와 중복은 신경 쓰지 않는다 --
 * 사용자는 아무 순서로 고르고, 같은 날을 두 번 누를 수도 있다.
 */
export function groupIntoRuns(dates: readonly string[]): DateRun[] {
  const sorted = [...new Set(dates)].sort();
  const runs: DateRun[] = [];
  for (const date of sorted) {
    const last = runs[runs.length - 1];
    if (last && nextDay(last.end ?? last.start) === date) {
      last.end = date;
      continue;
    }
    runs.push({ start: date });
  }
  return runs;
}

/**
 * 고른 것을 사람이 읽는 한 줄로.
 *
 * 며칠인지와 몇 건이 되는지를 **둘 다** 말한다. 흩어진 날을 고른 사람은 그것이 일정
 * 여러 건이 된다는 것을 저장하기 전에 알아야 한다 -- 저장하고 나서 격자에서 발견하면
 * 그때는 지우는 일이 남는다.
 */
export function describeRuns(dates: readonly string[]): string {
  if (dates.length === 0) return '날짜를 골라 주세요';
  const runs = groupIntoRuns(dates);
  const days = new Set(dates).size;
  if (runs.length === 1) {
    const [run] = runs;
    if (!run.end) return `${run.start.slice(5)} 하루`;
    return `${run.start.slice(5)} – ${run.end.slice(5)} · ${days}일`;
  }
  return `${days}일 고름 · 일정 ${runs.length}건`;
}
