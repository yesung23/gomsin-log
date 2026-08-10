import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Migration 022 contracts: the V3 cycle tables.
 *
 * Asserted against the SQL text because this migration has to be correct BEFORE
 * it is applied to a project — the failure mode it guards against (a missing
 * table, or a table nobody can reach) is only observable in production.
 */
const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/022_cycle_v3_schema.sql'),
  'utf8',
);

describe('022 creates the V3 cycle tables as owner-only', () => {
  it.each([
    'cycle_periods',
    'cycle_daily_logs',
    'user_sensitive_consents',
    'cycle_sharing_preferences',
  ])('creates %s with RLS enabled and anon revoked', (table) => {
    expect(migration).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`);
    expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    // Without the grant, RLS passes but PostgREST still refuses with 42501.
    expect(migration).toContain(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.${table} TO authenticated`);
    expect(migration).toContain(`REVOKE ALL ON TABLE public.${table} FROM anon`);
  });

  it('scopes every policy to the owner, so a partner can never read raw health data', () => {
    const policies = migration.match(/CREATE POLICY[\s\S]*?WITH CHECK \(user_id = auth\.uid\(\)\);/g);
    expect(policies).toHaveLength(4);
    for (const policy of policies || []) {
      expect(policy).toContain('USING (user_id = auth.uid())');
    }
  });

  it('reloads the PostgREST schema cache, or the new tables answer PGRST205', () => {
    /*
     * This is the defect the user actually hit. Creating the tables without the
     * NOTIFY leaves PostgREST serving a stale schema, so every read fails with
     * "Could not find the table ... in the schema cache" and the feature looks
     * broken while the tables sit there, fine.
     */
    expect(migration).toContain("NOTIFY pgrst, 'reload schema'");
  });
});

describe('022 migrates legacy data without guessing or losing it', () => {
  it('backs the legacy table up before touching anything', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.legacy_cycle_entries_backup');
  });

  it('promotes only unambiguous period rows into cycle_periods', () => {
    /*
     * A legacy row with symptoms and no end date is exactly the contaminated
     * shape the V3 split exists to fix: it may be a real ongoing period, or it may
     * be a symptom-only log that the old UI recorded as a period start. Copying
     * every row would re-import that ambiguity as fact.
     */
    expect(migration).toMatch(/WHERE end_date IS NOT NULL\s*\n\s*OR \(\(symptoms IS NULL OR array_length\(symptoms, 1\) IS NULL\)/);
  });

  it('carries every legacy symptom and note across as a daily log', () => {
    expect(migration).toContain('INSERT INTO public.cycle_daily_logs');
    expect(migration).toMatch(/ON CONFLICT \(user_id, log_date\) DO UPDATE/);
  });

  it('is re-runnable: every write is guarded or upserted', () => {
    // An operator who runs the file twice must not get duplicate-key errors.
    expect(migration).toContain('ON CONFLICT (user_id, start_date) DO UPDATE');
    expect(migration).toContain('IF EXISTS (SELECT 1 FROM information_schema.tables');
  });

  it('never deletes or truncates legacy data', () => {
    expect(migration).not.toMatch(/\bDROP TABLE\b/i);
    expect(migration).not.toMatch(/\bTRUNCATE\b/i);
    expect(migration).not.toMatch(/DELETE FROM public\.cycle_entries/i);
  });
});

describe('022 constrains the data the app relies on', () => {
  it('rejects a period whose end precedes its start', () => {
    expect(migration).toContain('CHECK (end_date IS NULL OR end_date >= start_date)');
  });

  it('keeps one period per start date and one log per date, per user', () => {
    expect(migration).toContain('UNIQUE(user_id, start_date)');
    expect(migration).toContain('UNIQUE(user_id, log_date)');
  });

  it('constrains flow, pain and mood to the vocabularies the client sends', () => {
    expect(migration).toContain("flow IN ('spotting', 'light', 'medium', 'heavy')");
    expect(migration).toContain("pain_level IN ('none', 'mild', 'moderate', 'severe')");
    expect(migration).toContain("mood IN ('calm', 'sensitive', 'sad', 'tired', 'good')");
  });

  it('cascades on account deletion, so no health row outlives its owner', () => {
    const cascades = migration.match(/REFERENCES auth\.users\(id\) ON DELETE CASCADE/g);
    expect(cascades?.length).toBeGreaterThanOrEqual(4);
  });
});
