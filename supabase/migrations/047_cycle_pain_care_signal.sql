-- 047: Let a coarse pain state be sent as an explicit, expiring care signal.
--
-- Product decision (Control Tower, 2026-08-20): a person may choose to tell their
-- partner that today hurts. Until now they could not -- `cycle_support_signals`
-- accepted four care requests and nothing about pain, and the standing
-- `get_partner_cycle_projection()` window deliberately has no field for it.
--
-- WHY THIS TABLE AND NOT THE PROJECTION
--
-- The projection is a continuous window: flip `share_current_period` on and the
-- partner sees the value on every load, derived from the owner's raw tables under
-- SECURITY DEFINER. That is the right shape for "am I on my period" and the wrong
-- shape for pain, which is a moment and the most sensitive thing on the screen. A
-- standing toggle would keep publishing it on days nobody thought about it, and
-- widening the projection would mean the RPC reading `cycle_daily_logs.pain_level`
-- directly -- exactly the coupling that must not exist.
--
-- This table already has the four properties an explicit disclosure needs, and has
-- had them since 014: one row per deliberate act, `shared_for_date` chosen by the
-- owner, `expires_at` defaulting a day out, and `revoked_at` for taking it back.
-- So the change is a wider vocabulary and nothing else.
--
-- WHAT THIS MIGRATION DOES NOT DO
--
-- No column is added. No RLS policy is written, altered or relaxed -- the existing
-- couple-scoped policies from 014 already govern who may insert, read and revoke a
-- row here, and a new `kind` value inherits them unchanged. No function is created
-- or replaced. No projection RPC is touched. `cycle_daily_logs.pain_level` is not
-- read by anything this migration adds, and nothing here can copy it: the server
-- never derives a signal, the client writes one only from an explicit press.
--
-- The three values are buckets, not a scale. There is no numeric column, so the
-- partner learns that today is hard and cannot reconstruct a health record from it.
--
-- Reversible: the DOWN direction at the bottom restores the 014 vocabulary. It will
-- fail if pain rows exist, which is correct -- silently deleting a person's
-- disclosures to satisfy a constraint would be worse than refusing.

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
      -- Coarse pain, added 2026-08-20. Buckets, never a number.
      'pain_mild',
      'pain_moderate',
      'pain_severe'
    )
  );

COMMENT ON COLUMN public.cycle_support_signals.kind IS
  'Explicit opt-in care request or coarse pain bucket. Never derived from cycle_daily_logs; written only from a deliberate user action, and expiring/revocable like every other signal.';

COMMIT;

-- ---------------------------------------------------------------------------
-- DOWN (manual, not run by the migration runner)
-- ---------------------------------------------------------------------------
-- Refuses rather than destroys if anyone has already shared pain. Run the SELECT
-- first; if it returns rows, decide deliberately what happens to them.
--
--   SELECT id, owner_id, shared_for_date
--     FROM public.cycle_support_signals
--    WHERE kind LIKE 'pain_%';
--
--   BEGIN;
--   ALTER TABLE public.cycle_support_signals
--     DROP CONSTRAINT IF EXISTS cycle_support_signals_kind_check;
--   ALTER TABLE public.cycle_support_signals
--     ADD CONSTRAINT cycle_support_signals_kind_check CHECK (
--       kind IN ('resting', 'need_space', 'would_like_support', 'check_in_later')
--     );
--   COMMIT;
