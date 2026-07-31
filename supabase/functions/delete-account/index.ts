import { createClient } from 'npm:@supabase/supabase-js@2';

/**
 * Account deletion is deliberately split across service boundaries:
 *
 * 1. Enumerate the caller's daily records and completely remove their Storage
 *    objects. A listing/removal failure aborts before relational/auth changes.
 * 2. Call the service-role-only prepare_account_deletion RPC. It verifies that
 *    the record set did not change, locks couple rows first, transfers shared
 *    plan ownership, removes private/blocking rows, and deletes records in one
 *    database transaction.
 * 3. Delete the Auth user only after database preparation succeeds.
 *
 * Storage, Postgres, and Auth cannot share one transaction. Every phase is
 * retry-safe, but a failed later phase may follow a completed media cleanup.
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
type RecordMediaScope = { id: string; couple_id: string };

/**
 * Remove and then confirm the absence of every object under each record path.
 * Re-listing offset zero after every batch avoids skipped entries after delete.
 */
async function removeAndConfirmRecordMedia(
  admin: Admin,
  records: RecordMediaScope[],
): Promise<void> {
  const bucket = admin.storage.from(MEDIA_BUCKET);

  for (const record of records) {
    const folder = `${record.couple_id}/${record.id}`;

    for (;;) {
      const { data: files, error: listError } = await bucket.list(folder, {
        limit: STORAGE_PAGE_SIZE,
        offset: 0,
      });
      if (listError) {
        throw new Error(`Unable to list media folder ${folder}: ${listError.message}`);
      }
      if (!files?.length) break;

      const paths = files
        .filter((file) => Boolean(file.name))
        .map((file) => `${folder}/${file.name}`);
      if (paths.length !== files.length) {
        throw new Error(`Unable to identify every object in media folder ${folder}`);
      }

      const { error: removeError } = await bucket.remove(paths);
      if (removeError) {
        throw new Error(`Unable to clear media folder ${folder}: ${removeError.message}`);
      }
      // Always re-list, including short batches, to confirm Storage accepted
      // every removal rather than treating a successful request as proof.
    }
  }
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
    return jsonResponse({ error: 'Invalid or expired session' }, 401);
  }

  const userId = user.id;
  let deletionMarkerStarted = false;
  let databasePreparationCompleted = false;

  try {
    // Read-only preflight. These exact IDs are passed to the transactional RPC,
    // which fails closed if a record appeared/disappeared during media cleanup.
    const { data: recordRows, error: recordsError } = await admin
      .from('daily_records')
      .select('id, couple_id')
      .eq('user_id', userId);
    if (recordsError) throw recordsError;

    const records = (recordRows || []) as RecordMediaScope[];

    // This marker is non-destructive. Migration 015's Storage INSERT policy
    // uses it to close the upload race while media is being removed/confirmed.
    const { error: beginError } = await admin.rpc('begin_account_deletion', {
      p_user_id: userId,
      p_expected_record_ids: records.map((record) => record.id),
    });
    if (beginError) throw beginError;
    deletionMarkerStarted = true;

    try {
      await removeAndConfirmRecordMedia(admin, records);
    } catch (mediaError) {
      const { error: cancelError } = await admin.rpc('cancel_account_deletion', {
        p_user_id: userId,
      });
      if (cancelError) {
        console.error('[delete-account] Failed to clear deletion marker', cancelError);
      } else {
        deletionMarkerStarted = false;
      }
      console.error('[delete-account] Media cleanup failed; database untouched', mediaError);
      return jsonResponse(
        {
          error: 'Account deletion failed because stored media could not be fully removed. Please try again.',
          warnings: [],
        },
        500,
      );
    }

    // Migration 015 owns all destructive relational work. In particular,
    // ownership transfer is no longer a best-effort direct table update: an
    // RPC error aborts before auth deletion, preventing ON DELETE CASCADE from
    // destroying shared events or trips.
    const { data: preparation, error: preparationError } = await admin.rpc(
      'prepare_account_deletion',
      {
        p_user_id: userId,
        p_expected_record_ids: records.map((record) => record.id),
      },
    );
    if (preparationError) throw preparationError;
    if (!preparation || preparation.ok !== true) {
      throw new Error('Account deletion database preparation did not confirm success');
    }
    databasePreparationCompleted = true;

    const { error: deleteUserError } = await admin.auth.admin.deleteUser(userId);
    if (deleteUserError) throw deleteUserError;

    console.log('[delete-account] Completed', {
      records: records.length,
      preparation,
    });

    return jsonResponse({ success: true, warnings: [] });
  } catch (error) {
    if (deletionMarkerStarted && !databasePreparationCompleted) {
      const { error: cancelError } = await admin.rpc('cancel_account_deletion', {
        p_user_id: userId,
      });
      if (cancelError) {
        console.error('[delete-account] Failed to clear deletion marker', cancelError);
      }
    }
    console.error('[delete-account] Deletion failed', error);
    return jsonResponse(
      {
        error: 'Account deletion failed. Please try again.',
        warnings: [],
      },
      500,
    );
  }
});
