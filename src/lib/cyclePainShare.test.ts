import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCycleSupportPayload, isCycleSupportKind } from '@/lib/cycle';
import { CYCLE_PAIN_LEVELS, CYCLE_SUPPORT_KINDS, CYCLE_SYMPTOMS } from '@/types';

/**
 * The pain boundary around the care signal.
 *
 * The approved decision (V1_LAUNCH_DECISIONS §5, upheld by the 2026-08-21
 * independent review) is ONE ungraded kind — `feeling_unwell` — and nothing that
 * restates the personal pain scale. Every test here holds that line: no graded
 * vocabulary, no path from the personal log to a signal, and a signal that takes a
 * deliberate act, ends on its own, and can be taken back.
 */

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/047_care_signal_feeling_unwell.sql'),
  'utf8',
);

/** The migration with its commentary removed, for "does not do X" assertions. */
const executable = migration.replace(/^\s*--.*$/gm, '');

/** Source with comments stripped, so prose explaining a rule cannot break it. */
function code(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

describe('the signal vocabulary carries no pain grade', () => {
  it('contains feeling_unwell and no graded pain kind', () => {
    expect(CYCLE_SUPPORT_KINDS).toContain('feeling_unwell');
    /*
     * The refused draft's kinds, by name and by shape. `pain_mild` restated the
     * personal `mild` inside a server-visible column; if any kind ever encodes a
     * level again, this is the test that has to be argued with first.
     */
    for (const kind of CYCLE_SUPPORT_KINDS) {
      expect(kind, kind).not.toMatch(/^pain_/);
      expect(kind, kind).not.toMatch(/mild|moderate|severe/);
      expect(kind, kind).not.toMatch(/\d/);
    }
  });

  it('shares no value with the personal pain scale', () => {
    // `severe` must never validate as a signal kind: `signal.kind = log.painLevel`
    // must not typecheck AND must not pass the runtime guard.
    for (const level of CYCLE_PAIN_LEVELS) {
      expect(isCycleSupportKind(level), level).toBe(false);
    }
  });

  it('never lets a symptom become a signal', () => {
    for (const symptom of CYCLE_SYMPTOMS) {
      expect(isCycleSupportKind(symptom), symptom).toBe(false);
    }
  });
});

describe('feeling_unwell is built like every other signal', () => {
  const base = {
    coupleId: 'couple-1',
    sharedForDate: '2026-08-20',
  };
  const now = new Date('2026-08-20T09:00:00.000Z');

  it('accepts the kind and produces the same shaped row', () => {
    const payload = buildCycleSupportPayload(
      { ...base, kind: 'feeling_unwell' },
      'owner-1',
      now,
    );
    expect(payload).not.toBeNull();
    expect(payload!.kind).toBe('feeling_unwell');
    expect(payload!.owner_id).toBe('owner-1');
    expect(payload!.shared_for_date).toBe('2026-08-20');
  });

  it('expires within a day, so a hard morning does not follow someone all week', () => {
    const payload = buildCycleSupportPayload({ ...base, kind: 'feeling_unwell' }, 'owner-1', now);
    const expiry = Date.parse(payload!.expires_at);
    expect(expiry).toBeGreaterThan(now.getTime());
    expect(expiry).toBeLessThanOrEqual(now.getTime() + 24 * 60 * 60 * 1000);
  });

  it('refuses an expiry further out than a day, even if asked', () => {
    const payload = buildCycleSupportPayload(
      { ...base, kind: 'feeling_unwell', expiresAt: '2026-09-30T00:00:00.000Z' },
      'owner-1',
      now,
    );
    expect(payload).toBeNull();
  });

  it('carries no field that could hold a log id, a date or a symptom', () => {
    const payload = buildCycleSupportPayload({ ...base, kind: 'feeling_unwell' }, 'owner-1', now);
    expect(Object.keys(payload!).sort()).toEqual(
      ['couple_id', 'expires_at', 'kind', 'message', 'owner_id', 'shared_for_date'].sort(),
    );
  });

  it('rejects the refused graded kinds and every other invented one', () => {
    // The refused draft's vocabulary must fail like any unknown string — a client
    // holding a stale build cannot write a graded kind through this path.
    expect(buildCycleSupportPayload({ ...base, kind: 'pain_severe' as never }, 'o', now)).toBeNull();
    expect(buildCycleSupportPayload({ ...base, kind: 'pain_mild' as never }, 'o', now)).toBeNull();
    expect(buildCycleSupportPayload({ ...base, kind: 'severe' as never }, 'o', now)).toBeNull();
    expect(buildCycleSupportPayload({ ...base, kind: 'unwell' as never }, 'o', now)).toBeNull();
  });
});

describe('migration 047 widens a vocabulary by one and nothing else', () => {
  it('carries all five kinds and no graded kind', () => {
    for (const kind of CYCLE_SUPPORT_KINDS) {
      expect(migration, kind).toContain(`'${kind}'`);
    }
    expect(executable).not.toContain("'pain_");
  });

  it('touches no RLS policy, no function and no column', () => {
    /*
     * The blast radius, asserted. A `kind` value inherits the couple-scoped policies
     * migration 014 already wrote; if this file also created a policy or a SECURITY
     * DEFINER function, the review question would be a much larger one.
     *
     * Asserted against the EXECUTABLE sql only. The header explains at length what
     * this migration deliberately does not do, and naming those things is the point
     * of the header -- a check that cannot tell prose from a statement would force
     * the file to stop explaining itself.
     */
    expect(executable).not.toMatch(/CREATE POLICY/i);
    expect(executable).not.toMatch(/DROP POLICY/i);
    expect(executable).not.toMatch(/CREATE (OR REPLACE )?FUNCTION/i);
    expect(executable).not.toMatch(/SECURITY DEFINER/i);
    expect(executable).not.toMatch(/ADD COLUMN/i);
    expect(executable).not.toMatch(/GRANT /i);
  });

  it('never reads the personal pain table', () => {
    /*
     * The server must not be able to derive a signal from a log.
     *
     * Asserted as "no statement selects from or writes to it", not as "the string
     * never appears": the `COMMENT ON COLUMN` deliberately says the signal is never
     * derived from `cycle_daily_logs`, and a documentation string saying a table is
     * not used is not a use of it.
     */
    const statements = executable.replace(/COMMENT ON[\s\S]*?;/gi, '');
    expect(statements).not.toContain('pain_level');
    expect(statements).not.toMatch(/\b(FROM|JOIN|UPDATE|INSERT INTO)\s+(public\.)?cycle_daily_logs/i);
    expect(statements).not.toContain('cycle_daily_logs');
  });

  it('drops the old constraint by discovery, not by assumed name', () => {
    // Constraint names differ between environments created at different times --
    // the same reason migration 014 does this for `events.event_type`.
    expect(migration).toContain('pg_constraint');
    expect(migration).toContain('cycle_support_signals');
  });

  it('documents a DOWN path that refuses rather than deletes', () => {
    expect(migration).toContain('DOWN');
    expect(migration).toMatch(/SELECT id, owner_id, shared_for_date/);
  });
});

describe('the client never derives a signal from the personal log', () => {
  const section = code('src/components/CycleSupportSection.tsx');

  it('the sharing surface cannot see a daily log at all', () => {
    /*
     * Structural, and the strongest guarantee available here: it cannot copy what
     * it never receives. The component takes a role, a user id and a couple id --
     * no log, no pain level, no symptom list, and no import that could fetch one.
     */
    expect(section).not.toContain('painLevel');
    expect(section).not.toContain('CycleDailyLog');
    expect(section).not.toContain('dailyLog');
    expect(section).not.toContain('fetchCycleDailyLogs');
  });

  it('sets a kind only from a press, never from an effect', () => {
    /*
     * Every `setKind` call must be inside an `onClick`, or be the reset to empty.
     * An assignment inside a `useEffect` would mean the app choosing a disclosure
     * on someone's behalf -- which is the one thing this feature must never do.
     */
    const calls = [...section.matchAll(/(\w+)?\s*setKind\(/g)];
    expect(calls.length).toBeGreaterThan(0);
    for (const match of calls) {
      const context = section.slice(Math.max(0, match.index - 120), match.index + 60);
      const fromPress = context.includes('onClick');
      const isReset = /setKind\(''\)/.test(context);
      expect(fromPress || isReset, context.trim().slice(-90)).toBe(true);
    }
  });
});
