-- 047: Add one care-signal kind — `feeling_unwell`, "오늘은 몸이 힘들어요".
--
-- Product decision (V1_LAUNCH_DECISIONS_2026-08-20 §5): a person may choose to tell
-- their partner that today is physically hard. The approved shape is ONE new kind in
-- the existing care-signal vocabulary — not a graded pain scale. An earlier draft of
-- this migration shipped `pain_mild`/`pain_moderate`/`pain_severe`; the independent
-- security review (2026-08-21) returned CHANGES_REQUIRED because that graded
-- vocabulary mirrors the personal HRK pain levels one-to-one inside a server-visible
-- `kind` column, and no canonical document approves it. PRODUCT_V3 §21's sentence —
-- "증상·출혈량·통증·기분·메모는 어떤 설정에서도 공유되지 않는다" — stays true:
-- `feeling_unwell` is not a pain record, carries no severity, and is never derived
-- from one.
--
-- WHY THIS TABLE AND NOT THE PROJECTION
--
-- The projection is a continuous window: flip `share_current_period` on and the
-- partner sees the value on every load, derived from the owner's raw tables under
-- SECURITY DEFINER. That is the right shape for "am I on my period" and the wrong
-- shape for a bad day, which is a moment. A standing toggle would keep publishing it
-- on days nobody thought about it, and widening the projection would mean the RPC
-- reading `cycle_daily_logs` directly — exactly the coupling that must not exist.
--
-- This table already has the four properties an explicit disclosure needs, and has
-- had them since 014: one row per deliberate act, `shared_for_date` chosen by the
-- owner, `expires_at` defaulting a day out, and `revoked_at` for taking it back.
-- So the change is one more vocabulary value and nothing else.
--
-- WHAT THIS MIGRATION DOES NOT DO
--
-- No column is added. No RLS policy is written, altered or relaxed — the existing
-- couple-scoped policies from 014 already govern who may insert, read and revoke a
-- row here, and a new `kind` value inherits them unchanged. No function is created
-- or replaced. No projection RPC is touched. `cycle_daily_logs` is not read by
-- anything this migration adds, and nothing here can copy it: the server never
-- derives a signal, the client writes one only from an explicit press.
--
-- Reversible: the DOWN direction at the bottom restores the 014 vocabulary. It will
-- fail if `feeling_unwell` rows exist, which is correct — silently deleting a
-- person's disclosures to satisfy a constraint would be worse than refusing.

BEGIN;

-- Replace the vocabulary check by discovering its name rather than assuming it.
-- 014 established this pattern for `events.event_type` because the generated
-- constraint name differs between environments that were created at different
-- times, and the same risk applies here.
DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  FOR v_constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.cycle_support_signals'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%kind%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.cycle_support_signals DROP CONSTRAINT %I',
      v_constraint_name
    );
  END LOOP;
END $$;

ALTER TABLE public.cycle_support_signals
  ADD CONSTRAINT cycle_support_signals_kind_check CHECK (
    kind IN (
      -- The four care requests from 014, unchanged.
      'resting',
      'need_space',
      'would_like_support',
      'check_in_later',
      -- Added 2026-08-21. One kind, no grade: "오늘은 몸이 힘들어요."
      'feeling_unwell'
    )
  );

COMMENT ON COLUMN public.cycle_support_signals.kind IS
  'Explicit opt-in care request. Never derived from cycle_daily_logs; written only from a deliberate user action, and expiring/revocable like every other signal. Deliberately carries no pain grade.';

COMMIT;

-- ---------------------------------------------------------------------------
-- DOWN (manual, not run by the migration runner)
-- ---------------------------------------------------------------------------
-- Refuses rather than destroys if anyone has already shared the new kind. Run the
-- SELECT first; if it returns rows, decide deliberately what happens to them.
--
--   SELECT id, owner_id, shared_for_date
--     FROM public.cycle_support_signals
--    WHERE kind = 'feeling_unwell';
--
--   BEGIN;
--   ALTER TABLE public.cycle_support_signals
--     DROP CONSTRAINT IF EXISTS cycle_support_signals_kind_check;
--   ALTER TABLE public.cycle_support_signals
--     ADD CONSTRAINT cycle_support_signals_kind_check CHECK (
--       kind IN ('resting', 'need_space', 'would_like_support', 'check_in_later')
--     );
--   COMMIT;
