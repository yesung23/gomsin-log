import { parseAllowedOrigins, resolveCors } from '../_shared/cors.ts';

/**
 * Account deletion is deliberately split across service boundaries:
 *
 * 0. Resolve CORS against an explicit allowlist and refuse any origin that is
 *    not on it, before any authentication or admin-client work.
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
 *
 * The request handling lives in this module rather than in `index.ts` purely so
 * that it can be exercised by the test suite: `index.ts` stays a thin Deno
 * entrypoint that injects `Deno.env` and the service-role client. The deletion
 * sequence itself is unchanged -- every step, every constant, same order.
 */

const MEDIA_BUCKET = 'couple-media';
const STORAGE_PAGE_SIZE = 100;
/**
 * Bound on the remove-then-confirm cycle per record folder.
 *
 * Storage reports a successful removal for entries it did not actually delete,
 * so confirmation has to be a re-listing. Without a cap, anything Storage keeps
 * returning turns that into an endless loop that the platform eventually kills
 * mid-deletion.
 */
const MAX_STORAGE_ROUNDS = 20;
/** Guard against a pathological prefix chain while descending a record folder. */
const MAX_STORAGE_DEPTH = 8;
/** Attempts for the Auth deletion, which is the only step with no rollback. */
const AUTH_DELETE_ATTEMPTS = 3;

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  corsHeaders: Record<string, string>,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

type Admin = any;
type RecordMediaScope = { id: string; couple_id: string };

type Bucket = any;
type StorageEntry = { name: string; id: string | null };

export type HandlerDeps = {
  env: (key: string) => string | undefined;
  createAdmin: (url: string, serviceRoleKey: string) => Admin;
};

/** Every entry directly under `folder`, across all pages. */
async function listFolderEntries(bucket: Bucket, folder: string): Promise<StorageEntry[]> {
  const entries: StorageEntry[] = [];
  for (let offset = 0; ; offset += STORAGE_PAGE_SIZE) {
    const { data, error } = await bucket.list(folder, {
      limit: STORAGE_PAGE_SIZE,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) {
      throw new Error(`Unable to list media folder ${folder}: ${error.message}`);
    }
    if (!data?.length) break;
    for (const entry of data) {
      if (!entry.name) {
        throw new Error(`Unable to identify every object in media folder ${folder}`);
      }
      entries.push({ name: entry.name, id: entry.id ?? null });
    }
    if (data.length < STORAGE_PAGE_SIZE) break;
  }
  return entries;
}

/**
 * Every real object path under `folder`, descending into prefixes.
 *
 * A listing entry with a null `id` is a prefix derived from a nested object name
 * rather than an object. `remove()` ignores those without reporting an error, so
 * passing one back is what previously made the confirmation loop spin forever.
 * The objects beneath it have to be enumerated explicitly.
 */
async function collectObjectPaths(
  bucket: Bucket,
  folder: string,
  depth = 0,
): Promise<string[]> {
  if (depth > MAX_STORAGE_DEPTH) {
    throw new Error(`Media folder ${folder} is nested deeper than deletion supports`);
  }
  const paths: string[] = [];
  for (const entry of await listFolderEntries(bucket, folder)) {
    const path = `${folder}/${entry.name}`;
    if (entry.id === null) {
      paths.push(...await collectObjectPaths(bucket, path, depth + 1));
    } else {
      paths.push(path);
    }
  }
  return paths;
}

/**
 * Remove and then confirm the absence of every object under each record path.
 *
 * Confirmation is a fresh enumeration rather than the removal response, because
 * Storage answers 200 while silently skipping entries it did not delete. The
 * round cap turns "Storage will not let go of this object" into a failed
 * deletion the caller can retry instead of a hung request.
 */
async function removeAndConfirmRecordMedia(
  admin: Admin,
  records: RecordMediaScope[],
): Promise<void> {
  const bucket = admin.storage.from(MEDIA_BUCKET);

  for (const record of records) {
    const folder = `${record.couple_id}/${record.id}`;

    for (let round = 1; ; round += 1) {
      const paths = await collectObjectPaths(bucket, folder);
      if (paths.length === 0) break;
      if (round > MAX_STORAGE_ROUNDS) {
        throw new Error(
          `Unable to clear media folder ${folder}: ${paths.length} object(s) still present after ${MAX_STORAGE_ROUNDS} attempts`,
        );
      }
      for (let index = 0; index < paths.length; index += STORAGE_PAGE_SIZE) {
        const batch = paths.slice(index, index + STORAGE_PAGE_SIZE);
        const { error: removeError } = await bucket.remove(batch);
        if (removeError) {
          throw new Error(`Unable to clear media folder ${folder}: ${removeError.message}`);
        }
      }
    }
  }
}

export async function handleDeleteAccountRequest(
  request: Request,
  deps: HandlerDeps,
): Promise<Response> {
  // ---- Origin gate. Strictly in front of authentication and admin work. ----
  const allowlist = parseAllowedOrigins(deps.env('ALLOWED_ORIGINS'));
  const origin = request.headers.get('Origin');
  const cors = resolveCors(request.method, origin, allowlist);

  if (!cors.configured) {
    console.error('[delete-account] ALLOWED_ORIGINS is not configured; refusing every request');
    return jsonResponse({ error: 'Server configuration error' }, 500, cors.headers);
  }
  if (!cors.allowed) {
    return jsonResponse({ error: 'Origin not allowed' }, 403, cors.headers);
  }

  if (request.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: cors.headers });
  }
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, cors.headers);
  }

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Authentication required' }, 401, cors.headers);
  }

  const supabaseUrl = deps.env('SUPABASE_URL');
  const serviceRoleKey = deps.env('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('[delete-account] Missing server environment variables');
    return jsonResponse({ error: 'Server configuration error' }, 500, cors.headers);
  }

  const admin = deps.createAdmin(supabaseUrl, serviceRoleKey);

  const token = authorization.slice('Bearer '.length);
  const { data: { user }, error: userError } = await admin.auth.getUser(token);
  if (userError || !user) {
    return jsonResponse({ error: 'Invalid or expired session' }, 401, cors.headers);
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
        cors.headers,
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

    // The last irreversible step, and the only one whose failure leaves a live
    // account with its data already removed, so it gets a few attempts.
    let deleteUserError: unknown = null;
    for (let attempt = 1; attempt <= AUTH_DELETE_ATTEMPTS; attempt += 1) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (!error) {
        deleteUserError = null;
        break;
      }
      deleteUserError = error;
      console.error(
        `[delete-account] Auth deletion attempt ${attempt}/${AUTH_DELETE_ATTEMPTS} failed`,
        error,
      );
      if (attempt < AUTH_DELETE_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
    if (deleteUserError) throw deleteUserError;

    console.log('[delete-account] Completed', {
      records: records.length,
      preparation,
    });

    return jsonResponse({ success: true, warnings: [] }, 200, cors.headers);
  } catch (error) {
    if (deletionMarkerStarted) {
      // Cleared even when the database preparation already committed. The login
      // still exists in that case, and migration 015's Storage INSERT policy
      // denies every upload while the marker is set, so leaving it behind would
      // permanently break an account that is still in use. Retrying deletion
      // still works: the record set is now empty and matches the next preflight.
      //
      // This is a DIFFERENT marker from `app_metadata.account_deletion_pending`,
      // with the opposite lifecycle. The pending flag deliberately REMAINS set
      // here, because the account's data is already gone and recovery must stay
      // active. Do not "tidy it up".
      const { error: cancelError } = await admin.rpc('cancel_account_deletion', {
        p_user_id: userId,
      });
      if (cancelError) {
        console.error(
          '[delete-account] Failed to clear deletion marker; uploads stay blocked until an operator clears it',
          cancelError,
        );
      }
    }
    console.error('[delete-account] Deletion failed', {
      databasePreparationCompleted,
      error,
    });
    return jsonResponse(
      {
        error: databasePreparationCompleted
          ? 'Your data was removed but the login could not be deleted. Please try again to finish deleting the account.'
          : 'Account deletion failed. Please try again.',
        // Signals that the account still exists while its data is already gone,
        // so the caller does not present this as a clean no-op failure.
        dataRemoved: databasePreparationCompleted,
        warnings: [],
      },
      500,
      cors.headers,
    );
  }
}
