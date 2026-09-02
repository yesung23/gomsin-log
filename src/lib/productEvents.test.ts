import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The client half of §19, and the shape of what it refuses to send.
 *
 * The database guarantees are proved against a real PostgreSQL in the phase0
 * harness. What this file adds is the emitter's own contract: that the date is
 * derived in one place rather than passed in, that Korean-local is what buckets
 * a day, and that a failure here can never reach the person being measured.
 */

const insert = vi.fn(async () => ({ error: null }));
const from = vi.fn(() => ({ insert }));

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => from(...(args as [never])) },
  isSupabaseConfigured: true,
}));

const { recordProductEvent, FORBIDDEN_EVENT_SUBSTRINGS } = await import('@/lib/productEvents');

const SOURCE = readFileSync(resolve(process.cwd(), 'src/lib/productEvents.ts'), 'utf8');

beforeEach(() => {
  insert.mockClear().mockResolvedValue({ error: null });
  from.mockClear();
});

describe('what reaches the server', () => {
  it('sends a date bucket and never a time', async () => {
    await recordProductEvent(
      { kind: 'record_composed', durationMs: 4200 },
      new Date('2026-08-21T11:30:00+09:00'),
    );

    const row = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(row.occurred_on).toBe('2026-08-21');
    // Not "no time in this field" but "no field could hold one".
    for (const value of Object.values(row)) {
      expect(String(value)).not.toMatch(/\d{2}:\d{2}/);
    }
  });

  it('buckets by Korean-local date, not UTC', async () => {
    /*
      02:00 KST on the 21st is 17:00 UTC on the 20th. A UTC bucket would file
      every entry written between midnight and 09:00 KST under the previous day,
      which is precisely the window this product's users write in.
    */
    await recordProductEvent(
      { kind: 'record_composed' },
      new Date('2026-08-21T02:00:00+09:00'),
    );
    expect((insert.mock.calls[0][0] as { occurred_on: string }).occurred_on).toBe('2026-08-21');
  });

  it('sends no user id, so a client cannot attribute an event elsewhere', async () => {
    // The column defaults to auth.uid() in migration 049. Sending one from here
    // would be the shape in which that default could be overridden.
    await recordProductEvent({ kind: 'couple_connected' });
    expect(insert.mock.calls[0][0]).not.toHaveProperty('user_id');
  });

  it('sends exactly the six allowlisted fields, and nothing else', async () => {
    await recordProductEvent({
      kind: 'briefing_to_original',
      subjectId: 'rec-1',
      screen: 'home',
      durationMs: 10,
      errorCode: 'forbidden',
    });
    expect(Object.keys(insert.mock.calls[0][0] as object).sort()).toEqual(
      ['duration_ms', 'error_code', 'kind', 'occurred_on', 'screen', 'subject_id'],
    );
  });
});

describe('measurement can never damage what it measures', () => {
  it('stays silent when the insert is rejected', async () => {
    insert.mockResolvedValue({ error: { message: 'nope' } });
    await expect(recordProductEvent({ kind: 'record_composed' })).resolves.toBeUndefined();
  });

  it('stays silent when the call throws outright', async () => {
    // Someone writing a diary entry does not care that an analytics insert timed
    // out, and surfacing it would make the product worse for a number.
    insert.mockRejectedValue(new Error('offline'));
    await expect(recordProductEvent({ kind: 'record_composed' })).resolves.toBeUndefined();
  });

  it('does nothing at all without a configured backend', async () => {
    vi.resetModules();
    vi.doMock('@/lib/supabase', () => ({ supabase: null, isSupabaseConfigured: false }));
    const offline = await import('@/lib/productEvents');
    await expect(offline.recordProductEvent({ kind: 'record_composed' })).resolves.toBeUndefined();
    vi.doUnmock('@/lib/supabase');
    vi.resetModules();
  });
});

describe('the vocabulary names nothing §19 forbids', () => {
  it('has no kind touching content, emotion, health or behaviour', () => {
    /*
      Asserted against the SOURCE rather than against a value, because the union
      is a type and types are erased. A test that only checks today's members
      passes trivially; this says what must never be added, which is the
      assertion that still means something in a year.
    */
    const union = SOURCE.slice(
      SOURCE.indexOf('export type ProductEventKind'),
      SOURCE.indexOf('export type ProductEventScreen'),
    );
    for (const forbidden of FORBIDDEN_EVENT_SUBSTRINGS) {
      expect(union.toLowerCase(), forbidden).not.toContain(`'${forbidden}`);
    }
  });

  it('has no free-text field on the event type', () => {
    const shape = SOURCE.slice(
      SOURCE.indexOf('export interface ProductEvent'),
      SOURCE.indexOf('FORBIDDEN_EVENT_SUBSTRINGS'),
    );
    // `subjectId` is an id and `errorCode` is a classified kind. Anything else
    // typed `string` would be a place content could travel.
    const stringFields = [...shape.matchAll(/^\s{2}(\w+)\??: string;/gm)].map((m) => m[1]);
    expect(stringFields.sort()).toEqual(['errorCode', 'subjectId']);
  });
});

/**
 * The pipe is actually connected.
 *
 * `ENGINEERING_ROADMAP`'s LV entry condition is not "instrumentation exists", it
 * is that the events of the validated flow LAND. An emitter with no callers
 * satisfies every test written about the emitter, so this counts callers -- the
 * same defect class the security-review procedure names first.
 */
describe('the measured flow is wired, not merely available', () => {
  /**
   * Comments are stripped before anything is matched.
   *
   * The first version of this gate matched the bare kind string anywhere in the
   * file, and a probe showed what that is worth: commenting out the real
   * `recordProductEvent` calls in `store.tsx` and `CallBriefingWidget.tsx` --
   * so §19 emitted nothing at all -- left every test here green, because the
   * kind was still spelled in the comment that replaced the call.
   *
   * That is the same defect the push-module export gate was caught on earlier in
   * this branch, surviving in a second place. §19 instrumentation landing is an
   * LV entry condition, so a gate that cannot fail is worse than no gate: it
   * reports a connected pipe either way.
   */
  const stripComments = (text: string) =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');

  function source(path: string) {
    return stripComments(readFileSync(resolve(process.cwd(), path), 'utf8'));
  }

  const CALLERS: Array<[string, string]> = [
    ['src/components/widgets/TodayLogWidget.tsx', 'record_composed'],
    ['src/features/story/StoryRoute.tsx', 'briefing_opened'],
    ['src/features/story/StoryRoute.tsx', 'briefing_to_original'],
    ['src/pages/CallModePage.tsx', 'call_mode_opened'],
    ['src/pages/CallModePage.tsx', 'talk_about_resolved'],
    ['src/components/widgets/TalkAboutListWidget.tsx', 'talk_about_resolved'],
    ['src/lib/store.tsx', 'talk_about_marked'],
    ['src/lib/store.tsx', 'couple_connected'],
    ['src/components/NotificationPreferencesSection.tsx', 'notifications_disabled'],
  ];

  it.each(CALLERS)('%s emits %s', (path, kind) => {
    const text = source(path);
    expect(text).toContain("from '@/lib/productEvents'");
    // A CALL, not a mention. `recordProductEvent({ kind: 'x'` across either
    // formatting the codebase uses -- inline or with the object broken over
    // lines -- so the assertion fails when the call is removed rather than
    // when the word is.
    expect(
      text,
      `${path} names ${kind} but never passes it to recordProductEvent()`,
    ).toMatch(new RegExp(`recordProductEvent\\(\\s*\\{\\s*kind:\\s*'${kind}'`));
  });

it('emits every kind the union declares', () => {
    /*
      Soundness for the list above. A kind that exists but is never emitted is a
      column that will be empty at LV read-out, and finding that out then is
      finding it out too late.
    */
    const union = SOURCE.slice(
      SOURCE.indexOf('export type ProductEventKind'),
      SOURCE.indexOf('export type ProductEventScreen'),
    );
    const declared = [...union.matchAll(/'(\w+)'/g)].map((m) => m[1]);
    const wired = new Set(CALLERS.map(([, kind]) => kind));

    expect(declared.length).toBeGreaterThan(0);
    for (const kind of declared) {
      expect(wired.has(kind), `${kind} is declared but nothing emits it`).toBe(true);
    }
  });

  /*
    The kill metric's OFF-only rule was asserted here as a source string, and the
    audit that moved the emit broke it -- correctly, but for the wrong reason. A
    substring check passes for any code that merely CONTAINS the expression, so
    it would also have passed while the emit sat in a function that fires after a
    DENIED permission request: a user pressing "allow" counted as a user opting
    out, with this test green.

    It now lives in `notificationPreferencesSection.test.tsx`, which renders the
    component and clicks the toggles. Both mutations -- moving the emit back, and
    inverting the OFF test -- fail there.
  */


  it('measures composing only after the save succeeded', () => {
    /*
      A failed write must not be counted as an entry. The emit sits after the
      failure branch has already returned, so a rejected save produces no event
      and the 30-second number stays a number about entries that exist.
    */
    const text = source('src/components/widgets/TodayLogWidget.tsx');
    expect(text.indexOf("kind: 'record_composed'"))
      .toBeGreaterThan(text.indexOf("toast.error(result.error"));
  });

  it('sends an elapsed duration, never a clock reading', () => {
    const text = source('src/components/widgets/TodayLogWidget.tsx');
    expect(text).toContain('durationMs: Date.now() - composerOpenedAt.current');
    // The opening instant stays on the device; only the difference leaves it.
    expect(text).not.toMatch(/occurredAt|startedAt:\s*Date\.now/);
  });

  it('keeps the client and final database screen vocabularies identical', () => {
    const screenUnion = SOURCE.slice(
      SOURCE.indexOf('export type ProductEventScreen'),
      SOURCE.indexOf('export interface ProductEvent'),
    );
    const clientScreens = [...screenUnion.matchAll(/'(\w+)'/g)].map((match) => match[1]);

    const migration = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/068_allow_story_product_event_screen.sql'),
      'utf8',
    );
    const constraint = migration.slice(
      migration.indexOf('ADD CONSTRAINT product_events_screen_check_v2'),
      migration.indexOf('NOT VALID'),
    );
    const databaseScreens = [...constraint.matchAll(/'(\w+)'/g)].map((match) => match[1]);

    expect(databaseScreens).toEqual(clientScreens);
    expect(databaseScreens).toContain('story');
    expect(migration).toContain('CHECK (screen IS DISTINCT FROM \'story\' OR subject_id IS NULL)');
  });
});
