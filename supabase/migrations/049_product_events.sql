-- 049: The measurement pipe, inside PRODUCT_V3 §19's allowlist.
--
-- LV cannot start without this. `ENGINEERING_ROADMAP`'s LV entry conditions were
-- amended on 2026-08-21 to say so outright: an unmeasured validation is theatre,
-- because it produces opinions about a loop nobody counted.
--
-- An analytics table is also the easiest place in this product to build the thing
-- the product refuses to be. So the shape is the enforcement:
--
--   * THERE IS NO TIMESTAMP COLUMN. `occurred_on` is a DATE. §19 permits a date
--     bucket and forbids precise times, and a `created_at TIMESTAMPTZ DEFAULT
--     now()` -- which every other table here has, and which nobody would question
--     in review -- would turn this into a minute-by-minute log of when each
--     person opens the app. That is the behavioural surveillance §19's closing
--     rules forbid, and it would arrive as a default rather than as a decision.
--
--   * `kind` is a CHECK-constrained enum, not free text. Adding an event is a
--     migration, which is a review.
--
--   * There is no text column that could hold content. `subject_id` is a UUID:
--     a record id fits, a record's first line does not.
--
--   * Nothing here is per-couple-aggregatable by the partner. RLS scopes every
--     row to the account that emitted it, and no policy grants the partner any
--     read at all. §19 forbids aggregating even a boolean along the partner axis
--     for the health domain; this table simply has no health kind and no partner
--     read, which is the stronger version of the same rule.
--
-- What is deliberately absent, and why each would be a violation rather than an
-- oversight:
--
--   session/dwell events   -- time-in-app is the metric §19 rules out by name
--   a record counter       -- §19 forbids record count as a success measure
--   a streak counter       -- same rule, and streaks are §16's anxiety engine
--   a read/seen event      -- that is a read receipt (§14.3), from the other side
--   emotion kinds          -- §19 forbids the label and the count alike

BEGIN;

CREATE TABLE public.product_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- The closed vocabulary. Every value answers a question from the LV read-out
  -- list; nothing is collected in case it turns out to be interesting.
  kind TEXT NOT NULL CHECK (kind IN (
    'record_composed',
    'briefing_opened',
    'briefing_to_original',
    'talk_about_marked',
    'talk_about_resolved',
    'call_mode_opened',
    'notifications_disabled',
    'couple_connected'
  )),

  -- A closed set too: a free string here would become a route, and routes carry
  -- ids and query parameters.
  screen TEXT CHECK (screen IS NULL OR screen IN (
    'home', 'record', 'schedule', 'us', 'my', 'call', 'onboarding', 'settings'
  )),

  -- Opaque. A UUID column cannot hold a title, a body, or a filename.
  subject_id UUID,

  -- Elapsed, not absolute. Bounded because an unbounded duration is usually a
  -- backgrounded tab rather than a person taking four hours to write a sentence.
  duration_ms INTEGER CHECK (duration_ms IS NULL OR (duration_ms >= 0 AND duration_ms <= 3600000)),

  -- A classified kind from `serverErrors.ts`, never a server message.
  error_code TEXT CHECK (error_code IS NULL OR length(error_code) <= 40),

  -- The date bucket, and the whole reason this table has no `created_at`.
  occurred_on DATE NOT NULL
);

ALTER TABLE public.product_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_product_events_day ON public.product_events (occurred_on, kind);

-- Own rows only, in both directions. The partner has no policy here at all, so
-- there is no query shape in which one person's activity becomes visible to the
-- other -- which is the point, not a side effect.
CREATE POLICY "Users write only their own events"
  ON public.product_events FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users read only their own events"
  ON public.product_events FOR SELECT
  USING (user_id = auth.uid());

-- No UPDATE and no DELETE policy. An event is a fact about something that
-- happened; editing one is not a use case, and the absence means a compromised
-- session cannot rewrite the record of its own activity either.

GRANT SELECT, INSERT ON public.product_events TO authenticated;

-- `user_id` is filled from the session rather than from the payload, so a client
-- cannot attribute its events to another account even by mistake.
ALTER TABLE public.product_events
  ALTER COLUMN user_id SET DEFAULT auth.uid();

COMMIT;

NOTIFY pgrst, 'reload schema';
