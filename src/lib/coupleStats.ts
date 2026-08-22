import type { CoupleEvent, DailyRecord, MilitaryInfo } from '@/types';
import { daysBetweenLocal } from '@/lib/utils';
import {
  computeServiceProgress,
  nextAnniversaryMilestone,
  nextUpcomingEvent,
} from '@/lib/milestones';

/**
 * 커플 프로필의 세 숫자.
 *
 * ## 인스타의 통계 줄에서 무엇을 가져왔나
 *
 * 인스타 프로필의 `게시물 · 팔로워 · 팔로잉`은 네 가지 성질을 갖는다: 균등 3분할,
 * 위는 숫자 아래는 라벨, 전부 탭 가능, **클수록 좋다**. 앞의 셋을 그대로 가져오고
 * **넷째만 뒤집는다.**
 *
 *     함께한 날   쌓인다   ← 클수록 좋다
 *     만남까지    줄어든다 ← 작을수록 좋다
 *     (선택)      줄어든다
 *
 * 두 방향이 한 줄에 공존하는 것이 이 제품의 시간 감각이다. 인스타에는 없는 성질이고,
 * 떨어져 있는 두 사람에게는 그것이 전부다.
 *
 * ## 첫 칸이 "게시물" 자리인 것은 우연이 아니다
 *
 * 인스타에서 게시물 수를 누르면 격자로 간다. `함께한 날`의 수는 곧 **격자 칸의 수**다.
 * 숫자와 격자가 문자 그대로 같은 것이라 자리가 정확히 맞는다.
 *
 * ## 0을 보여주지 않는다
 *
 * 기념일을 안 정했으면 `0일`이 아니라 `—`다. 다음 만남이 없으면 `D-0`이 아니라 `미정`이다.
 * 없는 것을 0으로 적으면 앱이 사용자 관계에 대해 거짓을 말하게 된다 -- `DDayWidget`이
 * 지어낸 기념일을 지운 것과 같은 이유다(M-1).
 *
 * ## 여기서 계산하지 않는 것
 *
 * 전부 `milestones.ts`가 이미 갖고 있다. 이 파일은 그 값들을 한 줄로 모으는 일만 한다 --
 * 위젯마다 흩어져 있던 것을 프로필이 다시 쓰는 것이지 새로 만드는 것이 아니다.
 */

/** 세 번째 칸에 무엇을 놓을지. 커플마다 기다리는 것이 다르다. */
export type ThirdSlotChoice = 'discharge' | 'anniversary' | 'meetings';

export interface CoupleStat {
  /** 화면에 크게 오는 값. 없으면 `—`. */
  value: string;
  label: string;
  /** 눌렀을 때 갈 곳. 없으면 누를 수 없다. */
  href?: string;
  /** 값이 없을 때 무엇을 하면 되는지. */
  hint?: string;
}

const MEETING_TYPES = ['visit', 'vacation', 'date', 'trip'] as const;

/** 함께한 날. 한국식으로 사귄 날이 1일이다. */
export function togetherDays(anniversaryDate: string | undefined, todayStr: string): number | null {
  if (!anniversaryDate) return null;
  const days = daysBetweenLocal(anniversaryDate, todayStr) + 1;
  return days > 0 ? days : null;
}

export function buildCoupleStats({
  anniversaryDate,
  events,
  military,
  todayStr,
  thirdSlot,
}: {
  anniversaryDate?: string;
  events: CoupleEvent[];
  military?: MilitaryInfo;
  todayStr: string;
  /** 사용자가 고른 세 번째 칸. 군 정보가 없으면 기념일로 조용히 대체된다. */
  thirdSlot: ThirdSlotChoice;
}): [CoupleStat, CoupleStat, CoupleStat] {
  const days = togetherDays(anniversaryDate, todayStr);

  const meeting = nextUpcomingEvent(events, todayStr, [...MEETING_TYPES]);
  const meetingDays = meeting ? daysBetweenLocal(todayStr, meeting.startDate) : null;

  const service = computeServiceProgress(military, todayStr);
  const anniversary = nextAnniversaryMilestone(anniversaryDate, todayStr);
  const upcomingMeetings = events.filter(
    (event) => MEETING_TYPES.includes(event.eventType as typeof MEETING_TYPES[number])
      && !!event.startDate && event.startDate >= todayStr,
  ).length;

  /*
    세 번째 칸이 비면 조용히 대체한다.

    군 정보를 안 넣은 커플에게 `전역까지 —`를 남겨 두면 빈 칸이 셋 중 하나를 차지한다.
    전역한 뒤에도 같은 일이 일어나는데, 그때는 대체가 곧 "조용한 전환"이다 -- 축하
    팝업도 리텐션 유도도 없이 그 칸이 다음 기다림으로 바뀐다.
  */
  const third: CoupleStat = (() => {
    if (thirdSlot === 'discharge' && service && !service.isDischarged) {
      return { value: `${service.remainingDays}`, label: '전역까지', href: '/service' };
    }
    if (thirdSlot === 'meetings' && upcomingMeetings > 0) {
      return { value: `${upcomingMeetings}`, label: '예정된 만남', href: '/schedule' };
    }
    if (anniversary) {
      return { value: `D-${anniversary.daysRemaining}`, label: anniversary.label, href: '/schedule' };
    }
    return { value: '—', label: '다음 기념일', hint: '기념일을 정하면 보여요' };
  })();

  return [
    days !== null
      ? { value: `${days}`, label: '함께한 날' }
      : { value: '—', label: '함께한 날', hint: '사귄 날을 정하면 세기 시작해요' },
    meetingDays !== null && meetingDays >= 0
      ? { value: meetingDays === 0 ? '오늘' : `D-${meetingDays}`, label: '만남까지', href: '/schedule' }
      : { value: '미정', label: '만남까지', href: '/schedule', hint: '일정을 더하면 보여요' },
    third,
  ];
}

/** 격자가 세는 것과 같은 방식으로 사진 수를 센다. 프로필의 숫자가 격자와 어긋나면 안 된다. */
export function photoCount(records: DailyRecord[]): number {
  return records.reduce(
    (total, record) => total + (record.attachments ?? []).filter((a) => a.type === 'photo').length,
    0,
  );
}
