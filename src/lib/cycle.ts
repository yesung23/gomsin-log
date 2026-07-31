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

export async function fetchCycleSettingsFromDB(): Promise<CycleSettings | null> {
  if (!isSupabaseConfigured || !supabase) return null;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;

  const { data, error } = await supabase
    .from('cycle_settings')
    .select('*')
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (error) {
    console.error('Failed to fetch cycle settings:', error);
    return null;
  }

  if (!data) return null;

  return {
    userId: data.user_id,
    averageCycleLength: data.average_cycle_length,
    averagePeriodLength: data.average_period_length,
  };
}

export async function saveCycleSettingsToDB(
  averageCycleLength: number,
  averagePeriodLength: number
): Promise<CycleSettings | null> {
  if (!isSupabaseConfigured || !supabase) return null;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;

  const { data, error } = await supabase
    .from('cycle_settings')
    .upsert({
      user_id: session.user.id,
      average_cycle_length: averageCycleLength,
      average_period_length: averagePeriodLength,
      updated_at: new Date().toISOString(),
    })
    .select()
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

export async function fetchCycleEntriesFromDB(): Promise<CycleEntry[]> {
  if (!isSupabaseConfigured || !supabase) return [];

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return [];

  const { data, error } = await supabase
    .from('cycle_entries')
    .select('*')
    .eq('user_id', session.user.id)
    .order('start_date', { ascending: false });

  if (error || !data) {
    console.error('Failed to fetch cycle entries:', error);
    return [];
  }

  return data.map(mapCycleEntryRow);
}

export async function saveCycleEntryToDB(
  startDate: string,
  endDate?: string,
  notes?: string,
  symptoms: CycleSymptom[] = []
): Promise<CycleEntry | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  if (!symptoms.every(isCycleSymptom)) return null;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;

  const { data, error } = await supabase
    .from('cycle_entries')
    .upsert({
      user_id: session.user.id,
      start_date: startDate,
      end_date: endDate || null,
      notes: notes || null,
      symptoms,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id, start_date' })
    .select()
    .single();

  if (error || !data) {
    console.error('Failed to save cycle entry:', error);
    return null;
  }

  return mapCycleEntryRow(data);
}

export async function deleteCycleEntryFromDB(id: string): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;

  const { data, error } = await supabase
    .from('cycle_entries')
    .delete()
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('Failed to delete cycle entry:', error);
    return false;
  }

  return !!data;
}

export interface CreateCycleSupportSignalInput {
  coupleId: string;
  kind: CycleSupportKind;
  sharedForDate: string;
  message?: string;
  expiresAt?: string;
}

export async function listCycleSupportSignalsFromDB(
  coupleId: string
): Promise<CycleSupportSignal[]> {
  if (!isSupabaseConfigured || !supabase || !coupleId) return [];

  const { data, error } = await supabase
    .from('cycle_support_signals')
    .select('*')
    .eq('couple_id', coupleId)
    .order('created_at', { ascending: false });

  if (error || !data) {
    console.error('Failed to fetch cycle support signals:', error);
    return [];
  }

  return data
    .filter((row: any) => isCycleSupportKind(row.kind))
    .map(mapCycleSupportSignalRow);
}

export const fetchCycleSupportSignalsFromDB = listCycleSupportSignalsFromDB;

export async function createCycleSupportSignalInDB(
  input: CreateCycleSupportSignalInput
): Promise<CycleSupportSignal | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  if (!input.coupleId || !input.sharedForDate || !isCycleSupportKind(input.kind)) return null;
  if (!isValidCycleSupportMessage(input.message)) return null;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;

  const payload: Record<string, string | null> = {
    couple_id: input.coupleId,
    owner_id: session.user.id,
    kind: input.kind,
    message: input.message || null,
    shared_for_date: input.sharedForDate,
  };
  if (input.expiresAt) payload.expires_at = input.expiresAt;

  const { data, error } = await supabase
    .from('cycle_support_signals')
    .insert(payload)
    .select()
    .single();

  if (error || !data) {
    console.error('Failed to create cycle support signal:', error);
    return null;
  }

  return mapCycleSupportSignalRow(data);
}

export async function revokeCycleSupportSignalFromDB(id: string): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase || !id) return false;

  const revokedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from('cycle_support_signals')
    .update({ revoked_at: revokedAt, updated_at: revokedAt })
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('Failed to revoke cycle support signal:', error);
    return false;
  }

  return !!data;
}
