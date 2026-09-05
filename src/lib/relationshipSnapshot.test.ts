import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RelationshipSnapshotParseError,
  fetchMyRelationshipSnapshotV2,
  parseRelationshipSnapshotV2,
} from '@/lib/relationshipSnapshot';

const { mockRpc } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: mockRpc },
}));

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const PARTNER_ID = '22222222-2222-4222-8222-222222222222';
const COUPLE_ID = '33333333-3333-4333-8333-333333333333';
const JOINED_AT = '2026-09-03T12:34:56.789+00:00';
const INVITATION_EXPIRES_AT = '2026-09-04T12:34:56+00:00';

const personalPayload = () => ({
  contract_version: 2,
  owner_user_id: OWNER_ID,
  lifecycle: 'personal',
  couple_id: null,
  relation_revision: null,
  partner: null,
  invitation_active: false,
  invitation_expires_at: null,
});

const pendingPayload = () => ({
  ...personalPayload(),
  lifecycle: 'pending',
  couple_id: COUPLE_ID,
  relation_revision: '9007199254740993',
  invitation_active: true,
  invitation_expires_at: INVITATION_EXPIRES_AT,
});

const disconnectedPayload = () => ({
  ...personalPayload(),
  lifecycle: 'disconnected',
  couple_id: COUPLE_ID,
  relation_revision: '7',
});

const activePayload = () => ({
  ...personalPayload(),
  lifecycle: 'active',
  couple_id: COUPLE_ID,
  relation_revision: '9223372036854775807',
  partner: {
    user_id: PARTNER_ID,
    joined_at: JOINED_AT,
    display_name: '상대',
    role: 'soldier',
    avatar_path: 'avatars/partner.webp',
    username: 'partner_01',
    service: {
      branch: 'army',
      military_status: 'serving',
      enlistment_date: '2025-01-02',
      expected_discharge_date: '2026-06-30',
      discharge_date: null,
      discharge_date_source: 'calculated',
    },
  },
});

describe('parseRelationshipSnapshotV2', () => {
  it('parses the authoritative personal lifecycle without inventing a relationship', () => {
    expect(parseRelationshipSnapshotV2(personalPayload(), OWNER_ID)).toEqual({
      contractVersion: 2,
      ownerUserId: OWNER_ID,
      lifecycle: 'personal',
      coupleId: null,
      relationRevision: null,
      partner: null,
      invitationActive: false,
      invitationExpiresAt: null,
    });
  });

  it('parses pending with an exact couple, decimal revision text, and invitation expiry', () => {
    expect(parseRelationshipSnapshotV2(pendingPayload(), OWNER_ID)).toEqual({
      contractVersion: 2,
      ownerUserId: OWNER_ID,
      lifecycle: 'pending',
      coupleId: COUPLE_ID,
      relationRevision: '9007199254740993',
      partner: null,
      invitationActive: true,
      invitationExpiresAt: INVITATION_EXPIRES_AT,
    });
  });

  it('parses disconnected with its immutable relationship generation and revision', () => {
    expect(parseRelationshipSnapshotV2(disconnectedPayload(), OWNER_ID)).toEqual({
      contractVersion: 2,
      ownerUserId: OWNER_ID,
      lifecycle: 'disconnected',
      coupleId: COUPLE_ID,
      relationRevision: '7',
      partner: null,
      invitationActive: false,
      invitationExpiresAt: null,
    });
  });

  it('parses active only with the exact partner and sanitized presentation/service fields', () => {
    expect(parseRelationshipSnapshotV2(activePayload(), OWNER_ID)).toEqual({
      contractVersion: 2,
      ownerUserId: OWNER_ID,
      lifecycle: 'active',
      coupleId: COUPLE_ID,
      relationRevision: '9223372036854775807',
      partner: {
        userId: PARTNER_ID,
        joinedAt: JOINED_AT,
        displayName: '상대',
        role: 'soldier',
        avatarPath: 'avatars/partner.webp',
        username: 'partner_01',
        service: {
          branch: 'army',
          militaryStatus: 'serving',
          enlistmentDate: '2025-01-02',
          expectedDischargeDate: '2026-06-30',
          dischargeDate: null,
          dischargeDateSource: 'calculated',
        },
      },
      invitationActive: false,
      invitationExpiresAt: null,
    });
  });

  it.each([1, 3, '2', null, undefined])(
    'rejects unknown or malformed contract_version %j',
    (contractVersion) => {
      expect(() => parseRelationshipSnapshotV2({
        ...personalPayload(),
        contract_version: contractVersion,
      }, OWNER_ID)).toThrow(RelationshipSnapshotParseError);
    },
  );

  it('rejects a snapshot whose authenticated owner is not the expected owner', () => {
    expect(() => parseRelationshipSnapshotV2({
      ...personalPayload(),
      owner_user_id: PARTNER_ID,
    }, OWNER_ID)).toThrow(/owner_user_id/);
  });

  it.each([
    ['owner_user_id', { ...personalPayload(), owner_user_id: 'not-a-uuid' }],
    ['couple_id', { ...pendingPayload(), couple_id: 'not-a-uuid' }],
    ['partner.user_id', {
      ...activePayload(),
      partner: { ...activePayload().partner, user_id: 'not-a-uuid' },
    }],
    ['self partner', {
      ...activePayload(),
      partner: { ...activePayload().partner, user_id: OWNER_ID },
    }],
  ])('rejects invalid UUID binding: %s', (_label, payload) => {
    expect(() => parseRelationshipSnapshotV2(payload, OWNER_ID))
      .toThrow(RelationshipSnapshotParseError);
  });

  it.each([
    ['partner joined_at', {
      ...activePayload(),
      partner: { ...activePayload().partner, joined_at: 'September 3, 2026' },
    }],
    ['invitation expiry', {
      ...pendingPayload(),
      invitation_expires_at: '2026-02-30T12:00:00Z',
    }],
    ['service calendar date', {
      ...activePayload(),
      partner: {
        ...activePayload().partner,
        service: {
          ...activePayload().partner.service,
          expected_discharge_date: '2026-02-30',
        },
      },
    }],
  ])('rejects invalid timestamp/date binding: %s', (_label, payload) => {
    expect(() => parseRelationshipSnapshotV2(payload, OWNER_ID))
      .toThrow(RelationshipSnapshotParseError);
  });

  it.each([
    ['unsafe JSON number', 9_007_199_254_740_992],
    ['safe JSON number', 7],
    ['negative text', '-1'],
    ['non-decimal text', '12a'],
    ['non-canonical text', '007'],
    ['outside PostgreSQL bigint', '9223372036854775808'],
  ])('rejects relation_revision represented as %s', (_label, revision) => {
    expect(() => parseRelationshipSnapshotV2({
      ...pendingPayload(),
      relation_revision: revision,
    }, OWNER_ID)).toThrow(RelationshipSnapshotParseError);
  });

  it.each(['personal', 'pending', 'disconnected'])(
    'rejects partner fields in the %s lifecycle',
    (lifecycle) => {
      expect(() => parseRelationshipSnapshotV2({
        ...pendingPayload(),
        lifecycle,
        ...(lifecycle === 'personal'
          ? { couple_id: null, relation_revision: null }
          : {}),
        partner: activePayload().partner,
      }, OWNER_ID)).toThrow(RelationshipSnapshotParseError);
    },
  );

  it('rejects an active lifecycle with no exact partner', () => {
    expect(() => parseRelationshipSnapshotV2({
      ...activePayload(),
      partner: null,
    }, OWNER_ID)).toThrow(RelationshipSnapshotParseError);
  });

  it.each([
    ['top-level invitation code', { ...pendingPayload(), invitation_code: '123456' }],
    ['top-level invitation hash', { ...pendingPayload(), code_hash: 'secret' }],
    ['partner memo', {
      ...activePayload(),
      partner: { ...activePayload().partner, memo: 'private note' },
    }],
    ['raw health field', { ...activePayload(), cycle_notes: 'private health' }],
  ])('rejects non-contract fields: %s', (_label, payload) => {
    expect(() => parseRelationshipSnapshotV2(payload, OWNER_ID))
      .toThrow(RelationshipSnapshotParseError);
  });

  it('rejects invitation fields outside the pending invariant', () => {
    expect(() => parseRelationshipSnapshotV2({
      ...activePayload(),
      invitation_active: true,
      invitation_expires_at: INVITATION_EXPIRES_AT,
    }, OWNER_ID)).toThrow(RelationshipSnapshotParseError);
    expect(() => parseRelationshipSnapshotV2({
      ...pendingPayload(),
      invitation_active: false,
    }, OWNER_ID)).toThrow(RelationshipSnapshotParseError);
  });
});

describe('fetchMyRelationshipSnapshotV2', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('calls only get_my_relationship_snapshot_v2 without input arguments', async () => {
    mockRpc.mockResolvedValueOnce({ data: activePayload(), error: null });

    await expect(fetchMyRelationshipSnapshotV2(OWNER_ID)).resolves.toEqual({
      ok: true,
      snapshot: parseRelationshipSnapshotV2(activePayload(), OWNER_ID),
    });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('get_my_relationship_snapshot_v2');
  });

  it.each([
    { code: 'PGRST202', message: 'schema cache miss' },
    { code: '42501', message: 'not authenticated' },
    { code: 'XX000', message: 'server failure' },
  ])('fails closed on RPC error $code without any legacy RPC fallback', async (error) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockRpc.mockResolvedValueOnce({ data: null, error });

    await expect(fetchMyRelationshipSnapshotV2(OWNER_ID)).resolves.toEqual({
      ok: false,
      reason: 'server',
    });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('get_my_relationship_snapshot_v2');
    expect(mockRpc.mock.calls.flat().join(' ')).not.toMatch(/get_my_couple_state|get_partner_profile|get_partner_service_info/);
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();

    consoleError.mockRestore();
    consoleWarn.mockRestore();
  });

  it('fails closed when the v2 payload is malformed', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { ...activePayload(), relation_revision: 9_007_199_254_740_992 },
      error: null,
    });

    await expect(fetchMyRelationshipSnapshotV2(OWNER_ID)).resolves.toEqual({
      ok: false,
      reason: 'invalid-payload',
    });
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the RPC transport throws and emits no payload log', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockRpc.mockRejectedValueOnce(new Error('transport failed'));

    await expect(fetchMyRelationshipSnapshotV2(OWNER_ID)).resolves.toEqual({
      ok: false,
      reason: 'server',
    });
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();

    consoleError.mockRestore();
    consoleWarn.mockRestore();
  });
});
