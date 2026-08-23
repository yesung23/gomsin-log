import type { Attachment, CoupleEvent, DailyRecord, Trip } from '@/types';

/*
  `postTiles.ts` 이지 `postGrid.ts` 가 아니다.

  macOS 는 기본이 대소문자 비구분 파일시스템이라 `PostGrid.tsx` 와 `postGrid.ts` 가
  **같은 경로**다. TypeScript 가 import 를 엉뚱한 쪽으로 풀고, 그때 나오는 오류는
  "쓰지 않는 변수" 라서 아무도 그 자리를 보지 않는다. `MonthGrid.tsx` 가 같은 함정을
  이미 밟고 `monthTexture.ts` 로 갈라 두었고, 이 파일도 같은 이유로 갈라 둔다.
*/

/**
 * 여행 게시물 격자에 들어갈 칸 하나. **하루가 아니라 기록 하나가 한 칸이다.**
 *
 * ## 왜 여행 게시물로 좁히는가
 *
 * 앞의 판은 한 달의 모든 날을 7열로 그렸다. 날짜 순이고 요일 정렬이 아니라는 이유로
 * "달력이 아니라 질감" 이라고 적혀 있었지만, **쓰는 사람에게는 달력으로 읽힌다** --
 * 날짜가 적혀 있고 빈 칸이 있으면 그것은 달력이다. 지금은 그 자리를 인스타그램처럼
 * 여행 중 남긴 기록 게시물에만 사용한다.
 *
 * 인스타의 프로필 격자는 날이 아니라 **게시물**을 센다. 여기서는 그 게시물의 범위를
 * 여행 기간으로 먼저 좁힌다. 일반 기록은 사진 탭의 기존 기록 목록에서 본다.
 *
 * ## 글만 있는 기록도 칸이 된다
 *
 * 인스타에는 글만 있는 게시물이 없지만 이 앱에는 그것이 대부분이다. 사진 있는 것만
 * 칸으로 만들면 격자가 이 커플이 남긴 것의 일부만 말하게 되고, 사진을 안 올리는 커플의
 * 프로필은 영영 비어 있다.
 */
export interface PostTile {
  recordId: string;
  date: string;
  time: string;
  /** 있으면 사진 칸, 없으면 글 칸. 첫 장만 쓴다 -- 격자는 한 칸에 하나를 보여준다. */
  photo?: Attachment;
  /** 글 칸에 그릴 말. 사진 칸에서는 접근 이름에만 쓴다. */
  text: string;
  /** 사진이 여럿인가. 인스타가 겹친 장 표시를 다는 조건과 같다. */
  multiple: boolean;
  /** 이 기기가 못 여는 기록(`key_unavailable` · `undecryptable`). 없는 것이 아니라 못 여는 것이다. */
  unavailable: boolean;
}

/** 격자가 보여줄 수 있는 첨부인가. 사진과 영상 썸네일만 칸이 된다. */
function firstVisual(attachments?: Attachment[]): Attachment | undefined {
  return attachments?.find((one) => one.type === 'photo' || one.type === 'video');
}

/**
 * 여행과 연결된 기록인지 판별한다.
 *
 * 현재 `DailyRecord` 데이터 구조에는 여행(`trip_id`)을 가리키는 외래키 필드가 없다.
 * 따라서 DB 스키마/마이그레이션을 임의로 추가하지 않고, 기존 코드에서 확인 가능한
 * 여행 목록(`trips`)의 기간(`startDate` ~ `endDate`) 및 여행 일정 이벤트(`events` 중 `eventType === 'trip'`)의
 * 기간 내에 작성된 기록인지를 날짜 기준으로 매칭한다.
 *
 * [한계점]
 * 동일 날짜에 여러 여행이 겹치거나 여행 당일 일상 메모를 작성한 경우 여행 기록으로 함께 분류될 수 있는
 * 한계가 있으며, 향후 레코드 단위 외래키 필드가 도입되기 전까지 날짜 기반 매칭을 최소 범위로 적용한다.
 */
export function isTravelRecord(
  record: Pick<DailyRecord, 'date'>,
  trips: readonly Trip[],
  events: readonly CoupleEvent[] = [],
): boolean {
  const inTrip = trips.some((trip) => trip.startDate <= record.date && record.date <= trip.endDate);
  if (inTrip) return true;
  return events.some((event) => {
    if (event.eventType !== 'trip') return false;
    const end = event.endDate || event.startDate;
    return event.startDate <= record.date && record.date <= end;
  });
}

/**
 * 기록을 게시물 칸으로. **최근이 먼저다** -- 인스타의 프로필 격자와 같은 순서이고,
 * 프로필을 여는 사람이 가장 먼저 궁금해하는 것은 요즘이다.
 *
 * 아무것도 남기지 않은 기록은 칸이 되지 않는다. 글도 사진도 없는 행이 저장될 길은
 * 없지만, 있다면 그것은 빈 칸이고 빈 칸이야말로 이 격자가 없애려는 것이다.
 */
export function buildPostTiles(records: readonly DailyRecord[]): PostTile[] {
  return records
    .filter((record) => {
      const visuals = record.attachments?.filter(
        (one) => one.type === 'photo' || one.type === 'video',
      ) ?? [];
      return record.log.trim().length > 0 || visuals.length > 0;
    })
    .map((record) => {
      const visuals = record.attachments?.filter(
        (one) => one.type === 'photo' || one.type === 'video',
      ) ?? [];
      return {
        recordId: record.id,
        date: record.date,
        time: record.time,
        photo: firstVisual(record.attachments),
        text: record.log,
        multiple: visuals.length > 1,
        unavailable: record.contentUnavailable !== undefined,
      };
    })
    .sort((a, b) => (a.date === b.date
      ? b.time.localeCompare(a.time)
      : b.date.localeCompare(a.date)));
}
