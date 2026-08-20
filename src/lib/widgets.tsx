import React from 'react';
import { TodayLogWidget } from '@/components/widgets/TodayLogWidget';
import { DDayWidget } from '@/components/widgets/DDayWidget';
import { UpcomingScheduleWidget } from '@/components/widgets/UpcomingScheduleWidget';
import {
  TodayBriefingWidget,
  RecordShortcutWidget,
  ServiceProgressWidget,
  NextAnniversaryWidget,
  NextVacationWidget,
  MemoriesWidget,
  TodayConditionWidget,
} from '@/lib/widgetComponents';
import {
  PartnerEmotionFlowWidget,
  PartnerEmotionSummaryWidget,
} from '@/components/widgets/PartnerEmotionWidgets';
import { PartnerDayTimelineWidget } from '@/components/widgets/PartnerDayTimelineWidget';
import { CareHintWidget } from '@/components/widgets/CareHintWidget';
import { TalkAboutListWidget } from '@/components/widgets/TalkAboutListWidget';
import type { Role } from '@/types';

export type WidgetDef = {
  id: string;
  label: string;
  description: string;
  component: React.FC;
  /**
   * Which roles may use this widget. Omitted means both.
   *
   * Needed because the two new partner-emotion widgets only make sense for the
   * person reading someone else's day: offering "곰신의 마음 흐름" to 곰신 herself
   * would be a widget about her own records described as someone else's.
   */
  roles?: readonly Role[];
};

/**
 * Default home composition per role.
 *
 * 군화's default is deliberately SHORT. `통화 전 60초` is pinned by
 * `WidgetDashboard` outside this list and cannot be removed or reordered, so the
 * soldier home is: briefing, then the day it summarises, then D-Day.
 *
 * It used to be six widgets on top of the pinned briefing. Four of them --
 * `partner_emotion_flow`, `partner_emotion_summary`, `care_hint` and `today_word`
 * -- described the same day the briefing had just described, so the screen built to
 * save a soldier's minute spent it: PRODUCT_PRD §7.3 caps the core screen at three
 * priorities and this default carried seven surfaces. PRODUCT_REVIEW §2 diagnosed
 * exactly this and recorded the fix as done, but only the briefing card was
 * consolidated; the default was never changed.
 *
 * Nothing is deleted. The three description widgets are one tap away inside the
 * briefing's `더 보기`, `today_word` lives on the 기록 tab, and every one of them --
 * plus `upcoming_schedule` -- is still offered by `위젯 추가`. Users who already
 * arranged their own layout keep it: `WidgetDashboard` only falls back to this list
 * when the stored layout is empty.
 *
 * `partner_day` stays, and that is the load-bearing part. README §1.4 defines this
 * home as the partner's moments in chronological order, and
 * `PartnerDayTimelineWidget.test.tsx` exists precisely to stop a home that shows
 * only descriptions of them. The briefing is a judgement surface; `partner_day` is
 * the evidence it was judged from. They are not substitutes.
 *
 * 곰신 leads with the composer, because she is the one writing -- but PRODUCT_V3
 * §5.1 is explicit that `상대방의 오늘` belongs to BOTH roles: the north star is
 * "서로의 하루" (each other's day), not one-directional. `partner_day` used to be
 * `soldier`-only in `WIDGET_REGISTRY` and absent from 곰신's default entirely, so
 * she had a compose surface but no evidence surface of her own -- the same asymmetry
 * `partner_day` was written to fix on the other side. Order follows §5.1's stated
 * default for the side that writes more often: 기록 시작 → 상대방의 오늘 → 보조.
 */
/**
 * The surfaces the home screen pins, in the order that role reads them.
 *
 * These are NOT widgets. They cannot be removed, reordered or added, they render
 * without the drag chrome, and they sit above the widget layer -- because the two
 * roles are doing opposite jobs and the screen should say which one you are here
 * for before it offers you anything to arrange.
 *
 *  - 곰신 records their day. The composer is first, and what came back is under it.
 *  - 군화 catches up. PRODUCT_V3 §6.1's two layers in order -- the briefing that
 *    compresses (판단 화면), then the timeline that evidences it (근거 화면) -- then
 *    the bridge to the call.
 *
 * `today_word` is in BOTH, and that is §5.1: the record entry point exists for
 * both roles. The soldier default layout did not include it, so the person with
 * the scarce phone window had no composer on their home unless they went and
 * added one.
 *
 * `call_briefing` has no registry entry on purpose. It was never arrangeable --
 * it was pinned by the home screen outside the widget list -- and making it a
 * widget now would be offering to remove the one thing that screen is for.
 */
export const HOME_CORE_BY_ROLE: Record<Role, readonly string[]> = {
  gomsin: ['today_word', 'partner_day', 'talk_about_list'],
  soldier: ['call_briefing', 'partner_day', 'talk_about_list', 'today_word'],
};

export function isHomeCore(id: string, role: Role): boolean {
  return HOME_CORE_BY_ROLE[role].includes(id);
}

/**
 * What the widget layer starts with, now that the core is pinned above it.
 *
 * Both roles previously defaulted to a list whose first three entries are now
 * core. A stored layout that still names them is filtered at render rather than
 * rewritten -- a layout is a user's arrangement, and silently editing it to match
 * a structural change is not ours to do.
 */
export const DEFAULT_LAYOUT_BY_ROLE: Record<Role, string[]> = {
  soldier: ['dday'],
  gomsin: ['dday'],
};

const LEGACY_GOMSIN_DEFAULT = ['today_briefing', 'today_word', 'dday'];

/**
 * Move only the old untouched default to the new record-first product default.
 * Any custom order is a user's explicit choice and is preserved byte-for-byte.
 */
export function migrateWidgetLayout(layout: string[], role: Role): string[] {
  if (
    role === 'gomsin'
    && layout.length === LEGACY_GOMSIN_DEFAULT.length
    && layout.every((id, index) => id === LEGACY_GOMSIN_DEFAULT[index])
  ) {
    return [...DEFAULT_LAYOUT_BY_ROLE.gomsin];
  }
  return layout;
}

/**
 * Widgets this role may arrange, used by the add sheet and the renderer.
 *
 * Excludes the pinned core. Without that the add sheet would offer 상대방의 오늘
 * to someone whose home already shows it, and accepting would render it twice.
 */
export function widgetsForRole(role: Role): WidgetDef[] {
  return Object.values(WIDGET_REGISTRY).filter(
    (widget) => (!widget.roles || widget.roles.includes(role)) && !isHomeCore(widget.id, role),
  );
}

export function isWidgetAllowedForRole(id: string, role: Role): boolean {
  const widget = WIDGET_REGISTRY[id];
  if (!widget) return false;
  return !widget.roles || widget.roles.includes(role);
}

export const WIDGET_REGISTRY: Record<string, WidgetDef> = {
  partner_day: {
    id: 'partner_day',
    // The NAME stays canonical (PRODUCT_V3 §6 titles the surface 상대방의 오늘).
    // The description does not, because the subject is not always today: §6.1
    // makes it the missed window when the viewer has been away, and the widget
    // retitles itself 놓친 하루 in that state.
    label: '상대방의 오늘',
    description: '마지막 확인 이후 놓친 순간을 시간순으로, 사진·영상·음성까지 그대로',
    component: PartnerDayTimelineWidget,
    // Both roles: PRODUCT_V3 §5.1 -- the point of the surface is symmetric
    // ("서로의 하루"), not soldier-only. See DEFAULT_LAYOUT_BY_ROLE above.
  },
  talk_about_list: {
    id: 'talk_about_list',
    label: '오늘 이야기할 것',
    description: "'이따 이야기하기'로 표시해 둔 기록 모아보기",
    component: TalkAboutListWidget,
    // Both roles: either partner marks, either partner reads the list.
  },
  partner_emotion_flow: {
    id: 'partner_emotion_flow',
    label: '상대방의 마음 흐름',
    description: '오늘 공유된 마음이 어떻게 흘렀는지',
    component: PartnerEmotionFlowWidget,
    roles: ['soldier'],
  },
  partner_emotion_summary: {
    id: 'partner_emotion_summary',
    label: '오늘의 요약',
    description: '오늘 상대방이 공유한 이야기 요약',
    component: PartnerEmotionSummaryWidget,
    roles: ['soldier'],
  },
  care_hint: {
    id: 'care_hint',
    label: '다정한 한마디',
    description: '통화할 때 건네면 좋은 말 한마디',
    component: CareHintWidget,
    roles: ['soldier'],
  },
  today_briefing: {
    id: 'today_briefing',
    label: '오늘의 브리핑',
    description: '오늘 상대방이 공유한 기록의 요약',
    component: TodayBriefingWidget,
  },
  today_word: {
    id: 'today_word',
    label: '오늘의 기록',
    description: '글·사진·영상·음성으로 오늘을 남기기',
    component: TodayLogWidget,
  },
  record_shortcut: {
    id: 'record_shortcut',
    label: '기록 모아보기',
    description: '지금까지 쌓인 기록을 달력으로 보기',
    component: RecordShortcutWidget,
  },
  dday: {
    id: 'dday',
    label: '전역 D-Day',
    description: '남은 복무일과 함께한 날 수',
    component: DDayWidget,
  },
  upcoming_schedule: {
    id: 'upcoming_schedule',
    label: '다가오는 일정',
    description: '가까운 일정을 첫 화면에서 확인',
    component: UpcomingScheduleWidget,
  },
  service_progress: {
    id: 'service_progress',
    label: '복무 진행률',
    description: '입대일과 전역일로 계산한 복무 진행률',
    component: ServiceProgressWidget,
  },
  next_anniversary: {
    id: 'next_anniversary',
    label: '다음 기념일',
    description: '100일·1주년 등 다가오는 기념일 카운트다운',
    component: NextAnniversaryWidget,
  },
  next_vacation: {
    id: 'next_vacation',
    label: '다음 휴가·면회',
    description: '등록한 휴가나 면회 일정까지 남은 날',
    component: NextVacationWidget,
  },
  memories: {
    id: 'memories',
    label: '추억 다시보기',
    description: '작년 오늘 남긴 기록 돌아보기',
    component: MemoriesWidget,
  },
  today_condition: {
    id: 'today_condition',
    label: '오늘의 컨디션',
    description: '오늘 기록에 남긴 기분 표시',
    component: TodayConditionWidget,
  },
  // Removed: `today_meal` rendered a fixed barracks menu ("제육볶음, 된장찌개, 김치")
  // with no data source behind it, and `my_memo` was a static card with no input
  // that duplicated the composer's "나만 보기" option. Existing layouts that
  // still reference these ids are filtered out by WidgetDashboard.
};
