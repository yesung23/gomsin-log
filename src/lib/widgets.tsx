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
import { CareHintWidget } from '@/components/widgets/CareHintWidget';
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
 * 군화 leads with the partner's emotion flow and then the summary, because a
 * soldier gets a short window and needs "how is she" before anything else. 곰신
 * leads with the briefing and the composer, because she is the one writing.
 */
export const DEFAULT_LAYOUT_BY_ROLE: Record<Role, string[]> = {
  soldier: ['partner_emotion_flow', 'partner_emotion_summary', 'care_hint', 'today_word', 'dday'],
  gomsin: ['today_briefing', 'today_word', 'dday'],
};

/** Widgets this role is allowed to see, used by the add sheet and the renderer. */
export function widgetsForRole(role: Role): WidgetDef[] {
  return Object.values(WIDGET_REGISTRY).filter(
    (widget) => !widget.roles || widget.roles.includes(role),
  );
}

export function isWidgetAllowedForRole(id: string, role: Role): boolean {
  const widget = WIDGET_REGISTRY[id];
  if (!widget) return false;
  return !widget.roles || widget.roles.includes(role);
}

export const WIDGET_REGISTRY: Record<string, WidgetDef> = {
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
