import { strict as assert } from 'node:assert';
import {
  type RecordMediaCleanupHandlerDeps,
  handleRecordMediaCleanupRequest,
} from './handler.ts';

const SECRET = 'record-media-cleanup-scheduler-secret';

function request(secret: string | null = SECRET, method = 'POST'): Request {
  const headers = new Headers();
  if (secret !== null) headers.set('x-record-media-cleanup-scheduler-secret', secret);
  return new Request('https://edge.test/record-media-cleanup', { method, headers });
}

function deps(): { calls: number; value: RecordMediaCleanupHandlerDeps } {
  const fixture = {
    calls: 0,
    value: {
      schedulerSecret: SECRET,
      runCleanup: async () => {
        fixture.calls += 1;
        return { outcome: 'idle' as const, deletedObjects: 0 };
      },
    },
  };
  return fixture;
}

Deno.test('record media cleanup handler: rejects non-POST and unauthenticated requests before claiming', async () => {
  for (const [candidate, method, status] of [
    [SECRET, 'GET', 405],
    [null, 'POST', 401],
    ['wrong-record-media-cleanup-secret', 'POST', 401],
  ] as const) {
    const fixture = deps();
    const response = await handleRecordMediaCleanupRequest(request(candidate, method), fixture.value);
    assert.equal(response.status, status);
    assert.equal(fixture.calls, 0);
  }
});

Deno.test('record media cleanup handler: returns only bounded outcome metadata', async () => {
  const fixture = deps();
  fixture.value.runCleanup = async () => ({ outcome: 'completed', deletedObjects: 3 });

  const response = await handleRecordMediaCleanupRequest(request(), fixture.value);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { outcome: 'completed', deletedObjects: 3 });
  assert.equal(fixture.calls, 0);
});

Deno.test('record media cleanup handler: hides worker errors and object paths', async () => {
  const fixture = deps();
  fixture.value.runCleanup = async () => {
    throw new Error('private/folder/photo.jpg');
  };

  const response = await handleRecordMediaCleanupRequest(request(), fixture.value);
  const body = await response.text();
  assert.equal(response.status, 503);
  assert.deepEqual(JSON.parse(body), { error: 'E_RECORD_MEDIA_CLEANUP_FAILED' });
  assert.equal(body.includes('private/folder/photo.jpg'), false);
});

Deno.test('record media cleanup handler: aborts a stalled invocation and returns bounded 503', async () => {
  const fixture = deps();
  let signalWasAborted = false;
  fixture.value.invocationTimeoutMs = 20;
  fixture.value.runCleanup = (signal) => {
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        signalWasAborted = signal.aborted;
        reject(signal.reason);
      }, { once: true });
    });
  };

  const startedAt = Date.now();
  const response = await handleRecordMediaCleanupRequest(request(), fixture.value);
  const elapsedMs = Date.now() - startedAt;

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'E_RECORD_MEDIA_CLEANUP_FAILED' });
  assert.equal(signalWasAborted, true);
  assert.ok(elapsedMs < 1_000, `test deadline should be bounded, observed ${elapsedMs}ms`);
});
