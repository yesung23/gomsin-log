export const RECORD_MEDIA_CLEANUP_LEASE_SECONDS = 120;
export const EXTERNAL_CALL_TIMEOUT_MS = 8_000;
export const CLEANUP_LANE_TIMEOUT_MS = 40_000;
export const CLEANUP_INVOCATION_TIMEOUT_MS = 55_000;
export const MAX_LIST_PAGE_SIZE = 100;
export const MAX_LIST_CALLS_PER_SCAN = 64;
export const MAX_DIRECTORY_DEPTH = 8;
export const MAX_OBJECTS_PER_INVOCATION = 500;
export const MAX_DELETE_BATCH_SIZE = 100;
export const MAX_DELETE_ROUNDS = 3;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_ERROR_CODES = new Set([
  'E_STORAGE_LIST_FAILED',
  'E_STORAGE_PATH_INVALID',
  'E_STORAGE_DEPTH_EXCEEDED',
  'E_STORAGE_DELETE_FAILED',
  'E_STORAGE_OBJECT_RESOLVE_FAILED',
]);

export type RecordMediaCleanupJob = {
  recordId: string;
  coupleId: string;
  leaseId: string;
};

export type RecordMediaObjectCleanupJob = {
  mediaObjectId: string;
  storageObjectId: string;
  recordId: string;
  coupleId: string;
  leaseId: string;
};

export type RecordMediaCleanupResult = {
  outcome: 'idle' | 'completed' | 'deferred' | 'retry_scheduled' | 'blocked';
  deletedObjects: number;
};

export type RecordMediaCleanupDeps = {
  createLeaseId: () => string;
  contractVersion: (signal: AbortSignal) => Promise<number>;
  claim: (
    leaseId: string,
    leaseSeconds: number,
    signal: AbortSignal,
  ) => Promise<RecordMediaCleanupJob | null>;
  list: (
    prefix: string,
    options: { limit: number; offset: number },
    signal: AbortSignal,
  ) => Promise<unknown>;
  remove: (paths: string[], signal: AbortSignal) => Promise<void>;
  complete: (recordId: string, leaseId: string, signal: AbortSignal) => Promise<boolean>;
  defer: (recordId: string, leaseId: string, signal: AbortSignal) => Promise<boolean>;
  fail: (
    recordId: string,
    leaseId: string,
    errorCode: string,
    signal: AbortSignal,
  ) => Promise<'pending' | 'blocked' | null>;
  object: {
    claim: (
      leaseId: string,
      leaseSeconds: number,
      signal: AbortSignal,
    ) => Promise<RecordMediaObjectCleanupJob | null>;
    resolvePath: (
      job: RecordMediaObjectCleanupJob,
      signal: AbortSignal,
    ) => Promise<string | null>;
    settle: (job: RecordMediaObjectCleanupJob, signal: AbortSignal) => Promise<boolean>;
    fail: (
      job: RecordMediaObjectCleanupJob,
      errorCode: string,
      signal: AbortSignal,
    ) => Promise<'pending' | 'blocked' | null>;
  };
};

export type RecordMediaCleanupOptions = {
  externalCallTimeoutMs?: number;
  laneTimeoutMs?: number;
  signal?: AbortSignal;
};

type ScanResult = {
  paths: string[];
  truncated: boolean;
};

class CleanupStorageError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

type CleanupCallContext = {
  signal: AbortSignal;
  externalCallTimeoutMs: number;
};

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('E_CLEANUP_ABORTED');
}

function boundedTimeout(value: number | undefined, fallback: number): number {
  const timeoutMs = value ?? fallback;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('E_CLEANUP_TIMEOUT_INVALID');
  }
  return timeoutMs;
}

async function runWithTimeout<T>(
  parentSignal: AbortSignal,
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (parentSignal.aborted) throw abortReason(parentSignal);

  const controller = new AbortController();
  const forwardParentAbort = () => controller.abort(abortReason(parentSignal));
  parentSignal.addEventListener('abort', forwardParentAbort, { once: true });
  const timeoutId = setTimeout(
    () => controller.abort(new Error('E_CLEANUP_TIMEOUT')),
    timeoutMs,
  );

  let rejectOnAbort: (() => void) | null = null;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = () => reject(abortReason(controller.signal));
    if (controller.signal.aborted) {
      rejectOnAbort();
      return;
    }
    controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
  });
  const pending = Promise.resolve().then(() => {
    if (controller.signal.aborted) throw abortReason(controller.signal);
    return operation(controller.signal);
  });

  try {
    return await Promise.race([pending, aborted]);
  } finally {
    clearTimeout(timeoutId);
    parentSignal.removeEventListener('abort', forwardParentAbort);
    if (rejectOnAbort) {
      controller.signal.removeEventListener('abort', rejectOnAbort);
    }
  }
}

function callExternal<T>(
  context: CleanupCallContext,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  return runWithTimeout(context.signal, context.externalCallTimeoutMs, operation);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isSafeSegment(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 1024 ||
    value === '.' ||
    value === '..' ||
    value.includes('/') ||
    value.includes('\\')
  ) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return false;
  }
  return true;
}

function storageErrorCode(error: unknown): string {
  if (error instanceof CleanupStorageError && SAFE_ERROR_CODES.has(error.code)) {
    return error.code;
  }
  return 'E_STORAGE_LIST_FAILED';
}

async function listPage(
  deps: RecordMediaCleanupDeps,
  context: CleanupCallContext,
  prefix: string,
  offset: number,
): Promise<Array<{ name: unknown; id: unknown }>> {
  let raw: unknown;
  try {
    raw = await callExternal(
      context,
      (signal) => deps.list(prefix, { limit: MAX_LIST_PAGE_SIZE, offset }, signal),
    );
  } catch {
    throw new CleanupStorageError('E_STORAGE_LIST_FAILED');
  }
  if (!Array.isArray(raw) || raw.length > MAX_LIST_PAGE_SIZE) {
    throw new CleanupStorageError('E_STORAGE_LIST_FAILED');
  }
  return raw.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      throw new CleanupStorageError('E_STORAGE_PATH_INVALID');
    }
    const candidate = entry as Record<string, unknown>;
    return { name: candidate.name, id: candidate.id };
  });
}

async function scanExactPrefix(
  deps: RecordMediaCleanupDeps,
  context: CleanupCallContext,
  root: string,
): Promise<ScanResult> {
  const queue: Array<{ prefix: string; depth: number }> = [{ prefix: root, depth: 0 }];
  const seenDirectories = new Set([root]);
  const seenObjects = new Set<string>();
  const paths: string[] = [];
  let listCalls = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    let offset = 0;

    while (true) {
      if (listCalls >= MAX_LIST_CALLS_PER_SCAN) {
        return { paths, truncated: true };
      }
      const page = await listPage(deps, context, current.prefix, offset);
      listCalls += 1;

      if (page.length === 0) break;
      for (const entry of page) {
        if (!isSafeSegment(entry.name)) {
          throw new CleanupStorageError('E_STORAGE_PATH_INVALID');
        }
        const childPath = `${current.prefix}/${entry.name}`;
        if (!childPath.startsWith(`${root}/`)) {
          throw new CleanupStorageError('E_STORAGE_PATH_INVALID');
        }

        if (entry.id === null) {
          if (current.depth >= MAX_DIRECTORY_DEPTH) {
            throw new CleanupStorageError('E_STORAGE_DEPTH_EXCEEDED');
          }
          if (!seenDirectories.has(childPath)) {
            seenDirectories.add(childPath);
            queue.push({ prefix: childPath, depth: current.depth + 1 });
          }
          continue;
        }
        if (typeof entry.id !== 'string' || entry.id.length === 0) {
          throw new CleanupStorageError('E_STORAGE_PATH_INVALID');
        }
        if (seenObjects.has(childPath)) continue;
        if (paths.length >= MAX_OBJECTS_PER_INVOCATION) {
          return { paths, truncated: true };
        }
        seenObjects.add(childPath);
        paths.push(childPath);
      }

      offset += page.length;
      if (page.length < MAX_LIST_PAGE_SIZE) break;
    }
  }

  return { paths, truncated: false };
}

async function removePaths(
  deps: RecordMediaCleanupDeps,
  context: CleanupCallContext,
  paths: string[],
): Promise<void> {
  for (let offset = 0; offset < paths.length; offset += MAX_DELETE_BATCH_SIZE) {
    try {
      const batch = paths.slice(offset, offset + MAX_DELETE_BATCH_SIZE);
      await callExternal(context, (signal) => deps.remove(batch, signal));
    } catch {
      throw new CleanupStorageError('E_STORAGE_DELETE_FAILED');
    }
  }
}

async function replayBooleanSettlement(
  context: CleanupCallContext,
  settle: (signal: AbortSignal) => Promise<boolean>,
): Promise<boolean> {
  try {
    return await callExternal(context, settle);
  } catch {
    try {
      return await callExternal(context, settle);
    } catch {
      throw new Error('E_CLEANUP_SETTLEMENT_FAILED');
    }
  }
}

async function settleFailure(
  deps: RecordMediaCleanupDeps,
  context: CleanupCallContext,
  job: RecordMediaCleanupJob,
  errorCode: string,
  deletedObjects: number,
): Promise<RecordMediaCleanupResult> {
  let state: 'pending' | 'blocked' | null;
  const settle = (signal: AbortSignal) =>
    deps.fail(job.recordId, job.leaseId, errorCode, signal);
  try {
    state = await callExternal(context, settle);
  } catch {
    try {
      state = await callExternal(context, settle);
    } catch {
      throw new Error('E_CLEANUP_SETTLEMENT_FAILED');
    }
  }
  if (state === 'pending') return { outcome: 'retry_scheduled', deletedObjects };
  if (state === 'blocked') return { outcome: 'blocked', deletedObjects };
  throw new Error('E_CLEANUP_SETTLEMENT_FAILED');
}

async function settleComplete(
  deps: RecordMediaCleanupDeps,
  context: CleanupCallContext,
  job: RecordMediaCleanupJob,
  deletedObjects: number,
): Promise<RecordMediaCleanupResult> {
  const completed = await replayBooleanSettlement(
    context,
    (signal) => deps.complete(job.recordId, job.leaseId, signal),
  );
  if (!completed) throw new Error('E_CLEANUP_SETTLEMENT_FAILED');
  return { outcome: 'completed', deletedObjects };
}

async function settleDeferred(
  deps: RecordMediaCleanupDeps,
  context: CleanupCallContext,
  job: RecordMediaCleanupJob,
  deletedObjects: number,
): Promise<RecordMediaCleanupResult> {
  const deferred = await replayBooleanSettlement(
    context,
    (signal) => deps.defer(job.recordId, job.leaseId, signal),
  );
  if (!deferred) throw new Error('E_CLEANUP_SETTLEMENT_FAILED');
  return { outcome: 'deferred', deletedObjects };
}

function isRecordMediaObjectCleanupJob(
  value: RecordMediaObjectCleanupJob,
  leaseId: string,
): boolean {
  return isUuid(value.mediaObjectId)
    && isUuid(value.storageObjectId)
    && isUuid(value.recordId)
    && isUuid(value.coupleId)
    && isUuid(value.leaseId)
    && value.leaseId === leaseId;
}

function isExactObjectPath(path: unknown, job: RecordMediaObjectCleanupJob): path is string {
  if (typeof path !== 'string') return false;
  const parts = path.split('/');
  return parts.length === 3
    && parts[0] === job.coupleId
    && parts[1] === job.recordId
    && isSafeSegment(parts[2]);
}

async function settleObjectComplete(
  deps: RecordMediaCleanupDeps,
  context: CleanupCallContext,
  job: RecordMediaObjectCleanupJob,
  deletedObjects: number,
): Promise<RecordMediaCleanupResult> {
  const completed = await replayBooleanSettlement(
    context,
    (signal) => deps.object.settle(job, signal),
  );
  if (!completed) throw new Error('E_CLEANUP_SETTLEMENT_FAILED');
  return { outcome: 'completed', deletedObjects };
}

async function settleObjectFailure(
  deps: RecordMediaCleanupDeps,
  context: CleanupCallContext,
  job: RecordMediaObjectCleanupJob,
  errorCode: string,
): Promise<RecordMediaCleanupResult> {
  let state: 'pending' | 'blocked' | null;
  try {
    state = await callExternal(
      context,
      (signal) => deps.object.fail(job, errorCode, signal),
    );
  } catch {
    try {
      state = await callExternal(
        context,
        (signal) => deps.object.fail(job, errorCode, signal),
      );
    } catch {
      throw new Error('E_CLEANUP_SETTLEMENT_FAILED');
    }
  }
  if (state === 'pending') return { outcome: 'retry_scheduled', deletedObjects: 0 };
  if (state === 'blocked') return { outcome: 'blocked', deletedObjects: 0 };
  throw new Error('E_CLEANUP_SETTLEMENT_FAILED');
}

async function runObjectCleanup(
  deps: RecordMediaCleanupDeps,
  context: CleanupCallContext,
  leaseId: string,
): Promise<RecordMediaCleanupResult> {
  let job: RecordMediaObjectCleanupJob | null;
  try {
    job = await callExternal(
      context,
      (signal) => deps.object.claim(leaseId, RECORD_MEDIA_CLEANUP_LEASE_SECONDS, signal),
    );
  } catch {
    throw new Error('E_CLEANUP_CLAIM_FAILED');
  }
  if (job === null) return { outcome: 'idle', deletedObjects: 0 };
  if (!isRecordMediaObjectCleanupJob(job, leaseId)) {
    throw new Error('E_CLEANUP_JOB_INVALID');
  }

  let path: string | null;
  try {
    path = await callExternal(context, (signal) => deps.object.resolvePath(job, signal));
  } catch {
    return settleObjectFailure(deps, context, job, 'E_STORAGE_OBJECT_RESOLVE_FAILED');
  }
  if (path === null) return settleObjectComplete(deps, context, job, 0);
  if (!isExactObjectPath(path, job)) {
    return settleObjectFailure(deps, context, job, 'E_STORAGE_PATH_INVALID');
  }

  try {
    await removePaths(deps, context, [path]);
  } catch (error) {
    if (!(error instanceof CleanupStorageError)) throw error;
    return settleObjectFailure(deps, context, job, storageErrorCode(error));
  }
  return settleObjectComplete(deps, context, job, 1);
}

async function runPrefixCleanup(
  deps: RecordMediaCleanupDeps,
  context: CleanupCallContext,
  leaseId: string,
): Promise<RecordMediaCleanupResult> {
  let job: RecordMediaCleanupJob | null;
  try {
    job = await callExternal(
      context,
      (signal) => deps.claim(leaseId, RECORD_MEDIA_CLEANUP_LEASE_SECONDS, signal),
    );
  } catch {
    throw new Error('E_CLEANUP_CLAIM_FAILED');
  }
  if (job === null) return { outcome: 'idle', deletedObjects: 0 };
  if (
    !isUuid(job.recordId) || !isUuid(job.coupleId) || !isUuid(job.leaseId) ||
    job.leaseId !== leaseId
  ) {
    throw new Error('E_CLEANUP_JOB_INVALID');
  }

  const root = `${job.coupleId}/${job.recordId}`;
  let deletedObjects = 0;
  try {
    for (let round = 0; round < MAX_DELETE_ROUNDS; round += 1) {
      const scan = await scanExactPrefix(deps, context, root);
      if (scan.paths.length === 0 && !scan.truncated) {
        return await settleComplete(deps, context, job, deletedObjects);
      }

      await removePaths(deps, context, scan.paths);
      deletedObjects += scan.paths.length;
      if (scan.truncated) {
        return await settleDeferred(deps, context, job, deletedObjects);
      }
    }

    const verification = await scanExactPrefix(deps, context, root);
    if (verification.paths.length === 0 && !verification.truncated) {
      return await settleComplete(deps, context, job, deletedObjects);
    }
    return await settleDeferred(deps, context, job, deletedObjects);
  } catch (error) {
    if (!(error instanceof CleanupStorageError)) throw error;
    return settleFailure(deps, context, job, storageErrorCode(error), deletedObjects);
  }
}

const CLEANUP_OUTCOME_PRIORITY: Record<RecordMediaCleanupResult['outcome'], number> = {
  idle: 0,
  completed: 1,
  deferred: 2,
  retry_scheduled: 3,
  blocked: 4,
};

function combineLaneResults(
  prefix: RecordMediaCleanupResult,
  object: RecordMediaCleanupResult,
): RecordMediaCleanupResult {
  const outcome = CLEANUP_OUTCOME_PRIORITY[prefix.outcome]
      >= CLEANUP_OUTCOME_PRIORITY[object.outcome]
    ? prefix.outcome
    : object.outcome;
  return {
    outcome,
    deletedObjects: prefix.deletedObjects + object.deletedObjects,
  };
}

export async function runRecordMediaCleanup(
  deps: RecordMediaCleanupDeps,
  options: RecordMediaCleanupOptions = {},
): Promise<RecordMediaCleanupResult> {
  const externalCallTimeoutMs = boundedTimeout(
    options.externalCallTimeoutMs,
    EXTERNAL_CALL_TIMEOUT_MS,
  );
  const laneTimeoutMs = boundedTimeout(options.laneTimeoutMs, CLEANUP_LANE_TIMEOUT_MS);
  if (externalCallTimeoutMs >= laneTimeoutMs) {
    throw new Error('E_CLEANUP_TIMEOUT_INVALID');
  }
  const invocationSignal = options.signal ?? new AbortController().signal;

  let contractVersion: number;
  try {
    contractVersion = await runWithTimeout(
      invocationSignal,
      externalCallTimeoutMs,
      (signal) => deps.contractVersion(signal),
    );
  } catch {
    throw new Error('E_CLEANUP_CONTRACT_UNAVAILABLE');
  }
  if (contractVersion !== 3) {
    throw new Error('E_CLEANUP_CONTRACT_UNAVAILABLE');
  }

  const leaseId = deps.createLeaseId();
  if (!isUuid(leaseId)) throw new Error('E_CLEANUP_LEASE_INVALID');

  // The object claim also advances one stale mutation expiry in PostgreSQL.
  // Start both isolated lanes before awaiting either so a stalled prefix scan
  // cannot starve exact-object work (or vice versa).
  const [prefixResult, objectResult] = await Promise.allSettled([
    runWithTimeout(invocationSignal, laneTimeoutMs, (signal) =>
      runPrefixCleanup(deps, { signal, externalCallTimeoutMs }, leaseId)),
    runWithTimeout(invocationSignal, laneTimeoutMs, (signal) =>
      runObjectCleanup(deps, { signal, externalCallTimeoutMs }, leaseId)),
  ]);

  if (prefixResult.status === 'rejected' || objectResult.status === 'rejected') {
    throw new Error('E_CLEANUP_LANE_FAILED');
  }
  return combineLaneResults(prefixResult.value, objectResult.value);
}
