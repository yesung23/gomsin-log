/**
 * Contract tests for the CONCRETE Supabase adapter.
 *
 * The flow tests run against an in-memory server. That proves the protocol
 * works; it proves nothing about whether this adapter speaks PostgREST
 * correctly, and a `bytea` written as a bare hex string or an epoch selected as
 * a JSON number is the kind of defect that only surfaces in production, months
 * later, as material nobody can decrypt.
 *
 * So these tests drive the real class against a transport shaped like the real
 * client's responses, and assert on the exact wire values: the `\x` form, the
 * `::text` casts, the RPC argument names, the enum vocabularies, and — most
 * importantly — that every error propagates instead of becoming an empty result.
 */

import { describe, expect, it } from 'vitest';
import { hex, unhex } from '@/crypto/bytes';
import { decodeBytea, encodeBytea, E2eeCodecError } from './codec';
import {
  E2eeRepositoryError,
  SupabaseE2eeRepository,
  type E2eeQuery,
  type E2eeTable,
  type E2eeTransport,
  type PostgrestLikeError,
  type Row,
  type TransportResult,
} from './SupabaseE2eeRepository';

// ---------------------------------------------------------------------------
// A transport shaped like supabase-js
// ---------------------------------------------------------------------------

type Recorded = {
  table: string;
  op: 'select' | 'insert' | 'update';
  columns: string | null;
  values: Row | null;
  filters: { method: string; column: string; value: unknown }[];
  terminal: 'single' | 'maybeSingle' | 'list';
};

type Reply = TransportResult<unknown>;

function ok(data: unknown): Reply {
  return { data, error: null };
}

function boom(message: string, code?: string): Reply {
  return { data: null, error: { message, code } as PostgrestLikeError };
}

function createMockTransport(replies: Reply[]) {
  const queue = [...replies];
  const queries: Recorded[] = [];
  const rpcs: { fn: string; args?: Row }[] = [];
  const invocations: { name: string; body: Row }[] = [];

  const next = (): Reply => queue.shift() ?? ok(null);

  function builder(record: Recorded): E2eeQuery {
    const query = {
      select(columns?: string) {
        record.columns = columns ?? null;
        return query;
      },
      eq(column: string, value: unknown) {
        record.filters.push({ method: 'eq', column, value });
        return query;
      },
      in(column: string, value: readonly unknown[]) {
        record.filters.push({ method: 'in', column, value });
        return query;
      },
      is(column: string, value: null) {
        record.filters.push({ method: 'is', column, value });
        return query;
      },
      order(column: string, options?: { ascending?: boolean }) {
        record.filters.push({ method: 'order', column, value: options });
        return query;
      },
      limit(count: number) {
        record.filters.push({ method: 'limit', column: '', value: count });
        return query;
      },
      single() {
        record.terminal = 'single';
        return Promise.resolve(next() as TransportResult<Row>);
      },
      maybeSingle() {
        record.terminal = 'maybeSingle';
        return Promise.resolve(next() as TransportResult<Row>);
      },
      then<TResult1, TResult2>(
        onfulfilled?: ((value: TransportResult<Row[]>) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        return Promise.resolve(next() as TransportResult<Row[]>).then(onfulfilled, onrejected);
      },
    } as unknown as E2eeQuery;
    return query;
  }

  const transport: E2eeTransport = {
    from(table: string): E2eeTable {
      const make = (op: Recorded['op'], values: Row | null) => {
        const record: Recorded = { table, op, columns: null, values, filters: [], terminal: 'list' };
        queries.push(record);
        return builder(record);
      };
      return {
        select: (columns?: string) => {
          const query = make('select', null);
          return query.select(columns);
        },
        insert: (values: Row) => make('insert', values),
        update: (values: Row) => make('update', values),
      };
    },
    rpc(fn: string, args?: Row) {
      rpcs.push({ fn, args });
      return Promise.resolve(next());
    },
    functions: {
      invoke(name: string, options: { body: Row }) {
        invocations.push({ name, body: options.body });
        return Promise.resolve(next());
      },
    },
  };

  return { transport, queries, rpcs, invocations };
}

function repositoryWith(replies: Reply[]) {
  const mock = createMockTransport(replies);
  return { repository: new SupabaseE2eeRepository(mock.transport), ...mock };
}

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';
const UUID_C = '33333333-3333-4333-8333-333333333333';

const SPKI = new Uint8Array(91).fill(7);
const FP32 = new Uint8Array(32).fill(9);
const CERT = new Uint8Array(445).fill(4);
const ENVELOPE = new Uint8Array(360).fill(5);
const SIG64 = new Uint8Array(64).fill(6);
const NONCE12 = new Uint8Array(12).fill(1);
const SEALED = new Uint8Array(140).fill(2);

// ---------------------------------------------------------------------------
// bytea
// ---------------------------------------------------------------------------

describe('bytea', () => {
  it('writes the Postgres hex form and reads it back byte for byte', () => {
    const bytes = unhex('00ff10deadbeef');
    expect(encodeBytea(bytes)).toBe('\\x00ff10deadbeef');
    expect(hex(decodeBytea('\\x00ff10deadbeef', 'x'))).toBe('00ff10deadbeef');
  });

  it('round-trips the empty value', () => {
    expect(encodeBytea(new Uint8Array(0))).toBe('\\x');
    expect(decodeBytea('\\x', 'x')).toHaveLength(0);
  });

  it('refuses a bare hex string, which is ambiguous with a text column', () => {
    expect(() => decodeBytea('deadbeef', 'devices.sig_spki')).toThrow(/E_BYTEA_FORMAT/);
  });

  it('refuses odd-length and non-hex payloads rather than coercing them', () => {
    expect(() => decodeBytea('\\xabc', 'x')).toThrow(/E_BYTEA_FORMAT/);
    expect(() => decodeBytea('\\xzz', 'x')).toThrow(/E_BYTEA_FORMAT/);
  });

  it('refuses a null where bytes are required', () => {
    expect(() => decodeBytea(null, 'devices.sig_spki')).toThrow(E2eeCodecError);
  });

  it('accepts a driver that already decoded to bytes', () => {
    expect(hex(decodeBytea(new Uint8Array([1, 2]), 'x'))).toBe('0102');
    expect(hex(decodeBytea([1, 2], 'x'))).toBe('0102');
  });

  it('sends every key column as \\x on insert', async () => {
    const { repository, queries } = repositoryWith([ok({ id: UUID_A })]);
    await repository.insertDevice({
      id: UUID_A,
      userId: UUID_B,
      sigSpki: SPKI,
      kemSpki: SPKI,
      platform: 'ios',
      assurance: 'secure_enclave',
      status: 'PENDING',
    });
    const values = queries[0].values!;
    expect(values.sig_spki).toBe(`\\x${hex(SPKI)}`);
    expect(values.kem_spki).toBe(`\\x${hex(SPKI)}`);
    expect(values.platform).toBe('ios');
    expect(queries[0].table).toBe('devices');
    expect(queries[0].terminal).toBe('single');
  });
});

describe('write-floor adapter', () => {
  it('reads a missing floor as zero and keeps scope kind explicit', async () => {
    const { repository, queries } = repositoryWith([ok(null)]);
    await expect(repository.getWriteFloor('personal', UUID_A)).resolves.toBe(0);
    expect(queries[0]).toMatchObject({ table: 'crypto_write_floor', op: 'select' });
    expect(queries[0].filters).toEqual([
      { method: 'eq', column: 'scope_kind', value: 'user' },
      { method: 'eq', column: 'scope_id', value: UUID_A },
    ]);
  });

  it('activates a floor only through the guarded RPC contract', async () => {
    const { repository, rpcs, queries } = repositoryWith([ok(true)]);
    await repository.activateWriteFloor('couple', UUID_A, UUID_B);
    expect(rpcs).toEqual([{
      fn: 'activate_e2ee_write_floor',
      args: { p_scope_kind: 'couple', p_scope_id: UUID_A, p_device_id: UUID_B },
    }]);
    expect(queries).toHaveLength(0);
  });
});

describe('pairing ceremony adapter', () => {
  it('uses actor-bound RPCs and bytea encoding instead of direct table writes', async () => {
    const transcript = new Uint8Array(440).fill(3);
    const nonce = new Uint8Array(32).fill(4);
    const hash = new Uint8Array(32).fill(5);
    const signature = new Uint8Array(64).fill(6);
    const { repository, rpcs, queries } = repositoryWith([ok(UUID_A), ok('CONFIRMED_ONE'), ok(null)]);

    await expect(repository.startPairing({
      coupleId: UUID_B,
      pairingNonce: nonce,
      transcript,
      transcriptHash: hash,
      createdAt: '2026-08-26T00:00:00.000Z',
      expiresAt: '2026-08-26T00:05:00.000Z',
    })).resolves.toBe(UUID_A);
    await repository.confirmPairing({ pairingId: UUID_A, deviceId: UUID_C, signature });
    await repository.markPairingActive({ pairingId: UUID_A, scopeKeyId: UUID_B });

    expect(rpcs).toEqual([
      {
        fn: 'e2ee_start_couple_pairing',
        args: {
          p_couple_id: UUID_B,
          p_pairing_nonce: `\\x${hex(nonce)}`,
          p_transcript: `\\x${hex(transcript)}`,
          p_transcript_hash: `\\x${hex(hash)}`,
          p_created_at: '2026-08-26T00:00:00.000Z',
          p_expires_at: '2026-08-26T00:05:00.000Z',
        },
      },
      {
        fn: 'e2ee_confirm_couple_pairing',
        args: {
          p_pairing_id: UUID_A,
          p_device_id: UUID_C,
          p_signature: `\\x${hex(signature)}`,
        },
      },
      {
        fn: 'e2ee_mark_couple_pairing_active',
        args: { p_pairing_id: UUID_A, p_scope_key_id: UUID_B },
      },
    ]);
    expect(queries).toHaveLength(0);
  });

  it('round-trips the persisted transcript and authoritative timestamps', async () => {
    const transcript = new Uint8Array(440).fill(7);
    const { repository, queries } = repositoryWith([ok({
      id: UUID_A,
      couple_id: UUID_B,
      state: 'TRANSCRIPT_PROPOSED',
      pairing_nonce: encodeBytea(new Uint8Array(32)),
      transcript: encodeBytea(transcript),
      transcript_hash: encodeBytea(new Uint8Array(32)),
      confirmed_low_signature: null,
      confirmed_low_device_id: null,
      confirmed_high_signature: null,
      confirmed_high_device_id: null,
      created_at: '2026-08-26T00:00:00.000Z',
      expires_at: '2026-08-26T00:05:00.000Z',
    })]);
    const row = await repository.getPairing(UUID_B);
    expect(row?.transcript).toEqual(transcript);
    expect(row?.createdAt).toBe('2026-08-26T00:00:00.000Z');
    expect(queries[0].columns).toContain('transcript');
    expect(queries[0].columns).toContain('created_at');
    expect(queries[0].filters).toContainEqual({
      method: 'in',
      column: 'state',
      value: [
        'CRYPTO_PENDING', 'TRANSCRIPT_PROPOSED', 'CONFIRMED_ONE',
        'CONFIRMED_BOTH', 'EPOCH_PREPARING', 'CRYPTO_ACTIVE',
      ],
    });
  });

  it('maps a committed expiration result to the existing app error', async () => {
    const { repository } = repositoryWith([ok('TRANSCRIPT_EXPIRED')]);

    await expect(repository.confirmPairing({
      pairingId: UUID_A,
      deviceId: UUID_B,
      signature: SIG64,
    })).rejects.toMatchObject({ code: 'E_TRANSCRIPT_EXPIRED' });
  });

  it('fails closed on an unexpected confirmation response', async () => {
    const { repository } = repositoryWith([ok(null)]);

    await expect(repository.confirmPairing({
      pairingId: UUID_A,
      deviceId: UUID_B,
      signature: SIG64,
    })).rejects.toMatchObject({ code: 'E_DB_SHAPE' });
  });
});

// ---------------------------------------------------------------------------
// bigint
// ---------------------------------------------------------------------------

describe('bigint', () => {
  it('selects key_epoch as text, so nothing above 2^53 is rewritten', async () => {
    const { repository, queries } = repositoryWith([ok([{
      id: UUID_A,
      domain: 'personal',
      scope_id: UUID_B,
      key_epoch: '9223372036854775807',
      state: 'ACTIVE',
      owner_user_id: UUID_B,
      owner_couple_id: null,
    }])]);
    const keys = await repository.listScopeKeys('personal', UUID_B);
    expect(queries[0].columns).toContain('key_epoch::text');
    expect(keys[0].epoch).toBe(9223372036854775807n);
    expect(typeof keys[0].epoch).toBe('bigint');
  });

  it('writes an epoch as a decimal string, never as a JSON number', async () => {
    const { repository, queries } = repositoryWith([ok({ id: UUID_C })]);
    await repository.insertScopeKey({
      domain: 'couple',
      scopeId: UUID_B,
      epoch: 9007199254740995n,
      state: 'PREPARING',
      ownerUserId: null,
      ownerCoupleId: UUID_B,
    });
    expect(queries[0].values!.key_epoch).toBe('9007199254740995');
    expect(typeof queries[0].values!.key_epoch).toBe('string');
  });

  it('refuses a JSON number that already lost precision', async () => {
    const { repository } = repositoryWith([ok([{
      id: UUID_A,
      domain: 'personal',
      scope_id: UUID_B,
      key_epoch: 9223372036854776000,
      state: 'ACTIVE',
      owner_user_id: UUID_B,
      owner_couple_id: null,
    }])]);
    await expect(repository.listScopeKeys('personal', UUID_B))
      .rejects.toThrow(/unsafe JSON number/);
  });

  it('reads a revocation sequence as text and keeps it exact', async () => {
    const { repository, queries } = repositoryWith([ok([{
      id: UUID_A,
      user_id: UUID_B,
      revoked_device_id: UUID_C,
      revoker_device_id: UUID_A,
      reason: 3,
      statement: encodeBytea(new Uint8Array(203)),
      signature: encodeBytea(SIG64),
      sequence: '4611686018427387904',
      log_head: encodeBytea(FP32),
    }])]);
    const revocations = await repository.listRevocations(UUID_B);
    expect(queries[0].columns).toContain('sequence::text');
    expect(revocations[0].sequence).toBe(4611686018427387904n);
  });
});

// ---------------------------------------------------------------------------
// nulls, enums and required fields
// ---------------------------------------------------------------------------

describe('nulls and enums', () => {
  it('keeps a genuinely optional column as null', async () => {
    const { repository } = repositoryWith([ok({
      id: UUID_A,
      user_id: UUID_B,
      subject_device_id: UUID_C,
      issuer_device_id: null,
      issuer_certificate_id: null,
      recovery_public_anchor_id: UUID_A,
      recovery_identity_id: UUID_B,
      recovery_version: 1,
      certificate: encodeBytea(CERT),
      certificate_fp: encodeBytea(FP32),
      subject_sig_spki: encodeBytea(SPKI),
      subject_kem_spki: encodeBytea(SPKI),
    })]);
    const certificate = await repository.getCertificate(UUID_A);
    expect(certificate!.issuerCertificateId).toBeNull();
    expect(certificate!.issuerDeviceId).toBeNull();
    expect(certificate!.recoveryPublicAnchorId).toBe(UUID_A);
  });

  it('treats an absent row as null only where absence is a real answer', async () => {
    const { repository } = repositoryWith([ok(null)]);
    expect(await repository.getDevice(UUID_A)).toBeNull();
  });

  it('refuses an unknown enum value instead of passing it upward', async () => {
    const { repository } = repositoryWith([ok([{
      id: UUID_A,
      user_id: UUID_B,
      sig_spki: encodeBytea(SPKI),
      kem_spki: encodeBytea(SPKI),
      platform: 'palmos',
      assurance: 'secure_enclave',
      status: 'ACTIVE',
    }])]);
    await expect(repository.listDevices(UUID_B)).rejects.toThrow(/E_FIELD_ENUM/);
  });

  it('refuses an unknown epoch state', async () => {
    const { repository } = repositoryWith([ok([{
      id: UUID_A,
      domain: 'personal',
      scope_id: UUID_B,
      key_epoch: '1',
      state: 'DEFINITELY_ACTIVE',
      owner_user_id: UUID_B,
      owner_couple_id: null,
    }])]);
    await expect(repository.listScopeKeys('personal', UUID_B)).rejects.toThrow(/E_FIELD_ENUM/);
  });

  it('refuses a recovery_version outside one byte', async () => {
    const { repository } = repositoryWith([ok({
      id: UUID_A,
      user_id: UUID_B,
      recovery_version: 300,
      recovery_salt: encodeBytea(FP32),
      rec_sig_spki: encodeBytea(SPKI),
      rec_kem_spki: encodeBytea(SPKI),
      enc_rec_sig_priv: encodeBytea(new Uint8Array([...NONCE12, ...SEALED])),
      enc_rec_kem_priv: encodeBytea(new Uint8Array([...NONCE12, ...SEALED])),
      recovery_bundle_fp: encodeBytea(FP32),
      bundle_sig: encodeBytea(SIG64),
      superseded_at: null,
    })]);
    await expect(repository.getRecoveryIdentity(UUID_B)).rejects.toThrow(/E_FIELD_RANGE/);
  });
});

// ---------------------------------------------------------------------------
// recovery identity: the nonce and the bundle signature
// ---------------------------------------------------------------------------

describe('recovery identity', () => {
  it('prefixes each nonce onto its ciphertext on write', async () => {
    const { repository, queries } = repositoryWith([ok({ id: UUID_A })]);
    const kemNonce = new Uint8Array(12).fill(8);
    await repository.insertRecoveryIdentity({
      userId: UUID_B,
      recoveryVersion: 1,
      recoverySalt: FP32,
      recSigSpki: SPKI,
      recKemSpki: SPKI,
      recSigNonce: NONCE12,
      encRecSigPriv: SEALED,
      recKemNonce: kemNonce,
      encRecKemPriv: SEALED,
      recoveryBundleFp: FP32,
      bundleSig: SIG64,
    });
    const values = queries[0].values!;
    expect(values.enc_rec_sig_priv).toBe(`\\x${hex(NONCE12)}${hex(SEALED)}`);
    expect(values.enc_rec_kem_priv).toBe(`\\x${hex(kemNonce)}${hex(SEALED)}`);
    // The signature is written, not dropped.
    expect(values.bundle_sig).toBe(`\\x${hex(SIG64)}`);
  });

  it('splits the nonce back off on read, exactly', async () => {
    const kemNonce = new Uint8Array(12).fill(8);
    const { repository } = repositoryWith([ok({
      id: UUID_A,
      user_id: UUID_B,
      recovery_version: 1,
      recovery_salt: encodeBytea(FP32),
      rec_sig_spki: encodeBytea(SPKI),
      rec_kem_spki: encodeBytea(SPKI),
      enc_rec_sig_priv: encodeBytea(new Uint8Array([...NONCE12, ...SEALED])),
      enc_rec_kem_priv: encodeBytea(new Uint8Array([...kemNonce, ...SEALED])),
      recovery_bundle_fp: encodeBytea(FP32),
      bundle_sig: encodeBytea(SIG64),
      superseded_at: null,
    })]);
    const identity = await repository.getRecoveryIdentity(UUID_B);
    expect(hex(identity!.recSigNonce)).toBe(hex(NONCE12));
    expect(hex(identity!.recKemNonce)).toBe(hex(kemNonce));
    expect(hex(identity!.encRecSigPriv)).toBe(hex(SEALED));
    expect(hex(identity!.bundleSig)).toBe(hex(SIG64));
    expect(identity!.supersededAt).toBeNull();
  });

  it('reads only the live generation', async () => {
    const { repository, queries } = repositoryWith([ok(null)]);
    await repository.getRecoveryIdentity(UUID_B);
    expect(queries[0].filters).toContainEqual({ method: 'is', column: 'superseded_at', value: null });
  });

  it('refuses a blob too short to contain a nonce and a tag', async () => {
    const { repository } = repositoryWith([ok({
      id: UUID_A,
      user_id: UUID_B,
      recovery_version: 1,
      recovery_salt: encodeBytea(FP32),
      rec_sig_spki: encodeBytea(SPKI),
      rec_kem_spki: encodeBytea(SPKI),
      enc_rec_sig_priv: encodeBytea(new Uint8Array(8)),
      enc_rec_kem_priv: encodeBytea(new Uint8Array([...NONCE12, ...SEALED])),
      recovery_bundle_fp: encodeBytea(FP32),
      bundle_sig: encodeBytea(SIG64),
      superseded_at: null,
    })]);
    await expect(repository.getRecoveryIdentity(UUID_B)).rejects.toThrow(/E_SEALED_TRUNCATED/);
  });

  it('refuses a nonce of the wrong width on write', async () => {
    const { repository } = repositoryWith([ok({ id: UUID_A })]);
    await expect(repository.insertRecoveryIdentity({
      userId: UUID_B,
      recoveryVersion: 1,
      recoverySalt: FP32,
      recSigSpki: SPKI,
      recKemSpki: SPKI,
      recSigNonce: new Uint8Array(16),
      encRecSigPriv: SEALED,
      recKemNonce: NONCE12,
      encRecKemPriv: SEALED,
      recoveryBundleFp: FP32,
      bundleSig: SIG64,
    })).rejects.toThrow(/E_BAD_NONCE/);
  });
});

// ---------------------------------------------------------------------------
// envelopes
// ---------------------------------------------------------------------------

describe('envelopes', () => {
  it('routes a device recipient to recipient_device_id and leaves the other null', async () => {
    const { repository, queries } = repositoryWith([ok({ id: UUID_A })]);
    await repository.insertEnvelope({
      scopeKeyId: UUID_A,
      recipientKind: 'device',
      recipientId: UUID_C,
      senderDeviceId: UUID_B,
      senderCertificateId: UUID_B,
      envelope: ENVELOPE,
    });
    const values = queries[0].values!;
    expect(values.recipient_device_id).toBe(UUID_C);
    expect(values.recipient_recovery_id).toBeNull();
    expect(values.envelope).toBe(`\\x${hex(ENVELOPE)}`);
    expect(values.self_notarized).toBe(false);
  });

  it('routes a recovery recipient to recipient_recovery_id', async () => {
    const { repository, queries } = repositoryWith([ok({ id: UUID_A })]);
    await repository.insertEnvelope({
      scopeKeyId: UUID_A,
      recipientKind: 'recovery_identity',
      recipientId: UUID_C,
      senderDeviceId: UUID_B,
      senderCertificateId: UUID_B,
      envelope: ENVELOPE,
      selfNotarized: true,
    });
    const values = queries[0].values!;
    expect(values.recipient_recovery_id).toBe(UUID_C);
    expect(values.recipient_device_id).toBeNull();
    expect(values.self_notarized).toBe(true);
  });

  it('reads the recipient id back out of whichever column carries it', async () => {
    const { repository } = repositoryWith([ok([
      {
        scope_key_id: UUID_A,
        recipient_kind: 'device',
        recipient_device_id: UUID_C,
        recipient_recovery_id: null,
        sender_device_id: UUID_B,
        sender_certificate_id: UUID_B,
        envelope: encodeBytea(ENVELOPE),
        self_notarized: false,
      },
      {
        scope_key_id: UUID_A,
        recipient_kind: 'recovery_identity',
        recipient_device_id: null,
        recipient_recovery_id: UUID_B,
        sender_device_id: UUID_B,
        sender_certificate_id: UUID_B,
        envelope: encodeBytea(ENVELOPE),
        self_notarized: true,
      },
    ])]);
    const envelopes = await repository.listEnvelopes(UUID_A);
    expect(envelopes.map((e) => e.recipientId)).toEqual([UUID_C, UUID_B]);
    expect(envelopes[1].selfNotarized).toBe(true);
  });

  it('refuses an envelope row whose sender certificate is null', async () => {
    const { repository } = repositoryWith([ok([{
      scope_key_id: UUID_A,
      recipient_kind: 'device',
      recipient_device_id: UUID_C,
      recipient_recovery_id: null,
      sender_device_id: UUID_B,
      sender_certificate_id: null,
      envelope: encodeBytea(ENVELOPE),
      self_notarized: false,
    }])]);
    // An envelope verifiable by nothing is not a state the protocol has.
    await expect(repository.listEnvelopes(UUID_A)).rejects.toThrow(/sender_certificate_id/);
  });

  it('self-notarization targets one recipient of one epoch', async () => {
    const { repository, queries } = repositoryWith([ok({ id: UUID_A })]);
    await repository.selfNotarizeEnvelope({
      scopeKeyId: UUID_A,
      recipientDeviceId: UUID_C,
      envelope: ENVELOPE,
      senderCertificateId: UUID_B,
      senderDeviceId: UUID_C,
    });
    expect(queries[0].op).toBe('update');
    expect(queries[0].values!.self_notarized).toBe(true);
    expect(queries[0].filters).toContainEqual({ method: 'eq', column: 'scope_key_id', value: UUID_A });
    expect(queries[0].filters).toContainEqual({
      method: 'eq', column: 'recipient_device_id', value: UUID_C,
    });
  });
});

// ---------------------------------------------------------------------------
// RPCs
// ---------------------------------------------------------------------------

describe('epoch RPCs', () => {
  it('moves state only through the three functions, with the documented argument', async () => {
    const { repository, rpcs, queries } = repositoryWith([ok('READY'), ok('ACTIVE'), ok('ABANDONED')]);
    await repository.markEpochReady(UUID_A);
    await repository.activateEpoch(UUID_A);
    await repository.abandonEpoch(UUID_A);
    expect(rpcs.map((r) => r.fn)).toEqual([
      'e2ee_mark_epoch_ready', 'e2ee_activate_epoch', 'e2ee_abandon_epoch',
    ]);
    for (const rpc of rpcs) expect(rpc.args).toEqual({ p_scope_key_id: UUID_A });
    // No UPDATE on scope_keys, ever.
    expect(queries.filter((q) => q.table === 'scope_keys' && q.op === 'update')).toHaveLength(0);
  });

  it('always inserts an epoch as PREPARING, whatever the caller asked for', async () => {
    const { repository, queries } = repositoryWith([ok({ id: UUID_C })]);
    await repository.insertScopeKey({
      domain: 'personal',
      scopeId: UUID_B,
      epoch: 1n,
      state: 'PREPARING',
      ownerUserId: UUID_B,
      ownerCoupleId: null,
    });
    expect(queries[0].values!.state).toBe('PREPARING');
  });

  it('propagates an RPC error rather than reporting a successful transition', async () => {
    const { repository } = repositoryWith([
      boom('E2EE_ILLEGAL_EPOCH_TRANSITION: RETIRED -> ACTIVE', '42501'),
    ]);
    const error = await repository.activateEpoch(UUID_A).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(E2eeRepositoryError);
    expect((error as E2eeRepositoryError).operation).toBe('rpc.e2ee_activate_epoch');
    expect((error as E2eeRepositoryError).code).toBe('42501');
    expect((error as Error).message).toMatch(/RETIRED -> ACTIVE/);
  });

  it('reads the partner anchor out of the set-returning RPC, and null when there is no partner', async () => {
    const { repository, rpcs } = repositoryWith([
      ok([{
        recovery_identity_id: UUID_A,
        recovery_version: 1,
        rec_sig_spki: encodeBytea(SPKI),
        rec_kem_spki: encodeBytea(SPKI),
        recovery_bundle_fp: encodeBytea(FP32),
      }]),
      ok([]),
    ]);
    const anchor = await repository.getPartnerRecoveryAnchor();
    expect(anchor!.recoveryIdentityId).toBe(UUID_A);
    expect(hex(anchor!.recKemSpki)).toBe(hex(SPKI));
    expect(rpcs[0]).toEqual({ fn: 'get_partner_recovery_anchor', args: undefined });
    expect(await repository.getPartnerRecoveryAnchor()).toBeNull();
  });
});

describe('recovery RPCs', () => {
  it('sends base64 to the Edge Functions and requires an explicit confirmation', async () => {
    const { repository, invocations } = repositoryWith([
      ok({ authenticated: true, deviceId: UUID_C, nextState: 'RECOVERY_AUTHENTICATED' }),
    ]);
    const result = await repository.verifyRecoveryAuthentication({
      challengeId: UUID_A, deviceId: UUID_C, signature: SIG64,
    });
    expect(result.nextState).toBe('RECOVERY_AUTHENTICATED');
    expect(invocations[0].name).toBe('verify-recovery');
    expect(invocations[0].body.challengeId).toBe(UUID_A);
    expect(typeof invocations[0].body.signature).toBe('string');
    expect(atob(invocations[0].body.signature as string)).toHaveLength(64);
  });

  it('refuses a response that does not confirm authentication', async () => {
    const { repository } = repositoryWith([ok({ authenticated: false })]);
    await expect(repository.verifyRecoveryAuthentication({
      challengeId: UUID_A, deviceId: UUID_C, signature: SIG64,
    })).rejects.toThrow(/E_RECOVERY_REJECTED/);
  });

  it('refuses a response claiming a state the protocol does not have', async () => {
    const { repository } = repositoryWith([
      ok({ authenticated: true, deviceId: UUID_C, nextState: 'ACTIVE' }),
    ]);
    await expect(repository.verifyRecoveryAuthentication({
      challengeId: UUID_A, deviceId: UUID_C, signature: SIG64,
    })).rejects.toThrow(/E_RECOVERY_STATE/);
  });

  it('parses an issued challenge as the function returns it: base64 body, bigint timestamps', async () => {
    const { repository, invocations } = repositoryWith([ok({
      challengeId: UUID_A,
      // An HTTP body, so base64 — NOT the \\x form a bytea column would use.
      challenge: btoa(String.fromCharCode(...FP32)),
      recoveryIdentityId: UUID_B,
      recoveryVersion: 1,
      deviceId: UUID_C,
      issuedAt: '2026-08-12T00:00:00.000Z',
      expiresAt: '2026-08-12T00:02:00.000Z',
    })]);
    const challenge = await repository.issueRecoveryChallenge({ userId: UUID_B, deviceId: UUID_C });
    expect(invocations[0].name).toBe('issue-recovery-challenge');
    expect(invocations[0].body).toEqual({ deviceId: UUID_C });
    // The row identity and the secret bytes are separate values.
    expect(challenge.id).toBe(UUID_A);
    expect(hex(challenge.challengeNonce)).toBe(hex(FP32));
    expect(challenge.id).not.toBe(hex(challenge.challengeNonce));
    expect(challenge.recoveryIdentityId).toBe(UUID_B);
    expect(challenge.newDeviceId).toBe(UUID_C);
    // The PERSISTED timestamps, echoed exactly.
    expect(challenge.expiresAtMs - challenge.issuedAtMs).toBe(120_000n);
  });

  it('refuses a challenge body that is hex where base64 was promised', async () => {
    const { repository } = repositoryWith([ok({
      challengeId: UUID_A,
      challenge: encodeBytea(FP32),
      recoveryIdentityId: UUID_B,
      recoveryVersion: 1,
      deviceId: UUID_C,
      issuedAt: '2026-08-12T00:00:00.000Z',
      expiresAt: '2026-08-12T00:02:00.000Z',
    })]);
    await expect(repository.issueRecoveryChallenge({ userId: UUID_B, deviceId: UUID_C }))
      .rejects.toThrow(/E_BAD_BASE64/);
  });

  it('refuses a challenge that is not 32 bytes', async () => {
    const { repository } = repositoryWith([ok({
      challengeId: UUID_A,
      challenge: btoa('short'),
      recoveryIdentityId: UUID_B,
      recoveryVersion: 1,
      deviceId: UUID_C,
      issuedAt: '2026-08-12T00:00:00.000Z',
      expiresAt: '2026-08-12T00:02:00.000Z',
    })]);
    await expect(repository.issueRecoveryChallenge({ userId: UUID_B, deviceId: UUID_C }))
      .rejects.toThrow(/E_BAD_WIDTH/);
  });

  it('addresses approve-device by enrollment id and sends NO transcript', async () => {
    const { repository, invocations } = repositoryWith([ok({ activated: true, deviceId: UUID_C })]);
    const approved = await repository.approveDeviceEnrollment({
      enrollmentId: UUID_A, certificate: CERT, approvalSignature: SIG64,
    });
    expect(approved.deviceId).toBe(UUID_C);
    // Stable uuid, so the row lookup cannot be steered through a nonce encoding.
    expect(invocations[0].body.enrollmentId).toBe(UUID_A);
    expect(invocations[0].body.enrollNonce).toBeUndefined();
    // The caller cannot supply transcript bytes at all: the server rebuilds them.
    expect(invocations[0].body.transcriptHash).toBeUndefined();
    expect(Object.keys(invocations[0].body).sort())
      .toEqual(['approvalSignature', 'certificate', 'enrollmentId']);
    // An HTTP body, so base64 for the binary fields.
    expect(atob(invocations[0].body.certificate as string)).toHaveLength(445);
    expect(atob(invocations[0].body.approvalSignature as string)).toHaveLength(64);
  });

  it('refuses an approve-device response that does not confirm activation', async () => {
    const { repository } = repositoryWith([ok({ activated: false })]);
    await expect(repository.approveDeviceEnrollment({
      enrollmentId: UUID_A, certificate: CERT, approvalSignature: SIG64,
    })).rejects.toThrow(/E_APPROVAL_REJECTED/);
  });
});

// ---------------------------------------------------------------------------
// error propagation
// ---------------------------------------------------------------------------

describe('every failure propagates', () => {
  it('turns a PostgREST error into a thrown, named failure carrying its code', async () => {
    const { repository } = repositoryWith([boom('permission denied for table devices', '42501')]);
    const error = await repository.listDevices(UUID_B).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(E2eeRepositoryError);
    expect((error as E2eeRepositoryError).code).toBe('42501');
    expect((error as E2eeRepositoryError).operation).toBe('devices.list');
  });

  it('never turns a failed read into an empty list', async () => {
    const { repository } = repositoryWith([boom('network unreachable')]);
    await expect(repository.listCertificates(UUID_B)).rejects.toThrow(E2eeRepositoryError);
  });

  it('refuses a write that returned no row', async () => {
    const { repository } = repositoryWith([ok(null)]);
    await expect(repository.insertCertificate({
      userId: UUID_B,
      subjectDeviceId: UUID_C,
      issuerDeviceId: null,
      issuerCertificateId: null,
      recoveryPublicAnchorId: UUID_A,
      recoveryIdentityId: UUID_A,
      recoveryVersion: 1,
      certificate: CERT,
      certificateFp: FP32,
      subjectSigSpki: SPKI,
      subjectKemSpki: SPKI,
    })).rejects.toThrow(/E_DB_NO_ROW/);
  });

  it('treats a missing deployment identity as fatal, not as an empty answer', async () => {
    const { repository } = repositoryWith([ok(null)]);
    await expect(repository.serverOriginId()).rejects.toThrow(/E_NO_DEPLOYMENT_IDENTITY/);
  });

  // Since 036 the client has no UPDATE privilege on devices.status, so retiring
  // a device is an RPC call rather than an UPDATE. "Matched no row" is not a
  // condition an RPC can report — e2ee_revoke_own_device raises
  // E2EE_UNKNOWN_DEVICE instead — so what is worth asserting here is that the
  // call goes to the function and that a transport failure still propagates.
  it('retires a device through the RPC rather than a direct update', async () => {
    const { repository, rpcs, queries } = repositoryWith([ok('REVOKED')]);
    await repository.setDeviceStatus(UUID_A, 'REVOKED');
    expect(rpcs.map((r) => r.fn)).toContain('e2ee_revoke_own_device');
    // No table write at all: the privilege to set this column is gone.
    expect(queries).toHaveLength(0);
  });

  it('records a provisioning failure through its own RPC', async () => {
    const { repository, rpcs, queries } = repositoryWith([ok('PROVISIONING_FAILED')]);
    await repository.setDeviceStatus(UUID_A, 'PROVISIONING_FAILED');
    expect(rpcs.map((r) => r.fn)).toContain('e2ee_mark_device_provisioning_failed');
    expect(queries).toHaveLength(0);
  });

  it('propagates a database failure from the retire RPC', async () => {
    const { repository } = repositoryWith([{ data: null, error: { message: 'E2EE_UNKNOWN_DEVICE' } }]);
    await expect(repository.setDeviceStatus(UUID_A, 'REVOKED')).rejects.toThrow(/E2EE_UNKNOWN_DEVICE|E_DB/);
  });

  // A promotion is the server's conclusion. The repository must not offer it a
  // route at all, so this fails before any request is made.
  it('refuses to ask the database for a status the client cannot set', async () => {
    const { repository, rpcs, queries } = repositoryWith([]);
    await expect(repository.setDeviceStatus(UUID_A, 'ACTIVE'))
      .rejects.toThrow(/E_DEVICE_STATUS_NOT_CLIENT_SETTABLE/);
    expect(rpcs).toHaveLength(0);
    expect(queries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// revocation
// ---------------------------------------------------------------------------

describe('revocation rows', () => {
  it('writes the wire reason code, not the name', async () => {
    const { repository, queries } = repositoryWith([ok({ id: UUID_A })]);
    await repository.appendRevocation({
      userId: UUID_B,
      revokedDeviceId: UUID_C,
      revokerDeviceId: UUID_A,
      reason: 'potentiallyCompromised',
      statement: new Uint8Array(203).fill(1),
      signature: SIG64,
      revokedAtMs: 1_800_000_000_000n,
      sequence: 1n,
      logHead: FP32,
    });
    const values = queries[0].values!;
    // REVOCATION_REASON.potentiallyCompromised, bound into the signed statement.
    expect(values.reason).toBe(3);
    expect(values.sequence).toBe('1');
    expect(values.statement).toBe(`\\x${hex(new Uint8Array(203).fill(1))}`);
    expect(values.log_head).toBe(`\\x${hex(FP32)}`);
    expect(values.revoked_at).toBe(new Date(1_800_000_000_000).toISOString());
  });

  it('orders the log by sequence so the head can be replayed forward', async () => {
    const { repository, queries } = repositoryWith([ok([])]);
    await repository.listRevocations(UUID_B);
    expect(queries[0].filters).toContainEqual({
      method: 'order', column: 'sequence', value: { ascending: true },
    });
  });
});

// ---------------------------------------------------------------------------
// enrollment
// ---------------------------------------------------------------------------

describe('enrollment rows', () => {
  it('round-trips the nonce and returns the persisted row, not the request', async () => {
    const nonce = new Uint8Array(32).fill(11);
    const { repository, queries } = repositoryWith([ok({
      id: UUID_A,
      user_id: UUID_B,
      new_device_id: UUID_C,
      approver_device_id: null,
      enroll_nonce: encodeBytea(nonce),
      granted_domains: 7,
      transcript_hash: null,
      approval_signature: null,
      created_at: '2026-08-12T00:00:00.000Z',
      expires_at: '2026-08-12T00:10:00.000Z',
      approved_at: null,
      consumed_at: null,
    })]);
    const row = await repository.insertEnrollment({
      userId: UUID_B,
      newDeviceId: UUID_C,
      approverDeviceId: null,
      enrollNonce: nonce,
      grantedDomains: 7,
      expiresAt: '2026-08-12T00:10:00.000Z',
    });
    expect(queries[0].values!.enroll_nonce).toBe(`\\x${hex(nonce)}`);
    expect(hex(row.enrollNonce)).toBe(hex(nonce));
    expect(row.consumedAt).toBeNull();
    expect(row.grantedDomains).toBe(7);
    // The stored issuedAt, which both devices and the Edge Function bind into
    // the canonical transcript.
    expect(row.createdAt).toBe('2026-08-12T00:00:00.000Z');
    expect(queries[0].columns).toContain('created_at');
  });

  it('looks an enrollment up by the bytea form of its nonce', async () => {
    const nonce = new Uint8Array(32).fill(12);
    const { repository, queries } = repositoryWith([ok(null)]);
    expect(await repository.getEnrollmentByNonce(nonce)).toBeNull();
    expect(queries[0].filters).toContainEqual({
      method: 'eq', column: 'enroll_nonce', value: `\\x${hex(nonce)}`,
    });
  });

  it('refuses a granted_domains mask outside three bits', async () => {
    const { repository } = repositoryWith([ok({
      id: UUID_A,
      user_id: UUID_B,
      new_device_id: UUID_C,
      approver_device_id: null,
      enroll_nonce: encodeBytea(new Uint8Array(32)),
      granted_domains: 9,
      transcript_hash: null,
      approval_signature: null,
      created_at: '2026-08-12T00:00:00.000Z',
      expires_at: '2026-08-12T00:10:00.000Z',
      approved_at: null,
      consumed_at: null,
    })]);
    await expect(repository.getEnrollmentByNonce(new Uint8Array(32))).rejects.toThrow(/E_FIELD_RANGE/);
  });
});
