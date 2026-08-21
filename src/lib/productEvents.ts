import { supabase, isSupabaseConfigured } from '@/lib/supabase';

/**
 * The measurement pipe, shaped by PRODUCT_V3 §19's allowlist.
 *
 * LV cannot start without this: an unmeasured validation is theatre, and
 * `ENGINEERING_ROADMAP`'s LV entry conditions now say so. But an analytics layer
 * is also the single easiest place in this product to build the thing it exists
 * to refuse, so the design goal is not "collect carefully" -- it is that the
 * forbidden columns have nowhere to go.
 *
 * §19's two columns, and how each side is enforced:
 *
 *   ALLOWED                     HOW
 *   event kind                  a closed union, below
 *   opaque object identifier    `subjectId`, typed as an id and never text
 *   error code                  `errorCode`, from classified server errors
 *   elapsed time (ms)           `durationMs`, a number
 *   screen name                 a closed union, below
 *   platform / app version      filled in by the emitter, not by callers
 *
 *   FORBIDDEN                   HOW IT IS PREVENTED
 *   record / topic content      there is no free-text field on this type
 *   emotion label or count      no field, and emotion is not a `kind`
 *   attachment filename         no field
 *   anything cycle or health    no `kind` names one, and a test asserts it
 *   schedule title/address      no field
 *   precise timestamps          the row stores a DATE, never a time
 *
 * That last one is the one people undo by accident. A `created_at TIMESTAMPTZ`
 * default is what every table gets, and it would turn this table into a
 * minute-by-minute record of when each person opens the app -- the behavioural
 * surveillance §19's closing rules forbid outright. Migration 049 has no
 * timestamp column at all.
 *
 * Two more of those closing rules shape what is NOT here. There is no
 * `session_started` or `screen_dwell` event, because time-in-app is exactly the
 * metric §19 rules out. And nothing counts records or consecutive days, because
 * §19 forbids treating either as a success measure -- the strategy measures
 * couples that wrote in a week, which is a different question asked of the
 * records themselves rather than a streak accumulated here.
 */

/**
 * Every event this product may emit.
 *
 * A closed union rather than a string, so adding one is a deliberate edit here
 * and shows up in review as a change to the measurement contract.
 *
 * Each of these answers a question from the strategy's LV read-out list. Nothing
 * is collected because it might be interesting later.
 */
export type ProductEventKind =
  /** How long composing took. The strategy's 30-second target. */
  | 'record_composed'
  /** The loop's middle: did the briefing lead to the exact original? */
  | 'briefing_opened'
  | 'briefing_to_original'
  /** Conversation intent, and whether it completed. */
  | 'talk_about_marked'
  | 'talk_about_resolved'
  | 'call_mode_opened'
  /** The kill metric. If people turn notifications off, the design failed. */
  | 'notifications_disabled'
  /** The activation funnel's one step that decides everything after it. */
  | 'couple_connected';

/** Screens, as a closed set. A free string would be a route, and routes carry ids. */
export type ProductEventScreen =
  | 'home'
  | 'record'
  | 'schedule'
  | 'us'
  | 'my'
  | 'call'
  | 'onboarding'
  | 'settings';

export interface ProductEvent {
  kind: ProductEventKind;
  /**
   * An opaque row id, when the event is about one. Never a title, never a body,
   * never a filename. Typed as a plain id so there is no shape in which content
   * could be attached to it.
   */
  subjectId?: string;
  screen?: ProductEventScreen;
  /** Elapsed milliseconds. §19 allows a duration; it forbids a wall-clock time. */
  durationMs?: number;
  /** A classified error kind, not a server message. */
  errorCode?: string;
}

/**
 * Kinds that would be a §19 violation if they ever existed.
 *
 * Listed so the test can assert their ABSENCE by name. A test that only checks
 * the current union passes trivially; this one says what must never be added,
 * which is the assertion that still means something in a year.
 */
export const FORBIDDEN_EVENT_SUBSTRINGS: readonly string[] = [
  'cycle', 'health', 'period', 'symptom', 'pain',
  'emotion', 'mood', 'feeling',
  'dwell', 'session', 'streak', 'retention',
  'read', 'seen', 'opened_partner',
];

/** The one place a date is derived, so no caller can pass a time by accident. */
function todayBucket(now: Date): string {
  // Korean-local, matching the product's calendar everywhere else. A UTC bucket
  // would file everything written between midnight and 09:00 KST on the wrong day.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Record one event.
 *
 * Fire-and-forget, and silent on failure. Measurement must never be able to
 * interrupt, slow or fail the thing being measured -- a person writing a diary
 * entry does not care that the analytics insert timed out, and surfacing it
 * would make the product worse in exchange for a number.
 */
export async function recordProductEvent(
  event: ProductEvent,
  now: Date = new Date(),
): Promise<void> {
  if (!isSupabaseConfigured || !supabase) return;

  try {
    await supabase.from('product_events').insert({
      kind: event.kind,
      subject_id: event.subjectId ?? null,
      screen: event.screen ?? null,
      duration_ms: event.durationMs ?? null,
      error_code: event.errorCode ?? null,
      occurred_on: todayBucket(now),
    });
  } catch {
    // Deliberately swallowed. See above.
  }
}
