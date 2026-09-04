import { strict as assert } from 'node:assert';
import {
  MAX_DELETE_BATCH_SIZE,
  MAX_DELETE_ROUNDS,
  MAX_DIRECTORY_DEPTH,
  MAX_OBJECTS_PER_INVOCATION,
  type RecordMediaCleanupDeps,
  type RecordMediaCleanupJob,
  runRecordMediaCleanup,
} from './recordMediaCleanup.ts';

const COUPLE_ID = '10000000-0000-4000-8000-000000000001';
const RECORD_ID = '20000000-0000-4000-8000-000000000001';
const LEASE_ID = '30000000-0000-4000-8000-000000000001';
const ROOT = `${COUPLE_ID}/${RECORD_ID}`;

const JOB: RecordMediaCleanupJob = {
  recordId: RECORD_ID,
  coupleId: COUPLE_ID,
  leaseId: LEASE_ID,
};

type Fixture = ReturnType<typeof createFixture>;

function directChildren(objects: Set<string>, path: string) {
  const prefix = `${path}/`;
  const children = new Map<string, boolean>();
  for (const objectPath of objects) {
    if (!objectPath.startsWith(prefix)) continue;
    const remainder = objectPath.slice(prefix.length);
    const slash = remainder.indexOf('/');
    const name = slash === -1 ? remainder : remainder.slice(0, slash);
    if (!name) continue;
    children.set(name, slash !== -1 || children.get(name) === true);
  }
  return [...children.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, isDirectory]) => ({
      name,
      id: isDirectory ? null : `object-${name}`,
      metadata: isDirectory ? null : {},
    }));
}

function createFixture(initialObjects: string[] = []) {
  const objects = new Set(initialObjects);
  const listed: string[] = [];
  const removed: string[][] = [];
  const completed: Array<[string, string]> = [];
  const deferred: Array<[string, string]> = [];
  const failed: Array<[string, string, string]> = [];
  const value: RecordMediaCleanupDeps = {
    createLeaseId: () => LEASE_ID,
    claim: async () => JOB,
    list: async (path, { limit, offset }) => {
      listed.push(path);
      return directChildren(objects, path).slice(offset, offset + limit);
    },
    remove: async (paths) => {
      removed.push([...paths]);
      for (const path of paths) objects.delete(path);
    },
    complete: async (recordId, leaseId) => {
      completed.push([recordId, leaseId]);
      return true;
    },
    defer: async (recordId, leaseId) => {
      deferred.push([recordId, leaseId]);
      return true;
    },
    fail: async (recordId, leaseId, errorCode) => {
      failed.push([recordId, leaseId, errorCode]);
      return 'pending';
    },
  };
  return { objects, listed, removed, completed, deferred, failed, value };
}

function flattenRemoved(fixture: Fixture): string[] {
  return fixture.removed.flat();
}

Deno.test('record media cleanup: an empty claim is idle and never touches Storage', async () => {
  const fixture = createFixture();
  fixture.value.claim = async () => null;

  assert.deepEqual(await runRecordMediaCleanup(fixture.value), {
    outcome: 'idle',
    deletedObjects: 0,
  });
  assert.deepEqual(fixture.listed, []);
  assert.deepEqual(fixture.completed, []);
  assert.deepEqual(fixture.failed, []);
});

Deno.test('record media cleanup: after no prefix job it deletes one exact object and settles by object id', async () => {
  const fixture = createFixture();
  fixture.value.claim = async () => null;
  const objectPath = `${ROOT}/legacy-photo.jpg`;
  const calls: string[] = [];
  const objectAware = fixture.value as RecordMediaCleanupDeps & {
    object?: {
      claim: (leaseId: string, leaseSeconds: number) => Promise<{
        mediaObjectId: string;
        storageObjectId: string;
        recordId: string;
        coupleId: string;
        leaseId: string;
      } | null>;
      resolvePath: (job: { storageObjectId: string }) => Promise<string | null>;
      settle: (job: { storageObjectId: string }) => Promise<boolean>;
      fail: (
        job: { storageObjectId: string },
        errorCode: string,
      ) => Promise<'pending' | 'blocked' | null>;
    };
  };
  objectAware.object = {
    claim: async (leaseId, leaseSeconds) => {
      calls.push(`claim:${leaseId}:${leaseSeconds}`);
      return {
        mediaObjectId: '40000000-0000-4000-8000-000000000001',
        storageObjectId: '50000000-0000-4000-8000-000000000001',
        recordId: RECORD_ID,
        coupleId: COUPLE_ID,
        leaseId: LEASE_ID,
      };
    },
    resolvePath: async (job) => {
      calls.push(`resolve:${job.storageObjectId}`);
      return objectPath;
    },
    settle: async (job) => {
      calls.push(`settle:${job.storageObjectId}`);
      return true;
    },
    fail: async (_job, errorCode) => {
      calls.push(`fail:${errorCode}`);
      return 'pending';
    },
  };
  fixture.value.remove = async (paths) => {
    calls.push(`remove:${paths.join('|')}`);
  };

  assert.deepEqual(await runRecordMediaCleanup(objectAware), {
    outcome: 'completed',
    deletedObjects: 1,
  });
  assert.deepEqual(calls, [
    `claim:${LEASE_ID}:120`,
    'resolve:50000000-0000-4000-8000-000000000001',
    `remove:${objectPath}`,
    'settle:50000000-0000-4000-8000-000000000001',
  ]);
});

Deno.test('record media cleanup: recursively drains only the exact UUID prefix and completes after a fresh empty scan', async () => {
  const paths = [
    `${ROOT}/root.jpg`,
    `${ROOT}/album/photo.jpg`,
    `${ROOT}/album/deeper/voice.m4a`,
  ];
  const fixture = createFixture(paths);

  assert.deepEqual(await runRecordMediaCleanup(fixture.value), {
    outcome: 'completed',
    deletedObjects: paths.length,
  });
  assert.deepEqual(new Set(flattenRemoved(fixture)), new Set(paths));
  assert.ok(flattenRemoved(fixture).every((path) => path.startsWith(`${ROOT}/`)));
  assert.ok(fixture.listed.filter((path) => path === ROOT).length >= 2);
  assert.deepEqual(fixture.completed, [[RECORD_ID, LEASE_ID]]);
  assert.deepEqual(fixture.deferred, []);
  assert.deepEqual(fixture.failed, []);
});

Deno.test('record media cleanup: rejects untrusted job identifiers before listing or settlement', async () => {
  const fixture = createFixture();
  fixture.value.claim = async () => ({ ...JOB, recordId: '../sibling' });

  await assert.rejects(
    () => runRecordMediaCleanup(fixture.value),
    (error: unknown) => error instanceof Error && error.message === 'E_CLEANUP_JOB_INVALID',
  );
  assert.deepEqual(fixture.listed, []);
  assert.deepEqual(fixture.failed, []);
});

Deno.test('record media cleanup: a traversal-shaped Storage name is never deleted and only a bounded code is persisted', async () => {
  const fixture = createFixture();
  fixture.value.list = async () => [{ name: '../sibling.jpg', id: 'unsafe', metadata: {} }];

  assert.deepEqual(await runRecordMediaCleanup(fixture.value), {
    outcome: 'retry_scheduled',
    deletedObjects: 0,
  });
  assert.deepEqual(fixture.removed, []);
  assert.deepEqual(fixture.completed, []);
  assert.deepEqual(fixture.failed, [[RECORD_ID, LEASE_ID, 'E_STORAGE_PATH_INVALID']]);
});

Deno.test('record media cleanup: traversal depth is bounded without listing past the limit', async () => {
  const fixture = createFixture();
  fixture.value.list = async (path) => {
    fixture.listed.push(path);
    return [{ name: 'nested', id: null, metadata: null }];
  };

  assert.deepEqual(await runRecordMediaCleanup(fixture.value), {
    outcome: 'retry_scheduled',
    deletedObjects: 0,
  });
  assert.equal(fixture.listed.length, MAX_DIRECTORY_DEPTH + 1);
  assert.deepEqual(fixture.failed, [[RECORD_ID, LEASE_ID, 'E_STORAGE_DEPTH_EXCEEDED']]);
});

Deno.test('record media cleanup: object and delete-batch budgets defer remaining work instead of claiming completion', async () => {
  const paths = Array.from(
    { length: MAX_OBJECTS_PER_INVOCATION + 1 },
    (_, index) => `${ROOT}/object-${String(index).padStart(4, '0')}.jpg`,
  );
  const fixture = createFixture(paths);

  assert.deepEqual(await runRecordMediaCleanup(fixture.value), {
    outcome: 'deferred',
    deletedObjects: MAX_OBJECTS_PER_INVOCATION,
  });
  assert.equal(fixture.objects.size, 1);
  assert.ok(fixture.removed.every((batch) => batch.length <= MAX_DELETE_BATCH_SIZE));
  assert.deepEqual(fixture.completed, []);
  assert.deepEqual(fixture.deferred, [[RECORD_ID, LEASE_ID]]);
  assert.deepEqual(fixture.failed, []);
});

Deno.test('record media cleanup: a concurrent upload found by the fresh scan is deleted before completion', async () => {
  const fixture = createFixture([`${ROOT}/first.jpg`]);
  const baseRemove = fixture.value.remove;
  let addedLateObject = false;
  fixture.value.remove = async (paths) => {
    await baseRemove(paths);
    if (!addedLateObject) {
      fixture.objects.add(`${ROOT}/late.jpg`);
      addedLateObject = true;
    }
  };

  assert.deepEqual(await runRecordMediaCleanup(fixture.value), {
    outcome: 'completed',
    deletedObjects: 2,
  });
  assert.equal(fixture.objects.size, 0);
  assert.ok(fixture.listed.filter((path) => path === ROOT).length >= 3);
  assert.deepEqual(fixture.completed, [[RECORD_ID, LEASE_ID]]);
});

Deno.test('record media cleanup: persistent non-empty verification stops after bounded rounds and defers', async () => {
  const fixture = createFixture([`${ROOT}/persistent.jpg`]);
  fixture.value.remove = async (paths) => {
    fixture.removed.push([...paths]);
  };

  assert.deepEqual(await runRecordMediaCleanup(fixture.value), {
    outcome: 'deferred',
    deletedObjects: MAX_DELETE_ROUNDS,
  });
  assert.equal(fixture.removed.length, MAX_DELETE_ROUNDS);
  assert.deepEqual(fixture.completed, []);
  assert.deepEqual(fixture.deferred, [[RECORD_ID, LEASE_ID]]);
});

Deno.test('record media cleanup: completion response loss replays the same idempotent settlement', async () => {
  const fixture = createFixture();
  let calls = 0;
  fixture.value.complete = async (recordId, leaseId) => {
    fixture.completed.push([recordId, leaseId]);
    calls += 1;
    if (calls === 1) throw new Error('response lost after commit');
    return true;
  };

  assert.deepEqual(await runRecordMediaCleanup(fixture.value), {
    outcome: 'completed',
    deletedObjects: 0,
  });
  assert.deepEqual(fixture.completed, [
    [RECORD_ID, LEASE_ID],
    [RECORD_ID, LEASE_ID],
  ]);
});

Deno.test('record media cleanup: failure response loss replays one bounded error code without object names', async () => {
  const fixture = createFixture();
  fixture.value.list = async () => {
    throw new Error(`${ROOT}/private-name.jpg`);
  };
  let calls = 0;
  fixture.value.fail = async (recordId, leaseId, errorCode) => {
    fixture.failed.push([recordId, leaseId, errorCode]);
    calls += 1;
    if (calls === 1) throw new Error('response lost after commit');
    return 'pending';
  };

  const result = await runRecordMediaCleanup(fixture.value);
  assert.deepEqual(result, { outcome: 'retry_scheduled', deletedObjects: 0 });
  assert.deepEqual(fixture.failed, [
    [RECORD_ID, LEASE_ID, 'E_STORAGE_LIST_FAILED'],
    [RECORD_ID, LEASE_ID, 'E_STORAGE_LIST_FAILED'],
  ]);
  assert.equal(JSON.stringify(result).includes('private-name.jpg'), false);
});

Deno.test('record media cleanup: delete response loss leaves retryable work that a later empty scan completes', async () => {
  const fixture = createFixture([`${ROOT}/once.jpg`]);
  let loseResponse = true;
  fixture.value.remove = async (paths) => {
    fixture.removed.push([...paths]);
    for (const path of paths) fixture.objects.delete(path);
    if (loseResponse) {
      loseResponse = false;
      throw new Error('response lost after object deletion');
    }
  };

  assert.deepEqual(await runRecordMediaCleanup(fixture.value), {
    outcome: 'retry_scheduled',
    deletedObjects: 0,
  });
  assert.deepEqual(fixture.failed, [[RECORD_ID, LEASE_ID, 'E_STORAGE_DELETE_FAILED']]);

  fixture.failed.length = 0;
  assert.deepEqual(await runRecordMediaCleanup(fixture.value), {
    outcome: 'completed',
    deletedObjects: 0,
  });
  assert.deepEqual(fixture.completed, [[RECORD_ID, LEASE_ID]]);
});
