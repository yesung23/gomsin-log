import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { CycleSettings, CycleEntry } from '@/types';

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

  return data.map((row: any) => ({
    id: row.id,
    userId: row.user_id,
    startDate: row.start_date,
    endDate: row.end_date || undefined,
    notes: row.notes || undefined,
  }));
}

export async function saveCycleEntryToDB(
  startDate: string,
  endDate?: string,
  notes?: string
): Promise<CycleEntry | null> {
  if (!isSupabaseConfigured || !supabase) return null;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;

  const { data, error } = await supabase
    .from('cycle_entries')
    .upsert({
      user_id: session.user.id,
      start_date: startDate,
      end_date: endDate || null,
      notes: notes || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id, start_date' })
    .select()
    .single();

  if (error || !data) {
    console.error('Failed to save cycle entry:', error);
    return null;
  }

  return {
    id: data.id,
    userId: data.user_id,
    startDate: data.start_date,
    endDate: data.end_date || undefined,
    notes: data.notes || undefined,
  };
}

export async function deleteCycleEntryFromDB(id: string): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;

  const { error } = await supabase
    .from('cycle_entries')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Failed to delete cycle entry:', error);
    return false;
  }

  return true;
}
