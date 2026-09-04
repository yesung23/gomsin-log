export const RECORD_MEDIA_CLEANUP_LEASE_SECONDS = 120;
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
  claim: (
    leaseId: string,
    leaseSeconds: number,
  ) => Promise<RecordMediaCleanupJob | null>;
  list: (
    prefix: string,
    options: { limit: number; offset: number },
  ) => Promise<unknown>;
  remove: (paths: string[]) => Promise<void>;
  complete: (recordId: string, leaseId: string) => Promise<boolean>;
  defer: (recordId: string, leaseId: string) => Promise<boolean>;
  fail: (
    recordId: string,
    leaseId: string,
    errorCode: string,
  ) => Promise<'pending' | 'blocked' | null>;
  object?: {
    claim: (
      leaseId: string,
      leaseSeconds: number,
    ) => Promise<RecordMediaObjectCleanupJob | null>;
    resolvePath: (job: RecordMediaObjectCleanupJob) => Promise<string | null>;
    settle: (job: RecordMediaObjectCleanupJob) => Promise<boolean>;
    fail: (
      job: RecordMediaObjectCleanupJob,
      errorCode: string,
    ) => Promise<'pending' | 'blocked' | null>;
  };
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
  prefix: string,
  offset: number,
): Promise<Array<{ name: unknown; id: unknown }>> {
  let raw: unknown;
  try {
    raw = await deps.list(prefix, { limit: MAX_LIST_PAGE_SIZE, offset });
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
      const page = await listPage(deps, current.prefix, offset);
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
  paths: string[],
): Promise<void> {
  for (let offset = 0; offset < paths.length; offset += MAX_DELETE_BATCH_SIZE) {
    try {
      await deps.remove(paths.slice(offset, offset + MAX_DELETE_BATCH_SIZE));
    } catch {
      throw new CleanupStorageError('E_STORAGE_DELETE_FAILED');
    }
  }
}

async function replayBooleanSettlement(
  settle: () => Promise<boolean>,
): Promise<boolean> {
  try {
    return await settle();
  } catch {
    try {
      return await settle();
    } catch {
      throw new Error('E_CLEANUP_SETTLEMENT_FAILED');
    }
  }
}

async function settleFailure(
  deps: RecordMediaCleanupDeps,
  job: RecordMediaCleanupJob,
  errorCode: string,
  deletedObjects: number,
): Promise<RecordMediaCleanupResult> {
  let state: 'pending' | 'blocked' | null;
  const settle = () => deps.fail(job.recordId, job.leaseId, errorCode);
  try {
    state = await settle();
  } catch {
    try {
      state = await settle();
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
  job: RecordMediaCleanupJob,
  deletedObjects: number,
): Promise<RecordMediaCleanupResult> {
  const completed = await replayBooleanSettlement(
    () => deps.complete(job.recordId, job.leaseId),
  );
  if (!completed) throw new Error('E_CLEANUP_SETTLEMENT_FAILED');
  return { outcome: 'completed', deletedObjects };
}

async function settleDeferred(
  deps: RecordMediaCleanupDeps,
  job: RecordMediaCleanupJob,
  deletedObjects: number,
): Promise<RecordMediaCleanupResult> {
  const deferred = await replayBooleanSettlement(
    () => deps.defer(job.recordId, job.leaseId),
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
  job: RecordMediaObjectCleanupJob,
  deletedObjects: number,
): Promise<RecordMediaCleanupResult> {
  if (!deps.object) throw new Error('E_CLEANUP_SETTLEMENT_FAILED');
  const completed = await replayBooleanSettlement(() => deps.object!.settle(job));
  if (!completed) throw new Error('E_CLEANUP_SETTLEMENT_FAILED');
  return { outcome: 'completed', deletedObjects };
}

async function settleObjectFailure(
  deps: RecordMediaCleanupDeps,
  job: RecordMediaObjectCleanupJob,
  errorCode: string,
): Promise<RecordMediaCleanupResult> {
  if (!deps.object) throw new Error('E_CLEANUP_SETTLEMENT_FAILED');
  let state: 'pending' | 'blocked' | null;
  try {
    state = await deps.object.fail(job, errorCode);
  } catch {
    try {
      state = await deps.object.fail(job, errorCode);
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
  leaseId: string,
): Promise<RecordMediaCleanupResult> {
  if (!deps.object) return { outcome: 'idle', deletedObjects: 0 };

  let job: RecordMediaObjectCleanupJob | null;
  try {
    job = await deps.object.claim(leaseId, RECORD_MEDIA_CLEANUP_LEASE_SECONDS);
  } catch {
    throw new Error('E_CLEANUP_CLAIM_FAILED');
  }
  if (job === null) return { outcome: 'idle', deletedObjects: 0 };
  if (!isRecordMediaObjectCleanupJob(job, leaseId)) {
    throw new Error('E_CLEANUP_JOB_INVALID');
  }

  let path: string | null;
  try {
    path = await deps.object.resolvePath(job);
  } catch {
    return settleObjectFailure(deps, job, 'E_STORAGE_OBJECT_RESOLVE_FAILED');
  }
  if (path === null) return settleObjectComplete(deps, job, 0);
  if (!isExactObjectPath(path, job)) {
    return settleObjectFailure(deps, job, 'E_STORAGE_PATH_INVALID');
  }

  try {
    await removePaths(deps, [path]);
  } catch (error) {
    if (!(error instanceof CleanupStorageError)) throw error;
    return settleObjectFailure(deps, job, storageErrorCode(error));
  }
  return settleObjectComplete(deps, job, 1);
}

export async function runRecordMediaCleanup(
  deps: RecordMediaCleanupDeps,
): Promise<RecordMediaCleanupResult> {
  const leaseId = deps.createLeaseId();
  if (!isUuid(leaseId)) throw new Error('E_CLEANUP_LEASE_INVALID');

  let job: RecordMediaCleanupJob | null;
  try {
    job = await deps.claim(leaseId, RECORD_MEDIA_CLEANUP_LEASE_SECONDS);
  } catch {
    throw new Error('E_CLEANUP_CLAIM_FAILED');
  }
  if (job === null) return runObjectCleanup(deps, leaseId);
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
      const scan = await scanExactPrefix(deps, root);
      if (scan.paths.length === 0 && !scan.truncated) {
        return await settleComplete(deps, job, deletedObjects);
      }

      await removePaths(deps, scan.paths);
      deletedObjects += scan.paths.length;
      if (scan.truncated) {
        return await settleDeferred(deps, job, deletedObjects);
      }
    }

    const verification = await scanExactPrefix(deps, root);
    if (verification.paths.length === 0 && !verification.truncated) {
      return await settleComplete(deps, job, deletedObjects);
    }
    return await settleDeferred(deps, job, deletedObjects);
  } catch (error) {
    if (!(error instanceof CleanupStorageError)) throw error;
    return settleFailure(deps, job, storageErrorCode(error), deletedObjects);
  }
}
