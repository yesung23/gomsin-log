-- 058_couple_highlights.sql
-- Shared, user-curated Instagram-like highlight collections.
--
-- The collection stores only record ids. A highlight can reference a record only
-- while that record is shared, and the child RLS policy hides an item immediately
-- when the author changes it back to private. No record body or media path is
-- copied into this model.

BEGIN;

CREATE TABLE IF NOT EXISTS public.couple_highlights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id UUID NOT NULL REFERENCES public.couples(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 20),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.couple_highlight_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  highlight_id UUID NOT NULL REFERENCES public.couple_highlights(id) ON DELETE CASCADE,
  record_id UUID NOT NULL REFERENCES public.daily_records(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT couple_highlight_items_unique_record UNIQUE (highlight_id, record_id),
  CONSTRAINT couple_highlight_items_unique_order UNIQUE (highlight_id, sort_order)
);

CREATE INDEX IF NOT EXISTS couple_highlights_couple_order_idx
  ON public.couple_highlights (couple_id, sort_order, created_at);

ALTER TABLE public.couple_highlights ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.couple_highlight_items ENABLE ROW LEVEL SECURITY;

-- The invalidation row is content-free realtime metadata. Extend the existing
-- allow-list before either trigger can emit the new slice.
ALTER TABLE public.collaboration_invalidations
  DROP CONSTRAINT IF EXISTS collaboration_invalidations_slice_check;
ALTER TABLE public.collaboration_invalidations
  ADD CONSTRAINT collaboration_invalidations_slice_check
  CHECK (slice IN ('events', 'cycle_support', 'talk_about', 'highlights', 'profile'));

DROP POLICY IF EXISTS "Active members can view couple highlights" ON public.couple_highlights;
CREATE POLICY "Active members can view couple highlights"
  ON public.couple_highlights FOR SELECT
  TO authenticated
  USING (couple_id = public.get_my_active_couple_id());

DROP POLICY IF EXISTS "Active members can delete couple highlights" ON public.couple_highlights;
CREATE POLICY "Active members can delete couple highlights"
  ON public.couple_highlights FOR DELETE
  TO authenticated
  USING (couple_id = public.get_my_active_couple_id());

DROP POLICY IF EXISTS "Active members can view shared highlight items" ON public.couple_highlight_items;
CREATE POLICY "Active members can view shared highlight items"
  ON public.couple_highlight_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.couple_highlights h
      JOIN public.daily_records r ON r.id = couple_highlight_items.record_id
      WHERE h.id = couple_highlight_items.highlight_id
        AND h.couple_id = public.get_my_active_couple_id()
        AND r.couple_id = h.couple_id
        AND r.is_private = false
    )
  );

REVOKE ALL ON TABLE public.couple_highlights FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.couple_highlight_items FROM PUBLIC, anon;
GRANT SELECT, DELETE ON TABLE public.couple_highlights TO authenticated;
GRANT SELECT ON TABLE public.couple_highlight_items TO authenticated;

DROP FUNCTION IF EXISTS public.save_couple_highlight(uuid, uuid, text, uuid, uuid[], integer);
DROP FUNCTION IF EXISTS public.save_couple_highlight(uuid, uuid, text, uuid[], integer);
DROP FUNCTION IF EXISTS public.save_couple_highlight(uuid, text, uuid[], integer);
CREATE FUNCTION public.save_couple_highlight(
  p_highlight_id UUID,
  p_title TEXT,
  p_record_ids UUID[],
  p_sort_order INTEGER
)
RETURNS public.couple_highlights
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_active_couple UUID;
  v_highlight public.couple_highlights;
  v_requested_count INTEGER;
  v_distinct_count INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  IF public.is_my_account_deletion_pending() THEN
    RAISE EXCEPTION 'account_deletion_pending' USING ERRCODE = '42501';
  END IF;

  v_active_couple := public.get_my_active_couple_id();
  IF v_active_couple IS NULL THEN
    RAISE EXCEPTION 'inactive_couple' USING ERRCODE = '42501';
  END IF;
  -- Serialize highlight writes against disconnect and re-check membership after
  -- acquiring the same parent lock used by disconnect_couple().
  PERFORM 1 FROM public.couples WHERE id = v_active_couple FOR UPDATE;
  IF NOT EXISTS (
    SELECT 1 FROM public.couple_members
    WHERE couple_id = v_active_couple
      AND user_id = v_uid
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'inactive_couple' USING ERRCODE = '42501';
  END IF;

  IF p_title IS NULL OR char_length(btrim(p_title)) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'invalid_highlight_title' USING ERRCODE = '22023';
  END IF;
  IF p_record_ids IS NULL OR cardinality(p_record_ids) < 1 OR cardinality(p_record_ids) > 50 THEN
    RAISE EXCEPTION 'invalid_highlight_items' USING ERRCODE = '22023';
  END IF;

  SELECT cardinality(p_record_ids), count(DISTINCT requested.record_id)
    INTO v_requested_count, v_distinct_count
  FROM unnest(p_record_ids) AS requested(record_id);
  IF v_requested_count <> v_distinct_count THEN
    RAISE EXCEPTION 'duplicate_highlight_items' USING ERRCODE = '22023';
  END IF;

  -- SECURITY DEFINER sees the full table, so this check is independent of the
  -- caller's own/partner RLS path and cannot be weakened by a broad subquery.
  IF EXISTS (
    SELECT 1
    FROM unnest(p_record_ids) AS requested(record_id)
    LEFT JOIN public.daily_records r ON r.id = requested.record_id
    WHERE r.id IS NULL
      OR r.couple_id <> v_active_couple
      OR r.is_private = true
  ) THEN
    RAISE EXCEPTION 'highlight_record_not_shared' USING ERRCODE = '42501';
  END IF;

  IF p_highlight_id IS NULL THEN
    INSERT INTO public.couple_highlights (couple_id, title, sort_order)
    VALUES (v_active_couple, btrim(p_title), greatest(coalesce(p_sort_order, 0), 0))
    RETURNING * INTO v_highlight;
  ELSE
    UPDATE public.couple_highlights
       SET title = btrim(p_title),
           sort_order = greatest(coalesce(p_sort_order, 0), 0),
           updated_at = now()
     WHERE id = p_highlight_id
       AND couple_id = v_active_couple
    RETURNING * INTO v_highlight;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'highlight_not_found' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- The first item is the cover. Reordering the selected ids changes the cover
  -- without adding a second record-id column that could outlive child RLS.
  DELETE FROM public.couple_highlight_items WHERE highlight_id = v_highlight.id;
  INSERT INTO public.couple_highlight_items (highlight_id, record_id, sort_order)
  SELECT v_highlight.id, requested.record_id, requested.ordinality - 1
  FROM unnest(p_record_ids) WITH ORDINALITY AS requested(record_id, ordinality);

  RETURN v_highlight;
END;
$$;

REVOKE ALL ON FUNCTION public.save_couple_highlight(uuid, text, uuid[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_couple_highlight(uuid, text, uuid[], integer) TO authenticated;

DROP TRIGGER IF EXISTS emit_highlight_collaboration_invalidation ON public.couple_highlights;
CREATE TRIGGER emit_highlight_collaboration_invalidation
  AFTER INSERT OR UPDATE OR DELETE ON public.couple_highlights
  FOR EACH ROW EXECUTE FUNCTION public.emit_collaboration_invalidation('highlights');

-- A record can become private or disappear after it has been selected into a
-- highlight. Remove that child in the same transaction; otherwise a later
-- shared transition would silently resurrect an old selection.
CREATE OR REPLACE FUNCTION public.prune_highlight_items_for_record()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_record_id UUID := OLD.id;
  v_highlight_ids UUID[];
BEGIN
  IF TG_OP = 'DELETE' OR (OLD.is_private = false AND NEW.is_private = true) THEN
    SELECT COALESCE(array_agg(DISTINCT h.id), ARRAY[]::UUID[])
      INTO v_highlight_ids
    FROM public.couple_highlights h
    JOIN public.couple_highlight_items i ON i.highlight_id = h.id
    WHERE i.record_id = v_record_id;

    DELETE FROM public.couple_highlight_items WHERE record_id = v_record_id;

    UPDATE public.couple_highlights
       SET updated_at = now()
     WHERE id = ANY(v_highlight_ids);

    DELETE FROM public.couple_highlights h
     WHERE h.id = ANY(v_highlight_ids)
       AND NOT EXISTS (
         SELECT 1 FROM public.couple_highlight_items i WHERE i.highlight_id = h.id
       );
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.prune_highlight_items_for_record() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS prune_highlight_items_on_record ON public.daily_records;
CREATE TRIGGER prune_highlight_items_on_record
  BEFORE UPDATE OF is_private OR DELETE ON public.daily_records
  FOR EACH ROW EXECUTE FUNCTION public.prune_highlight_items_for_record();

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ROLLBACK (after a backup and only with an agreed data-retention plan):
--   DROP TRIGGER IF EXISTS emit_highlight_collaboration_invalidation ON public.couple_highlights;
--   DROP TRIGGER IF EXISTS prune_highlight_items_on_record ON public.daily_records;
--   DROP FUNCTION IF EXISTS public.prune_highlight_items_for_record();
--   DROP FUNCTION IF EXISTS public.save_couple_highlight(uuid, text, uuid[], integer);
--   DROP TABLE IF EXISTS public.couple_highlight_items;
--   DROP TABLE IF EXISTS public.couple_highlights;
