import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { predictCycle } from '@/lib/cyclePrediction';

/**
 * Migration 025: the partner-facing projection.
 *
 * Why this exists at all: 022 shipped `cycle_sharing_preferences` and the UI
 * shipped three toggles, but nothing connected them to a partner. Turning a
 * toggle on wrote a row and changed nothing anyone could see, so the app
 * recorded a promise it never kept.
 *
 * The projection is the only bridge, which makes it the one place where a leak
 * would matter most. These tests pin both halves: what it must never return, and
 * that its date arithmetic agrees with the owner's own screen.
 */
const read = (file: string) =>
  readFileSync(resolve(process.cwd(), 'supabase/migrations', file), 'utf8');

/**
 * 070 redefines `get_partner_cycle_projection` in full, so it — not 069 — is the
 * definition that actually runs. Assertions about the partner-facing function
 * must read the winning file, or they pass while describing dead SQL.
 */
const migration = read('070_cycle_consent_atomic_write_gate.sql');
/** 025 still owns the internal prediction helper; 070 does not touch it. */
const helperMigration = read('025_partner_cycle_projection.sql');
const consentClient = readFileSync(
  resolve(process.cwd(), 'src/lib/sensitiveConsent.ts'),
  'utf8',
);

/** The RETURNS TABLE block of the partner-facing function, and nothing else. */
const projectionSignature = migration.slice(
  migration.indexOf('CREATE OR REPLACE FUNCTION public.get_partner_cycle_projection'),
  migration.indexOf('LANGUAGE plpgsql', migration.indexOf('get_partner_cycle_projection')),
);

describe('the projection cannot carry raw health data', () => {
  it.each([
    ['symptom', /symptom/i],
    ['flow', /\bflow\b/i],
    ['pain', /pain/i],
    ['mood', /mood/i],
    ['note', /\bnote\b/i],
    ['a period id', /\bid\b/i],
    ['an actual start date', /start_date/i],
    ['an actual end date', /end_date/i],
  ])('never returns %s', (_label, pattern) => {
    expect(projectionSignature).not.toMatch(pattern);
  });

  it('returns only booleans and dates', () => {
    const columns = projectionSignature
      .slice(projectionSignature.indexOf('RETURNS TABLE ('))
      .match(/^\s+(\w+)\s+(BOOLEAN|DATE)/gm) ?? [];
    // 3 booleans for "is this shared", 1 for the active flag, 4 dates.
    expect(columns).toHaveLength(8);
  });

  it('reads the partner\'s preferences, never the requester\'s own', () => {
    // The row it consults must be keyed by the partner. Reading the requester's
    // own preferences would show them their own settings as if they were shared.
    expect(migration).toContain('FROM public.cycle_sharing_preferences\n  WHERE user_id = v_partner_id');
  });

  it('gates each field on its own toggle', () => {
    for (const guard of [
      'CASE WHEN v_share_current THEN v_active ELSE false END',
      'CASE WHEN v_share_prediction THEN v_window_start ELSE NULL END',
      'CASE WHEN v_share_fertility THEN v_ovulation - 5 ELSE NULL END',
    ]) {
      expect(migration).toContain(guard);
    }
  });

  it('treats a missing preferences row as everything off', () => {
    expect(migration).toContain('v_share_current := COALESCE(v_share_current, false)');
    expect(migration).toContain('v_share_prediction := COALESCE(v_share_prediction, false)');
    expect(migration).toContain('v_share_fertility := COALESCE(v_share_fertility, false)');
  });

  it('does not dereference an unassigned prediction record in current-only mode', () => {
    expect(migration).not.toMatch(/\bv_window\s+RECORD\b/);
    expect(migration).not.toMatch(/\bv_window\./);
    expect(migration).toContain('v_expected_start DATE;');
    expect(migration).toContain('v_window_start DATE;');
    expect(migration).toContain('v_window_end DATE;');
  });
});

describe('the projection is reachable only by a connected partner', () => {
  it('requires an authenticated caller', () => {
    expect(migration).toContain('v_uid UUID := auth.uid()');
    expect(migration).toMatch(/IF v_uid IS NULL THEN\s+RETURN;/);
  });

  it('resolves the couple through the hardened lookup, not a raw query', () => {
    expect(migration).toContain('public.get_my_active_couple_id()');
  });

  it('requires the partner membership to still be active, so disconnecting hides it', () => {
    expect(migration).toContain("AND other.status = 'active'");
    expect(migration).toMatch(/IF v_partner_id IS NULL THEN\s+RETURN;/);
  });

  it('is granted to authenticated only, with anon and PUBLIC revoked', () => {
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.get_partner_cycle_projection() FROM anon');
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.get_partner_cycle_projection() FROM PUBLIC');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.get_partner_cycle_projection() TO authenticated');
  });

  it('keeps the internal prediction helper unreachable from any client role', () => {
    // It takes an arbitrary owner id, so exposing it would let any signed-in
    // user read any other user's predicted window.
    expect(helperMigration).toContain('REVOKE ALL ON FUNCTION public.cycle_prediction_window(UUID) FROM authenticated');
    expect(helperMigration).toContain('REVOKE ALL ON FUNCTION public.cycle_prediction_window(UUID) FROM anon');
    // Checked across BOTH files: a later migration must not hand it out either.
    for (const sql of [helperMigration, migration]) {
      expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.cycle_prediction_window\(UUID\) TO/);
    }
  });

  it('pins the prediction helper and partner projection to public plus pg_temp', () => {
    // Only definitions, not the prose above them: `^` anchors to the line the
    // clause actually occupies inside a CREATE FUNCTION body.
    expect(helperMigration.match(/^SECURITY DEFINER$/gm) ?? []).toHaveLength(2);
    expect(helperMigration.match(/^SET search_path = public, pg_temp$/gm) ?? []).toHaveLength(2);
    expect(migration.match(/^SET search_path = public, pg_temp$/gm) ?? []).toHaveLength(1);
  });

  it('uses a locking VOLATILE partner projection while keeping the pure helper STABLE', () => {
    expect(helperMigration.match(/^STABLE$/gm) ?? []).toHaveLength(2);
    const projection = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.get_partner_cycle_projection'),
      migration.indexOf('COMMENT ON FUNCTION public.get_partner_cycle_projection'),
    );
    expect(projection).toMatch(/^VOLATILE$/m);
    expect(projection).toContain('FOR SHARE');
  });
});

describe('only explicit, current consent permits partner sharing', () => {
  /**
   * 025 checked only the toggles, so revoking sensitive consent left any
   * enabled toggle running: the live project returned
   * `has_prediction_window = true` and a date after `revoked_at` was set.
   * Revoking means stop using this data this way, and partner sharing is one of
   * those ways.
  */
  it('requires an existing current-version, non-revoked partner consent row', () => {
    expect(migration).toContain("AND consent.consent_type = 'cycle'");
    expect(migration).toMatch(/FROM public\.user_sensitive_consents AS consent[\s\S]+FOR SHARE;/);
    expect(migration).toContain('consent.version = v_required_consent_version');
    expect(migration).toContain('AND consent.revoked_at IS NULL');
    // The consent gate must come BEFORE the preferences read, so an invalid
    // owner's toggles are never even consulted.
    expect(migration.indexOf('INTO v_consent_valid'))
      .toBeLessThan(migration.indexOf('FROM public.cycle_sharing_preferences'));
  });

  it('returns an all-false row for missing, stale, or revoked consent', () => {
    expect(migration).toMatch(
      /IF NOT v_consent_valid THEN\s+RETURN QUERY SELECT false, false, false, NULL::DATE, NULL::DATE, false, NULL::DATE, NULL::DATE;/,
    );
  });

  it('pins the exact same current consent version in TypeScript and SQL', () => {
    const clientVersion = consentClient.match(/CYCLE_CONSENT_VERSION = '([^']+)'/)?.[1];
    const sqlVersion = migration.match(/v_required_consent_version CONSTANT TEXT := '([^']+)'/)?.[1];
    expect(clientVersion).toBeTruthy();
    expect(sqlVersion).toBe(clientVersion);
  });
});

describe('the server window agrees with the owner\'s own screen', () => {
  /**
   * The owner reads `predictCycle()` in the browser; the partner reads the SQL
   * above. If the two disagree the couple sees different dates for the same
   * fact, which is worse than showing nothing. Postgres cannot run here, so this
   * pins the RULES the SQL is written to, each traced to its line.
   */
  it('uses at most 12 intervals, matching MAX_INTERVALS_CONSIDERED', () => {
    // 13 start dates yield 12 gaps.
    expect(helperMigration).toContain('LIMIT 13');
  });

  it('discards the same outlier range the client discards', () => {
    expect(helperMigration).toContain('WHERE gap BETWEEN 15 AND 60');
  });

  it('switches to real statistics at 3 periods, like the client', () => {
    expect(helperMigration).toContain('IF v_start_count < 3 THEN');
  });

  it('uses the median interval, not the mean', () => {
    // The client uses `calculateMedian`. A mean would drift apart from it on any
    // history containing one unusual cycle.
    expect(helperMigration).toContain('v_expected := v_latest + v_median');
    expect(helperMigration).not.toContain('avg(gap)');
  });

  it('caps the window at 3 days each side, like the client buffer', () => {
    expect(helperMigration).toContain('v_buffer := LEAST(v_variability, 3)');
  });

  it('uses a fixed 2-day buffer for the configured estimate', () => {
    const configured = helperMigration.match(/v_expected - 2, v_expected \+ 2/g) ?? [];
    expect(configured).toHaveLength(2);
  });

  it('never widens the start window by period duration', () => {
    // Period length and start-date uncertainty are different quantities. Using
    // one for the other made a 6-day period read as a 6-day-wide prediction.
    const helper = helperMigration.slice(
      helperMigration.indexOf('CREATE OR REPLACE FUNCTION public.cycle_prediction_window'),
      helperMigration.indexOf('CREATE OR REPLACE FUNCTION public.get_partner_cycle_projection'),
    );
    expect(helper).not.toMatch(/average_period_length\s*\)?\s*(INTO|\+|-)/);
  });

  it('agrees with predictCycle on a 28-day history', () => {
    // The rules above, applied by hand, must land where the client lands.
    const periods = [
      { startDate: '2026-05-01', endDate: '2026-05-05' },
      { startDate: '2026-05-29', endDate: '2026-06-02' },
      { startDate: '2026-06-26', endDate: '2026-06-30' },
      { startDate: '2026-07-24', endDate: '2026-07-28' },
    ];
    const prediction = predictCycle({ periods, today: '2026-08-11' });
    // Intervals are 28, 28, 28: median 28, spread 0 -> variability floor 1.
    expect(prediction.intervalsUsed).toBe(3);
    expect(prediction.medianCycleLength).toBe(28);
    expect(prediction.expectedStartDate).toBe('2026-08-21');
    expect(prediction.windowStart).toBe('2026-08-20');
    expect(prediction.windowEnd).toBe('2026-08-22');
  });

  it('agrees with predictCycle when only one period exists', () => {
    const prediction = predictCycle({
      periods: [{ startDate: '2026-07-24', endDate: '2026-07-29' }],
      configuredCycleLength: 28,
      configuredPeriodLength: 6,
      today: '2026-08-11',
    });
    expect(prediction.status).toBe('configured_estimate');
    expect(prediction.expectedStartDate).toBe('2026-08-21');
    // ±2, NOT ±6. The 6-day period length must not reach this width.
    expect(prediction.windowStart).toBe('2026-08-19');
    expect(prediction.windowEnd).toBe('2026-08-23');
  });
});

describe('the projection uses Korean local dates', () => {
  it('resolves today in Asia/Seoul, not UTC', () => {
    // A UTC date flips nine hours early, so a period that ends today would read
    // as already over to a partner checking late at night.
    const seoul = migration.match(/AT TIME ZONE 'Asia\/Seoul'/g) ?? [];
    expect(seoul.length).toBeGreaterThanOrEqual(1);
  });

  it('decides "in progress" by the same rule the client uses', () => {
    expect(migration).toContain('AND start_date <= v_today');
    expect(migration).toContain('AND (end_date IS NULL OR end_date >= v_today)');
  });
});
