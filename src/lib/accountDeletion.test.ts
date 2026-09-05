import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  RECOVERY_KEY_PREFIX,
  accountDeletionLockLeaseMatchesUser,
  assertNever,
  classifyDeletionErrorBody,
  classifyDeletionStatus,
  classifyDeletionSuccess,
  clearRecoveryMarkerForAttempt,
  combineServerAnswers,
  coerceWarnings,
  deletionStatusLogToken,
  inspectRecoveryMarker,
  isLocalDeletionCleanupPending,
  listRecoveryMarkers,
  markRecoveryPending,
  readRecoveryMarker,
  recoveryKeyFor,
  serverAnswerFromDatabase,
  serverAnswerFromUser,
  subscribeToRecoveryMarkerChanges,
  withAccountDeletionLock,
  advanceRecoveryMarkerToLocalCleanup,
  type DeletionStatus,
  type MarkerState,
  type ServerAnswer,
} from '@/lib/accountDeletion';

const ATTEMPT_A = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_B = '22222222-2222-4222-8222-222222222222';

/* ================================================================== *
 * C1 bug condition: isBugConditionC1(input) =
 *   input.httpStatus <> 200 AND input.body.dataRemoved = TRUE
 *
 * The counterexample that used to be silently discarded: a 500 response whose
 * body says the application data IS gone. Before the fix the whole error body
 * was thrown away and every failure collapsed into `{ ok: false }`.
 * ================================================================== */
describe('C1 - truthful three-valued deletion classification', () => {
  it('classifies a non-200 body carrying dataRemoved=true as partially_deleted', () => {
    const body = { error: 'login could not be deleted', dataRemoved: true, warnings: [] };
    expect(classifyDeletionErrorBody(body)).toEqual({
      status: 'partially_deleted',
      dataRemoved: true,
      warnings: [],
    });
  });

  it('classifies a non-200 body with dataRemoved=false as failed', () => {
    expect(classifyDeletionErrorBody({ error: 'nope', dataRemoved: false, warnings: [] }))
      .toEqual({ status: 'failed', dataRemoved: false, warnings: [] });
  });

  it('distinguishes a safely cancelled deletion from an ordinary failure', () => {
    expect(classifyDeletionErrorBody({
      error: 'shared encrypted history must be preserved',
      dataRemoved: false,
      deletionCancelled: true,
      warnings: [],
    })).toEqual({ status: 'cancelled', dataRemoved: false, warnings: [] });
  });

  it('enters recovery when the server cannot prove that its cancellation fence was cleared', () => {
    expect(classifyDeletionErrorBody({
      error: 'cancellation could not be completed',
      dataRemoved: false,
      recoveryRequired: true,
      warnings: [],
    })).toEqual({ status: 'recovery_required', dataRemoved: false, warnings: [] });
  });

  it('never lets a cancellation flag hide an explicit partial deletion', () => {
    expect(classifyDeletionErrorBody({
      dataRemoved: true,
      deletionCancelled: true,
      recoveryRequired: true,
      warnings: [],
    })).toEqual({ status: 'partially_deleted', dataRemoved: true, warnings: [] });
  });

  it('classifies an UNREADABLE body as failed, never a fabricated partial deletion', () => {
    for (const body of [null, undefined, 'not json', 42, [], {}]) {
      expect(classifyDeletionErrorBody(body).status).toBe('failed');
      expect(classifyDeletionErrorBody(body).dataRemoved).toBe(false);
    }
  });

  it('requires an explicit success acknowledgement for `deleted`', () => {
    expect(classifyDeletionSuccess({ success: true, warnings: [] }).status).toBe('deleted');
    // Never inferred from the absence of a transport error.
    for (const body of [{}, { success: 'true' }, { success: 1 }, null, undefined]) {
      expect(classifyDeletionSuccess(body).status).toBe('failed');
    }
  });

  it('coerces warnings defensively without propagating garbage', () => {
    expect(coerceWarnings({ warnings: ['a', 1, null, 'b'] })).toEqual(['a', 'b']);
    expect(coerceWarnings({ warnings: 'nope' })).toEqual([]);
    expect(coerceWarnings(null)).toEqual([]);
  });

  it('never reports dataRemoved=true together with status failed', () => {
    const bodies: unknown[] = [
      null, {}, { dataRemoved: true }, { dataRemoved: false }, { dataRemoved: 'true' },
      { success: true }, { success: false }, 'x', 0,
    ];
    for (const body of bodies) {
      for (const outcome of [classifyDeletionErrorBody(body), classifyDeletionSuccess(body)]) {
        expect(outcome.dataRemoved).toBe(
          outcome.status === 'deleted' || outcome.status === 'partially_deleted',
        );
      }
    }
  });
});

/* ================================================================== *
 * C1 durability: the dedicated per-user marker, outside STORE_KEY.
 * ================================================================== */
describe('C1 - per-user recovery marker fails closed', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('stores and reads back a content-free V2 pending attempt before returning it', () => {
    const marker = markRecoveryPending('user-a');
    expect(recoveryKeyFor('user-a')).toBe(`${RECOVERY_KEY_PREFIX}user-a`);
    expect(marker).toMatchObject({
      version: 2,
      userId: 'user-a',
      phase: 'pending',
    });
    expect(marker?.attemptId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(JSON.parse(localStorage.getItem(recoveryKeyFor('user-a')) || 'null')).toEqual(marker);
    // Not inside STORE_KEY, and carrying no deleted-account content.
    expect(localStorage.getItem('gomsinlog.state.v2')).toBeNull();
  });

  it('distinguishes the content-free local-cleanup phase without weakening fail-closed reads', () => {
    const attempt = markRecoveryPending('user-a');
    expect(attempt).not.toBeNull();
    expect(advanceRecoveryMarkerToLocalCleanup(attempt!)).toBe(true);

    expect(JSON.parse(localStorage.getItem(recoveryKeyFor('user-a')) || 'null')).toMatchObject({
      version: 2,
      userId: 'user-a',
      phase: 'local_cleanup',
    });
    expect(readRecoveryMarker('user-a')).toBe('active');
    expect(isLocalDeletionCleanupPending('user-a')).toBe(true);

    localStorage.setItem(recoveryKeyFor('user-a'), '{"broken":');
    expect(readRecoveryMarker('user-a')).toBe('active');
    expect(isLocalDeletionCleanupPending('user-a')).toBe(false);
  });

  it('never grants legacy local_cleanup destructive-cleanup authority', () => {
    localStorage.setItem(recoveryKeyFor('user-a'), 'local_cleanup');

    expect(readRecoveryMarker('user-a')).toBe('active');
    expect(inspectRecoveryMarker('user-a')).toMatchObject({ kind: 'legacy_local_cleanup' });
    expect(isLocalDeletionCleanupPending('user-a')).toBe(false);
  });

  it('returns absent ONLY for a genuinely missing key', () => {
    expect(readRecoveryMarker('user-a')).toBe('absent');
  });

  /**
   * Fail-closed totality. NOTE FOR FUTURE REFACTORS: the `removeItem`
   * assertion below is the one most likely to be deleted by a well-meaning
   * "clean up bad data" change. Removing it reintroduces the fail-open defect.
   */
  it('treats EVERY present value as active and never removes the key', () => {
    const removeItem = vi.fn();
    const storage = {
      getItem: (key: string) => localStorage.getItem(key),
      removeItem,
    };
    const values = [
      'true', 'false', '', ' ', '0', '1', 'null', 'undefined', '{}', '[]',
      '{"broken":', 'not json at all', '"true"', '{"accountDeletionRecovery":false}',
      JSON.stringify({ warnings: ['x'] }), '\u0000',
    ];
    for (const value of values) {
      localStorage.setItem(recoveryKeyFor('user-a'), value);
      expect(readRecoveryMarker('user-a', storage), `value=${JSON.stringify(value)}`).toBe('active');
      expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBe(value);
    }
    expect(removeItem).not.toHaveBeenCalledWith(recoveryKeyFor('user-a'));
  });

  it('is per-user: another account is neither blocked by nor able to clear it', () => {
    const marker = markRecoveryPending('user-a');
    expect(readRecoveryMarker('user-b')).toBe('absent');
    expect(clearRecoveryMarkerForAttempt({ ...marker!, userId: 'user-b' }, 'pending')).toBe(false);
    expect(readRecoveryMarker('user-a')).toBe('active');
  });

  it('fails closed when storage itself is unreadable', () => {
    const unreadableStorage = {
      getItem: () => { throw new Error('storage disabled'); },
    };
    expect(readRecoveryMarker('user-a', unreadableStorage)).toBe('active');
  });

  it('an exact V2 attempt clears only its own key', () => {
    const markerA = markRecoveryPending('user-a');
    markRecoveryPending('user-b');
    expect(clearRecoveryMarkerForAttempt(markerA!, 'pending')).toBe(true);
    expect(readRecoveryMarker('user-a')).toBe('absent');
    expect(readRecoveryMarker('user-b')).toBe('active');
  });

  it.each([
    ['legacy pending', 'true'],
    ['legacy local cleanup', 'local_cleanup'],
    ['corrupt', '{broken'],
    ['wrong-user V2', JSON.stringify({
      version: 2, userId: 'user-b', attemptId: ATTEMPT_B, phase: 'pending',
    })],
    ['V2 local cleanup', JSON.stringify({
      version: 2, userId: 'user-a', attemptId: ATTEMPT_A, phase: 'local_cleanup',
    })],
  ])('does not overwrite a fenced %s marker when marking pending', (_label, raw) => {
    localStorage.setItem(recoveryKeyFor('user-a'), raw);

    expect(markRecoveryPending('user-a', localStorage, () => ATTEMPT_B)).toBeNull();
    expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBe(raw);
  });

  it('reuses a pending attempt id and rejects a stale transition or clear', () => {
    const first = markRecoveryPending('user-a', localStorage, () => ATTEMPT_A);
    const retry = markRecoveryPending('user-a', localStorage, () => ATTEMPT_B);
    expect(retry).toEqual(first);

    const stale = { ...first!, attemptId: ATTEMPT_B };
    expect(advanceRecoveryMarkerToLocalCleanup(stale)).toBe(false);
    expect(clearRecoveryMarkerForAttempt(stale, 'pending')).toBe(false);
    expect(inspectRecoveryMarker('user-a')).toMatchObject({
      kind: 'v2',
      phase: 'pending',
      marker: { attemptId: ATTEMPT_A },
    });
  });

  it('returns null when an exact marker read-back cannot be proven', () => {
    let raw: string | null = null;
    const storage = {
      getItem: () => raw === null ? null : `${raw}corrupted`,
      setItem: (_key: string, value: string) => { raw = value; },
      removeItem: () => { raw = null; },
    };
    expect(markRecoveryPending('user-a', storage, () => ATTEMPT_A)).toBeNull();
  });

  it('inspects and lists V2, legacy cleanup, legacy pending, and corrupt markers fail closed', () => {
    localStorage.setItem(recoveryKeyFor('user-a'), JSON.stringify({
      version: 2, userId: 'user-a', attemptId: ATTEMPT_A, phase: 'pending',
    }));
    localStorage.setItem(recoveryKeyFor('user-b'), 'local_cleanup');
    localStorage.setItem(recoveryKeyFor('user-c'), 'true');
    localStorage.setItem(recoveryKeyFor('user-d'), '{broken');

    expect(inspectRecoveryMarker('user-a')).toMatchObject({ kind: 'v2', phase: 'pending' });
    expect(inspectRecoveryMarker('user-b')).toEqual({
      kind: 'legacy_local_cleanup', userId: 'user-b', phase: 'local_cleanup',
    });
    expect(inspectRecoveryMarker('user-c')).toEqual({
      kind: 'legacy_pending', userId: 'user-c', phase: 'pending',
    });
    expect(inspectRecoveryMarker('user-d')).toEqual({
      kind: 'corrupt', userId: 'user-d', phase: 'pending',
    });
    expect(listRecoveryMarkers().map(({ userId, phase }) => [userId, phase]).sort())
      .toEqual([
        ['user-a', 'pending'],
        ['user-b', 'local_cleanup'],
        ['user-c', 'pending'],
        ['user-d', 'pending'],
      ]);
  });

  it('notifies same-document subscribers only until they unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToRecoveryMarkerChanges(listener);
    const marker = markRecoveryPending('user-a', localStorage, () => ATTEMPT_A);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(clearRecoveryMarkerForAttempt(marker!, 'pending')).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    markRecoveryPending('user-b', localStorage, () => ATTEMPT_B);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('allows prior shared mutations to overlap while an exclusive deletion and later mutation wait fairly', async () => {
    let releaseShared!: () => void;
    const sharedBarrier = new Promise<void>((resolve) => { releaseShared = resolve; });
    let releaseDeletion!: () => void;
    const deletionBarrier = new Promise<void>((resolve) => { releaseDeletion = resolve; });
    const entered: string[] = [];

    const first = withAccountDeletionLock('user-a', async () => {
      entered.push('shared-1');
      await sharedBarrier;
    }, { mode: 'shared' });
    const second = withAccountDeletionLock('user-a', async () => {
      entered.push('shared-2');
      await sharedBarrier;
    }, { mode: 'shared' });

    await vi.waitFor(() => expect(entered).toEqual(['shared-1', 'shared-2']));

    const deletion = withAccountDeletionLock('user-a', async () => {
      entered.push('deletion');
      await deletionBarrier;
    });
    const lateMutation = withAccountDeletionLock('user-a', async () => {
      entered.push('shared-late');
    }, { mode: 'shared' });
    await Promise.resolve();
    expect(entered).toEqual(['shared-1', 'shared-2']);

    releaseShared();
    await vi.waitFor(() => expect(entered).toEqual(['shared-1', 'shared-2', 'deletion']));
    releaseDeletion();
    await Promise.all([first, second, deletion, lateMutation]);
    expect(entered).toEqual(['shared-1', 'shared-2', 'deletion', 'shared-late']);
  });

  it('issues a branded lease that is valid only for the locked user', async () => {
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: vi.fn(async (
          name: string,
          _options: LockOptions,
          callback: (lock: Lock | null) => unknown,
        ) => callback({ name, mode: 'exclusive' } as Lock)),
      },
    });

    const result = await withAccountDeletionLock('user-a', async (lease) => ({
      own: accountDeletionLockLeaseMatchesUser(lease, 'user-a'),
      other: accountDeletionLockLeaseMatchesUser(lease, 'user-b'),
    }));

    expect(result).toEqual({ kind: 'acquired', value: { own: true, other: false } });
    Reflect.deleteProperty(navigator, 'locks');
  });

  it('expires a branded lease when its lock callback ends', async () => {
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: vi.fn(async (
          name: string,
          _options: LockOptions,
          callback: (lock: Lock | null) => unknown,
        ) => callback({ name, mode: 'exclusive' } as Lock)),
      },
    });
    let captured: Parameters<typeof accountDeletionLockLeaseMatchesUser>[0];

    await withAccountDeletionLock('user-a', async (lease) => {
      captured = lease;
      expect(accountDeletionLockLeaseMatchesUser(lease, 'user-a')).toBe(true);
    });

    expect(accountDeletionLockLeaseMatchesUser(captured, 'user-a')).toBe(false);
    Reflect.deleteProperty(navigator, 'locks');
  });
});

/* ================================================================== *
 * C1 tri-state (clause 1.28): a failed or timed-out check must not be
 * indistinguishable from an authoritative negative.
 *
 * Tri-State Verification Suite - test 1 (classification is total and
 * exclusive) and the representational half of test 2.
 * ================================================================== */
describe('Tri-State Verification Suite - 1. classification is total and exclusive', () => {
  beforeEach(() => localStorage.clear());

  const answers: Array<[string, ServerAnswer]> = [
    ['server says pending', { kind: 'pending' }],
    ['server says not pending', { kind: 'not_pending' }],
    ['server could not answer', { kind: 'unavailable' }],
  ];

  /**
   * Totality BY ENUMERATION over all nine combinations. This is what catches an
   * ordering regression that swaps orders 1 and 2 and quietly turns
   * "marker present, server clear" into `clear`.
   */
  it('maps all nine marker x answer combinations to exactly one variant', () => {
    const removeItem = vi.fn();
    const storage = {
      getItem: (key: string) => localStorage.getItem(key),
      removeItem,
    };
    const markers: Array<[string, string | null]> = [
      ['absent', null],
      ['valid positive', 'true'],
      ['malformed', '{"broken":'],
    ];
    const seen: string[] = [];
    for (const [markerLabel, stored] of markers) {
      for (const [answerLabel, answer] of answers) {
        localStorage.clear();
        if (stored !== null) localStorage.setItem(recoveryKeyFor('user-a'), stored);
        const marker: MarkerState = readRecoveryMarker('user-a', storage);
        const status = classifyDeletionStatus(marker, answer);
        const label = `${markerLabel} / ${answerLabel}`;
        expect(['pending', 'clear', 'unknown'], label).toContain(status.kind);
        // Exactly one variant: the object has a single discriminant and nothing else.
        expect(Object.keys(status), label).toEqual(['kind']);
        seen.push(`${label} => ${status.kind}`);
        if (stored !== null) {
          expect(localStorage.getItem(recoveryKeyFor('user-a')), label).toBe(stored);
        }
      }
    }
    expect(seen).toHaveLength(9);
    expect(removeItem).not.toHaveBeenCalledWith(recoveryKeyFor('user-a'));
  });

  it('resolves (marker present, server not pending) to PENDING, not clear', () => {
    localStorage.setItem(recoveryKeyFor('user-a'), 'true');
    const status = classifyDeletionStatus(readRecoveryMarker('user-a'), { kind: 'not_pending' });
    expect(status).toEqual({ kind: 'pending' });
  });

  it('resolves a malformed marker to PENDING in all three answer columns', () => {
    localStorage.setItem(recoveryKeyFor('user-a'), '{"broken":');
    for (const [, answer] of answers) {
      expect(classifyDeletionStatus(readRecoveryMarker('user-a'), answer))
        .toEqual({ kind: 'pending' });
    }
  });

  it('resolves (no marker, unavailable) to UNKNOWN and (no marker, not pending) to CLEAR', () => {
    expect(classifyDeletionStatus('absent', { kind: 'unavailable' })).toEqual({ kind: 'unknown' });
    expect(classifyDeletionStatus('absent', { kind: 'not_pending' })).toEqual({ kind: 'clear' });
    expect(classifyDeletionStatus('absent', { kind: 'pending' })).toEqual({ kind: 'pending' });
  });

  it('accepts an Auth answer only from the expected real user', () => {
    expect(serverAnswerFromUser('user-a', {
      id: 'user-a',
      app_metadata: { account_deletion_pending: true },
    })).toEqual({ kind: 'pending' });
    expect(serverAnswerFromUser('user-a', {
      id: 'user-a',
      app_metadata: { account_deletion_pending: false },
    })).toEqual({ kind: 'not_pending' });
    for (const user of [
      null,
      undefined,
      {},
      { id: 'user-b', app_metadata: { account_deletion_pending: true } },
      { id: 'user-a' },
      { id: 'user-a', app_metadata: null },
      { id: 'user-a', app_metadata: 'not-an-object' },
      { id: 'user-a', app_metadata: [] },
    ]) {
      expect(serverAnswerFromUser('user-a', user)).toEqual({ kind: 'unavailable' });
    }
  });

  it('preserves unrelated app_metadata fields in the answer decision', () => {
    expect(serverAnswerFromUser('user-a', {
      id: 'user-a',
      app_metadata: { provider: 'google', providers: ['google'], account_deletion_pending: true },
    })).toEqual({ kind: 'pending' });
  });

  it('accepts only literal booleans from the database authority', () => {
    expect(serverAnswerFromDatabase(true)).toEqual({ kind: 'pending' });
    expect(serverAnswerFromDatabase(false)).toEqual({ kind: 'not_pending' });
    for (const malformed of [null, undefined, 'true', 'false', 1, 0, {}, []]) {
      expect(serverAnswerFromDatabase(malformed)).toEqual({ kind: 'unavailable' });
    }
  });

  it('uses positive dominance and requires two explicit negatives to clear', () => {
    const pending: ServerAnswer = { kind: 'pending' };
    const notPending: ServerAnswer = { kind: 'not_pending' };
    const unavailable: ServerAnswer = { kind: 'unavailable' };

    expect(combineServerAnswers(pending, unavailable)).toEqual(pending);
    expect(combineServerAnswers(unavailable, pending)).toEqual(pending);
    expect(combineServerAnswers(pending, notPending)).toEqual(pending);
    expect(combineServerAnswers(notPending, pending)).toEqual(pending);
    expect(combineServerAnswers(notPending, notPending)).toEqual(notPending);
    expect(combineServerAnswers(notPending, unavailable)).toEqual(unavailable);
    expect(combineServerAnswers(unavailable, notPending)).toEqual(unavailable);
    expect(combineServerAnswers(unavailable, unavailable)).toEqual(unavailable);
  });
});

describe('Tri-State Verification Suite - 2a. unknown is representationally distinct', () => {
  it('logs a distinct token per variant; never false, null or omitted', () => {
    expect(deletionStatusLogToken({ kind: 'unknown' })).toBe('deletion_status=unknown');
    expect(deletionStatusLogToken({ kind: 'clear' })).toBe('deletion_status=clear');
    expect(deletionStatusLogToken({ kind: 'pending' })).toBe('deletion_status=pending');
    const tokens = (['pending', 'clear', 'unknown'] as const)
      .map((kind) => deletionStatusLogToken({ kind }));
    expect(new Set(tokens).size).toBe(3);
    for (const token of tokens) {
      expect(token).not.toMatch(/=(false|null|undefined|)$/);
    }
  });

  it('serializes unknown differently from clear', () => {
    expect(JSON.stringify({ kind: 'unknown' } satisfies DeletionStatus))
      .not.toBe(JSON.stringify({ kind: 'clear' } satisfies DeletionStatus));
  });

  /**
   * TYPE-LEVEL assertion. The value-only version of this test would pass
   * against a `boolean | null` implementation that happens to branch correctly
   * today, which is exactly why this is required: defect 1.28 was
   * REPRESENTATIONAL, so the fix has to be enforced by the type-checker.
   */
  it('rejects collapsing representations at the type level', () => {
    // @ts-expect-error -- a boolean can never stand in for a three-variant union
    const asBoolean: DeletionStatus = true;
    // @ts-expect-error -- nor can a nullable boolean
    const asNullableBoolean: DeletionStatus = null;
    // @ts-expect-error -- nor an omitted/optional flag object
    const asOptionalFlag: DeletionStatus = { deletionPending: undefined };
    // @ts-expect-error -- nor a bare negatable string
    const asBareString: DeletionStatus = 'clear';
    // @ts-expect-error -- and a fourth variant is not admissible either
    const asFourthVariant: DeletionStatus = { kind: 'maybe' };
    expect([asBoolean, asNullableBoolean, asOptionalFlag, asBareString, asFourthVariant])
      .toHaveLength(5);
  });

  it('fails exhaustiveness when a variant is unhandled', () => {
    // A `switch` missing the `unknown` arm falls through to `assertNever`, which
    // is a compile-time error in real code and a throw at runtime.
    const missingUnknownArm = (status: DeletionStatus): string => {
      switch (status.kind) {
        case 'pending':
          return 'pending';
        case 'clear':
          return 'clear';
        default:
          // @ts-expect-error -- `{ kind: 'unknown' }` is not `never` here
          return assertNever(status);
      }
    };
    expect(() => missingUnknownArm({ kind: 'unknown' })).toThrow(/unhandled deletion status/);
    expect(missingUnknownArm({ kind: 'pending' })).toBe('pending');
  });
});

afterEach(() => {
  localStorage.clear();
});
