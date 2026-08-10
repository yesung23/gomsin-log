import { serverCallBlockedByPendingDeletion } from '@/lib/accountDeletion';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { classifyServerError, type ServerErrorKind } from '@/lib/serverErrors';
import {
  CYCLE_SUPPORT_KINDS,
  CYCLE_SYMPTOMS,
  CYCLE_FLOWS,
  CYCLE_PAIN_LEVELS,
  CYCLE_MOODS,
  CyclePeriod,
  CycleDailyLog,
  CycleSharingPreferences,
  CyclePartnerProjection,
  CycleFlow,
  CyclePainLevel,
  CycleMood,
  CycleEntry,
  CycleSettings,
  CycleSupportKind,
  CycleSupportSignal,
  CycleSymptom,
} from '@/types';

export function isCycleFlow(value: unknown): value is CycleFlow {
  return typeof value === 'string' && (CYCLE_FLOWS as readonly string[]).includes(value);
}

export function isCyclePainLevel(value: unknown): value is CyclePainLevel {
  return typeof value === 'string' && (CYCLE_PAIN_LEVELS as readonly string[]).includes(value);
}

export function isCycleMood(value: unknown): value is CycleMood {
  return typeof value === 'string' && (CYCLE_MOODS as readonly string[]).includes(value);
}

export function mapCyclePeriodRow(row: any): CyclePeriod {
  return {
    id: row.id,
    userId: row.user_id,
    startDate: row.start_date,
    endDate: row.end_date || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapCycleDailyLogRow(row: any): CycleDailyLog {
  return {
    id: row.id,
    userId: row.user_id,
    logDate: row.log_date,
    flow: isCycleFlow(row.flow) ? row.flow : undefined,
    painLevel: isCyclePainLevel(row.pain_level) ? row.pain_level : undefined,
    symptoms: Array.isArray(row.symptoms) ? row.symptoms.filter(isCycleSymptom) : [],
    mood: isCycleMood(row.mood) ? row.mood : undefined,
    note: row.note || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
const cycleSymptomSet = new Set<string>(CYCLE_SYMPTOMS);
const cycleSupportKindSet = new Set<string>(CYCLE_SUPPORT_KINDS);
export const CYCLE_SUPPORT_MESSAGE_MAX_LENGTH = 80;
export const CYCLE_LENGTH_MIN = 15;
export const CYCLE_LENGTH_MAX = 60;
export const PERIOD_LENGTH_MIN = 1;
export const PERIOD_LENGTH_MAX = 15;

/**
 * Why a cycle read failed.
 *
 * `not_deployed` is separate from `error` because the two need opposite copy and
 * opposite affordances. A missing table (`PGRST205`/`42P01`) means migration 022
 * has not been applied to this project: the request arrived, the server answered,
 * and no amount of retrying or reconnecting will change the answer. Collapsing it
 * into `error` produced "연결을 확인하고 다시 시도해 주세요" on a perfectly good
 * connection, which sent the user to check their wifi for a deployment gap.
 */
export type CycleFetchFailureReason =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_deployed'
  | 'error';
export type CycleFetchFailure = { ok: false; reason: CycleFetchFailureReason };
export type CycleSettingsFetchResult =
  | { ok: true; settings: CycleSettings | null }
  | CycleFetchFailure;
export type CycleEntriesFetchResult =
  | { ok: true; entries: CycleEntry[] }
  | CycleFetchFailure;
export type CycleSupportSignalsFetchResult =
  | { ok: true; signals: CycleSupportSignal[] }
  | CycleFetchFailure;
export type CyclePeriodsFetchResult =
  | { ok: true; periods: CyclePeriod[] }
  | CycleFetchFailure;
export type CycleDailyLogsFetchResult =
  | { ok: true; logs: CycleDailyLog[] }
  | CycleFetchFailure;
/**
 * Outcome of reading the partner-facing projection.
 *
 * `{ ok: true, projection: null }` is a real, distinct answer: the couple is not
 * connected, or the RPC has not been deployed to this project. It is NOT the
 * same as "nothing is shared", which is a projection with every flag false. The
 * partner surface renders those two states differently, so they must not
 * collapse into one value.
 */
export type CyclePartnerProjectionFetchResult =
  | { ok: true; projection: CyclePartnerProjection | null }
  | CycleFetchFailure;

/**
 * Outcome of a cycle write.
 *
 * Deliberately not `T | null` / `boolean`. Those shapes discarded the one thing
 * the user needed: an RLS rejection (`42501`, e.g. the couple was disconnected
 * from the other device mid-session), an expired session and a dead network all
 * collapsed into one falsy value, so both cycle surfaces reported "연결을 확인해
 * 주세요" and invited a retry that could never succeed. The reason is classified
 * by `serverErrors.ts` and carried to the message the user reads.
 */
export type CycleWriteFailure = { ok: false; reason: ServerErrorKind };
export type CycleEntryWriteResult = { ok: true; entry: CycleEntry } | CycleWriteFailure;
export type CycleSettingsWriteResult = { ok: true; settings: CycleSettings } | CycleWriteFailure;
export type CycleSupportWriteResult = { ok: true; signal: CycleSupportSignal } | CycleWriteFailure;
export type CycleDeleteResult = { ok: true } | CycleWriteFailure;
export type CyclePeriodWriteResult = { ok: true; period: CyclePeriod } | CycleWriteFailure;
export type CycleDailyLogWriteResult = { ok: true; log: CycleDailyLog } | CycleWriteFailure;

export interface CycleEntryDraft {
  startDate: string;
  endDate?: string;
  notes?: string;
  symptoms: CycleSymptom[];
  flow?: CycleFlow;
  painLevel?: CyclePainLevel;
  mood?: CycleMood;
}

export interface CalendarCell {
  date: string | null;
  day: number | null;
}

export interface CycleRangeMatch {
  entry: CycleEntry;
  isStart: boolean;
  isEnd: boolean;
}

export interface CreateCycleSupportSignalInput {
  coupleId: string;
  kind: CycleSupportKind;
  sharedForDate: string;
  message?: string;
  expiresAt?: string;
}

export interface CycleSupportInsertPayload {
  couple_id: string;
  owner_id: string;
  kind: CycleSupportKind;
  message: string | null;
  shared_for_date: string;
  expires_at: string;
}

/**
 * PostgREST/Postgres codes that mean "this table is not in the project yet".
 *
 * `PGRST205` is the schema-cache miss PostgREST returns for an unknown table, and
 * `42P01` is Postgres `undefined_table` for the same condition seen deeper down.
 */
const MISSING_TABLE_CODES: ReadonlySet<string> = new Set(['PGRST205', '42P01']);

function fetchFailure(error?: { code?: string } | null): CycleFetchFailure {
  const code = error?.code;
  if (code === '42501') return { ok: false, reason: 'forbidden' };
  if (code && MISSING_TABLE_CODES.has(code)) return { ok: false, reason: 'not_deployed' };
  return { ok: false, reason: 'error' };
}

/** Classify a rejected Supabase write into the shared server-error vocabulary. */
function writeFailure(error: unknown): CycleWriteFailure {
  return { ok: false, reason: classifyServerError(error).kind };
}

/**
 * The client cannot reach a server at all (no Supabase configuration).
 *
 * `offline` only when the browser itself reports no network, so a build without
 * credentials never claims a connection problem it cannot know about.
 */
function unconfiguredFailure(): CycleWriteFailure {
  return {
    ok: false,
    reason: classifyServerError(new Error('Cycle database is unavailable')).kind === 'offline'
      ? 'offline'
      : 'server',
  };
}

/**
 * The tri-state pre-flight gate blocked this write because the account is being
 * deleted.
 *
 * `forbidden` is the honest classification -- authenticated but not permitted --
 * and it is correctly non-retryable. The copy is a fallback only: the gate also
 * triggers the pending-deletion surface, which takes over the screen.
 */
function deletionGateFailure(): CycleWriteFailure {
  return { ok: false, reason: 'forbidden' };
}

/**
 * A write that never left the client because the draft was locally invalid.
 *
 * Both cycle surfaces run the same validators first and show their specific
 * Korean copy, so this is a defensive fallback rather than the message a user
 * normally sees.
 */
function invalidDraftFailure(): CycleWriteFailure {
  return { ok: false, reason: 'unknown' };
}

/** No usable session, so the request cannot be attributed to a user. */
function unauthenticatedFailure(): CycleWriteFailure {
  return { ok: false, reason: 'auth_expired' };
}

async function currentUserId(): Promise<string | null> {
  if (!supabase) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user.id || null;
}

export function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function localToday(): string {
  return toLocalDateString(new Date());
}

export function koreaToday(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day, 12);
  return parsed.getFullYear() === year
    && parsed.getMonth() === month - 1
    && parsed.getDate() === day;
}

export function buildMonthCalendarCells(year: number, month: number): CalendarCell[] {
  const leadingCount = new Date(year, month, 1, 12).getDay();
  const daysInMonth = new Date(year, month + 1, 0, 12).getDate();
  const cells: CalendarCell[] = Array.from(
    { length: leadingCount },
    () => ({ date: null, day: null }),
  );
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ date: toLocalDateString(new Date(year, month, day, 12)), day });
  }
  while (cells.length % 7 !== 0) cells.push({ date: null, day: null });
  return cells;
}

export function shiftCalendarMonth(
  year: number,
  month: number,
  amount: number,
): { year: number; month: number } {
  const shifted = new Date(year, month + amount, 1, 12);
  return { year: shifted.getFullYear(), month: shifted.getMonth() };
}

export function cycleEntryOccursOnDate(entry: CycleEntry, date: string): boolean {
  return entry.startDate <= date && date <= (entry.endDate || entry.startDate);
}

/*
 * ---------------------------------------------------------------
 * V3 pure helpers.
 *
 * These take `CyclePeriod[]` / `CycleDailyLog[]` and NOTHING else. The whole
 * point of the V3 split is that a daily log can never be mistaken for a period
 * start, so the types are the enforcement mechanism: passing a `CycleDailyLog`
 * to `activePeriodOnDate` does not compile, because a daily log has no
 * `startDate`.
 * ---------------------------------------------------------------
 */

/**
 * Does this period cover `date`?
 *
 * A closed period covers its inclusive range. An OPEN period (no end recorded
 * yet) covers from its start through `today` — not just its start day, and not
 * indefinitely into the future.
 *
 * Both wrong answers are visible on the calendar: falling back to `startDate`
 * marked only day 1 while the hero said "생리 3일째", and extending without a
 * bound painted every future day as a recorded period.
 *
 * `today` is optional so a caller with no clock context still gets the safe
 * start-day-only answer rather than an unbounded one.
 */
export function periodOccursOnDate(period: CyclePeriod, date: string, today?: string): boolean {
  if (period.startDate > date) return false;
  const effectiveEnd = period.endDate || (today && today > period.startDate ? today : period.startDate);
  return date <= effectiveEnd;
}

/**
 * Every period covering `date`, with start/end flags for calendar rendering.
 *
 * `isEnd` is true only for a recorded end date: an ongoing period has no end, so
 * marking today as its end would misreport the user's own record.
 */
export function periodRangesOnDate(
  periods: CyclePeriod[],
  date: string,
  today?: string,
): Array<{ period: CyclePeriod; isStart: boolean; isEnd: boolean }> {
  return periods
    .filter((period) => periodOccursOnDate(period, date, today))
    .map((period) => ({
      period,
      isStart: period.startDate === date,
      isEnd: period.endDate === date,
    }));
}

/**
 * The period the user is currently in, or null.
 *
 * `startDate <= today AND (endDate IS NULL OR endDate >= today)`. Daily logs are
 * structurally excluded: this reads `CyclePeriod` only.
 *
 * Returns the MOST RECENT match rather than the first in array order. An old
 * period whose end was never recorded stays open forever, so an unordered `find`
 * could report a period from months ago as "today's" period and hide the current
 * one.
 */
export function activePeriodOnDate(periods: CyclePeriod[], today: string): CyclePeriod | null {
  const candidates = periods.filter(
    (period) => period.startDate <= today && (!period.endDate || period.endDate >= today),
  );
  if (candidates.length === 0) return null;
  return candidates.reduce(
    (latest, period) => (period.startDate > latest.startDate ? period : latest),
  );
}

/**
 * Has an open period been running implausibly long?
 *
 * A user who forgets to tap "끝났어요" leaves a period open indefinitely, which
 * then reads as "생리 40일째". The record is never modified automatically — it is
 * the user's data and a silent edit would be a lie — so this only tells the UI
 * when to ask.
 */
export function isPeriodImplausiblyLong(
  period: CyclePeriod,
  today: string,
  maxDays = PERIOD_LENGTH_MAX,
): boolean {
  if (period.endDate) return false;
  return periodDayNumber(period, today) > maxDays;
}

/** 1-based day number inside an active period, for "생리 3일째". */
export function periodDayNumber(period: CyclePeriod, today: string): number {
  const [y1, m1, d1] = period.startDate.split('-').map(Number);
  const [y2, m2, d2] = today.split('-').map(Number);
  const start = new Date(y1, m1 - 1, d1, 12).getTime();
  const now = new Date(y2, m2 - 1, d2, 12).getTime();
  return Math.round((now - start) / (1000 * 60 * 60 * 24)) + 1;
}

/** The single daily log for `date`, or null. One row per user per date. */
export function dailyLogOnDate(logs: CycleDailyLog[], date: string): CycleDailyLog | null {
  return logs.find((log) => log.logDate === date) || null;
}

/** Does the daily log carry anything worth showing as a calendar marker? */
export function dailyLogHasContent(log: CycleDailyLog | null): boolean {
  if (!log) return false;
  return log.symptoms.length > 0
    || !!log.flow
    || !!log.painLevel
    || !!log.mood
    || !!(log.note && log.note.trim());
}

export function cycleRangesOnDate(entries: CycleEntry[], date: string): CycleRangeMatch[] {
  return entries.filter((entry) => cycleEntryOccursOnDate(entry, date)).map((entry) => ({
    entry,
    isStart: entry.startDate === date,
    isEnd: (entry.endDate || entry.startDate) === date,
  }));
}

export function calculateExpectedStartDate(
  entries: Array<Pick<CycleEntry, 'startDate'>>,
  averageCycleLength: number,
): string | null {
  if (entries.length === 0 || !Number.isInteger(averageCycleLength)) return null;
  const latestStartDate = entries
    .map((entry) => entry.startDate)
    .filter(isCalendarDate)
    .sort((a, b) => b.localeCompare(a))[0];
  if (!latestStartDate) return null;
  const [year, month, day] = latestStartDate.split('-').map(Number);
  const expected = new Date(year, month - 1, day, 12);
  expected.setDate(expected.getDate() + averageCycleLength);
  return toLocalDateString(expected);
}

export function validateCycleEntryDraft(draft: CycleEntryDraft): string | null {
  if (!draft.startDate) return '시작일을 선택해 주세요.';
  if (!isCalendarDate(draft.startDate)) return '올바른 시작일을 선택해 주세요.';
  if (draft.endDate && !isCalendarDate(draft.endDate)) return '올바른 종료일을 선택해 주세요.';
  if (draft.endDate && draft.endDate < draft.startDate) {
    return '종료일은 시작일보다 빠를 수 없어요.';
  }
  if (!draft.symptoms.every(isCycleSymptom)) return '선택할 수 없는 증상 항목이 있어요.';
  return null;
}

export function validateCycleSettings(
  averageCycleLength: number,
  averagePeriodLength: number,
): string | null {
  if (!Number.isInteger(averageCycleLength)
    || averageCycleLength < CYCLE_LENGTH_MIN
    || averageCycleLength > CYCLE_LENGTH_MAX) {
    return `평균 주기 길이는 ${CYCLE_LENGTH_MIN}~${CYCLE_LENGTH_MAX}일로 입력해 주세요.`;
  }
  if (!Number.isInteger(averagePeriodLength)
    || averagePeriodLength < PERIOD_LENGTH_MIN
    || averagePeriodLength > PERIOD_LENGTH_MAX) {
    return `평균 기간은 ${PERIOD_LENGTH_MIN}~${PERIOD_LENGTH_MAX}일로 입력해 주세요.`;
  }
  return null;
}

export function isCycleSymptom(value: unknown): value is CycleSymptom {
  return typeof value === 'string' && cycleSymptomSet.has(value);
}

export function isCycleSupportKind(value: unknown): value is CycleSupportKind {
  return typeof value === 'string' && cycleSupportKindSet.has(value);
}

export function isValidCycleSupportMessage(message?: string): boolean {
  return message === undefined || Array.from(message).length <= CYCLE_SUPPORT_MESSAGE_MAX_LENGTH;
}

export function mapCycleEntryRow(row: any): CycleEntry {
  return {
    id: row.id,
    userId: row.user_id,
    startDate: row.start_date,
    endDate: row.end_date || undefined,
    notes: row.notes || undefined,
    symptoms: Array.isArray(row.symptoms) ? row.symptoms.filter(isCycleSymptom) : [],
  };
}

export function mapCycleSupportSignalRow(row: any): CycleSupportSignal {
  return {
    id: row.id,
    coupleId: row.couple_id,
    ownerId: row.owner_id,
    kind: row.kind as CycleSupportKind,
    message: row.message || undefined,
    sharedForDate: row.shared_for_date,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function buildCycleSupportPayload(
  input: CreateCycleSupportSignalInput,
  ownerId: string,
  now = new Date(),
): CycleSupportInsertPayload | null {
  const message = input.message?.trim() || undefined;
  if (!ownerId || !input.coupleId || !isCalendarDate(input.sharedForDate)) return null;
  if (!isCycleSupportKind(input.kind) || !isValidCycleSupportMessage(message)) return null;
  const defaultExpiryTime = now.getTime() + 24 * 60 * 60 * 1000;
  const expiryTime = input.expiresAt ? Date.parse(input.expiresAt) : defaultExpiryTime;
  if (!Number.isFinite(expiryTime) || expiryTime <= now.getTime() || expiryTime > defaultExpiryTime) {
    return null;
  }
  return {
    couple_id: input.coupleId,
    owner_id: ownerId,
    kind: input.kind,
    message: message || null,
    shared_for_date: input.sharedForDate,
    expires_at: new Date(expiryTime).toISOString(),
  };
}

export function activeCycleSupportSignal(
  signals: CycleSupportSignal[],
  today: string,
  nowIso: string,
  ownerId?: string,
): CycleSupportSignal | null {
  return signals.find((signal) => (!ownerId || signal.ownerId === ownerId)
    && signal.sharedForDate === today
    && !signal.revokedAt
    && signal.expiresAt > nowIso) || null;
}

export async function fetchCycleSettingsResultFromDB(): Promise<CycleSettingsFetchResult> {
  if (!isSupabaseConfigured || !supabase) return fetchFailure();
  const userId = await currentUserId();
  if (!userId) return { ok: false, reason: 'unauthenticated' };

  const { data, error } = await supabase
    .from('cycle_settings')
    .select('user_id, average_cycle_length, average_period_length')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('Failed to fetch cycle settings:', error);
    return fetchFailure(error);
  }
  return {
    ok: true,
    settings: data ? {
      userId: data.user_id,
      averageCycleLength: data.average_cycle_length,
      averagePeriodLength: data.average_period_length,
    } : null,
  };
}

export async function fetchCycleSettingsFromDB(): Promise<CycleSettings | null> {
  const result = await fetchCycleSettingsResultFromDB();
  return result.ok ? result.settings : null;
}

export async function saveCycleSettingsToDB(
  averageCycleLength: number,
  averagePeriodLength: number,
): Promise<CycleSettingsWriteResult> {
  if (!isSupabaseConfigured || !supabase) return unconfiguredFailure();
  if (validateCycleSettings(averageCycleLength, averagePeriodLength)) return invalidDraftFailure();
  // Pre-flight: a pending deletion aborts this write before it is issued.
  if (await serverCallBlockedByPendingDeletion()) return deletionGateFailure();
  const userId = await currentUserId();
  if (!userId) return unauthenticatedFailure();

  const { data, error } = await supabase
    .from('cycle_settings')
    .upsert({
      user_id: userId,
      average_cycle_length: averageCycleLength,
      average_period_length: averagePeriodLength,
      updated_at: new Date().toISOString(),
    })
    .select('user_id, average_cycle_length, average_period_length')
    .single();

  if (error || !data) {
    console.error('Failed to save cycle settings:', error);
    return writeFailure(error);
  }
  return {
    ok: true,
    settings: {
      userId: data.user_id,
      averageCycleLength: data.average_cycle_length,
      averagePeriodLength: data.average_period_length,
    },
  };
}

export async function fetchCycleEntriesResultFromDB(): Promise<CycleEntriesFetchResult> {
  if (!isSupabaseConfigured || !supabase) return fetchFailure();
  const userId = await currentUserId();
  if (!userId) return { ok: false, reason: 'unauthenticated' };

  const { data, error } = await supabase
    .from('cycle_entries')
    .select('id, user_id, start_date, end_date, notes, symptoms')
    .eq('user_id', userId)
    .order('start_date', { ascending: false });

  if (error) {
    console.error('Failed to fetch cycle entries:', error);
    return fetchFailure(error);
  }
  return { ok: true, entries: (data || []).map(mapCycleEntryRow) };
}

export async function fetchCycleEntriesFromDB(): Promise<CycleEntry[]> {
  const result = await fetchCycleEntriesResultFromDB();
  return result.ok ? result.entries : [];
}

export async function saveCycleEntryToDB(
  startDate: string,
  endDate?: string,
  notes?: string,
  symptoms: CycleSymptom[] = [],
): Promise<CycleEntryWriteResult> {
  if (!isSupabaseConfigured || !supabase) return unconfiguredFailure();
  const draft = { startDate, endDate, notes, symptoms };
  // Pre-flight: a pending deletion aborts this write before it is issued.
  if (await serverCallBlockedByPendingDeletion()) return deletionGateFailure();
  if (validateCycleEntryDraft(draft)) return invalidDraftFailure();
  const userId = await currentUserId();
  if (!userId) return unauthenticatedFailure();

  const { data, error } = await supabase
    .from('cycle_entries')
    .upsert({
      user_id: userId,
      start_date: startDate,
      end_date: endDate || null,
      notes: notes?.trim() || null,
      symptoms,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id, start_date' })
    .select('id, user_id, start_date, end_date, notes, symptoms')
    .single();

  if (error || !data) {
    console.error('Failed to save cycle entry:', error);
    return writeFailure(error);
  }
  return { ok: true, entry: mapCycleEntryRow(data) };
}

export async function updateCycleEntryInDB(
  id: string,
  draft: CycleEntryDraft,
): Promise<CycleEntryWriteResult> {
  if (!isSupabaseConfigured || !supabase) return unconfiguredFailure();
  // No target id: there is nothing to update, which is not a transport problem.
  if (!id) return { ok: false, reason: 'not_found' };
  if (validateCycleEntryDraft(draft)) return invalidDraftFailure();
  // Pre-flight: a pending deletion aborts this write before it is issued.
  if (await serverCallBlockedByPendingDeletion()) return deletionGateFailure();
  const userId = await currentUserId();
  if (!userId) return unauthenticatedFailure();

  const { data, error } = await supabase
    .from('cycle_entries')
    .update({
      start_date: draft.startDate,
      end_date: draft.endDate || null,
      notes: draft.notes?.trim() || null,
      symptoms: draft.symptoms,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select('id, user_id, start_date, end_date, notes, symptoms')
    .maybeSingle();

  if (error) {
    console.error('Failed to update cycle entry:', error);
    return writeFailure(error);
  }
  // The filters pin id + owner, so an empty answer is an ownership/visibility
  // verdict rather than a failed request.
  if (!data) return { ok: false, reason: 'not_found' };
  return { ok: true, entry: mapCycleEntryRow(data) };
}

export async function deleteCycleEntryFromDB(id: string): Promise<CycleDeleteResult> {
  if (!isSupabaseConfigured || !supabase) return unconfiguredFailure();
  if (!id) return { ok: false, reason: 'not_found' };
  // Pre-flight: a pending deletion aborts this write before it is issued.
  if (await serverCallBlockedByPendingDeletion()) return deletionGateFailure();
  const userId = await currentUserId();
  if (!userId) return unauthenticatedFailure();
  const { data, error } = await supabase
    .from('cycle_entries')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('Failed to delete cycle entry:', error);
    return writeFailure(error);
  }
  // Nothing was deleted: the row is gone or was never this user's.
  if (!data) return { ok: false, reason: 'not_found' };
  return { ok: true };
}

export async function fetchCycleSupportSignalsResultFromDB(
  coupleId: string,
): Promise<CycleSupportSignalsFetchResult> {
  if (!isSupabaseConfigured || !supabase) return fetchFailure();
  if (!coupleId) return { ok: false, reason: 'forbidden' };
  const userId = await currentUserId();
  if (!userId) return { ok: false, reason: 'unauthenticated' };

  const { data, error } = await supabase
    .from('cycle_support_signals')
    .select('id, couple_id, owner_id, kind, message, shared_for_date, expires_at, revoked_at, created_at, updated_at')
    .eq('couple_id', coupleId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to fetch cycle support signals:', error);
    return fetchFailure(error);
  }
  return {
    ok: true,
    signals: (data || [])
      .filter((row: any) => isCycleSupportKind(row.kind))
      .map(mapCycleSupportSignalRow),
  };
}

export async function listCycleSupportSignalsFromDB(
  coupleId: string,
): Promise<CycleSupportSignal[]> {
  const result = await fetchCycleSupportSignalsResultFromDB(coupleId);
  return result.ok ? result.signals : [];
}

export const fetchCycleSupportSignalsFromDB = listCycleSupportSignalsFromDB;

export async function createCycleSupportSignalInDB(
  input: CreateCycleSupportSignalInput,
): Promise<CycleSupportWriteResult> {
  if (!isSupabaseConfigured || !supabase) return unconfiguredFailure();
  const userId = await currentUserId();
  // Pre-flight: a pending deletion aborts this write before it is issued.
  if (await serverCallBlockedByPendingDeletion()) return deletionGateFailure();
  if (!userId) return unauthenticatedFailure();
  const payload = buildCycleSupportPayload(input, userId);
  if (!payload) return invalidDraftFailure();

  const { data, error } = await supabase
    .from('cycle_support_signals')
    .insert(payload)
    .select('id, couple_id, owner_id, kind, message, shared_for_date, expires_at, revoked_at, created_at, updated_at')
    .single();

  if (error || !data) {
    console.error('Failed to create cycle support signal:', error);
    return writeFailure(error);
  }
  return { ok: true, signal: mapCycleSupportSignalRow(data) };
}

export async function revokeCycleSupportSignalFromDB(id: string): Promise<CycleDeleteResult> {
  if (!isSupabaseConfigured || !supabase) return unconfiguredFailure();
  if (!id) return { ok: false, reason: 'not_found' };
  // Pre-flight: a pending deletion aborts this write before it is issued.
  if (await serverCallBlockedByPendingDeletion()) return deletionGateFailure();
  const userId = await currentUserId();
  if (!userId) return unauthenticatedFailure();
  const revokedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from('cycle_support_signals')
    .update({ revoked_at: revokedAt, updated_at: revokedAt })
    .eq('id', id)
    .eq('owner_id', userId)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('Failed to revoke cycle support signal:', error);
    return writeFailure(error);
  }
  // Nothing was revoked: the signal is gone or was never this user's to share.
  if (!data) return { ok: false, reason: 'not_found' };
  return { ok: true };
}

// =============================================================
// V3 CYCLE PERIODS & DAILY LOGS API
// =============================================================

export async function fetchCyclePeriodsResultFromDB(): Promise<CyclePeriodsFetchResult> {
  if (!isSupabaseConfigured || !supabase) return fetchFailure();
  const userId = await currentUserId();
  if (!userId) return { ok: false, reason: 'unauthenticated' };

  const { data, error } = await supabase
    .from('cycle_periods')
    .select('id, user_id, start_date, end_date, created_at, updated_at')
    .eq('user_id', userId)
    .order('start_date', { ascending: false });

  if (error) {
    console.error('Failed to fetch cycle periods:', error);
    return fetchFailure(error);
  }
  return { ok: true, periods: (data || []).map(mapCyclePeriodRow) };
}

export async function fetchCyclePeriodsFromDB(): Promise<CyclePeriod[]> {
  const result = await fetchCyclePeriodsResultFromDB();
  return result.ok ? result.periods : [];
}

export async function saveCyclePeriodToDB(
  startDate: string,
  endDate?: string,
): Promise<CyclePeriodWriteResult> {
  if (!isSupabaseConfigured || !supabase) return unconfiguredFailure();
  if (await serverCallBlockedByPendingDeletion()) return deletionGateFailure();
  if (!isCalendarDate(startDate)) return invalidDraftFailure();
  if (endDate && (!isCalendarDate(endDate) || endDate < startDate)) return invalidDraftFailure();
  const userId = await currentUserId();
  if (!userId) return unauthenticatedFailure();

  const { data, error } = await supabase
    .from('cycle_periods')
    .upsert({
      user_id: userId,
      start_date: startDate,
      end_date: endDate || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id, start_date' })
    .select('id, user_id, start_date, end_date, created_at, updated_at')
    .single();

  if (error || !data) {
    console.error('Failed to save cycle period:', error);
    return writeFailure(error);
  }
  return { ok: true, period: mapCyclePeriodRow(data) };
}

export async function updateCyclePeriodInDB(
  id: string,
  startDate: string,
  endDate?: string,
): Promise<CyclePeriodWriteResult> {
  if (!isSupabaseConfigured || !supabase) return unconfiguredFailure();
  if (!id) return { ok: false, reason: 'not_found' };
  if (await serverCallBlockedByPendingDeletion()) return deletionGateFailure();
  if (!isCalendarDate(startDate)) return invalidDraftFailure();
  if (endDate && (!isCalendarDate(endDate) || endDate < startDate)) return invalidDraftFailure();
  const userId = await currentUserId();
  if (!userId) return unauthenticatedFailure();

  const { data, error } = await supabase
    .from('cycle_periods')
    .update({
      start_date: startDate,
      end_date: endDate || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select('id, user_id, start_date, end_date, created_at, updated_at')
    .maybeSingle();

  if (error) {
    console.error('Failed to update cycle period:', error);
    return writeFailure(error);
  }
  if (!data) return { ok: false, reason: 'not_found' };
  return { ok: true, period: mapCyclePeriodRow(data) };
}

export async function deleteCyclePeriodFromDB(id: string): Promise<CycleDeleteResult> {
  if (!isSupabaseConfigured || !supabase) return unconfiguredFailure();
  if (!id) return { ok: false, reason: 'not_found' };
  if (await serverCallBlockedByPendingDeletion()) return deletionGateFailure();
  const userId = await currentUserId();
  if (!userId) return unauthenticatedFailure();

  const { data, error } = await supabase
    .from('cycle_periods')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('Failed to delete cycle period:', error);
    return writeFailure(error);
  }
  if (!data) return { ok: false, reason: 'not_found' };
  return { ok: true };
}

// -------------------------------------------------------------
// CYCLE DAILY LOGS API
// -------------------------------------------------------------

export async function fetchCycleDailyLogsResultFromDB(): Promise<CycleDailyLogsFetchResult> {
  if (!isSupabaseConfigured || !supabase) return fetchFailure();
  const userId = await currentUserId();
  if (!userId) return { ok: false, reason: 'unauthenticated' };

  const { data, error } = await supabase
    .from('cycle_daily_logs')
    .select('id, user_id, log_date, flow, pain_level, symptoms, mood, note, created_at, updated_at')
    .eq('user_id', userId)
    .order('log_date', { ascending: false });

  if (error) {
    console.error('Failed to fetch cycle daily logs:', error);
    return fetchFailure(error);
  }
  return { ok: true, logs: (data || []).map(mapCycleDailyLogRow) };
}

export async function fetchCycleDailyLogsFromDB(): Promise<CycleDailyLog[]> {
  const result = await fetchCycleDailyLogsResultFromDB();
  return result.ok ? result.logs : [];
}

export async function saveCycleDailyLogToDB(
  logDate: string,
  symptoms: CycleSymptom[] = [],
  options?: {
    flow?: CycleFlow;
    painLevel?: CyclePainLevel;
    mood?: CycleMood;
    note?: string;
  },
): Promise<CycleDailyLogWriteResult> {
  if (!isSupabaseConfigured || !supabase) return unconfiguredFailure();
  if (await serverCallBlockedByPendingDeletion()) return deletionGateFailure();
  if (!isCalendarDate(logDate)) return invalidDraftFailure();
  const userId = await currentUserId();
  if (!userId) return unauthenticatedFailure();

  const { data, error } = await supabase
    .from('cycle_daily_logs')
    .upsert({
      user_id: userId,
      log_date: logDate,
      flow: options?.flow || null,
      pain_level: options?.painLevel || null,
      symptoms: symptoms || [],
      mood: options?.mood || null,
      note: options?.note?.trim() || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id, log_date' })
    .select('id, user_id, log_date, flow, pain_level, symptoms, mood, note, created_at, updated_at')
    .single();

  if (error || !data) {
    console.error('Failed to save cycle daily log:', error);
    return writeFailure(error);
  }
  return { ok: true, log: mapCycleDailyLogRow(data) };
}

export async function deleteCycleDailyLogFromDB(id: string): Promise<CycleDeleteResult> {
  if (!isSupabaseConfigured || !supabase) return unconfiguredFailure();
  if (!id) return { ok: false, reason: 'not_found' };
  if (await serverCallBlockedByPendingDeletion()) return deletionGateFailure();
  const userId = await currentUserId();
  if (!userId) return unauthenticatedFailure();

  const { data, error } = await supabase
    .from('cycle_daily_logs')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('Failed to delete cycle daily log:', error);
    return writeFailure(error);
  }
  if (!data) return { ok: false, reason: 'not_found' };
  return { ok: true };
}

// -------------------------------------------------------------
// SHARING PREFERENCES & CONSENT DB API
// -------------------------------------------------------------

export async function fetchCycleSharingPreferencesFromDB(): Promise<CycleSharingPreferences> {
  const defaultPrefs: CycleSharingPreferences = {
    userId: '',
    shareCurrentPeriod: false,
    sharePredictionWindow: false,
    shareFertilityWindow: false,
  };
  if (!isSupabaseConfigured || !supabase) return defaultPrefs;
  const userId = await currentUserId();
  if (!userId) return defaultPrefs;

  const { data, error } = await supabase
    .from('cycle_sharing_preferences')
    .select('user_id, share_current_period, share_prediction_window, share_fertility_window')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) return { ...defaultPrefs, userId };
  return {
    userId: data.user_id,
    shareCurrentPeriod: !!data.share_current_period,
    sharePredictionWindow: !!data.share_prediction_window,
    shareFertilityWindow: !!data.share_fertility_window,
  };
}

/**
 * Sharing-preference write outcome.
 *
 * Deliberately a reason-carrying union, matching every other cycle mutation in
 * this module: a `null` return collapsed "you are offline", "RLS refused this"
 * and "your session expired" into one falsy value, so the toggle could not tell
 * the user which of the three actually happened.
 */
export type CycleSharingPreferencesWriteResult =
  | { ok: true; preferences: CycleSharingPreferences }
  | CycleWriteFailure;

export async function saveCycleSharingPreferencesToDB(
  prefs: Partial<CycleSharingPreferences>,
): Promise<CycleSharingPreferencesWriteResult> {
  if (!isSupabaseConfigured || !supabase) return unconfiguredFailure();
  // Pre-flight: a pending deletion aborts this write before it is issued.
  if (await serverCallBlockedByPendingDeletion()) return deletionGateFailure();
  const userId = await currentUserId();
  if (!userId) return unauthenticatedFailure();

  const current = await fetchCycleSharingPreferencesFromDB();
  const next = {
    user_id: userId,
    share_current_period: prefs.shareCurrentPeriod ?? current.shareCurrentPeriod,
    share_prediction_window: prefs.sharePredictionWindow ?? current.sharePredictionWindow,
    share_fertility_window: prefs.shareFertilityWindow ?? current.shareFertilityWindow,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('cycle_sharing_preferences')
    .upsert(next)
    .select('user_id, share_current_period, share_prediction_window, share_fertility_window')
    .single();

  if (error || !data) {
    console.error('Failed to save sharing preferences:', error);
    return writeFailure(error);
  }
  return {
    ok: true,
    preferences: {
      userId: data.user_id,
      shareCurrentPeriod: !!data.share_current_period,
      sharePredictionWindow: !!data.share_prediction_window,
      shareFertilityWindow: !!data.share_fertility_window,
    },
  };
}

// -------------------------------------------------------------
// PARTNER-FACING PROJECTION
// -------------------------------------------------------------

/**
 * Read the sanitized cycle projection the partner is allowed to see.
 *
 * This is the ONLY path by which cycle information reaches a partner. It calls
 * `get_partner_cycle_projection()`, a SECURITY DEFINER RPC that reads the
 * owner's raw tables and returns nothing but the booleans and date ranges the
 * owner explicitly turned on. The partner's own credentials can never read
 * `cycle_periods`, `cycle_daily_logs`, `cycle_settings`,
 * `cycle_sharing_preferences`, or `user_sensitive_consents` — those stay
 * owner-only under RLS.
 *
 * Before this existed the three sharing toggles wrote to the database and
 * changed nothing a partner could see. The promise was recorded and never kept.
 */
export async function fetchPartnerCycleProjectionFromDB(): Promise<CyclePartnerProjectionFetchResult> {
  if (!isSupabaseConfigured || !supabase) return fetchFailure();
  const userId = await currentUserId();
  if (!userId) return { ok: false, reason: 'unauthenticated' };

  const { data, error } = await supabase.rpc('get_partner_cycle_projection');

  if (error) {
    console.error('Failed to fetch partner cycle projection:', error);
    // `PGRST202` is the missing-function answer, the RPC analogue of a missing
    // table. Reporting it as a bad connection would invite a pointless retry.
    if (error.code === 'PGRST202') return { ok: false, reason: 'not_deployed' };
    return fetchFailure(error);
  }

  // No row means there is nothing to project: no active couple, or no partner.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { ok: true, projection: null };

  return {
    ok: true,
    projection: {
      isCurrentPeriodShared: !!row.has_current_period_status,
      isPeriodActive: !!row.current_period_active,
      isPredictionShared: !!row.has_prediction_window,
      predictedWindowStart: row.prediction_window_start || undefined,
      predictedWindowEnd: row.prediction_window_end || undefined,
      isFertilityShared: !!row.has_fertility_window,
      fertilityWindowStart: row.fertility_window_start || undefined,
      fertilityWindowEnd: row.fertility_window_end || undefined,
    },
  };
}

/** True when the owner has turned on nothing at all. */
export function isPartnerProjectionEmpty(projection: CyclePartnerProjection): boolean {
  return !projection.isCurrentPeriodShared
    && !projection.isPredictionShared
    && !projection.isFertilityShared;
}
