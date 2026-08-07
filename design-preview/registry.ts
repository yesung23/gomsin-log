import type { ComponentType } from 'react';
import { BriefingExpanded, GomsinHome, PartnerDayFull, SoldierHome } from './screens';
import { RecordComposer, RecordDetail, RecordTimeline } from './screensRecord';
import { Schedule, ScheduleDetail, TripDetail, Trips } from './screensPlan';
import { DeleteConfirm, My, Settings, Us } from './screensAccount';
import { Login, Onboarding, PendingConnect } from './screensAuth';
import type { ScreenState } from './fixtures';

/**
 * Screen registry.
 *
 * Separate from `Harness.tsx` on purpose: a module that exports both components
 * and other values trips `react-refresh/only-export-components`, and `npm run
 * lint` runs with `--max-warnings 0`. This file declares no components of its own,
 * so exporting the tables here is clean.
 */

export type ScreenProps = { state: ScreenState; compact: boolean };

export const SCREENS: {
  id: string;
  label: string;
  group: string;
  C: ComponentType<ScreenProps>;
}[] = [
  { id: 'soldier-home', label: '군화 홈', group: '홈', C: SoldierHome },
  { id: 'briefing-expanded', label: '브리핑 더 보기', group: '홈', C: BriefingExpanded },
  { id: 'partner-day-full', label: '상대방의 오늘 전체', group: '홈', C: PartnerDayFull },
  { id: 'gomsin-home', label: '곰신 홈', group: '홈', C: GomsinHome },
  { id: 'record-timeline', label: '기록 탭', group: '기록', C: RecordTimeline },
  { id: 'record-composer', label: '기록 작성', group: '기록', C: RecordComposer },
  { id: 'record-detail', label: '기록 상세', group: '기록', C: RecordDetail },
  { id: 'schedule', label: '일정', group: '계획', C: Schedule },
  { id: 'schedule-detail', label: '일정 상세', group: '계획', C: ScheduleDetail },
  { id: 'trips', label: '여행 목록', group: '계획', C: Trips },
  { id: 'trip-detail', label: '여행 상세', group: '계획', C: TripDetail },
  { id: 'us', label: '우리', group: '관계', C: Us },
  { id: 'my', label: '마이', group: '계정', C: My },
  { id: 'settings', label: '설정', group: '계정', C: Settings },
  { id: 'delete-confirm', label: '삭제 확인', group: '계정', C: DeleteConfirm },
  { id: 'login', label: '로그인', group: '진입', C: Login },
  { id: 'onboarding', label: '온보딩', group: '진입', C: Onboarding },
  { id: 'pending', label: '연결 대기', group: '진입', C: PendingConnect },
];

export const VIEWPORTS = [
  { name: '390×844', width: 390, height: 844, compact: false },
  { name: '320×568', width: 320, height: 568, compact: true },
] as const;

export const THEMES = ['light', 'dark'] as const;

export const STATES: { id: ScreenState; label: string }[] = [
  { id: 'normal', label: '정상' },
  { id: 'empty', label: '빈 상태' },
  { id: 'loading', label: '로딩' },
  { id: 'error', label: '오류' },
  { id: 'long', label: '긴 텍스트' },
];
