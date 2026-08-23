import type { CoupleEvent, MilitaryInfo, ProfileDateType } from '@/types';
import { togetherDays } from '@/lib/coupleStats';
import { computeServiceProgress, nextUpcomingEvent } from '@/lib/milestones';

export const PROFILE_CAPTION_MAX_LENGTH = 80;
export const PROFILE_USERNAME_PATTERN = /^[a-z][a-z0-9_]{2,19}$/;

export type ProfileCaptionToken = ProfileDateType;

export interface ProfileCaptionInput {
  template?: string;
  anniversaryDate?: string;
  events: CoupleEvent[];
  military?: MilitaryInfo;
  todayStr: string;
}

export type ProfileCaptionResult =
  | { status: 'empty'; text: null; missing: [] }
  | { status: 'needs_setup'; text: null; missing: ProfileCaptionToken[] }
  | { status: 'ready'; text: string; missing: [] };

const DEFAULT_PROFILE_CAPTION = '일째 같은 하늘 아래';

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidUsername(value: string): boolean {
  return PROFILE_USERNAME_PATTERN.test(normalizeUsername(value));
}

function formatCaptionDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${year}년 ${month}월 ${day}일`;
}

function valueForToken(token: ProfileCaptionToken, input: ProfileCaptionInput): string | null {
  if (token === 'together') {
    const days = togetherDays(input.anniversaryDate, input.todayStr);
    return days === null ? null : String(days);
  }

  if (token === 'meeting') {
    const event = nextUpcomingEvent(input.events, input.todayStr);
    return event ? formatCaptionDate(event.startDate) : null;
  }

  const progress = computeServiceProgress(input.military, input.todayStr);
  return progress ? String(progress.remainingDays) : null;
}

const TOKEN_REPLACEMENTS: readonly [string, ProfileCaptionToken][] = [
  ['(함께한 날)', 'together'],
  ['(만남)', 'meeting'],
  ['(전역)', 'discharge'],
];

/** Render only facts already present in the user's profile and shared state. */
export function renderProfileCaption(input: ProfileCaptionInput): ProfileCaptionResult {
  const template = input.template?.trim() || '';
  if (!template) {
    const days = togetherDays(input.anniversaryDate, input.todayStr);
    return days === null
      ? { status: 'needs_setup', text: null, missing: ['together'] }
      : { status: 'ready', text: `${days}${DEFAULT_PROFILE_CAPTION}`, missing: [] };
  }

  const missing = TOKEN_REPLACEMENTS
    .filter(([token]) => template.includes(token))
    .map(([, token]) => token)
    .filter((token) => valueForToken(token, input) === null);
  if (missing.length > 0) return { status: 'needs_setup', text: null, missing };

  const text = TOKEN_REPLACEMENTS.reduce(
    (result, [token, key]) => result.split(token).join(valueForToken(key, input) ?? token),
    template,
  );
  return { status: 'ready', text, missing: [] };
}
