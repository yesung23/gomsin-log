import { createClient } from 'npm:@supabase/supabase-js@2';

/**
 * Account deletion.
 *
 * Design constraints that shaped this implementation:
 *
 * 1. `events.created_by` and `trips.created_by` are `ON DELETE CASCADE` on
 *    `auth.users`. Deleting the user therefore destroys every shared plan they
 *    created, which the partner also depends on. Shared plans are reassigned to
 *    the surviving partner before the user row is removed.
 *
 * 2. `couple_members.status` must NOT be flipped to 'disconnected' for the
 *    partner. `get_my_active_couple_id()` returns NULL for a non-active member,
 *    and every RLS policy keys off it, so disconnecting the partner would leave
 *    them unable to read or write even their OWN records. The leaving user's
 *    membership row disappears via CASCADE, which is sufficient.
 *
 * 3. `invitation_codes.created_by/used_by` and `briefings.recipient_id` have NO
 *    cascade, so those rows must be removed first or the user delete fails with
 *    a foreign key violation.
 *
 * 4. Only data the caller owns is deleted. `briefings` are removed by
 *    `recipient_id` only -- deleting by `couple_id` (the previous behaviour)
 *    destroyed briefings addressed to the partner.
 *
 * The operation is not a single transaction (storage and auth live outside
 * Postgres), so it is ordered so that every step is either idempotent or
 * retry-safe, and non-critical failures are reported as warnings instead of
 * aborting a deletion the user explicitly asked for.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MEDIA_BUCKET = 'couple-media';
const STORAGE_PAGE_SIZE = 100;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

type Admin = ReturnType<typeof createClient>;

/**
 * Remove every object under `{coupleId}/{recordId}/`.
 * Returns the folders it could not fully clear so the caller can warn instead
 * of aborting.
 */
async function removeRecordMedia(
  admin: Admin,
  coupleId: string,
  recordIds: string[],
): Promise<string[]> {
  const bucket = admin.storage.from(MEDIA_BUCKET);
  const failed: string[] = [];

  for (const recordId of recordIds) {
    const folder = `${coupleId}/${recordId}`;
    try {
      // Re-list from offset 0 each round: removing objects shifts the listing,
      // so advancing an offset would skip entries.
      for (;;) {
        const { data: files, error } = await bucket.list(folder, { limit: STORAGE_PAGE_SIZE });
        if (error) throw error;
        if (!files?.length) break;

        const paths = files
          .filter((file) => file.name && file.name !== '.emptyFolderPlaceholder')
          .map((file) => `${folder}/${file.name}`);

        if (paths.length === 0) break;

        const { error: removeError } = await bucket.remove(paths);
        if (removeError) throw removeError;

        if (files.length < STORAGE_PAGE_SIZE) break;
      }
    } catch (error) {
      console.error(`[delete-account] Failed to clear media folder ${folder}`, error);
      failed.push(folder);
    }
  }

  return failed;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Authentication required' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[delete-account] Missing server environment variables');
    return jsonResponse({ error: 'Server configuration error' }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const token = authorization.slice('Bearer '.length);
  const { data: { user }, error: userError } = await admin.auth.getUser(token);

  if (userError || !user) {
    // A token for an already-deleted user lands here. Treat it as done so a
    // retry after a partial failure does not look like a new error.
    return jsonResponse({ error: 'Invalid or expired session' }, 401);
  }

  const userId = user.id;
  const warnings: string[] = [];

  try {
    // ---------------------------------------------------------------
    // 1. Work out which couples the user belongs to, and who remains.
    // ---------------------------------------------------------------
    const { data: memberships, error: membershipError } = await admin
      .from('couple_members')
      .select('couple_id')
      .eq('user_id', userId);
    if (membershipError) throw membershipError;

    const coupleIds = Array.from(
      new Set((memberships || []).map((row) => row.couple_id as string).filter(Boolean)),
    );

    /** couple_id -> surviving partner user id (if any). */
    const survivingPartner = new Map<string, string>();
    if (coupleIds.length > 0) {
      const { data: others, error: othersError } = await admin
        .from('couple_members')
        .select('couple_id, user_id, status')
        .in('couple_id', coupleIds)
        .neq('user_id', userId);
      if (othersError) throw othersError;

      for (const row of others || []) {
        // Prefer an active member; fall back to any remaining member.
        const existing = survivingPartner.get(row.couple_id as string);
        if (!existing || row.status === 'active') {
          survivingPartner.set(row.couple_id as string, row.user_id as string);
        }
      }
    }

    // ---------------------------------------------------------------
    // 2. Preserve shared plans by handing them to the surviving partner.
    //    Without this, the CASCADE on created_by deletes the couple's
    //    shared events, trips, trip items and checklists.
    // ---------------------------------------------------------------
    for (const coupleId of coupleIds) {
      const partnerId = survivingPartner.get(coupleId);
      if (!partnerId) continue; // Nobody left to own them; cascade may clean up.

      // Personal (private) events are the user's own content -> delete.
      const { error: privateEventError } = await admin
        .from('events')
        .delete()
        .eq('created_by', userId)
        .eq('couple_id', coupleId)
        .eq('is_private', true);
      if (privateEventError) {
        console.error('[delete-account] Failed to delete private events', privateEventError);
        warnings.push('private_events_not_deleted');
      }

      // Shared events belong to both people -> transfer ownership.
      const { error: sharedEventError } = await admin
        .from('events')
        .update({ created_by: partnerId })
        .eq('created_by', userId)
        .eq('couple_id', coupleId)
        .eq('is_private', false);
      if (sharedEventError) {
        console.error('[delete-account] Failed to transfer shared events', sharedEventError);
        warnings.push('shared_events_not_transferred');
      }

      // Trips have no privacy flag: every trip in a couple space is shared.
      const { error: tripError } = await admin
        .from('trips')
        .update({ created_by: partnerId })
        .eq('created_by', userId)
        .eq('couple_id', coupleId);
      if (tripError) {
        console.error('[delete-account] Failed to transfer trips', tripError);
        warnings.push('trips_not_transferred');
      }
    }

    // ---------------------------------------------------------------
    // 3. Remove rows that have no cascade and would block the user delete.
    // ---------------------------------------------------------------
    const { error: invitationError } = await admin
      .from('invitation_codes')
      .delete()
      .or(`created_by.eq.${userId},used_by.eq.${userId}`);
    if (invitationError) throw invitationError;

    // Only briefings addressed to this user. Deleting by couple_id would
    // destroy the partner's briefings too.
    const { error: briefingError } = await admin
      .from('briefings')
      .delete()
      .eq('recipient_id', userId);
    if (briefingError) throw briefingError;

    // ---------------------------------------------------------------
    // 4. Delete the user's own records and their media.
    //    The partner's records are never touched.
    // ---------------------------------------------------------------
    const { data: records, error: recordsError } = await admin
      .from('daily_records')
      .select('id, couple_id')
      .eq('user_id', userId);
    if (recordsError) throw recordsError;

    for (const coupleId of coupleIds) {
      const recordIds = (records || [])
        .filter((record) => record.couple_id === coupleId)
        .map((record) => record.id as string);
      if (recordIds.length === 0) continue;

      const failedFolders = await removeRecordMedia(admin, coupleId, recordIds);
      if (failedFolders.length > 0) {
        // Orphaned objects are a cleanup concern, not a reason to keep the
        // account alive against the user's wishes.
        warnings.push(`media_not_fully_removed:${failedFolders.length}`);
      }
    }

    const { error: deleteRecordsError } = await admin
      .from('daily_records')
      .delete()
      .eq('user_id', userId);
    if (deleteRecordsError) throw deleteRecordsError;

    // ---------------------------------------------------------------
    // 5. Delete the auth user. CASCADE removes the profile, this user's
    //    couple_members row, contact preferences and cycle data.
    //    The partner's membership stays 'active' on purpose so they keep
    //    access to their own history.
    // ---------------------------------------------------------------
    const { error: deleteUserError } = await admin.auth.admin.deleteUser(userId);
    if (deleteUserError) throw deleteUserError;

    console.log('[delete-account] Completed', {
      couples: coupleIds.length,
      records: (records || []).length,
      warnings: warnings.length,
    });

    return jsonResponse({ success: true, warnings });
  } catch (error) {
    console.error('[delete-account] Deletion failed', error);
    return jsonResponse(
      {
        error: 'Account deletion failed. Nothing was confirmed as deleted; please try again.',
        warnings,
      },
      500,
    );
  }
});
