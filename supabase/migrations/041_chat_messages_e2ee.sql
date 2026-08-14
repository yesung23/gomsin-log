-- =============================================================
-- 041_chat_messages_e2ee.sql
-- V1 text chat: minimal metadata, CSK/GLE1 ciphertext, RLS and tombstones.
-- =============================================================
--
-- The message body never has a plaintext column. The only content column is a
-- nullable GLE1 envelope: non-NULL means a live message and NULL means the
-- sender's irreversible delete-for-both tombstone. The database reads only the
-- fixed GLE1 header needed to require the couple's ACTIVE epoch; it never opens
-- the envelope or sees message text.

BEGIN;

CREATE TABLE IF NOT EXISTS public.chat_messages (
  message_id UUID PRIMARY KEY,
  couple_id UUID NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  sender_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ciphertext BYTEA,
  ordinal BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chat_messages_ciphertext_size CHECK (
    ciphertext IS NULL OR octet_length(ciphertext) >= 108
  )
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_couple_ordinal
  ON public.chat_messages (couple_id, ordinal DESC);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- The trigger is the server-side write contract. It validates the public GLE1
-- header, binds new messages to the live couple epoch, assigns server order,
-- and permits exactly one mutation: live ciphertext -> NULL tombstone.
CREATE OR REPLACE FUNCTION public.enforce_chat_message_contract()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_header_epoch NUMERIC;
  v_last_ordinal BIGINT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- The authenticated caller cannot choose the sender identity. A service
    -- role may seed/operate rows explicitly, but it is not a client path.
    IF v_uid IS NOT NULL THEN
      NEW.sender_user_id := v_uid;
    END IF;
    IF NEW.sender_user_id IS NULL THEN
      RAISE EXCEPTION 'CHAT_SENDER_REQUIRED: a live message needs a sender'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.ciphertext IS NULL THEN
      RAISE EXCEPTION 'CHAT_CIPHERTEXT_REQUIRED: INSERT cannot create a tombstone'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF octet_length(NEW.ciphertext) < 108 THEN
      RAISE EXCEPTION 'CHAT_CIPHERTEXT_TRUNCATED: a GLE1 envelope is at least 108 bytes'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- GLE1 fixed header: magic 0..3, format 4, protocol 5, suite 6,
    -- domain 7, key_epoch u64 big-endian 12..19.
    IF substr(NEW.ciphertext, 1, 4) <> '\x474c4531'::BYTEA THEN
      RAISE EXCEPTION 'CHAT_GLE1_MAGIC: ciphertext is not a GLE1 envelope'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF get_byte(NEW.ciphertext, 4) <> 1
       OR get_byte(NEW.ciphertext, 5) <> 1
       OR get_byte(NEW.ciphertext, 6) <> 1 THEN
      RAISE EXCEPTION 'CHAT_GLE1_VERSION: unsupported GLE1 protocol or suite'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF get_byte(NEW.ciphertext, 7) <> 3 THEN
      RAISE EXCEPTION 'CHAT_DOMAIN_REQUIRED: chat content must use the couple domain'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    v_header_epoch :=
        get_byte(NEW.ciphertext, 12)::NUMERIC * 72057594037927936
      + get_byte(NEW.ciphertext, 13)::NUMERIC * 281474976710656
      + get_byte(NEW.ciphertext, 14)::NUMERIC * 1099511627776
      + get_byte(NEW.ciphertext, 15)::NUMERIC * 4294967296
      + get_byte(NEW.ciphertext, 16)::NUMERIC * 16777216
      + get_byte(NEW.ciphertext, 17)::NUMERIC * 65536
      + get_byte(NEW.ciphertext, 18)::NUMERIC * 256
      + get_byte(NEW.ciphertext, 19)::NUMERIC;

    -- The header's epoch is compared to server-held ACTIVE scope state. No
    -- caller-controlled epoch column exists to become a second source of truth.
    IF NOT EXISTS (
      SELECT 1
      FROM public.scope_keys sk
      WHERE sk.domain = 'couple'
        AND sk.owner_couple_id = NEW.couple_id
        AND sk.state = 'ACTIVE'
        AND sk.key_epoch::NUMERIC = v_header_epoch
    ) THEN
      RAISE EXCEPTION 'CHAT_STALE_EPOCH: ciphertext does not name the couple ACTIVE epoch'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- This is an independent server invariant for service-role/definer paths.
    -- Normal authenticated writes are also required to pass the RLS predicate.
    IF NOT EXISTS (
      SELECT 1
      FROM public.couple_members cm
      WHERE cm.couple_id = NEW.couple_id
        AND cm.user_id = NEW.sender_user_id
        AND cm.status = 'active'
    ) THEN
      RAISE EXCEPTION 'CHAT_ACTIVE_MEMBER_REQUIRED: sender is not an active member'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    -- Serialize only writers for this couple. A global identity sequence would
    -- expose unrelated-couple traffic and MAX without a lock would duplicate
    -- ordinals under concurrent senders.
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.couple_id::TEXT, 0));
    SELECT COALESCE(MAX(ordinal), 0) INTO v_last_ordinal
    FROM public.chat_messages
    WHERE couple_id = NEW.couple_id;
    IF v_last_ordinal = 9223372036854775807 THEN
      RAISE EXCEPTION 'CHAT_ORDINAL_EXHAUSTED: couple message order is exhausted'
        USING ERRCODE = 'numeric_value_out_of_range';
    END IF;
    NEW.ordinal := v_last_ordinal + 1;
    NEW.created_at := now();
    RETURN NEW;
  END IF;

  -- Account deletion drives the sender FK to NULL. This is not a client
  -- message mutation: the ciphertext (live or tombstone) and every ordering
  -- field stay byte-for-byte unchanged. Allowing this transition is what lets
  -- the surviving partner retain shared history without retaining a deleted
  -- Auth user as its sender identity.
  IF NEW.sender_user_id IS NULL
     AND OLD.sender_user_id IS NOT NULL
     AND NEW.message_id IS NOT DISTINCT FROM OLD.message_id
     AND NEW.couple_id IS NOT DISTINCT FROM OLD.couple_id
     AND NEW.ciphertext IS NOT DISTINCT FROM OLD.ciphertext
     AND NEW.ordinal IS NOT DISTINCT FROM OLD.ordinal
     AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at THEN
    RETURN NEW;
  END IF;

  -- Tombstone is the sole permitted UPDATE. RLS separately limits it to the
  -- original sender; these checks also protect service-role/definer paths.
  IF OLD.ciphertext IS NULL THEN
    RAISE EXCEPTION 'CHAT_TOMBSTONE_IMMUTABLE: a tombstone cannot be updated'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.ciphertext IS NOT NULL THEN
    RAISE EXCEPTION 'CHAT_MESSAGE_IMMUTABLE: V1 messages cannot be edited or restored'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.message_id IS DISTINCT FROM OLD.message_id
     OR NEW.couple_id IS DISTINCT FROM OLD.couple_id
     OR NEW.sender_user_id IS DISTINCT FROM OLD.sender_user_id
     OR NEW.ordinal IS DISTINCT FROM OLD.ordinal
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'CHAT_TOMBSTONE_IDENTITY: tombstone may change ciphertext only'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_chat_message_contract() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_chat_messages_contract ON public.chat_messages;
CREATE TRIGGER trg_chat_messages_contract
  BEFORE INSERT OR UPDATE ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_chat_message_contract();

DROP POLICY IF EXISTS "Active members read chat messages" ON public.chat_messages;
CREATE POLICY "Active members read chat messages"
  ON public.chat_messages FOR SELECT TO authenticated
  USING (couple_id = public.get_my_active_couple_id());

DROP POLICY IF EXISTS "Active members send chat messages" ON public.chat_messages;
CREATE POLICY "Active members send chat messages"
  ON public.chat_messages FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND couple_id = public.get_my_active_couple_id()
    AND sender_user_id = auth.uid()
    AND ciphertext IS NOT NULL
  );

DROP POLICY IF EXISTS "Authors tombstone own chat messages" ON public.chat_messages;
CREATE POLICY "Authors tombstone own chat messages"
  ON public.chat_messages FOR UPDATE TO authenticated
  USING (
    couple_id = public.get_my_active_couple_id()
    AND sender_user_id = auth.uid()
    AND ciphertext IS NOT NULL
  )
  WITH CHECK (
    couple_id = public.get_my_active_couple_id()
    AND sender_user_id = auth.uid()
    AND ciphertext IS NULL
  );

-- Column grants are part of the boundary, not a convenience. The client can
-- never submit sender/ordinal/created_at or rewrite identity columns, and it
-- can update only ciphertext for the sender-only tombstone transition.
REVOKE ALL ON TABLE public.chat_messages FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.chat_messages TO authenticated;
GRANT INSERT (message_id, couple_id, ciphertext) ON public.chat_messages TO authenticated;
GRANT UPDATE (ciphertext) ON public.chat_messages TO authenticated;
GRANT SELECT ON TABLE public.chat_messages TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
