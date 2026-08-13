-- =============================================================
-- 038_bilateral_talk_about_marks.sql
-- "이따 이야기하기" — bilateral, metadata-only conversation marks.
-- =============================================================
--
-- PRODUCT_V3 §8: either partner may flag a SHARED record as something to talk
-- about later, both see it, both can clear it, and the stored row carries no
-- free text at all.
--
-- The obvious implementation -- let the partner write `daily_records.talk_about`
-- -- was rejected. `daily_records` RLS gives the author `FOR ALL` and the
-- partner `SELECT` only (009:137-155), and widening that to let a partner
-- UPDATE the author's row would hand them a write path to `log_text`,
-- `emotion_flow` and `attachments` on the way to flipping one boolean. A
-- column-level UPDATE grant could narrow it, but the row would still be the
-- AUTHOR's row, so "who marked this" would be unrepresentable and the two
-- partners would overwrite each other's intent. A separate coordination table
-- keeps `daily_records` write access exactly as it is today.
--
-- WHAT THE SERVER LEARNS, in full:
--   which record id was marked, by which user, in which couple, and when.
-- Nothing else. No topic, no note, no excerpt, no summary, no emotion. The
-- 오늘 이야기할 것 list renders record content the client ALREADY holds and is
-- already authorized for; this table only says which of those to show. That is
-- Minimal Server Metadata, not User Content, so it takes no part in the E2EE
-- key hierarchy (DATA_LEGAL §E "서버에 남겨도 되는 최소 메타데이터").
--
-- Deliberately NOT here: no SECURITY DEFINER function, no RPC, no trigger. The
-- whole contract is expressible in RLS policies plus a column-level INSERT
-- grant, and every one of those is inspectable in `pg_policies` without
-- reading a function body.

BEGIN;

CREATE TABLE IF NOT EXISTS public.talk_about_marks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- CASCADE is the whole orphan story: deleting a record deletes its marks,
  -- so a mark can never point at a row that is gone, and the 이야기할 것 list
  -- cannot hold an entry it is unable to render.
  record_id UUID NOT NULL REFERENCES public.daily_records(id) ON DELETE CASCADE,
  -- Denormalised so RLS can scope without joining `daily_records` (whose own
  -- RLS would then decide this table's visibility as a side effect). Verified
  -- against the record's real couple by the INSERT policy below, never trusted
  -- from the client.
  couple_id UUID NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One mark per person per record. This is what makes a double tap, or both
  -- partners marking the same record at the same instant, deterministic: the
  -- second concurrent INSERT loses the race and violates this, rather than
  -- producing two rows that both have to be reconciled later. Clients use
  -- ON CONFLICT DO NOTHING and treat "already marked" as success.
  --
  -- Per ACTOR rather than per record on purpose. PRODUCT_V3 §8 requires that
  -- "누가 붙였는지도 보인다", and a single couple-level row cannot express
  -- that. It also means unmarking your own mark can never silently discard
  -- your partner's separate intention.
  CONSTRAINT talk_about_marks_one_per_actor UNIQUE (record_id, actor_user_id)
);

COMMENT ON TABLE public.talk_about_marks IS
  'Metadata-only conversation coordination: which shared record was flagged for a later conversation, by whom, when. Never stores record text, topics, summaries or emotion -- the UI renders content the client is already authorized to hold.';
COMMENT ON COLUMN public.talk_about_marks.couple_id IS
  'Verified against daily_records.couple_id by the INSERT policy; not trusted from the client.';

-- Reads are always "the marks for this couple", newest first.
CREATE INDEX IF NOT EXISTS idx_talk_about_marks_couple_created
  ON public.talk_about_marks (couple_id, created_at DESC);

ALTER TABLE public.talk_about_marks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Active members read couple talk-about marks" ON public.talk_about_marks;
DROP POLICY IF EXISTS "Active members create own talk-about marks" ON public.talk_about_marks;
DROP POLICY IF EXISTS "Active members clear couple talk-about marks" ON public.talk_about_marks;

-- READ. Both partners see both partners' marks -- that is the feature. Scoped
-- to the CURRENT active couple, so `get_my_active_couple_id()` returning NULL
-- after a disconnect makes the whole predicate NULL and fails closed.
CREATE POLICY "Active members read couple talk-about marks"
  ON public.talk_about_marks FOR SELECT
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND couple_id = public.get_my_active_couple_id()
  );

-- CREATE. Four independent conditions, each of which must hold:
--   1. the row is attributed to the caller, not to their partner
--   2. the caller is in an active couple, and it is THIS couple
--   3. the target record really belongs to that same couple -- this is what
--      stops a forged `record_id` from another couple being smuggled in
--      alongside a legitimate `couple_id`
--   4. the target is actually markable BY THIS CALLER: shared, or their own
--
-- Condition 4 is stated explicitly even though `daily_records` RLS would
-- already hide a partner's private record from the sub-select. Two layers
-- deny the same thing on purpose, and the harness tests each in isolation --
-- an earlier storage-policy pass in this repo shipped an assertion that
-- passed only because of the inner layer, so the outer one was never
-- actually exercised.
CREATE POLICY "Active members create own talk-about marks"
  ON public.talk_about_marks FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND actor_user_id = auth.uid()
    AND couple_id = public.get_my_active_couple_id()
    AND EXISTS (
      SELECT 1
      FROM public.daily_records AS record
      WHERE record.id = talk_about_marks.record_id
        AND record.couple_id = talk_about_marks.couple_id
        AND (record.is_private = false OR record.user_id = auth.uid())
    )
  );

-- CLEAR. Either partner may clear either mark, which is PRODUCT_V3 §8's
-- "양쪽 다 해제할 수 있다" and is what makes 이야기했어요 resolve a topic for
-- both people once the conversation has actually happened. That is the
-- feature's success state, not a way to discard someone's intent unheard --
-- and unmarking your own flag from the record itself deletes only your row,
-- because the client scopes that call by `actor_user_id`.
CREATE POLICY "Active members clear couple talk-about marks"
  ON public.talk_about_marks FOR DELETE
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND couple_id = public.get_my_active_couple_id()
  );

-- No UPDATE policy, and no UPDATE grant below. A mark has no mutable state:
-- it exists or it does not. With RLS enabled the absence of a policy is the
-- deny rule, and the absent grant refuses before RLS is even consulted.
REVOKE ALL ON TABLE public.talk_about_marks FROM PUBLIC;
REVOKE ALL ON TABLE public.talk_about_marks FROM anon;
GRANT SELECT, DELETE ON TABLE public.talk_about_marks TO authenticated;

-- Column-level INSERT, the same technique 036 used to put `devices.status`
-- out of client reach. `id` and `created_at` are omitted, so a client cannot
-- supply either: both fall to their defaults and the timestamp is the
-- server's. Without this a caller could backdate or forward-date a mark.
GRANT INSERT (record_id, couple_id, actor_user_id) ON TABLE public.talk_about_marks TO authenticated;

-- Let the partner's client know something changed without telling Realtime
-- what. `collaboration_invalidations` carries only (couple_id, slice, time) --
-- see 014:135-143 for why a content-free ping is the mechanism here rather
-- than publishing this table directly.
ALTER TABLE public.collaboration_invalidations
  DROP CONSTRAINT IF EXISTS collaboration_invalidations_slice_check;
ALTER TABLE public.collaboration_invalidations
  ADD CONSTRAINT collaboration_invalidations_slice_check
  CHECK (slice IN ('events', 'cycle_support', 'talk_about'));

DROP TRIGGER IF EXISTS emit_talk_about_collaboration_invalidation ON public.talk_about_marks;
CREATE TRIGGER emit_talk_about_collaboration_invalidation
  AFTER INSERT OR DELETE ON public.talk_about_marks
  FOR EACH ROW EXECUTE FUNCTION public.emit_collaboration_invalidation('talk_about');

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Rollback:
--   DROP TABLE public.talk_about_marks;   -- takes its trigger with it
--   then restore the two-value slice CHECK on collaboration_invalidations
--   AFTER deleting any rows with slice = 'talk_about'.
-- Nothing else in the schema references this table, and `daily_records` was
-- not modified, so a rollback cannot strand record data.
--
-- Deliberately NOT done here: `daily_records.talk_about` is left exactly as it
-- is. It is the author's own pre-call flag, written only by the composer, and
-- it is listed in the 032 write-floor's accepted-plaintext set. Migrating it
-- into this table would mean writing rows on behalf of users who never
-- consented to the new model, and dropping it would destroy data an existing
-- client still reads. See the PR description for the disposition.
