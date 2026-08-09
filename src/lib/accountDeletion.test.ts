import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  RECOVERY_KEY_PREFIX,
  assertNever,
  classifyDeletionErrorBody,
  classifyDeletionStatus,
  classifyDeletionSuccess,
  clearRecoveryMarker,
  coerceWarnings,
  deletionStatusLogToken,
  markRecoveryPending,
  readRecoveryMarker,
  recoveryKeyFor,
  serverAnswerFromUser,
  type DeletionStatus,
  type MarkerState,
  type ServerAnswer,
} from '@/lib/accountDeletion';

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
        expect(outcome.dataRemoved).toBe(outcome.status !== 'failed');
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

  it('stores a boolean-only payload at its own top-level key', () => {
    markRecoveryPending('user-a');
    expect(recoveryKeyFor('user-a')).toBe(`${RECOVERY_KEY_PREFIX}user-a`);
    expect(localStorage.getItem(recoveryKeyFor('user-a'))).toBe('true');
    // Not inside STORE_KEY, and carrying no deleted-account content.
    expect(localStorage.getItem('gomsinlog.state.v2')).toBeNull();
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
    markRecoveryPending('user-a');
    expect(readRecoveryMarker('user-b')).toBe('absent');
    clearRecoveryMarker('user-b');
    expect(readRecoveryMarker('user-a')).toBe('active');
  });

  it('fails closed when storage itself is unreadable', () => {
    const unreadableStorage = {
      getItem: () => { throw new Error('storage disabled'); },
    };
    expect(readRecoveryMarker('user-a', unreadableStorage)).toBe('active');
  });

  it('clearRecoveryMarker removes exactly the one key', () => {
    markRecoveryPending('user-a');
    markRecoveryPending('user-b');
    clearRecoveryMarker('user-a');
    expect(readRecoveryMarker('user-a')).toBe('absent');
    expect(readRecoveryMarker('user-b')).toBe('active');
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

  it('reads the pending flag only from an authoritative user payload', () => {
    expect(serverAnswerFromUser({ app_metadata: { account_deletion_pending: true } }))
      .toEqual({ kind: 'pending' });
    // Anything that is not an explicit `true` is a positive negative, never
    // `unavailable` -- this function is only ever called with a real answer.
    for (const user of [null, undefined, {}, { app_metadata: {} },
      { app_metadata: { account_deletion_pending: false } },
      { app_metadata: { account_deletion_pending: 'true' } }]) {
      expect(serverAnswerFromUser(user)).toEqual({ kind: 'not_pending' });
    }
  });

  it('preserves unrelated app_metadata fields in the answer decision', () => {
    expect(serverAnswerFromUser({
      app_metadata: { provider: 'google', providers: ['google'], account_deletion_pending: true },
    })).toEqual({ kind: 'pending' });
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
