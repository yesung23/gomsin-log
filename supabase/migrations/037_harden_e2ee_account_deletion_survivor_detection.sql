-- =============================================================
-- 037_harden_e2ee_account_deletion_survivor_detection.sql
-- Make E2EE deletion agree with 029 about who counts as a survivor.
-- =============================================================
--
-- 031 decided "is there a surviving partner?" with `status = 'active'`, and 029
-- decided the same question with "does any other membership row exist?". Those
-- two answers disagree whenever a membership row exists in a non-active state,
-- and the disagreement is destructive in one direction only.
--
-- Reproduced against the real schema, with A active and B disconnected:
--
--   e2ee_prepare_account_deletion('A')  -> partner_remains: false
--                                       -> couple scope_keys      1 -> 0
--                                       -> crypto_pairings        1 -> 0
--                                       -> crypto_write_floor     1 -> 0
--   cleanup_account_solo_couples('A')   -> 0 couples deleted
--   public.couples row                  -> still present
--   B's couple_members row              -> still present
--
-- The relational layer correctly preserved the couple for B while the crypto
-- layer had already shredded every key B needs to open its shared history. The
-- pre-flight that exists precisely to prevent that never ran, because it too is
-- gated on `v_partner_remains`.
--
-- Reachable today: the 001-era `disconnect_couple()` updated only the caller's
-- row (`WHERE user_id = auth.uid()`), so couples disconnected before 006 can
-- still hold one active and one disconnected member. `pending` is accepted by
-- the CHECK constraint and counted by 029, though no current code path writes
-- it. Neither case should depend on an invariant maintained in a different
-- function that has already been redefined twice.
--
-- 031-036 are frozen; this is a forward replacement of one function body.

BEGIN;

CREATE OR REPLACE FUNCTION public.e2ee_prepare_account_deletion(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_couple RECORD;
  v_epoch RECORD;
  v_surviving INTEGER;
  v_any_partner_remains BOOLEAN := false;
  v_couples_examined INTEGER := 0;
  v_couples_cleaned INTEGER := 0;
  v_deleted_envelopes INTEGER := 0;
  v_deleted_devices INTEGER := 0;
  v_retained_certs INTEGER := 0;
  v_deleted_certs INTEGER := 0;
  v_loop_deleted INTEGER := 0;
  v_deleted_scope_keys INTEGER := 0;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user id required';
  END IF;

  -- Transaction-local, and only for this function's own statements. It is not
  -- reachable by a client: `authenticated` has no EXECUTE on this function.
  PERFORM set_config('gomsinlog.e2ee_account_destruction', 'on', true);

  -- Lock every couple this account belongs to, in a deterministic order, before
  -- reading membership. 029 already takes FOR UPDATE on the same rows for the
  -- same reason: two partners deleting concurrently must not each observe the
  -- other as present and then both act on that stale answer. Ordering by id
  -- makes the two callers queue instead of deadlock.
  PERFORM 1
  FROM public.couples c
  WHERE EXISTS (
    SELECT 1 FROM public.couple_members cm
    WHERE cm.couple_id = c.id AND cm.user_id = p_user_id
  )
  ORDER BY c.id
  FOR UPDATE;

  -- PRE-FLIGHT. Abort rather than crypto-shred a surviving partner.
  --
  -- Deliberately still scoped to an ACTIVE partner. This branch REFUSES the
  -- account deletion outright, and a person's ability to delete their account
  -- must not be blocked by the key state of an ex-partner who already has no
  -- access. Preservation below is what protects a non-active member; refusal is
  -- reserved for a live relationship.
  FOR v_couple IN
    SELECT cm.couple_id,
           (SELECT o.user_id
              FROM public.couple_members o
             WHERE o.couple_id = cm.couple_id
               AND o.user_id <> p_user_id
               AND o.status = 'active'
             LIMIT 1) AS active_partner_id
      FROM public.couple_members cm
     WHERE cm.user_id = p_user_id
     ORDER BY cm.couple_id
  LOOP
    CONTINUE WHEN v_couple.active_partner_id IS NULL;

    FOR v_epoch IN
      SELECT sk.id, sk.key_epoch
      FROM public.scope_keys sk
      WHERE sk.domain = 'couple' AND sk.owner_couple_id = v_couple.couple_id
        AND sk.state IN ('ACTIVE', 'RETIRED')
        -- Only epochs that are actually decryptable by somebody. An epoch with
        -- no envelopes at all is dead weight: nobody can open it, so deleting A
        -- takes nothing from B and aborting would help no one.
        AND EXISTS (SELECT 1 FROM public.key_envelopes ke WHERE ke.scope_key_id = sk.id)
    LOOP
      SELECT count(*) INTO v_surviving
      FROM public.key_envelopes ke
      WHERE ke.scope_key_id = v_epoch.id
        AND (
          (ke.recipient_device_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.devices d
            WHERE d.id = ke.recipient_device_id AND d.user_id = v_couple.active_partner_id
          ))
          OR (ke.recipient_recovery_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.recovery_identities r
            WHERE r.id = ke.recipient_recovery_id AND r.user_id = v_couple.active_partner_id
          ))
        );

      IF v_surviving = 0 THEN
        RAISE EXCEPTION
          'E2EE_DELETION_WOULD_ORPHAN_PARTNER: couple epoch % has no surviving envelope for the remaining partner',
          v_epoch.key_epoch
          USING ERRCODE = 'raise_exception';
      END IF;
    END LOOP;
  END LOOP;

  -- RECIPIENT OWNED: only A's own envelopes.
  DELETE FROM public.key_envelopes ke
  WHERE (ke.recipient_device_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.devices d WHERE d.id = ke.recipient_device_id AND d.user_id = p_user_id))
     OR (ke.recipient_recovery_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.recovery_identities r WHERE r.id = ke.recipient_recovery_id AND r.user_id = p_user_id));
  GET DIAGNOSTICS v_deleted_envelopes = ROW_COUNT;

  -- USER OWNED scope keys only. Couple epochs are couple-owned and are never
  -- reachable from a user predicate, which is the structural half of the fix;
  -- the loop at the end is the explicit half.
  DELETE FROM public.scope_keys sk
  WHERE sk.domain IN ('personal', 'health') AND sk.owner_user_id = p_user_id;
  GET DIAGNOSTICS v_deleted_scope_keys = ROW_COUNT;

  -- HISTORICAL: keep only what a surviving envelope still needs. Retention is
  -- decided by the actual foreign key, not by a cached counter that can drift —
  -- the FK is ON DELETE RESTRICT, so a referenced certificate cannot be removed
  -- even by this function.
  v_deleted_certs := 0;
  LOOP
    DELETE FROM public.device_certificates dc
    WHERE dc.user_id = p_user_id
      AND NOT EXISTS (SELECT 1 FROM public.key_envelopes ke WHERE ke.sender_certificate_id = dc.id)
      AND NOT EXISTS (SELECT 1 FROM public.device_certificates child WHERE child.issuer_certificate_id = dc.id);
    GET DIAGNOSTICS v_loop_deleted = ROW_COUNT;
    v_deleted_certs := v_deleted_certs + v_loop_deleted;
    EXIT WHEN v_loop_deleted = 0;
  END LOOP;

  -- Anchors follow the same rule: removable only once no retained certificate
  -- roots at them.
  DELETE FROM public.recovery_public_anchors rpa
  WHERE rpa.user_id = p_user_id
    AND NOT EXISTS (
      SELECT 1 FROM public.device_certificates dc WHERE dc.recovery_public_anchor_id = rpa.id
    );

  SELECT count(*) INTO v_retained_certs
  FROM public.device_certificates dc WHERE dc.user_id = p_user_id;

  UPDATE public.device_certificates
     SET retained_reason = 'historical_verification'
   WHERE user_id = p_user_id;

  DELETE FROM public.migration_ledger WHERE user_id = p_user_id;
  DELETE FROM public.recovery_challenges WHERE user_id = p_user_id;
  DELETE FROM public.device_enrollments WHERE user_id = p_user_id;
  DELETE FROM public.recovery_identities WHERE user_id = p_user_id;
  -- Permitted only because the destruction flag is set above, and only for the
  -- personal scope whose keys have just been destroyed.
  DELETE FROM public.crypto_write_floor WHERE scope_kind = 'user' AND scope_id = p_user_id;

  DELETE FROM public.devices WHERE user_id = p_user_id;
  GET DIAGNOSTICS v_deleted_devices = ROW_COUNT;

  -- COUPLE OWNED.
  --
  -- One couple at a time, and the survivor test is now "does ANY other
  -- membership row exist", which is exactly the predicate 029 uses to decide
  -- whether to keep the `couples` row. The two layers can no longer disagree.
  --
  -- Iterating also fixes a second defect in the single-row version: it located
  -- the couple through the deleting user's own ACTIVE membership, so a user
  -- whose only membership was non-active had their couple crypto skipped
  -- entirely — leaving scope keys, pairings and a write floor behind for a
  -- couple that 029 then deleted, and `crypto_write_floor` has no foreign key
  -- to `couples` to clean it up by cascade.
  FOR v_couple IN
    SELECT cm.couple_id,
           EXISTS (
             SELECT 1 FROM public.couple_members o
              WHERE o.couple_id = cm.couple_id
                AND o.user_id <> p_user_id
           ) AS partner_remains
      FROM public.couple_members cm
     WHERE cm.user_id = p_user_id
     ORDER BY cm.couple_id
  LOOP
    v_couples_examined := v_couples_examined + 1;

    IF v_couple.partner_remains THEN
      -- Retained for the surviving member. Retention grants no access: couple
      -- epochs are readable only through
      -- `owner_couple_id = public.get_my_active_couple_id()`, which is NULL for
      -- a disconnected member, so a preserved key stays unreachable until and
      -- unless that membership becomes active again.
      v_any_partner_remains := true;
      CONTINUE;
    END IF;

    DELETE FROM public.crypto_pairings WHERE couple_id = v_couple.couple_id;
    DELETE FROM public.crypto_write_floor
     WHERE scope_kind = 'couple' AND scope_id = v_couple.couple_id;
    DELETE FROM public.scope_keys
     WHERE domain = 'couple' AND owner_couple_id = v_couple.couple_id;
    v_couples_cleaned := v_couples_cleaned + 1;
  END LOOP;

  PERFORM set_config('gomsinlog.e2ee_account_destruction', 'off', true);

  RETURN jsonb_build_object(
    'partner_remains', v_any_partner_remains,
    'couples_examined', v_couples_examined,
    'couples_cleaned', v_couples_cleaned,
    'deleted_envelopes', v_deleted_envelopes,
    'deleted_devices', v_deleted_devices,
    'deleted_scope_keys', v_deleted_scope_keys,
    'deleted_certificates', v_deleted_certs,
    'retained_certificates', v_retained_certs
  );
END;
$$;

COMMENT ON FUNCTION public.e2ee_prepare_account_deletion(UUID) IS
  'E2EE key-table deletion with recipient-scoped semantics. Couple-owned state is destroyed only when no other membership row survives, matching cleanup_account_solo_couples. Aborts rather than orphan an ACTIVE partner. Call before prepare_account_deletion().';

REVOKE ALL ON FUNCTION public.e2ee_prepare_account_deletion(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.e2ee_prepare_account_deletion(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Rollback: restore the 031 body verbatim. Do so only with the understanding
-- that it reintroduces the split-brain above — a deletion that preserves the
-- couple row for a non-active member while destroying the keys that make it
-- worth preserving. Nothing else in 037 changes signature, grants or ordering.
