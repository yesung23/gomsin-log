import { parseAllowedOrigins, resolveCors } from './_shared/cors.ts';
import { parseAdminSecretKey } from '../_shared/adminSecret.ts';

/**
 * Account deletion is deliberately split across service boundaries:
 *
 * 0. Resolve CORS against an explicit allowlist and refuse any origin that is
 *    not on it, before any authentication or admin-client work.
 * 0b. Verify the bearer token, then write the admin-only Auth flag
 *    `app_metadata.account_deletion_pending = true`. This is the PRIMARY
 *    authority for deletion recovery and it gates everything below: if the
 *    write fails, nothing is deleted.
 * 1. Enumerate the caller's daily records and completely remove their Storage
 *    objects. A listing/removal failure aborts before relational/auth changes.
 * 2. Call the service-role-only fenced E2EE preparation RPC, which
 *    removes this account's device/recovery/envelope material, preserves the
 *    couple-owned epochs and the surviving partner's envelopes, and REFUSES
 *    the whole deletion if continuing would strand that partner.
 * 3. Call the service-role-only prepare_account_deletion RPC. It verifies that
 *    the record set did not change, locks couple rows first, transfers shared
 *    plan ownership, removes private/blocking rows, and deletes records in one
 *    database transaction.
 * 4. Call the service-role-only close_account_relationship_generations RPC.
 *    It terminally closes every relationship generation, revokes pairing and
 *    delivery authority, disconnects both members, and invalidates invitations.
 * 5. Remove the couple row only when this account is its sole member. A current
 *    or former partner membership preserves the shared relationship scope.
 * 6. Delete the Auth user only after every database step succeeds.
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

/** Admin-only Auth flag. NEVER `user_metadata`, which a browser can rewrite. */
const ACCOUNT_DELETION_PENDING_FIELD = 'account_deletion_pending';

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

type DeleteErrorKind = 'authorization' | 'configuration' | 'server' | 'transient' | 'service' | 'unknown';
type AccountDeletionPhase =
  | 'media_cleanup'
  | 'e2ee_prepared'
  | 'relational_prepared'
  | 'relationships_closed'
  | 'solo_cleanup_complete';

const ACCOUNT_DELETION_PHASES = new Set<AccountDeletionPhase>([
  'media_cleanup',
  'e2ee_prepared',
  'relational_prepared',
  'relationships_closed',
  'solo_cleanup_complete',
]);

/**
 * Convert an external error into a bounded diagnostic category.
 *
 * Never return a message, code, path, or object from this boundary: Supabase
 * errors can contain request details and Storage paths, while the category is
 * enough to distinguish an auth, retryable, or service-side failure in logs.
 */
function safeDeleteErrorKind(error: unknown): DeleteErrorKind {
  if (!error || typeof error !== 'object') return 'unknown';
  const status = (error as { status?: unknown }).status;
  if (status === 401 || status === 403) return 'authorization';
  if (status === 408 || status === 429) return 'transient';
  if (typeof status === 'number' && status >= 500 && status <= 599) return 'server';
  return 'service';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function accountDeletionPhase(value: unknown): AccountDeletionPhase | null {
  return typeof value === 'string' && ACCOUNT_DELETION_PHASES.has(value as AccountDeletionPhase)
    ? value as AccountDeletionPhase
    : null;
}

export type HandlerDeps = {
  env: (key: string) => string | undefined;
  createAdmin: (url: string, adminSecretKey: string) => Admin;
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
  const secretKey = parseAdminSecretKey(deps.env('SUPABASE_SECRET_KEYS'));
  if (!supabaseUrl || !secretKey) {
    console.error('[delete-account] Missing or invalid server configuration');
    return jsonResponse({ error: 'Server configuration error' }, 500, cors.headers);
  }

  const admin = deps.createAdmin(supabaseUrl, secretKey);

  const token = authorization.slice('Bearer '.length);
  const { data: { user }, error: userError } = await admin.auth.getUser(token);
  if (userError || !user) {
    return jsonResponse({ error: 'Invalid or expired session' }, 401, cors.headers);
  }

  const userId = user.id;
  // One invocation, one unguessable fence. A retry receives a new token and
  // atomically supersedes the previous invocation without losing its phase.
  const attemptId = crypto.randomUUID();

  // ---- PRIMARY AUTHORITY: the server-side pending flag. ----
  //
  // Placement is load-bearing. It is written BEFORE the read-only
  // `daily_records` preflight and before `begin_account_deletion_v2`, because the
  // flag is a hard gate on anything that touches the account.
  //
  // It sits OUTSIDE the `try` below on purpose: a flag-write failure must return
  // before even the read-only preflight or fenced database marker can run.
  //
  // The existing `app_metadata` is spread FIRST. The Auth API replaces
  // `app_metadata` wholesale rather than merging, and the client derives the
  // rendered sign-in provider from `app_metadata.provider`, so dropping
  // `provider`/`providers` would silently change it.
  try {
    const { error: flagError } = await admin.auth.admin.updateUserById(userId, {
      app_metadata: {
        ...(user.app_metadata ?? {}),
        [ACCOUNT_DELETION_PENDING_FIELD]: true,
      },
    });
    if (flagError) throw flagError;
  } catch (flagError) {
    // Delete NOTHING. An ambiguous write (e.g. a timeout) counts as a failure
    // of this step, so the worst outcome is a flag set on an account whose data
    // is fully intact -- resolved by the next retry, which re-writes the same
    // `true` value idempotently.
    const kind = safeDeleteErrorKind(flagError);
    console.error('[delete-account] Could not record pending deletion; nothing was deleted', { kind });
    return jsonResponse(
      {
        error: 'Account deletion could not be started. Please try again.',
        dataRemoved: false,
        warnings: [],
      },
      500,
      cors.headers,
    );
  }

  let deletionMarkerStarted = false;
  let databasePreparationCompleted = false;
  let destructiveDatabasePreparationMayHaveCommitted = false;
  let soloCouplesDeleted = 0;
  let currentPhase: AccountDeletionPhase | null = null;

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
    const { data: beginResult, error: beginError } = await admin.rpc('begin_account_deletion_v2', {
      p_user_id: userId,
      p_expected_record_ids: records.map((record) => record.id),
      p_attempt_id: attemptId,
    });
    if (beginError) throw beginError;
    const beginPhase = isRecord(beginResult)
      ? accountDeletionPhase(beginResult.phase)
      : null;
    if (
      !isRecord(beginResult)
      || beginResult.ok !== true
      || beginResult.attempt_id !== attemptId
      || beginPhase === null
    ) {
      throw new Error('Account deletion begin did not confirm the fencing token');
    }
    deletionMarkerStarted = true;
    currentPhase = beginPhase;
    destructiveDatabasePreparationMayHaveCommitted = beginPhase !== 'media_cleanup';

    try {
      await removeAndConfirmRecordMedia(admin, records);
    } catch (mediaError) {
      if (currentPhase === 'media_cleanup') {
        const { data: cancelled, error: cancelError } = await admin.rpc(
          'cancel_account_deletion_v2',
          { p_user_id: userId, p_attempt_id: attemptId },
        );
        if (cancelError || cancelled !== true) {
          const kind = cancelError ? safeDeleteErrorKind(cancelError) : 'service';
          console.error('[delete-account] Failed to clear fenced deletion marker', { kind });
        } else {
          deletionMarkerStarted = false;
        }
      } else {
        throw mediaError;
      }
      const kind = safeDeleteErrorKind(mediaError);
      console.error('[delete-account] Media cleanup failed; database untouched', { kind });
      return jsonResponse(
        {
          error: 'Account deletion failed because stored media could not be fully removed. Please try again.',
          dataRemoved: false,
          warnings: [],
        },
        500,
        cors.headers,
      );
    }

    // E2EE key material comes first, and its failure aborts the whole deletion.
    //
    // It runs before the relational preparation because it is the step that can
    // legitimately refuse: if removing this account would leave the surviving
    // partner with no way to decrypt shared history, the RPC raises
    // E2EE_DELETION_WOULD_ORPHAN_PARTNER and nothing is destroyed. Aborting a
    // deletion is recoverable; crypto-shredding a bystander is not.
    //
    // It is also where the personal/health write floor is removed, which only
    // this service-role path is permitted to do.
    // From dispatch onward the result is commit-ambiguous: SQLSTATE 08007,
    // 40003, class 08, and even an application P0001 can all arrive without a
    // safe client-side proof of what committed. Only the v2 database wrapper's
    // exact structured orphan refusal proves its nested subtransaction rolled
    // back and remains cancellable.
    destructiveDatabasePreparationMayHaveCommitted = true;
    const { data: e2eePreparation, error: e2eePreparationError } = await admin.rpc(
      'e2ee_prepare_account_deletion_v2',
      { p_user_id: userId, p_attempt_id: attemptId },
    );
    if (e2eePreparationError) throw e2eePreparationError;

    if (
      isRecord(e2eePreparation)
      && e2eePreparation.ok === false
      && e2eePreparation.rollback_confirmed === true
      && e2eePreparation.refusal_code === 'e2ee_would_orphan_partner'
      && e2eePreparation.phase === 'media_cleanup'
    ) {
      destructiveDatabasePreparationMayHaveCommitted = false;
      const { data: cancelled, error: cancelError } = await admin.rpc(
        'cancel_account_deletion_v2',
        { p_user_id: userId, p_attempt_id: attemptId },
      );
      if (cancelError || cancelled !== true) {
        destructiveDatabasePreparationMayHaveCommitted = true;
        const kind = cancelError ? safeDeleteErrorKind(cancelError) : 'service';
        console.error('[delete-account] Exact orphan refusal could not clear its fence', { kind });
      } else {
        deletionMarkerStarted = false;
      }
      return jsonResponse(
        {
          error: destructiveDatabasePreparationMayHaveCommitted
            ? 'Account deletion could not be completed safely. Please try again.'
            : 'Account deletion was refused to preserve shared encrypted history.',
          dataRemoved: destructiveDatabasePreparationMayHaveCommitted,
          warnings: [],
        },
        500,
        cors.headers,
      );
    }

    const e2eePhase = isRecord(e2eePreparation)
      ? accountDeletionPhase(e2eePreparation.phase)
      : null;
    if (
      !isRecord(e2eePreparation)
      || e2eePreparation.ok !== true
      || e2eePhase === null
      || e2eePhase === 'media_cleanup'
    ) {
      throw new Error('E2EE deletion preparation did not confirm success');
    }
    currentPhase = e2eePhase;

    // Migration 015 owns all destructive relational work. In particular,
    // ownership transfer is no longer a best-effort direct table update: an
    // RPC error aborts before auth deletion, preventing ON DELETE CASCADE from
    // destroying shared events or trips.
    const { data: preparation, error: preparationError } = await admin.rpc(
      'prepare_account_deletion_v2',
      {
        p_user_id: userId,
        p_expected_record_ids: records.map((record) => record.id),
        p_attempt_id: attemptId,
      },
    );
    if (preparationError) throw preparationError;
    const relationalPhase = isRecord(preparation)
      ? accountDeletionPhase(preparation.phase)
      : null;
    if (
      !isRecord(preparation)
      || preparation.ok !== true
      || relationalPhase === null
      || ![
        'relational_prepared',
        'relationships_closed',
        'solo_cleanup_complete',
      ].includes(relationalPhase)
    ) {
      throw new Error('Account deletion database preparation did not confirm success');
    }
    databasePreparationCompleted = true;
    currentPhase = relationalPhase;

    // Relationship identity is a one-use generation. This service-only step
    // runs after ownership transfer/deletion has committed and before either
    // sole-couple cleanup or Auth deletion. Its per-user advisory lock is shared
    // with relationship creation/redemption, while the durable deletion request
    // makes later attempts fail closed after the lock is released.
    //
    // `databasePreparationCompleted` is intentionally already true: if this
    // call fails, relational user data has been removed by the preceding RPC,
    // so the response must preserve the existing `dataRemoved: true` recovery
    // meaning and Auth deletion must not run.
    const {
      data: relationshipClosure,
      error: relationshipClosureError,
    } = await admin.rpc('close_account_relationship_generations_v2', {
      p_user_id: userId,
      p_attempt_id: attemptId,
    });
    if (relationshipClosureError) throw relationshipClosureError;
    const closurePhase = isRecord(relationshipClosure)
      ? accountDeletionPhase(relationshipClosure.phase)
      : null;
    if (
      !isRecord(relationshipClosure)
      || relationshipClosure.ok !== true
      || closurePhase === null
      || !['relationships_closed', 'solo_cleanup_complete'].includes(closurePhase)
      || !Number.isInteger(relationshipClosure.closed_count as number)
      || (relationshipClosure.closed_count as number) < 0
    ) {
      throw new Error('Account deletion relationship closure did not confirm success');
    }
    currentPhase = closurePhase;

    // `couples` has no auth.users foreign key, so Auth deletion alone cannot
    // remove a sole-member relationship row (including anniversary metadata).
    // The service-role-only RPC preserves any couple with another membership
    // row, regardless of whether that member is active, pending or disconnected.
    const { data: cleanedCouples, error: cleanupCouplesError } = await admin.rpc(
      'cleanup_account_solo_couples_v2',
      { p_user_id: userId, p_attempt_id: attemptId },
    );
    if (cleanupCouplesError) throw cleanupCouplesError;
    if (
      !isRecord(cleanedCouples)
      || cleanedCouples.ok !== true
      || cleanedCouples.phase !== 'solo_cleanup_complete'
      || !Number.isInteger(cleanedCouples.deleted_count as number)
      || (cleanedCouples.deleted_count as number) < 0
    ) {
      throw new Error('Account deletion couple cleanup returned an invalid result');
    }
    soloCouplesDeleted = cleanedCouples.deleted_count as number;
    currentPhase = 'solo_cleanup_complete';

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
      const kind = safeDeleteErrorKind(error);
      console.error(
        `[delete-account] Auth deletion attempt ${attempt}/${AUTH_DELETE_ATTEMPTS} failed`,
        { kind },
      );
      if (attempt < AUTH_DELETE_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
    if (deleteUserError) throw deleteUserError;

    // Auth deletion clears the pending flag IMPLICITLY: the user and its
    // `app_metadata` cease to exist. No separate clearing call is made -- that
    // would open a window in which the flag is false while the user still lives.
    console.log('[delete-account] Completed', {
      records: records.length,
      soloCouplesDeleted,
    });

    return jsonResponse({ success: true, warnings: [] }, 200, cors.headers);
  } catch (error) {
    // Never infer rollback from an RPC error code. The only cancellation after
    // E2EE dispatch is handled above from the wrapper's exact structured orphan
    // refusal. Every other error preserves the fenced marker for retry/recovery.
    const kind = safeDeleteErrorKind(error);
    console.error('[delete-account] Deletion failed', {
      databasePreparationCompleted,
      destructiveDatabasePreparationMayHaveCommitted,
      deletionMarkerStarted,
      phase: currentPhase,
      kind,
    });
    return jsonResponse(
      {
        error: destructiveDatabasePreparationMayHaveCommitted
          ? 'Your data was removed but the login could not be deleted. Please try again to finish deleting the account.'
          : 'Account deletion failed. Please try again.',
        // Signals that the account still exists while its data is already gone,
        // so the caller does not present this as a clean no-op failure.
        dataRemoved: destructiveDatabasePreparationMayHaveCommitted,
        warnings: [],
      },
      500,
      cors.headers,
    );
  }
}
