import { describe, expect, it } from 'vitest';
import {
  deriveCoupleLifecycle,
  invitationExpiryLabel,
  isInvitationExpired,
  mergeCoupleState,
  parseRemoteCoupleState,
  type RemoteCoupleState,
} from '@/lib/coupleLifecycle';
import type { CoupleInfo } from '@/types';

function remote(overrides: Partial<RemoteCoupleState> = {}): RemoteCoupleState {
  return {
    coupleId: 'couple-1',
    role: 'gomsin',
    memberStatus: 'active',
    partnerPresent: false,
    invitationActive: true,
    invitationExpiresAt: '2026-02-02T00:00:00.000Z',
    ...overrides,
  };
}

function local(overrides: Partial<CoupleInfo> = {}): CoupleInfo {
  return {
    coupleId: 'couple-1',
    partnerName: '',
    coupleCode: '123456',
    connected: false,
    status: 'pending',
    ...overrides,
  };
}

describe('parseRemoteCoupleState', () => {
  it('parses a complete payload', () => {
    const parsed = parseRemoteCoupleState({
      couple_id: 'couple-1',
      role: 'soldier',
      member_status: 'active',
      partner_present: true,
      invitation_active: false,
      invitation_expires_at: null,
    });
    expect(parsed).toEqual({
      coupleId: 'couple-1',
      role: 'soldier',
      memberStatus: 'active',
      partnerPresent: true,
      invitationActive: false,
      invitationExpiresAt: null,
    });
  });

  it('parses the no-membership payload', () => {
    const parsed = parseRemoteCoupleState({ couple_id: null });
    expect(parsed?.coupleId).toBeNull();
    expect(parsed?.partnerPresent).toBe(false);
    expect(parsed?.invitationActive).toBe(false);
  });

  it('rejects a payload that does not carry couple_id at all', () => {
    expect(parseRemoteCoupleState({})).toBeNull();
    expect(parseRemoteCoupleState(null)).toBeNull();
    expect(parseRemoteCoupleState([])).toBeNull();
    expect(parseRemoteCoupleState('couple-1')).toBeNull();
    expect(parseRemoteCoupleState({ couple_id: 42 })).toBeNull();
  });

  it('never surfaces a code or a hash even if the server sent one', () => {
    const parsed = parseRemoteCoupleState({
      couple_id: 'couple-1',
      code: '123456',
      code_hash: 'deadbeef',
    });
    expect(parsed).not.toBeNull();
    expect(JSON.stringify(parsed)).not.toContain('123456');
    expect(JSON.stringify(parsed)).not.toContain('deadbeef');
  });
});

describe('deriveCoupleLifecycle', () => {
  it('reports pending for a couple with no partner yet', () => {
    expect(deriveCoupleLifecycle(remote(), local())).toBe('pending');
  });

  it('reports connected once the partner is present', () => {
    expect(deriveCoupleLifecycle(remote({ partnerPresent: true }), local())).toBe('connected');
  });

  it('reports personal for an authoritative no-membership answer', () => {
    expect(deriveCoupleLifecycle(null, local({ coupleId: undefined }))).toBe('personal');
    expect(deriveCoupleLifecycle(remote({ coupleId: null }), local())).toBe('personal');
  });

  it('reports disconnected when membership is no longer active', () => {
    expect(deriveCoupleLifecycle(remote({ memberStatus: 'disconnected' }), local()))
      .toBe('disconnected');
  });

  it('reports unknown when the question could not be asked', () => {
    expect(deriveCoupleLifecycle(undefined, local())).toBe('unknown');
  });

  it('never reports personal for an unanswered question, even with empty local state', () => {
    // This is the whole point of the `unknown` variant: an unanswered question
    // must not render as "you have no couple space".
    const empty: CoupleInfo = {
      partnerName: '',
      coupleCode: '',
      connected: false,
      status: 'pending',
    };
    expect(deriveCoupleLifecycle(undefined, empty)).not.toBe('personal');
    expect(deriveCoupleLifecycle(undefined, undefined)).toBe('unknown');
  });
});

describe('mergeCoupleState', () => {
  it('returns local state UNCHANGED for an unknown answer', () => {
    const current = local({ connected: true, status: 'active', partnerName: '몽룡' });
    expect(mergeCoupleState(current, undefined)).toBe(current);
  });

  it('never downgrades a connected local state to personal on an unknown answer', () => {
    const connected = local({ connected: true, status: 'active', partnerName: '몽룡' });
    const merged = mergeCoupleState(connected, undefined);
    expect(merged.coupleId).toBe('couple-1');
    expect(merged.connected).toBe(true);
    expect(merged.status).toBe('active');
  });

  it('never downgrades a pending local state on an unknown answer', () => {
    const merged = mergeCoupleState(local(), undefined);
    expect(merged.coupleId).toBe('couple-1');
    expect(merged.coupleCode).toBe('123456');
    expect(merged.status).toBe('pending');
  });

  it('keeps the plaintext code across a pending refresh of the same couple', () => {
    // The server stores only a hash, so this device is the only place the code
    // exists. Losing it on a routine refresh left creators unable to invite.
    const merged = mergeCoupleState(local(), remote());
    expect(merged.coupleCode).toBe('123456');
    expect(merged.status).toBe('pending');
    expect(merged.connected).toBe(false);
  });

  it('drops the code once the partner has joined', () => {
    const merged = mergeCoupleState(local(), remote({ partnerPresent: true }));
    expect(merged.coupleCode).toBe('');
    expect(merged.connected).toBe(true);
    expect(merged.status).toBe('active');
  });

  it('drops the code when the couple id changed', () => {
    const merged = mergeCoupleState(local(), remote({ coupleId: 'couple-2' }));
    expect(merged.coupleId).toBe('couple-2');
    expect(merged.coupleCode).toBe('');
  });

  it('clears the couple space on an authoritative no-membership answer', () => {
    const merged = mergeCoupleState(
      local({ connected: true, status: 'active', partnerName: '몽룡' }),
      null,
    );
    expect(merged.coupleId).toBeUndefined();
    expect(merged.coupleCode).toBe('');
    expect(merged.partnerName).toBe('');
    expect(merged.connected).toBe(false);
    expect(merged.status).toBe('disconnected');
  });

  it('adopts a couple id local state did not have', () => {
    const merged = mergeCoupleState(
      { partnerName: '', coupleCode: '', connected: false, status: 'pending' },
      remote(),
    );
    expect(merged.coupleId).toBe('couple-1');
    expect(merged.status).toBe('pending');
  });
});

describe('invitation expiry', () => {
  const now = new Date('2026-02-01T00:00:00.000Z');

  it('detects a lapsed invitation', () => {
    expect(isInvitationExpired('2026-01-31T23:59:00.000Z', now)).toBe(true);
    expect(isInvitationExpired('2026-02-01T05:00:00.000Z', now)).toBe(false);
  });

  it('treats an absent or unparseable deadline as not expired', () => {
    expect(isInvitationExpired(null, now)).toBe(false);
    expect(isInvitationExpired('not-a-date', now)).toBe(false);
  });

  it('labels the remaining validity in Korean', () => {
    expect(invitationExpiryLabel('2026-02-01T05:00:00.000Z', now)).toBe('약 5시간 남음');
    expect(invitationExpiryLabel('2026-02-01T00:30:00.000Z', now)).toBe('약 30분 남음');
    expect(invitationExpiryLabel('2026-01-31T20:00:00.000Z', now)).toBe('만료됨');
    expect(invitationExpiryLabel(null, now)).toBeNull();
  });
});
