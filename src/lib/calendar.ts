import type { CoupleEvent } from '@/types';
import { daysBetweenLocal } from '@/lib/utils';

export interface EventDraft {
  title: string;
  startDate: string;
  endDate?: string;
}

export function eventOccursOnDate(event: CoupleEvent, date: string): boolean {
  const endDate = event.endDate || event.startDate;
  return event.startDate <= date && date <= endDate;
}

export function eventsOnDate(events: CoupleEvent[], date: string): CoupleEvent[] {
  return events.filter((event) => eventOccursOnDate(event, date));
}

export function upcomingEvents(events: CoupleEvent[], today: string): CoupleEvent[] {
  return events
    .filter((event) => (event.endDate || event.startDate) >= today)
    .sort((a, b) => {
      const dateOrder = a.startDate.localeCompare(b.startDate);
      return dateOrder !== 0 ? dateOrder : a.createdAt.localeCompare(b.createdAt);
    });
}

export function validateEventDraft(draft: EventDraft): string | null {
  if (!draft.title.trim()) return '일정 제목을 입력해 주세요.';
  if (!draft.startDate) return '시작일을 선택해 주세요.';
  if (draft.endDate && draft.endDate < draft.startDate) {
    return '종료일은 시작일보다 빠를 수 없어요.';
  }
  return null;
}

export function dDayLabel(targetDate: string, today: string): string {
  const difference = daysBetweenLocal(today, targetDate);
  if (difference === 0) return 'D-DAY';
  return difference > 0 ? `D-${difference}` : `D+${Math.abs(difference)}`;
}
