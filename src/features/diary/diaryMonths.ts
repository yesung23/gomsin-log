import type { DailyRecord } from '@/types';

/**
 * 한 달치를 하나의 지면으로 엮는다.
 *
 * `일기장` 탭의 단위는 하루가 아니라 **한 달**이다. `우리`가 하루 칸으로 쌓인 것을
 * 보여주므로(§5.5의 경계), 여기서 다시 하루를 세면 같은 화면이 둘이 된다. 한 달은 종이
 * 다이어리가 한 장을 넘기는 단위이기도 하고, `BUSINESS_MEMORY_ROADMAP_V1` §9.2의 첫
 * 상품 「우리의 한 달」이 덮는 단위이기도 하다.
 *
 * 순수 함수인 이유는 이 계산이 "몇 개나 쌓였나"를 말하고, 그 숫자가 곧 상품 설명이 되기
 * 때문이다. 앱이 만든 홍보 문구보다 정확하고, 틀리면 눈에 띄지 않는 종류의 거짓말이 된다.
 */

export interface DiaryMonth {
  /** `YYYY-MM`. 정렬과 저장의 키. */
  key: string;
  /** `2026년 8월`. 앱이 만드는 라벨이며 사용자 콘텐츠가 아니다. */
  label: string;
  /** 그 달에 남긴 기록 수. */
  recordCount: number;
  /** 그 달에 붙은 사진·영상 수. */
  photoCount: number;
  /** 그 달에 실제로 무언가 남긴 날의 수. 빈 날은 세지 않는다. */
  dayCount: number;
  /** 지면에 그릴 기록. 오래된 것이 먼저 온다 -- 일기는 위에서 아래로 읽는다. */
  records: DailyRecord[];
}

/**
 * 기록을 달로 묶는다. 최근 달이 먼저 온다.
 *
 * 아무것도 없는 달은 만들지 않는다. 빈 지면을 목록에 두면 "이 달도 꾸며 보세요"가 되고,
 * 그것은 남기지 않은 것을 결핍으로 만드는 재촉이다 -- §16이 연속 기록을 금지하는 것과
 * 같은 이유다.
 *
 * `contentUnavailable`인 기록도 **센다**. 이 기기가 못 여는 것이지 없는 것이 아니고,
 * 세지 않으면 기기를 바꿀 때마다 지난 달의 기록 수가 줄어드는 것처럼 보인다.
 */
export function buildDiaryMonths(records: DailyRecord[]): DiaryMonth[] {
  const byMonth = new Map<string, DailyRecord[]>();

  for (const record of records) {
    const key = record.date.slice(0, 7);
    // `YYYY-MM` 모양이 아닌 날짜는 버린다. 달을 못 정하는 기록을 아무 달에나 넣으면
    // 그 달의 숫자가 조용히 틀린다.
    if (!/^\d{4}-\d{2}$/.test(key)) continue;
    const bucket = byMonth.get(key);
    if (bucket) bucket.push(record);
    else byMonth.set(key, [record]);
  }

  return [...byMonth.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, bucket]) => {
      const sorted = [...bucket].sort(
        (a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)),
      );
      const [year, month] = key.split('-');
      return {
        key,
        label: `${Number(year)}년 ${Number(month)}월`,
        recordCount: sorted.length,
        photoCount: sorted.reduce((total, record) => total + (record.attachments?.length ?? 0), 0),
        dayCount: new Set(sorted.map((record) => record.date)).size,
        records: sorted,
      };
    });
}

/** 한 달 지면을 `YYYY-MM`으로 찾는다. 없으면 `null` -- 없는 달을 빈 지면으로 만들지 않는다. */
export function findDiaryMonth(months: DiaryMonth[], key: string): DiaryMonth | null {
  return months.find((month) => month.key === key) ?? null;
}
