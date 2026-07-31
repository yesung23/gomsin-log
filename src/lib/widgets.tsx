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

export type WidgetDef = {
  id: string;
  label: string;
  description: string;
  component: React.FC;
};

export const WIDGET_REGISTRY: Record<string, WidgetDef> = {
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
