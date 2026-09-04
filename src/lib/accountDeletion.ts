/**
 * Account-deletion classification, the durable recovery marker, and the
 * tri-state deletion status.
 *
 * Deliberately pure and dependency-free: no React, no Supabase client, no
 * store. Every decision in here is unit-testable without a network.
 */

/* ------------------------------------------------------------------ *
 * 1. Truthful outcome of a deletion attempt
 * ------------------------------------------------------------------ */

export type AccountDeletionOutcome =
  | { status: 'deleted'; dataRemoved: true; warnings: string[] }
  | { status: 'partially_deleted'; dataRemoved: true; warnings: string[] }
  | { status: 'cancelled'; dataRemoved: false; warnings: string[] }
  | { status: 'recovery_required'; dataRemoved: false; warnings: string[] }
  | { status: 'failed'; dataRemoved: false; warnings: string[] };

/**
 * Defensive coercion mirroring the previous inline check: anything that is not
 * an array of strings becomes an empty array rather than propagating garbage.
 */
export function coerceWarnings(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const warnings = (body as { warnings?: unknown }).warnings;
  if (!Array.isArray(warnings)) return [];
  return warnings.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * A 2xx body. `deleted` requires the explicit acknowledgement; it is never
 * inferred from the absence of a transport error.
 */
export function classifyDeletionSuccess(body: unknown): AccountDeletionOutcome {
  const warnings = coerceWarnings(body);
  const success = !!body && typeof body === 'object'
    && (body as { success?: unknown }).success === true;
  return success
    ? { status: 'deleted', dataRemoved: true, warnings }
    : { status: 'failed', dataRemoved: false, warnings };
}

/**
 * An error body. `dataRemoved === true` is the server telling us the account's
 * application data is gone while the login still exists. Anything else -- an
 * unreadable body included -- classifies `failed`, never a fabricated partial
 * deletion.
 */
export function classifyDeletionErrorBody(body: unknown): AccountDeletionOutcome {
  const warnings = coerceWarnings(body);
  const dataRemoved = !!body && typeof body === 'object'
    && (body as { dataRemoved?: unknown }).dataRemoved === true;
  if (dataRemoved) {
    return { status: 'partially_deleted', dataRemoved: true, warnings };
  }
  const recoveryRequired = !!body && typeof body === 'object'
    && (body as { recoveryRequired?: unknown }).recoveryRequired === true;
  if (recoveryRequired) {
    return { status: 'recovery_required', dataRemoved: false, warnings };
  }
  const deletionCancelled = !!body && typeof body === 'object'
    && (body as { deletionCancelled?: unknown }).deletionCancelled === true;
  return deletionCancelled
    ? { status: 'cancelled', dataRemoved: false, warnings }
    : { status: 'failed', dataRemoved: false, warnings };
}

/* ------------------------------------------------------------------ *
 * 2. The dedicated per-user recovery marker (secondary authority)
 * ------------------------------------------------------------------ */

/**
 * Top-level key, deliberately OUTSIDE `STORE_KEY`.
 *
 * The rejected design persisted a boolean inside `STORE_KEY` via
 * `carryOverDevicePrefs`. That is fail-open: `loadState` removes `STORE_KEY`
 * wholesale on corrupt JSON, sign-out removes it too, and clearing site data or
 * changing device bypasses it entirely -- each of which hands a user in
 * partial-deletion recovery a normal app over deleted data.
 *
 * PRIVACY (clause 2.37): embedding `<userId>` in a key that outlives the
 * session IS persisting a pseudonymous identifier. The session having already
 * held that UUID does not make retaining it costless. It is justified narrowly:
 * it is the minimum identifier necessary to bind the marker to the one account
 * whose deletion the user requested, and it is removed on confirmed Auth
 * deletion. No "adds no new data category" reasoning is relied on.
 */
export const RECOVERY_KEY_PREFIX = 'gomsinlog.accountDeletionRecovery.v1.';

export function recoveryKeyFor(userId: string): string {
  return `${RECOVERY_KEY_PREFIX}${userId}`;
}

/**
 * Marker state. There is deliberately NO `'malformed'` variant: every present
 * value collapses to `'active'`, so no branch anywhere can route a malformed
 * value into permissive behaviour.
 */
export type MarkerState = 'absent' | 'active';

/** Boolean-only payload: never warnings, storage paths or account content. */
export function markRecoveryPending(userId: string): void {
  try {
    window.localStorage.setItem(recoveryKeyFor(userId), 'true');
  } catch {
    // Losing the marker is a FAILURE, not a "fail-safe". It is mitigated only
    // by the server-authoritative `app_metadata.account_deletion_pending` flag.
    console.error('[gomsinlog] deletion_status=pending marker could not be stored.');
  }
}

/**
 * `'absent'` ONLY for a genuinely missing key. Every present value -- invalid
 * JSON, `{}`, `"true"`, an unexpected type -- is `'active'`. There is no third
 * answer.
 *
 * There is NO parse-and-discard path and NO `removeItem` on this read path.
 * This is the exact place a well-meaning "clean up bad data" reflex
 * reintroduces the fail-open defect, so it is called out here explicitly: do
 * not add one.
 */
export function readRecoveryMarker(
  userId: string,
  storage: Pick<Storage, 'getItem'> = window.localStorage,
): MarkerState {
  try {
    return storage.getItem(recoveryKeyFor(userId)) === null ? 'absent' : 'active';
  } catch {
    // Storage unreadable. We cannot prove the marker is absent, so we do not
    // claim it is. Fail closed.
    console.error('[gomsinlog] deletion_status marker unreadable; failing closed.');
    return 'active';
  }
}

/**
 * Reachable from EXACTLY ONE place: the confirmed-Auth-deletion branch of
 * `deleteAccount` / `retryAccountDeletion`. Not logout, not a failed retry, not
 * an account switch, not corruption, not elapsed time. There is no
 * server-confirmed cancellation workflow today and no code path may behave as
 * though one exists.
 */
export function clearRecoveryMarker(userId: string): void {
  try {
    window.localStorage.removeItem(recoveryKeyFor(userId));
  } catch (error) {
    console.error('[gomsinlog] recovery marker could not be cleared.');
  }
}

/* ------------------------------------------------------------------ *
 * 3. Tri-state deletion status
 * ------------------------------------------------------------------ */

/**
 * Three variants, not two and not two-plus-a-null.
 *
 * FORBIDDEN representations, named so a reviewer can reject them on sight:
 * `boolean`, `boolean | null`, `boolean | undefined`, an optional field such as
 * `deletionPending?: boolean`, a nullable flag defaulted to `false`, a bare
 * string a caller can `!`-negate, and any "absent means fine" convention.
 */
export type DeletionStatus =
  | { kind: 'pending' }
  | { kind: 'clear' }
  | { kind: 'unknown' };

/**
 * The authoritative server answer.
 *
 * `unavailable` means `getUser()` COULD NOT COMPLETE (reject, timeout,
 * offline). It is therefore NOT an answer, and must never be produced for a
 * response that positively reported "not pending".
 */
export type ServerAnswer =
  | { kind: 'pending' }
  | { kind: 'not_pending' }
  | { kind: 'unavailable' };

/** Compile-time exhaustiveness. A fourth state becomes a type error. */
export function assertNever(value: never): never {
  throw new Error(`[gomsinlog] unhandled deletion status variant: ${JSON.stringify(value)}`);
}

/**
 * Pure, total resolver. The ORDERING is the point.
 *
 * Order 1: a positive local marker, or a server answer of pending  => pending.
 * Order 2: a server answer that positively reports not pending     => clear.
 * Order 3: no marker and no obtainable answer                      => unknown.
 *
 * A positive local marker OUTRANKS a `clear` server answer: the marker is
 * cleared only after confirmed Auth user deletion, and a `not_pending` answer
 * is not that confirmation. Swapping orders 1 and 2 is precisely the regression
 * the Tri-State Verification Suite's first test exists to catch.
 *
 * This function takes a MarkerState VALUE -- not the key, not the storage
 * object -- so it is physically unable to remove, overwrite, normalise or
 * repair anything.
 */
export function classifyDeletionStatus(
  marker: MarkerState,
  server: ServerAnswer,
): DeletionStatus {
  if (marker === 'active') return { kind: 'pending' };
  switch (server.kind) {
    case 'pending':
      return { kind: 'pending' };
    case 'not_pending':
      return { kind: 'clear' };
    case 'unavailable':
      return { kind: 'unknown' };
    default:
      return assertNever(server);
  }
}

/**
 * Distinct log token per variant. Never `false`, never `null`, never an omitted
 * field. `unknown` must never be represented, stored, cached, serialized or
 * logged as `clear`.
 */
export function deletionStatusLogToken(status: DeletionStatus): string {
  return `deletion_status=${status.kind}`;
}

/** The Auth `app_metadata` field name. Admin-only; never `user_metadata`. */
export const ACCOUNT_DELETION_PENDING_FIELD = 'account_deletion_pending';

/**
 * Interpret an authoritative `getUser()` payload.
 *
 * Only called with a response that actually completed, so it can never return
 * `unavailable`.
 */
export function serverAnswerFromUser(user: unknown): ServerAnswer {
  const metadata = (user as { app_metadata?: Record<string, unknown> } | null | undefined)
    ?.app_metadata;
  return metadata?.[ACCOUNT_DELETION_PENDING_FIELD] === true
    ? { kind: 'pending' }
    : { kind: 'not_pending' };
}

/* ------------------------------------------------------------------ *
 * 4. The pre-flight gate, reachable from outside the store
 * ------------------------------------------------------------------ */

/**
 * Re-issues the authoritative deletion check and, on `pending`, aborts.
 *
 * The store owns the only implementation, because aborting has to mark the
 * marker, purge local content and enter recovery -- all of which need store
 * state. Data-layer modules cannot do that, so they consult the store's gate
 * through this registry instead of growing their own half-version of it.
 */
export type ServerCallGate = () => Promise<DeletionStatus>;

let activeServerCallGate: ServerCallGate | null = null;

/**
 * Registered by `StoreProvider` on mount and cleared on unmount.
 *
 * Module-global on purpose: there is exactly one provider in the app, and the
 * data-layer functions that need the gate are plain module functions with no
 * access to React context.
 */
export function registerServerCallGate(gate: ServerCallGate | null): void {
  activeServerCallGate = gate;
}

/**
 * `true` when the caller must abort before issuing its request.
 *
 * Mirrors the store's own decision exactly: only `pending` blocks. `unknown`
 * does NOT block -- it is the deliberate availability tradeoff -- but because
 * this calls the gate on every entry rather than reading a cached verdict, an
 * `unknown` device re-verifies before every server mutation, which is the point.
 *
 * With no gate registered (for example, an isolated data-layer unit test) this
 * is a no-op and behaviour is exactly as before.
 */
export async function serverCallBlockedByPendingDeletion(): Promise<boolean> {
  const gate = activeServerCallGate;
  if (!gate) return false;
  try {
    return (await gate()).kind === 'pending';
  } catch (error) {
    // A broken gate must not silently open the door, but it also must not brick
    // every write. Log loudly and let the caller proceed: the route gate and the
    // store's own pre-flight remain in force.
    console.error('[gomsinlog] deletion pre-flight gate failed.');
    return false;
  }
}
