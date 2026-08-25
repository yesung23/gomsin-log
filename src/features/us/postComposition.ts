import type { Attachment, DailyRecord, Trip } from '@/types';
import { getPhotoAttachments } from '@/features/us/postTiles';
import { parseLocalDate, toLocalDateString } from '@/lib/utils';

/*
  `postComposition.ts` 이지 `PostComposer.ts` 가 아니다.

  `postTiles.ts` 가 `PostGrid.tsx` 와 갈라진 것과 같은 이유다. macOS 기본 파일시스템은
  대소문자를 구분하지 않으므로 `PostComposer.tsx` 와 `postComposer.ts` 는 같은 경로가
  되고, TypeScript 가 import 를 엉뚱하게 풀 때 나오는 오류는 아무도 그 자리를 보지 않는
  종류다.
*/

/**
 * 게시물 한 장. **업로드할 새 파일과 이미 서버에 있는 사진을 같은 목록에 세운다.**
 *
 * 인스타그램의 다음 화면이 하는 일이 정확히 이것이다 -- 어디서 왔는지와 무관하게 한 줄로
 * 세워 놓고 순서를 정한다. 곰신로그에서 "어디서 왔는지"는 세 가지다: 기기 앨범(새 파일),
 * 여행 사진(기존 기록), 스토리 사진(기존 기록).
 *
 * `sourceRecordId` 가 있으면 이미 서버에 있는 사진이다. 그 사진은 **다시 올리지 않는다** --
 * 같은 파일을 두 번 저장하면 저장 비용이 두 배가 되고, 원본 기록과 새 게시물이 서로 다른
 * 사본을 가리켜 하나를 지웠을 때 다른 하나가 어떻게 되는지 답할 수 없게 된다.
 */
export type PostDraftItem =
  /** 기기에서 새로 고른 사진. 업로드해야 한다. */
  | { kind: 'file'; id: string; file: File; previewUrl: string }
  /** 이미 서버에 있는 사진. 원본 기록을 가리킨다. */
  | { kind: 'existing'; id: string; sourceRecordId: string; attachment: Attachment };

/**
 * 한 게시물에 담을 수 있는 사진 수.
 *
 * 인스타그램은 20장이지만 그 값은 사진과 영상을 합산한, 팔로워에게 보여 주는 콘텐츠의
 * 상한이다. 곰신로그는 둘이 보는 기록이고 영상 경로가 아직 열리지 않았다
 * (`records.ts` 의 `MEDIA_POLICY_REFUSAL`). 기존 작성기 상한이 4장인데 게시물은 그보다
 * 넉넉해야 하므로 10장으로 둔다. 20장까지 늘리지 않는 실제 이유는 업로드가 **파일별로**
 * 실패할 수 있다는 것이다 -- 20장 중 3장이 실패한 화면을 사용자가 이해할 수 있게 만드는
 * 것은 별개의 큰 문제이고, 10장이면 하루의 한 순간을 담기에 모자라지 않는다.
 */
export const MAX_POST_PHOTOS = 10;

/** 게시물에 더 담을 수 있는 장수. 음수가 되지 않는다. */
export function remainingPostSlots(items: readonly PostDraftItem[]): number {
  return Math.max(0, MAX_POST_PHOTOS - items.length);
}

/**
 * 한 칸을 다른 자리로 옮긴다. **인스타그램의 길게 눌러 드래그가 하는 일.**
 *
 * 첫 칸이 프로필 격자의 대표 사진이 되므로(`postTiles.ts` 의 `photo`) 순서는 장식이
 * 아니다. 범위를 벗어난 인덱스는 목록을 그대로 돌려준다 -- 드래그가 화면 밖에서 끝나는
 * 것은 정상적인 사용자 동작이고, 그때 배열이 망가지면 사용자가 고른 사진이 사라진다.
 */
export function movePostItem(
  items: readonly PostDraftItem[],
  from: number,
  to: number,
): PostDraftItem[] {
  if (from === to) return [...items];
  if (from < 0 || from >= items.length) return [...items];
  if (to < 0 || to >= items.length) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** 한 칸을 뺀다. 인스타그램 편집 화면의 개별 제거와 같다. */
export function removePostItem(
  items: readonly PostDraftItem[],
  id: string,
): PostDraftItem[] {
  return items.filter((item) => item.id !== id);
}

/**
 * 이미 담은 사진인가.
 *
 * 여행 탭과 스토리 탭이 같은 기록을 보여 줄 수 있으므로(여행 기간의 사진 기록은 양쪽에
 * 모두 나타난다) 같은 첨부를 두 번 고르는 것이 실제로 일어난다. `path` 로 판정하는 이유는
 * 서명된 URL 이 매번 달라지기 때문이다 -- URL 로 비교하면 같은 파일이 다른 파일로 보인다.
 */
export function containsAttachment(
  items: readonly PostDraftItem[],
  attachment: Attachment,
): boolean {
  return items.some((item) => (
    item.kind === 'existing'
    && item.attachment.path !== undefined
    && item.attachment.path === attachment.path
  ));
}

/**
 * 기존 기록에서 고를 수 있는 사진 하나.
 *
 * 비공개 기록은 애초에 여기 오지 않는다 -- 호출부가 `visibleRecordsForViewer` 를 통과한
 * 목록만 넘기고, 아래에서 `isPrivate` 를 한 번 더 거른다. 두 번 거르는 것은 중복이 아니라
 * 이 함수가 다른 호출부에 재사용될 때를 위한 것이다.
 */
export interface SelectablePhoto {
  recordId: string;
  date: string;
  time: string;
  attachment: Attachment;
}

/**
 * 게시물에 넣을 수 있는 기존 사진을 최근 순으로 세운다.
 *
 * 열 수 없는 기록(`contentUnavailable`)은 제외한다. 못 읽는 사진을 고르게 하면 사용자는
 * 자기가 고른 것이 무엇인지 모른 채 게시물을 만들게 된다.
 */
export function selectablePhotos(
  records: readonly DailyRecord[],
  options: { dates?: ReadonlySet<string> } = {},
): SelectablePhoto[] {
  const { dates } = options;
  return records
    .filter((record) => !record.isPrivate)
    .filter((record) => record.contentUnavailable === undefined)
    .filter((record) => (dates ? dates.has(record.date) : true))
    .flatMap((record) => getPhotoAttachments(record)
      .filter((attachment) => attachment.path !== undefined)
      .map((attachment) => ({
        recordId: record.id,
        date: record.date,
        time: record.time,
        attachment,
      })))
    .sort((a, b) => (a.date === b.date
      ? b.time.localeCompare(a.time)
      : b.date.localeCompare(a.date)));
}

/**
 * 여행 기간에 걸친 날짜 집합.
 *
 * 여행은 기록을 직접 소유하지 않는다. 기간만 가지고 있고 그 기간의 사진 기록이 그 여행의
 * 사진이다(`trips.ts` 가 같은 방식으로 판정한다). 그래서 "여행에서 고르기" 는 날짜
 * 필터로 구현된다.
 */
export function tripDateSet(trips: readonly Pick<Trip, 'startDate' | 'endDate'>[]): Set<string> {
  const dates = new Set<string>();
  for (const trip of trips) {
    if (!trip.startDate) continue;
    const end = trip.endDate || trip.startDate;
    /*
      `toISOString()` 을 쓰지 않는다.

      그것은 UTC 로 바꾸므로 `Asia/Seoul` 에서는 날짜가 하루 앞으로 밀린다. 이 앱의 달력은
      한국 로컬이고(`localToday`), 여행 8/1–8/2 가 7/31–8/1 로 계산되면 그 여행의 사진이
      "여행에서 고르기" 에서 사라진다. 저장소가 이미 가진 로컬 변환을 쓴다.
    */
    const cursor = parseLocalDate(trip.startDate);
    const last = parseLocalDate(end);
    if (Number.isNaN(cursor.getTime()) || Number.isNaN(last.getTime())) continue;
    // 상한을 둔다. 잘못 입력된 종료일이 무한 루프가 되지 않게.
    let guard = 0;
    while (cursor <= last && guard < 400) {
      dates.add(toLocalDateString(cursor));
      cursor.setDate(cursor.getDate() + 1);
      guard += 1;
    }
  }
  return dates;
}
