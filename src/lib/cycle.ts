import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import {
  CYCLE_SUPPORT_KINDS,
  CYCLE_SYMPTOMS,
  CycleEntry,
  CycleSettings,
  CycleSupportKind,
  CycleSupportSignal,
  CycleSymptom,
} from '@/types';

const cycleSymptomSet = new Set<string>(CYCLE_SYMPTOMS);
const cycleSupportKindSet = new Set<string>(CYCLE_SUPPORT_KINDS);
export const CYCLE_SUPPORT_MESSAGE_MAX_LENGTH = 80;
export const CYCLE_LENGTH_MIN = 15;
export const CYCLE_LENGTH_MAX = 60;
export const PERIOD_LENGTH_MIN = 1;
export const PERIOD_LENGTH_MAX = 15;

export type CycleFetchFailureReason = 'unauthenticated' | 'forbidden' | 'error';
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

export interface CycleEntryDraft {
  startDate: string;
  endDate?: string;
  notes?: string;
  symptoms: CycleSymptom[];
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

function fetchFailure(error?: { code?: string } | null): CycleFetchFailure {
  return { ok: false, reason: error?.code === '42501' ? 'forbidden' : 'error' };
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
): Promise<CycleSettings | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  if (validateCycleSettings(averageCycleLength, averagePeriodLength)) return null;
  const userId = await currentUserId();
  if (!userId) return null;

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
    return null;
  }
  return {
    userId: data.user_id,
    averageCycleLength: data.average_cycle_length,
    averagePeriodLength: data.average_period_length,
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
): Promise<CycleEntry | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const draft = { startDate, endDate, notes, symptoms };
  if (validateCycleEntryDraft(draft)) return null;
  const userId = await currentUserId();
  if (!userId) return null;

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
    return null;
  }
  return mapCycleEntryRow(data);
}

export async function updateCycleEntryInDB(
  id: string,
  draft: CycleEntryDraft,
): Promise<CycleEntry | null> {
  if (!isSupabaseConfigured || !supabase || !id) return null;
  if (validateCycleEntryDraft(draft)) return null;
  const userId = await currentUserId();
  if (!userId) return null;

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

  if (error || !data) {
    console.error('Failed to update cycle entry:', error);
    return null;
  }
  return mapCycleEntryRow(data);
}

export async function deleteCycleEntryFromDB(id: string): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase || !id) return false;
  const userId = await currentUserId();
  if (!userId) return false;
  const { data, error } = await supabase
    .from('cycle_entries')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('Failed to delete cycle entry:', error);
    return false;
  }
  return !!data;
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
): Promise<CycleSupportSignal | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  const userId = await currentUserId();
  if (!userId) return null;
  const payload = buildCycleSupportPayload(input, userId);
  if (!payload) return null;

  const { data, error } = await supabase
    .from('cycle_support_signals')
    .insert(payload)
    .select('id, couple_id, owner_id, kind, message, shared_for_date, expires_at, revoked_at, created_at, updated_at')
    .single();

  if (error || !data) {
    console.error('Failed to create cycle support signal:', error);
    return null;
  }
  return mapCycleSupportSignalRow(data);
}

export async function revokeCycleSupportSignalFromDB(id: string): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase || !id) return false;
  const userId = await currentUserId();
  if (!userId) return false;
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
    return false;
  }
  return !!data;
}
