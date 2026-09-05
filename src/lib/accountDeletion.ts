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
export const ACCOUNT_DELETION_LOCK_PREFIX = 'gomsinlog.accountDeletion.lock.v1.';
export const ACCOUNT_DELETION_INTENT_LOCK_PREFIX = 'gomsinlog.accountDeletion.intent.v1.';
const LOCAL_CLEANUP_MARKER = 'local_cleanup';
export const RECOVERY_MARKER_VERSION = 2 as const;

export type RecoveryPhase = 'pending' | 'local_cleanup';

export type RecoveryMarkerV2 = {
  version: typeof RECOVERY_MARKER_VERSION;
  userId: string;
  attemptId: string;
  phase: RecoveryPhase;
};

export type RecoveryMarkerInspection =
  | { kind: 'absent'; userId: string }
  | { kind: 'v2'; userId: string; phase: RecoveryPhase; marker: RecoveryMarkerV2 }
  | { kind: 'legacy_pending'; userId: string; phase: 'pending' }
  | { kind: 'legacy_local_cleanup'; userId: string; phase: 'local_cleanup' }
  | { kind: 'corrupt'; userId: string; phase: 'pending' }
  | { kind: 'unreadable'; userId: string; phase: 'pending' };

type MarkerStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type MarkerListStorage = Pick<Storage, 'length' | 'key' | 'getItem'>;

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function recoveryKeyFor(userId: string): string {
  return `${RECOVERY_KEY_PREFIX}${userId}`;
}

export function accountDeletionLockNameFor(userId: string): string {
  return `${ACCOUNT_DELETION_LOCK_PREFIX}${userId}`;
}

export function accountDeletionIntentLockNameFor(userId: string): string {
  return `${ACCOUNT_DELETION_INTENT_LOCK_PREFIX}${userId}`;
}

export type AccountDeletionLockResult<T> =
  | { kind: 'acquired'; value: T }
  | { kind: 'unavailable'; reason: 'unsupported' | 'contended' | 'request_failed' };

const ACCOUNT_DELETION_LOCK_LEASE = Symbol('account-deletion-lock-lease');
const activeAccountDeletionLockLeases = new WeakSet<object>();

/**
 * Proof that this call stack currently owns one user's cooperative Web Lock.
 * The symbol is module-private, so ordinary callers cannot construct a lease;
 * runtime checks also reject re-use for a different user.
 */
export type AccountDeletionLockLease<UserId extends string = string> = {
  readonly userId: UserId;
  readonly mode: LockMode;
  readonly [ACCOUNT_DELETION_LOCK_LEASE]: true;
};

export function accountDeletionLockLeaseMatchesUser(
  lease: AccountDeletionLockLease | undefined,
  userId: string,
): boolean {
  return !!lease
    && lease.userId === userId
    && lease[ACCOUNT_DELETION_LOCK_LEASE] === true
    && activeAccountDeletionLockLeases.has(lease);
}

/**
 * Run one account-scoped operation under the browser's same-origin reader or
 * writer lock. Web Locks is the only cross-tab primitive used here: localStorage
 * inspect/set/remove sequences are not atomic and must never impersonate CAS.
 *
 * `ifAvailable` is used by user actions that must fail closed instead of
 * queuing behind a deletion already in flight. Startup cleanup may wait, then
 * re-check both auth resolution and the marker inside the callback.
 */
export async function withAccountDeletionLock<UserId extends string, T>(
  userId: UserId,
  operation: (lease: AccountDeletionLockLease<UserId>) => T | Promise<T>,
  options: { ifAvailable?: boolean; mode?: LockMode } = {},
): Promise<AccountDeletionLockResult<T>> {
  let lockManager: LockManager | undefined;
  try {
    lockManager = typeof navigator === 'undefined' ? undefined : navigator.locks;
  } catch {
    lockManager = undefined;
  }
  if (!lockManager || typeof lockManager.request !== 'function') {
    console.error('[gomsinlog] Account-deletion lock unavailable; failing closed.');
    return { kind: 'unavailable', reason: 'unsupported' };
  }

  const noOperationError = Symbol('no-operation-error');
  let operationError: unknown = noOperationError;
  try {
    return await lockManager.request(
      accountDeletionLockNameFor(userId),
      { mode: options.mode ?? 'exclusive', ifAvailable: options.ifAvailable === true },
      async (lock): Promise<AccountDeletionLockResult<T>> => {
        if (!lock) return { kind: 'unavailable', reason: 'contended' };
        const lease = {
          userId,
          mode: options.mode ?? 'exclusive',
          [ACCOUNT_DELETION_LOCK_LEASE]: true,
        } as AccountDeletionLockLease<UserId>;
        activeAccountDeletionLockLeases.add(lease);
        try {
          return { kind: 'acquired', value: await operation(lease) };
        } catch (error) {
          operationError = error;
          throw error;
        } finally {
          activeAccountDeletionLockLeases.delete(lease);
        }
      },
    );
  } catch {
    if (operationError !== noOperationError) throw operationError;
    console.error('[gomsinlog] Account-deletion lock failed; failing closed.');
    return { kind: 'unavailable', reason: 'request_failed' };
  }
}

/**
 * Admit only one deletion initiator for an account while allowing that winner
 * to wait behind an ordinary write on the separate account lock. A losing
 * Provider can join this intent lock after the winner finishes to reconcile
 * its recovery UI, but must never issue a second deletion request.
 */
export async function withAccountDeletionIntentLock<T>(
  userId: string,
  operation: () => T | Promise<T>,
  options: { ifAvailable?: boolean } = {},
): Promise<AccountDeletionLockResult<T>> {
  let lockManager: LockManager | undefined;
  try {
    lockManager = typeof navigator === 'undefined' ? undefined : navigator.locks;
  } catch {
    lockManager = undefined;
  }
  if (!lockManager || typeof lockManager.request !== 'function') {
    console.error('[gomsinlog] Account-deletion intent lock unavailable; failing closed.');
    return { kind: 'unavailable', reason: 'unsupported' };
  }

  const noOperationError = Symbol('no-operation-error');
  let operationError: unknown = noOperationError;
  try {
    return await lockManager.request(
      accountDeletionIntentLockNameFor(userId),
      { mode: 'exclusive', ifAvailable: options.ifAvailable === true },
      async (lock): Promise<AccountDeletionLockResult<T>> => {
        if (!lock) return { kind: 'unavailable', reason: 'contended' };
        try {
          return { kind: 'acquired', value: await operation() };
        } catch (error) {
          operationError = error;
          throw error;
        }
      },
    );
  } catch {
    if (operationError !== noOperationError) throw operationError;
    console.error('[gomsinlog] Account-deletion intent lock failed; failing closed.');
    return { kind: 'unavailable', reason: 'request_failed' };
  }
}

type RecoveryMarkerChangeListener = () => void;
const recoveryMarkerChangeListeners = new Set<RecoveryMarkerChangeListener>();

/** Same-document signal only; subscribers must re-read their current user's key. */
export function subscribeToRecoveryMarkerChanges(
  listener: RecoveryMarkerChangeListener,
): () => void {
  recoveryMarkerChangeListeners.add(listener);
  return () => recoveryMarkerChangeListeners.delete(listener);
}

function isWindowLocalStorage(storage: object): boolean {
  try {
    return typeof window !== 'undefined' && storage === window.localStorage;
  } catch {
    return false;
  }
}

function notifyRecoveryMarkerChanged(storage: object): void {
  if (!isWindowLocalStorage(storage)) return;
  for (const listener of recoveryMarkerChangeListeners) {
    try {
      listener();
    } catch {
      console.error('[gomsinlog] Recovery marker listener failed.');
    }
  }
}

function isRecoveryMarkerV2(value: unknown, expectedUserId: string): value is RecoveryMarkerV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  return keys.length === 4
    && keys[0] === 'attemptId'
    && keys[1] === 'phase'
    && keys[2] === 'userId'
    && keys[3] === 'version'
    && candidate.version === RECOVERY_MARKER_VERSION
    && candidate.userId === expectedUserId
    && typeof candidate.attemptId === 'string'
    && UUID_V4_PATTERN.test(candidate.attemptId)
    && (candidate.phase === 'pending' || candidate.phase === 'local_cleanup');
}

export function inspectRecoveryMarker(
  userId: string,
  storage: Pick<Storage, 'getItem'> = window.localStorage,
): RecoveryMarkerInspection {
  let raw: string | null;
  try {
    raw = storage.getItem(recoveryKeyFor(userId));
  } catch {
    console.error('[gomsinlog] deletion_status marker unreadable; failing closed.');
    return { kind: 'unreadable', userId, phase: 'pending' };
  }
  if (raw === null) return { kind: 'absent', userId };
  if (raw === LOCAL_CLEANUP_MARKER) {
    return { kind: 'legacy_local_cleanup', userId, phase: 'local_cleanup' };
  }
  if (raw === 'true') return { kind: 'legacy_pending', userId, phase: 'pending' };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isRecoveryMarkerV2(parsed, userId)) {
      return { kind: 'v2', userId, phase: parsed.phase, marker: parsed };
    }
  } catch {
    // Every malformed payload remains active and pending below.
  }
  return { kind: 'corrupt', userId, phase: 'pending' };
}

function persistMarkerExactly(marker: RecoveryMarkerV2, storage: MarkerStorage): boolean {
  const serialized = JSON.stringify(marker);
  try {
    storage.setItem(recoveryKeyFor(marker.userId), serialized);
    const persisted = storage.getItem(recoveryKeyFor(marker.userId)) === serialized;
    if (persisted) notifyRecoveryMarkerChanged(storage);
    return persisted;
  } catch {
    console.error('[gomsinlog] deletion_status=pending marker could not be stored.');
    return false;
  }
}

/**
 * Marker state. There is deliberately NO `'malformed'` variant: every present
 * value collapses to `'active'`, so no branch anywhere can route a malformed
 * value into permissive behaviour.
 */
export type MarkerState = 'absent' | 'active';

/** Content-free V2 payload, confirmed by an exact read-back before returning. */
export function markRecoveryPending(
  userId: string,
  storage: MarkerStorage = window.localStorage,
  createAttemptId: () => string = () => crypto.randomUUID(),
): RecoveryMarkerV2 | null {
  const existing = inspectRecoveryMarker(userId, storage);
  if (existing.kind === 'v2') {
    return existing.phase === 'pending' ? existing.marker : null;
  }
  if (existing.kind !== 'absent') return null;

  let attemptId: string;
  try {
    attemptId = createAttemptId();
  } catch {
    return null;
  }
  if (!UUID_V4_PATTERN.test(attemptId)) return null;
  const marker: RecoveryMarkerV2 = {
    version: RECOVERY_MARKER_VERSION,
    userId,
    attemptId,
    phase: 'pending',
  };
  return persistMarkerExactly(marker, storage) ? marker : null;
}

/**
 * Persist that the server has already deleted the account but this device still
 * has to remove its account-scoped outbox. The value carries no user content;
 * `readRecoveryMarker` continues to treat it exactly like every other present
 * marker, so a crash or reload remains fail-closed.
 */
export function advanceRecoveryMarkerToLocalCleanup(
  attempt: RecoveryMarkerV2,
  storage: MarkerStorage = window.localStorage,
): boolean {
  const current = inspectRecoveryMarker(attempt.userId, storage);
  if (current.kind !== 'v2'
    || current.marker.attemptId !== attempt.attemptId
    || current.phase !== 'pending') return false;
  return persistMarkerExactly({ ...attempt, phase: 'local_cleanup' }, storage);
}

export function clearRecoveryMarkerForAttempt(
  attempt: RecoveryMarkerV2,
  expectedPhase: RecoveryPhase,
  storage: MarkerStorage = window.localStorage,
): boolean {
  const current = inspectRecoveryMarker(attempt.userId, storage);
  if (current.kind !== 'v2'
    || current.marker.attemptId !== attempt.attemptId
    || current.phase !== expectedPhase) return false;
  try {
    storage.removeItem(recoveryKeyFor(attempt.userId));
    const cleared = storage.getItem(recoveryKeyFor(attempt.userId)) === null;
    if (cleared) notifyRecoveryMarkerChanged(storage);
    return cleared;
  } catch {
    console.error('[gomsinlog] recovery marker could not be cleared.');
    return false;
  }
}

export type ListedRecoveryMarker = Exclude<RecoveryMarkerInspection, { kind: 'absent' }>;

/** Snapshot every compatible marker without normalising or deleting any value. */
export function listRecoveryMarkers(
  storage: MarkerListStorage = window.localStorage,
): ListedRecoveryMarker[] {
  const userIds: string[] = [];
  try {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(RECOVERY_KEY_PREFIX)) continue;
      const userId = key.slice(RECOVERY_KEY_PREFIX.length);
      if (userId) userIds.push(userId);
    }
  } catch {
    return [];
  }
  return userIds.flatMap((userId) => {
    const marker = inspectRecoveryMarker(userId, storage);
    return marker.kind === 'absent' ? [] : [marker];
  });
}

/**
 * Detect only the exact, content-free local-cleanup phase. Unknown or malformed
 * values stay active through `readRecoveryMarker`, but never gain the authority
 * to skip the server-side deletion retry.
 */
export function isLocalDeletionCleanupPending(
  userId: string,
  storage: Pick<Storage, 'getItem'> = window.localStorage,
): boolean {
  const marker = inspectRecoveryMarker(userId, storage);
  return marker.kind === 'v2' && marker.phase === 'local_cleanup';
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
  return inspectRecoveryMarker(userId, storage).kind === 'absent' ? 'absent' : 'active';
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
 * One authoritative server answer.
 *
 * `unavailable` means one authority COULD NOT COMPLETE or returned a malformed
 * payload. It is therefore NOT an answer and must never be collapsed into a
 * negative.
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
 * Interpret an authoritative `getUser()` payload for exactly one account.
 *
 * A completed but missing/mismatched user is still `unavailable`; only an exact
 * user match can contribute a negative answer.
 */
export function serverAnswerFromUser(expectedUserId: string, user: unknown): ServerAnswer {
  if (!user || typeof user !== 'object' || Array.isArray(user)) {
    return { kind: 'unavailable' };
  }
  const candidate = user as { id?: unknown; app_metadata?: unknown };
  if (candidate.id !== expectedUserId) return { kind: 'unavailable' };
  const metadata = candidate.app_metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { kind: 'unavailable' };
  }
  return (metadata as Record<string, unknown>)[ACCOUNT_DELETION_PENDING_FIELD] === true
    ? { kind: 'pending' }
    : { kind: 'not_pending' };
}

/** Accept only the RPC's literal boolean contract. */
export function serverAnswerFromDatabase(value: unknown): ServerAnswer {
  if (value === true) return { kind: 'pending' };
  if (value === false) return { kind: 'not_pending' };
  return { kind: 'unavailable' };
}

/**
 * Combine Auth metadata and the authenticated self-only database fence.
 * Either positive dominates; a negative is authoritative only when both
 * independent sources explicitly agree.
 */
export function combineServerAnswers(
  auth: ServerAnswer,
  database: ServerAnswer,
): ServerAnswer {
  if (auth.kind === 'pending' || database.kind === 'pending') {
    return { kind: 'pending' };
  }
  if (auth.kind === 'not_pending' && database.kind === 'not_pending') {
    return { kind: 'not_pending' };
  }
  return { kind: 'unavailable' };
}

/* ------------------------------------------------------------------ *
 * 4. The pre-flight gate, reachable from outside the store
 * ------------------------------------------------------------------ */

/**
 * Re-issues the authoritative deletion check and, on `pending`, aborts.
 *
 * The store owns the only implementation, because aborting has to make the
 * marker durable, stop deferred work and enter recovery without deleting the
 * pending account's local data. Data-layer modules consult that one gate rather
 * than growing their own half-version of it.
 */
export type ServerCallGate = (
  lease?: AccountDeletionLockLease,
) => Promise<DeletionStatus>;

export type BoundServerCallGate = {
  /** The authenticated user this render-time Provider registration may serve. */
  expectedUserId: string | null;
  /** Read synchronously so an Auth switch closes the gate before React rerenders. */
  getCurrentUserId: () => string | null;
  gate: ServerCallGate;
};

export type ServerCallGateRegistration = Readonly<{
  unregister: () => void;
}>;

type RegisteredServerCallGate = BoundServerCallGate & {
  token: symbol;
  order: number;
};

const registeredServerCallGates = new Map<symbol, RegisteredServerCallGate>();
let nextServerCallGateOrder = 0;
let hasRegisteredBoundServerCallGate = false;

/**
 * Compatibility boundary for older isolated data-layer tests. Production has
 * exactly one caller (`StoreProvider`) and uses the user-bound overload below.
 * Keeping this separate means legacy cleanup can never remove a Provider's
 * tokenized registration.
 */
let unboundCompatibilityGate: ServerCallGate | null = null;

export function registerServerCallGate(
  registration: BoundServerCallGate,
): ServerCallGateRegistration;
/** @deprecated Production callers must use the user-bound registration. */
export function registerServerCallGate(gate: ServerCallGate | null): void;
export function registerServerCallGate(
  registration: BoundServerCallGate | ServerCallGate | null,
): ServerCallGateRegistration | void {
  if (typeof registration === 'function' || registration === null) {
    unboundCompatibilityGate = registration;
    return;
  }

  const token = Symbol('server-call-gate-registration');
  hasRegisteredBoundServerCallGate = true;
  const entry: RegisteredServerCallGate = {
    ...registration,
    token,
    order: nextServerCallGateOrder,
  };
  nextServerCallGateOrder += 1;
  registeredServerCallGates.set(token, entry);

  let registered = true;
  return Object.freeze({
    unregister: () => {
      if (!registered) return;
      registered = false;
      registeredServerCallGates.delete(token);
    },
  });
}

async function gateBlocksServerCall(
  gate: ServerCallGate,
  lease?: AccountDeletionLockLease,
): Promise<boolean> {
  try {
    return (await gate(lease)).kind === 'pending';
  } catch {
    console.error('[gomsinlog] deletion pre-flight gate failed; server call blocked.');
    return true;
  }
}

type ServerCallGateResolution =
  | { kind: 'bound'; userId: string; registration: RegisteredServerCallGate }
  | { kind: 'unbound'; gate: ServerCallGate }
  | { kind: 'bootstrap' }
  | { kind: 'blocked' };

function resolveServerCallGate(): ServerCallGateResolution {
  const registrations = Array.from(registeredServerCallGates.values());
  if (registrations.length === 0) {
    if (hasRegisteredBoundServerCallGate) {
      console.error('[gomsinlog] deletion pre-flight Provider unavailable; server call blocked.');
      return { kind: 'blocked' };
    }
    if (unboundCompatibilityGate) return { kind: 'unbound', gate: unboundCompatibilityGate };
    return { kind: 'bootstrap' };
  }

  const currentUserIds = new Set<string>();
  const observed = new Map<symbol, string | null>();
  for (const registration of registrations) {
    let currentUserId: string | null;
    try {
      currentUserId = registration.getCurrentUserId();
    } catch {
      console.error('[gomsinlog] deletion pre-flight identity unavailable; server call blocked.');
      return { kind: 'blocked' };
    }
    observed.set(registration.token, currentUserId);
    if (currentUserId) currentUserIds.add(currentUserId);
  }

  if (currentUserIds.size !== 1) {
    console.error('[gomsinlog] deletion pre-flight identity ambiguous; server call blocked.');
    return { kind: 'blocked' };
  }

  const [currentUserId] = currentUserIds;
  const matching = registrations
    .filter((registration) => registration.expectedUserId === currentUserId
      && observed.get(registration.token) === currentUserId)
    .sort((left, right) => right.order - left.order)[0];
  if (!matching) {
    console.error('[gomsinlog] deletion pre-flight gate unavailable for current user; server call blocked.');
    return { kind: 'blocked' };
  }
  return { kind: 'bound', userId: currentUserId, registration: matching };
}

async function readGateStatus(
  gate: ServerCallGate,
  lease?: AccountDeletionLockLease,
): Promise<DeletionStatus | null> {
  try {
    return await gate(lease);
  } catch {
    console.error('[gomsinlog] deletion pre-flight gate failed; server call blocked.');
    return null;
  }
}

export type ServerMutationBarrierResult<T> =
  | { kind: 'executed'; value: T }
  | { kind: 'blocked' };

export type ServerMutationPolicy = 'ordinary' | 'best_effort';

export type ServerMutationBarrierContext = {
  readonly userId: string;
  readonly lease?: AccountDeletionLockLease;
  /** Throws a private stale-identity signal that the barrier converts to blocked. */
  assertCurrent: () => void;
};

export type ServerMutationBarrierOptions = {
  /** A concrete initiating user, or a synchronous capture at API entry. */
  expectedUserId: string | 'current';
  existingLease?: AccountDeletionLockLease;
  /** Best-effort work never waits for a deletion lock and never runs on unknown. */
  policy?: ServerMutationPolicy;
};

const STALE_SERVER_MUTATION = Symbol('stale-server-mutation');

function throwIfServerMutationIdentityChanged(expectedUserId: string): void {
  const current = resolveServerCallGate();
  if (current.kind !== 'bound' || current.userId !== expectedUserId) {
    throw STALE_SERVER_MUTATION;
  }
}

/**
 * Keep a complete remote mutation behind the account-deletion reader/writer
 * barrier. Unlike a boolean pre-flight, this lease remains owned until the
 * caller's final server write and reconciliation have settled, so deletion
 * cannot begin in the check-to-write gap.
 *
 * The no-Provider branch exists only for bootstrap and isolated data-layer
 * tests. Once any bound StoreProvider has mounted, losing that authority fails
 * closed for the rest of the document lifetime.
 */
export async function runServerMutationBehindDeletionBarrier<T>(
  operation: (context: ServerMutationBarrierContext) => Promise<T>,
  options: ServerMutationBarrierOptions,
): Promise<ServerMutationBarrierResult<T>> {
  const initial = resolveServerCallGate();
  if (initial.kind === 'blocked' || initial.kind === 'bootstrap') return { kind: 'blocked' };
  const policy = options.policy ?? 'ordinary';

  if (initial.kind === 'unbound') {
    // Deprecated test authority only. Production StoreProvider always publishes
    // a user-bound registration, so a current user cannot be inferred here.
    if (options.expectedUserId === 'current') return { kind: 'blocked' };
    const status = await readGateStatus(initial.gate, options.existingLease);
    if (!status || status.kind === 'pending' || (policy === 'best_effort' && status.kind !== 'clear')) {
      return { kind: 'blocked' };
    }
    const assertCurrent = () => {
      const current = resolveServerCallGate();
      if (current.kind !== 'unbound' || current.gate !== initial.gate) throw STALE_SERVER_MUTATION;
    };
    try {
      assertCurrent();
      const value = await operation({
        userId: options.expectedUserId,
        lease: options.existingLease,
        assertCurrent,
      });
      assertCurrent();
      return { kind: 'executed', value };
    } catch (error) {
      if (error === STALE_SERVER_MUTATION) return { kind: 'blocked' };
      throw error;
    }
  }

  const expectedUserId = options.expectedUserId === 'current'
    ? initial.userId
    : options.expectedUserId;
  if (initial.userId !== expectedUserId) {
    console.error('[gomsinlog] deletion mutation identity changed before admission; server call blocked.');
    return { kind: 'blocked' };
  }

  const execute = async (
    registration: RegisteredServerCallGate,
    lease: AccountDeletionLockLease,
  ): Promise<ServerMutationBarrierResult<T>> => {
    const status = await readGateStatus(registration.gate, lease);
    if (!status || status.kind === 'pending' || (policy === 'best_effort' && status.kind !== 'clear')) {
      return { kind: 'blocked' };
    }
    const assertCurrent = () => throwIfServerMutationIdentityChanged(expectedUserId);
    assertCurrent();
    const value = await operation({ userId: expectedUserId, lease, assertCurrent });
    assertCurrent();
    return { kind: 'executed', value };
  };

  if (options.existingLease) {
    if (!accountDeletionLockLeaseMatchesUser(options.existingLease, expectedUserId)) {
      console.error('[gomsinlog] deletion mutation lease identity mismatch; server call blocked.');
      return { kind: 'blocked' };
    }
    try {
      return await execute(initial.registration, options.existingLease);
    } catch (error) {
      if (error === STALE_SERVER_MUTATION) return { kind: 'blocked' };
      throw error;
    }
  }

  let pendingNeedsExclusiveRecheck = false;
  let locked: AccountDeletionLockResult<ServerMutationBarrierResult<T>>;
  try {
    locked = await withAccountDeletionLock(expectedUserId, async (lease) => {
      const admitted = resolveServerCallGate();
      if (admitted.kind !== 'bound' || admitted.userId !== expectedUserId) {
        return { kind: 'blocked' } as const;
      }
      const status = await readGateStatus(admitted.registration.gate, lease);
      if (!status) return { kind: 'blocked' } as const;
      if (status.kind === 'pending') {
        pendingNeedsExclusiveRecheck = true;
        return { kind: 'blocked' } as const;
      }
      if (policy === 'best_effort' && status.kind !== 'clear') {
        return { kind: 'blocked' } as const;
      }
      const assertCurrent = () => throwIfServerMutationIdentityChanged(expectedUserId);
      assertCurrent();
      const value = await operation({ userId: expectedUserId, lease, assertCurrent });
      assertCurrent();
      return { kind: 'executed', value } as const;
    }, { mode: 'shared', ifAvailable: policy === 'best_effort' });
  } catch (error) {
    if (error === STALE_SERVER_MUTATION) return { kind: 'blocked' };
    throw error;
  }

  if (pendingNeedsExclusiveRecheck) {
    const current = resolveServerCallGate();
    if (current.kind === 'bound' && current.userId === expectedUserId) {
      // The Store gate persists a newly discovered pending marker only under
      // an exclusive lease. Calling it after releasing our shared lease avoids
      // a non-reentrant upgrade deadlock and makes the next launch fail closed.
      await readGateStatus(current.registration.gate);
    }
  }

  return locked.kind === 'acquired' ? locked.value : { kind: 'blocked' };
}

/**
 * `true` when the caller must abort before issuing its request.
 *
 * A mounted Provider publishes both its render-time expected user and a
 * synchronous reader for the current Auth user. A registration is eligible
 * only when those identities match. Multiple Providers that disagree about the
 * current user, a missing match, or a broken identity reader all fail closed.
 * Among multiple registrations for the same user, the newest live Provider is
 * used; unregistering an older Provider removes only its own opaque token.
 *
 * Once a matching gate is found, the store's existing availability decision is
 * preserved: `pending` blocks while `clear` and `unknown` continue. The check is
 * still re-issued on every entry rather than cached.
 */
export async function serverCallBlockedByPendingDeletion(
  lease?: AccountDeletionLockLease,
): Promise<boolean> {
  const resolution = resolveServerCallGate();
  if (resolution.kind === 'blocked') return true;
  if (resolution.kind === 'bootstrap') return false;
  if (resolution.kind === 'unbound') return gateBlocksServerCall(resolution.gate, lease);
  if (lease && !accountDeletionLockLeaseMatchesUser(lease, resolution.userId)) {
    console.error('[gomsinlog] deletion pre-flight lease identity mismatch; server call blocked.');
    return true;
  }
  return gateBlocksServerCall(resolution.registration.gate, lease);
}
