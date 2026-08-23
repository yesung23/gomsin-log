import type { Attachment, DailyRecord } from '@/types';

/*
  `postTiles.ts` 이지 `postGrid.ts` 가 아니다.

  macOS 는 기본이 대소문자 비구분 파일시스템이라 `PostGrid.tsx` 와 `postGrid.ts` 가
  **같은 경로**다. TypeScript 가 import 를 엉뚱한 쪽으로 풀고, 그때 나오는 오류는
  "쓰지 않는 변수" 라서 아무도 그 자리를 보지 않는다. `MonthGrid.tsx` 가 같은 함정을
  이미 밟고 `monthTexture.ts` 로 갈라 두었고, 이 파일도 같은 이유로 갈라 둔다.
*/

/**
 * 게시물 격자에 들어갈 칸 하나. **하루가 아니라 기록 하나가 한 칸이다.**
 *
 * ## 왜 하루 격자를 대체하는가
 *
 * 앞의 판은 한 달의 모든 날을 7열로 그렸다. 날짜 순이고 요일 정렬이 아니라는 이유로
 * "달력이 아니라 질감" 이라고 적혀 있었지만, **쓰는 사람에게는 달력으로 읽힌다** --
 * 날짜가 적혀 있고 빈 칸이 있으면 그것은 달력이다.
 *
 * 인스타의 프로필 격자는 날이 아니라 **게시물**을 센다. 그래서 안 올린 날의 빈 칸이
 * 없다. 하루 격자를 고른 원래 이유가 "사진 안 올리는 커플에게 구멍 난 격자가 되는 것을
 * 막으려고" 였는데, 칸의 단위를 기록으로 바꾸면 **그 문제가 구조적으로 사라진다** --
 * 남기지 않은 날은 칸이 생기지 않을 뿐 빈 칸으로 남지 않는다.
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
