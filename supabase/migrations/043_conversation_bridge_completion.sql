-- =============================================================
-- 043_conversation_bridge_completion.sql
-- Conversation Bridge V1: retain metadata-only topics through completion
-- and source-record removal without retaining record content.
-- =============================================================
--
-- 038 deliberately made a mark immutable and cascaded it with the record.
-- Conversation Bridge needs one additional metadata state: completed. It also
-- needs a deleted source to render a safe unavailable row instead of silently
-- substituting another record. The opaque UUID remains couple-scoped metadata;
-- no record text, preview, topic, summary, or author fields are copied here.

BEGIN;

ALTER TABLE public.talk_about_marks
  ADD COLUMN IF NOT EXISTS is_completed BOOLEAN NOT NULL DEFAULT false;

-- Conversation Bridge is for a shared record and a real two-person
-- conversation. 038 allowed the owner to mark an own-private record, which
-- would leave partner-visible coordination metadata for content the partner
-- cannot read. Replace that legacy policy with the stricter shared-only rule.
DROP POLICY IF EXISTS "Active members create own talk-about marks" ON public.talk_about_marks;
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
        AND record.is_private = false
    )
  );

-- Remove the only legacy shape that can never be a valid Conversation Bridge
-- item under the new shared-only rule. This touches coordination metadata only,
-- not any record, and runs only when this unapplied migration is explicitly
-- authorized.
DELETE FROM public.talk_about_marks AS mark
USING public.daily_records AS record
WHERE record.id = mark.record_id
  AND record.is_private = true;

-- Keep the opaque source id after a record is deleted. INSERT RLS continues
-- to prove that a live shared record belongs to the current active couple;
-- this only changes post-delete retention so the client can render a generic
-- unavailable state. A UUID is never used to locate a different record.
ALTER TABLE public.talk_about_marks
  DROP CONSTRAINT IF EXISTS talk_about_marks_record_id_fkey;

CREATE INDEX IF NOT EXISTS idx_talk_about_marks_couple_pending_created
  ON public.talk_about_marks (couple_id, is_completed, created_at DESC);

DROP POLICY IF EXISTS "Active members complete couple talk-about marks" ON public.talk_about_marks;
CREATE POLICY "Active members complete couple talk-about marks"
  ON public.talk_about_marks FOR UPDATE
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND couple_id = public.get_my_active_couple_id()
    AND is_completed = false
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND couple_id = public.get_my_active_couple_id()
    AND is_completed = true
  );

-- Completion is monotonic: authenticated clients can change only this flag,
-- and the RLS check above rejects reopening or mutating any other metadata.
GRANT UPDATE (is_completed) ON public.talk_about_marks TO authenticated;

DROP TRIGGER IF EXISTS emit_talk_about_collaboration_invalidation ON public.talk_about_marks;
CREATE TRIGGER emit_talk_about_collaboration_invalidation
  AFTER INSERT OR UPDATE OR DELETE ON public.talk_about_marks
  FOR EACH ROW EXECUTE FUNCTION public.emit_collaboration_invalidation('talk_about');

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Rollback (after confirming no client depends on completed state):
--   DROP TRIGGER IF EXISTS emit_talk_about_collaboration_invalidation ON public.talk_about_marks;
--   CREATE TRIGGER emit_talk_about_collaboration_invalidation
--     AFTER INSERT OR DELETE ON public.talk_about_marks
--     FOR EACH ROW EXECUTE FUNCTION public.emit_collaboration_invalidation('talk_about');
--   REVOKE UPDATE (is_completed) ON public.talk_about_marks FROM authenticated;
--   DROP POLICY IF EXISTS "Active members complete couple talk-about marks" ON public.talk_about_marks;
--   DROP INDEX IF EXISTS public.idx_talk_about_marks_couple_pending_created;
--   ALTER TABLE public.talk_about_marks DROP COLUMN IF EXISTS is_completed;
-- Re-adding 038's record FK is safe only after removing marks whose source
-- record no longer exists; do not apply that destructive rollback in Production
-- without an explicit data-retention decision.
