-- 063_partner_service_projection.sql
-- Let a gomsin see only the active soldier partner's service timeline.
-- The free-form military memo and the owner-only profiles row stay private.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_partner_service_info()
RETURNS TABLE (
  branch TEXT,
  military_status TEXT,
  enlistment_date TEXT,
  expected_discharge_date TEXT,
  discharge_date TEXT,
  discharge_date_source TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    p.military_info ->> 'branch',
    p.military_info ->> 'militaryStatus',
    p.military_info ->> 'enlistmentDate',
    p.military_info ->> 'expectedDischargeDate',
    p.military_info ->> 'dischargeDate',
    p.military_info ->> 'dischargeDateSource'
  FROM public.couple_members caller_cm
  JOIN public.couple_members partner_cm
    ON partner_cm.couple_id = caller_cm.couple_id
   AND partner_cm.user_id <> caller_cm.user_id
  JOIN public.profiles p ON p.id = partner_cm.user_id
  WHERE caller_cm.user_id = v_uid
    AND caller_cm.status = 'active'
    AND caller_cm.role = 'gomsin'
    AND partner_cm.status = 'active'
    AND partner_cm.role = 'soldier'
    AND (
      SELECT count(*)
      FROM public.couple_members active_cm
      WHERE active_cm.couple_id = caller_cm.couple_id
        AND active_cm.status = 'active'
    ) = 2
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_partner_service_info() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_partner_service_info() TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ROLLBACK:
--   BEGIN;
--   DROP FUNCTION IF EXISTS public.get_partner_service_info();
--   NOTIFY pgrst, 'reload schema';
--   COMMIT;
