-- 073_authoritative_relationship_snapshot.sql
-- One read-only statement binds the caller, relationship generation, revision,
-- exact active partner, allowlisted presentation/service fields, and lifecycle.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_my_relationship_snapshot_v2()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_snapshot JSONB;
  v_topology_invalid BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  -- All relation reads live in this single statement. Under PostgreSQL's
  -- statement snapshot, identity and presentation cannot come from different
  -- relationship generations even if membership changes concurrently.
  WITH
  owner_memberships AS MATERIALIZED (
    SELECT
      owner_member.id,
      owner_member.couple_id,
      owner_member.role,
      owner_member.status,
      owner_member.joined_at
    FROM public.couple_members AS owner_member
    WHERE owner_member.user_id = v_uid
  ),
  owner_counts AS (
    SELECT
      count(*)::INTEGER AS owner_membership_count,
      count(*) FILTER (WHERE owner_memberships.status = 'active')::INTEGER
        AS owner_active_count,
      count(*) FILTER (WHERE owner_memberships.status = 'pending')::INTEGER
        AS owner_pending_count
    FROM owner_memberships
  ),
  selected_membership AS MATERIALIZED (
    SELECT
      owner_memberships.id,
      owner_memberships.couple_id,
      owner_memberships.role,
      owner_memberships.status,
      owner_memberships.joined_at
    FROM owner_memberships
    ORDER BY
      (owner_memberships.status = 'active') DESC,
      owner_memberships.joined_at DESC,
      owner_memberships.id DESC
    LIMIT 1
  ),
  selected_couple AS MATERIALIZED (
    SELECT
      relationship.id,
      relationship.membership_revision
    FROM selected_membership
    JOIN public.couples AS relationship
      ON relationship.id = selected_membership.couple_id
  ),
  active_members AS MATERIALIZED (
    SELECT
      active_member.user_id,
      active_member.role,
      active_member.joined_at
    FROM selected_membership
    JOIN public.couple_members AS active_member
      ON active_member.couple_id = selected_membership.couple_id
     AND active_member.status = 'active'
  ),
  active_counts AS (
    SELECT
      count(*)::INTEGER AS active_member_count,
      count(*) FILTER (WHERE active_members.user_id = v_uid)::INTEGER
        AS self_active_count,
      count(*) FILTER (WHERE active_members.user_id <> v_uid)::INTEGER
        AS partner_active_count
    FROM active_members
  ),
  partner_rows AS MATERIALIZED (
    SELECT
      partner_member.user_id,
      partner_member.joined_at,
      partner_profile.display_name,
      partner_profile.role,
      partner_profile.avatar_path,
      partner_profile.username,
      selected_membership.role = 'gomsin'
        AND partner_member.role = 'soldier' AS may_expose_service,
      partner_profile.military_info ->> 'branch' AS service_branch,
      partner_profile.military_info ->> 'militaryStatus' AS service_status,
      partner_profile.military_info ->> 'enlistmentDate' AS service_enlistment_date,
      partner_profile.military_info ->> 'expectedDischargeDate'
        AS service_expected_discharge_date,
      partner_profile.military_info ->> 'dischargeDate' AS service_discharge_date,
      partner_profile.military_info ->> 'dischargeDateSource'
        AS service_discharge_date_source
    FROM selected_membership
    JOIN public.couple_members AS partner_member
      ON partner_member.couple_id = selected_membership.couple_id
     AND partner_member.status = 'active'
     AND partner_member.user_id <> v_uid
    JOIN public.profiles AS partner_profile ON partner_profile.id = partner_member.user_id
  ),
  partner_counts AS (
    SELECT count(*)::INTEGER AS partner_row_count
    FROM partner_rows
  ),
  invitation_rows AS MATERIALIZED (
    SELECT invitation.expires_at
    FROM selected_membership
    JOIN public.invitation_codes AS invitation
      ON invitation.couple_id = selected_membership.couple_id
    WHERE selected_membership.status = 'active'
      AND invitation.used = false
      AND invitation.expires_at > CURRENT_TIMESTAMP
  ),
  invitation_counts AS (
    SELECT
      count(*)::INTEGER AS invitation_row_count,
      max(invitation_rows.expires_at) AS invitation_expires_at
    FROM invitation_rows
  ),
  derived_state AS (
    SELECT
      owner_counts.owner_membership_count,
      owner_counts.owner_active_count,
      owner_counts.owner_pending_count,
      active_counts.active_member_count,
      active_counts.self_active_count,
      active_counts.partner_active_count,
      partner_counts.partner_row_count,
      invitation_counts.invitation_row_count,
      invitation_counts.invitation_expires_at,
      CASE
        WHEN owner_counts.owner_membership_count = 0 THEN 'personal'
        WHEN owner_counts.owner_active_count = 0
          AND owner_counts.owner_pending_count = 0 THEN 'disconnected'
        WHEN owner_counts.owner_active_count = 1
          AND active_counts.active_member_count = 1
          AND active_counts.self_active_count = 1
          AND active_counts.partner_active_count = 0 THEN 'pending'
        WHEN owner_counts.owner_active_count = 1
          AND active_counts.active_member_count = 2
          AND active_counts.self_active_count = 1
          AND active_counts.partner_active_count = 1 THEN 'active'
        ELSE NULL
      END AS lifecycle
    FROM owner_counts
    CROSS JOIN active_counts
    CROSS JOIN partner_counts
    CROSS JOIN invitation_counts
  ),
  service_payload AS (
    SELECT
      CASE
        WHEN partner_rows.may_expose_service THEN jsonb_build_object(
          'branch', partner_rows.service_branch,
          'military_status', partner_rows.service_status,
          'enlistment_date', partner_rows.service_enlistment_date,
          'expected_discharge_date', partner_rows.service_expected_discharge_date,
          'discharge_date', partner_rows.service_discharge_date,
          'discharge_date_source', partner_rows.service_discharge_date_source
        )
        ELSE NULL
      END AS service
    FROM partner_rows
  ),
  partner_payload AS (
    SELECT jsonb_build_object(
      'user_id', partner_rows.user_id,
      'joined_at', partner_rows.joined_at,
      'display_name', partner_rows.display_name,
      'role', partner_rows.role,
      'avatar_path', partner_rows.avatar_path,
      'username', partner_rows.username,
      'service', (SELECT service_payload.service FROM service_payload)
    ) AS partner
    FROM partner_rows
  ),
  finalized AS (
    SELECT
      (
        derived_state.owner_active_count > 1
        OR derived_state.owner_pending_count > 0
        OR derived_state.lifecycle IS NULL
        OR (
          derived_state.owner_membership_count > 0
          AND selected_couple.id IS NULL
        )
        OR (
          derived_state.lifecycle = 'disconnected'
          AND derived_state.active_member_count <> 0
        )
        OR (
          derived_state.lifecycle = 'active'
          AND derived_state.partner_row_count <> 1
        )
        OR (
          derived_state.lifecycle = 'pending'
          AND derived_state.invitation_row_count > 1
        )
      ) AS topology_invalid,
      jsonb_build_object(
        'contract_version', 2,
        'owner_user_id', v_uid,
        'lifecycle', derived_state.lifecycle,
        'couple_id', CASE
          WHEN derived_state.lifecycle = 'personal' THEN NULL
          ELSE selected_couple.id
        END,
        'relation_revision', selected_couple.membership_revision::text,
        'partner', CASE
          WHEN derived_state.lifecycle = 'active'
            THEN (SELECT partner_payload.partner FROM partner_payload)
          ELSE NULL
        END,
        'invitation_active',
          derived_state.lifecycle = 'pending'
          AND derived_state.invitation_row_count = 1,
        'invitation_expires_at', CASE
          WHEN derived_state.lifecycle = 'pending'
            AND derived_state.invitation_row_count = 1
            THEN derived_state.invitation_expires_at
          ELSE NULL
        END
      ) AS snapshot
    FROM derived_state
    LEFT JOIN selected_couple ON true
  )
  SELECT finalized.topology_invalid, finalized.snapshot
  INTO v_topology_invalid, v_snapshot
  FROM finalized;

  IF v_topology_invalid THEN
    RAISE EXCEPTION 'relationship_topology_invalid' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_snapshot;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_relationship_snapshot_v2()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_relationship_snapshot_v2()
  TO authenticated;

COMMENT ON FUNCTION public.get_my_relationship_snapshot_v2() IS
  'Version 2 authoritative relationship snapshot for auth.uid(). One statement '
  'binds lifecycle, immutable couple generation, revision text, exact partner, '
  'allowlisted presentation/service fields, and invitation validity.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ROLLBACK:
--   A later forward migration may revoke EXECUTE and drop this additive v2 RPC.
--   No table data, policy, or existing RPC is changed by migration 073.
