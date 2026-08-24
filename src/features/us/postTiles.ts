import type { Attachment, DailyRecord } from '@/types';

/*
  `postTiles.ts` 이지 `postGrid.ts` 가 아니다.

  macOS 는 기본이 대소문자 비구분 파일시스템이라 `PostGrid.tsx` 와 `postGrid.ts` 가
  **같은 경로**다. TypeScript 가 import 를 엉뚱한 쪽으로 풀고, 그때 나오는 오류는
  "쓰지 않는 변수" 라서 아무도 그 자리를 보지 않는다. `MonthGrid.tsx` 가 같은 함정을
  이미 밟고 `monthTexture.ts` 로 갈라 두었고, 이 파일도 같은 이유로 갈라 둔다.
*/

/**
 * 사진 게시물 격자에 들어갈 칸 하나. **하루가 아니라 기록 하나가 한 칸이다.**
 *
 * ## 왜 사진 기록으로 좁히는가
 *
 * 앞의 판은 한 달의 모든 날을 7열로 그렸다. 날짜 순이고 요일 정렬이 아니라는 이유로
 * "달력이 아니라 질감" 이라고 적혀 있었지만, **쓰는 사람에게는 달력으로 읽힌다** --
 * 날짜가 적혀 있고 빈 칸이 있으면 그것은 달력이다. 지금은 그 자리를 인스타그램처럼
 * 공유 사진 기록 게시물에 사용한다.
 *
 * 인스타의 프로필 격자는 날이 아니라 **게시물**을 센다. 일반 기록은 사진 탭의 기존
 * 기록 목록에서 본다.
 *
 * ## 사진이 있는 기록만 칸이 된다
 *
 * 이 격자는 글 목록이 아니라 사진 게시물 표면이다. 글만 남긴 기록은 `사진` 탭의 기존
 * 기록 목록에서 읽고, 이곳에서는 사진을 올린 게시물만 인스타그램처럼 한 칸을 차지한다.
 */
export interface PostTile {
  recordId: string;
  date: string;
  time: string;
  /** 격자에 보일 첫 번째 사진. 게시물 하나가 한 칸을 차지한다. */
  photo: Attachment;
  /** 사진이 여럿인가. 인스타가 겹친 장 표시를 다는 조건과 같다. */
  multiple: boolean;
  /** 이 기기가 못 여는 기록(`key_unavailable` · `undecryptable`). 없는 것이 아니라 못 여는 것이다. */
  unavailable: boolean;
}

/** 게시물 격자가 보여줄 사진만 추린다. 영상·음성은 이 사진 전용 표면에서 제외한다. */
export function getPhotoAttachments(
  record: Pick<DailyRecord, 'attachments'>,
): Attachment[] {
  return record.attachments?.filter((attachment) => attachment.type === 'photo') ?? [];
}

/**
 * 기록을 게시물 칸으로. **최근이 먼저다** -- 인스타의 프로필 격자와 같은 순서이고,
 * 프로필을 여는 사람이 가장 먼저 궁금해하는 것은 요즘이다.
 *
 * 사진이 없는 기록은 칸이 되지 않는다. 글만 남긴 기록을 사진 자리처럼 꾸미면 사용자가
 * 기대한 사진 게시물과 실제로 열리는 글 기록이 어긋난다. 그런 기록은 `사진` 탭이 맡는다.
 */
export function buildPostTiles(records: readonly DailyRecord[]): PostTile[] {
  return records
    .map((record) => ({ record, photos: getPhotoAttachments(record) }))
    .filter(({ photos }) => photos.length > 0)
    .map((record) => {
      return {
        recordId: record.record.id,
        date: record.record.date,
        time: record.record.time,
        photo: record.photos[0],
        multiple: record.photos.length > 1,
        unavailable: record.record.contentUnavailable !== undefined,
      };
    })
    .sort((a, b) => (a.date === b.date
      ? b.time.localeCompare(a.time)
      : b.date.localeCompare(a.date)));
}
