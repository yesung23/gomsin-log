import { describe, expect, it, vi } from 'vitest';
import {
  NOTIFICATION_BODY,
  NOTIFICATION_ROUTE,
  handleSendPush,
  type PushCandidate,
  type SendPushDeps,
} from '../../supabase/functions/send-push/handler.ts';

/**
 * The sender, and the four things §14.3 forbids it from becoming.
 *
 * The positive assertions here are ordinary. The negative ones are the feature:
 * this is the file where a notification service would first grow a per-kind
 * template, a count, a retry that lies, or a delivery log -- so each of those has
 * a test whose failure means the product rule broke, not that a detail changed.
 */

/** The instant `push_delivery_candidates()` chose the batch. See migration 055. */
const DECIDED_AT = '2026-08-21T12:00:00.000Z';
const CLAIM_ID = 'claim-1111-2222-3333-444444444444';

function candidate(over: Partial<PushCandidate> = {}): PushCandidate {
  return {
    user_id: 'user-a',
    platform: 'ios',
    token: 'token-a',
    decided_at: DECIDED_AT,
    claim_id: CLAIM_ID,
    ...over,
  };
}

function deps(over: Partial<SendPushDeps> = {}): SendPushDeps {
  return {
    listCandidates: async () => [candidate()],
    deliver: async () => ({ ok: true }),
    markDelivered: async () => {},
    releaseClaim: async () => {},
    dropToken: async () => {},
    ...over,
  };
}

describe('what the sender is structurally unable to do', () => {
  it('has one body, and it is not a parameter of delivery', () => {
    expect(NOTIFICATION_BODY).toBe('새로운 소식이 있어요');
    expect(NOTIFICATION_BODY).not.toMatch(/\d/);
  });

  it('lands on home, never on a specific record', () => {
    expect(NOTIFICATION_ROUTE).toBe('/');
  });

  it('reports no count of what happened', async () => {
    const result = await handleSendPush(deps());
    expect(Object.keys(result.body).sort()).toEqual(
      ['considered', 'delivered', 'failed', 'tokensDropped'],
    );
  });

  it('logs outcome metadata only, never a user_id or token', async () => {
    const logEvent = vi.fn();
    await handleSendPush(deps({ logEvent }));
    const logged = JSON.stringify(logEvent.mock.calls);
    expect(logged).not.toContain('token-a');
    expect(logged).not.toContain('user-a');
    expect(logEvent).toHaveBeenCalledWith('push_attempt', {
      devices: 1,
      delivered: true,
    });
  });
});

describe('one notification per person, not per device', () => {
  it('sends to every device but counts the person once and passes claim_id', async () => {
    const deliver = vi.fn(async () => ({ ok: true }));
    const markDelivered = vi.fn(async () => {});
    const result = await handleSendPush(deps({
      listCandidates: async () => [
        candidate({ token: 'phone' }),
        candidate({ token: 'tablet' }),
      ],
      deliver,
      markDelivered,
    }));

    expect(deliver).toHaveBeenCalledTimes(2);
    expect(markDelivered).toHaveBeenCalledTimes(1);
    expect(markDelivered).toHaveBeenCalledWith('user-a', DECIDED_AT, CLAIM_ID);
    expect(result.body).toMatchObject({ considered: 1, delivered: 1 });
  });

  it('separates recipients with their respective claims', async () => {
    const markDelivered = vi.fn(async () => {});
    await handleSendPush(deps({
      listCandidates: async () => [
        candidate({ user_id: 'a', token: 't-a', claim_id: 'claim-a' }),
        candidate({ user_id: 'b', token: 't-b', claim_id: 'claim-b' }),
      ],
      markDelivered,
    }));
    expect(markDelivered).toHaveBeenCalledWith('a', DECIDED_AT, 'claim-a');
    expect(markDelivered).toHaveBeenCalledWith('b', DECIDED_AT, 'claim-b');
  });
});

describe('atomic lease release and delivery failures', () => {
  it('releases the claim when delivery fails to all devices', async () => {
    const markDelivered = vi.fn(async () => {});
    const releaseClaim = vi.fn(async () => {});
    const result = await handleSendPush(deps({
      deliver: async () => ({ ok: false }),
      markDelivered,
      releaseClaim,
    }));

    expect(markDelivered).not.toHaveBeenCalled();
    expect(releaseClaim).toHaveBeenCalledWith('user-a', CLAIM_ID);
    expect(result.body).toMatchObject({ delivered: 0, failed: 1 });
  });

  it('releases the claim when deliver throws AbortError or TimeoutError (e.g. FCM fetch timeout)', async () => {
    const markDelivered = vi.fn(async () => {});
    const releaseClaim = vi.fn(async () => {});
    const result = await handleSendPush(deps({
      deliver: async () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      },
      markDelivered,
      releaseClaim,
    }));

    expect(markDelivered).not.toHaveBeenCalled();
    expect(releaseClaim).toHaveBeenCalledWith('user-a', CLAIM_ID);
    expect(result.body).toMatchObject({ considered: 1, delivered: 0, failed: 1 });
  });

  it('does NOT release claim when delivery succeeds but mark fails (avoids immediate replay)', async () => {
    const markDelivered = vi.fn(async () => {
      throw new Error('E_DB_WRITE_FAILED');
    });
    const releaseClaim = vi.fn(async () => {});
    const result = await handleSendPush(deps({
      deliver: async () => ({ ok: true }),
      markDelivered,
      releaseClaim,
    }));

    expect(markDelivered).toHaveBeenCalledWith('user-a', DECIDED_AT, CLAIM_ID);
    expect(releaseClaim).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({ delivered: 0, failed: 1 });
  });

  it('counts the person as told when at least one device took it', async () => {
    const markDelivered = vi.fn(async () => {});
    const releaseClaim = vi.fn(async () => {});
    await handleSendPush(deps({
      listCandidates: async () => [
        candidate({ token: 'dead-phone' }),
        candidate({ token: 'live-tablet' }),
      ],
      deliver: async (c) => ({ ok: c.token === 'live-tablet' }),
      markDelivered,
      releaseClaim,
    }));
    expect(markDelivered).toHaveBeenCalledWith('user-a', DECIDED_AT, CLAIM_ID);
    expect(releaseClaim).not.toHaveBeenCalled();
  });

  it('rejects malformed candidate bucket with mismatched claim or decided_at without calling FCM', async () => {
    const deliver = vi.fn(async () => ({ ok: true }));
    const markDelivered = vi.fn(async () => {});
    const releaseClaim = vi.fn(async () => {});

    const result = await handleSendPush(deps({
      listCandidates: async () => [
        candidate({ token: 'dev-1', claim_id: 'claim-x', decided_at: DECIDED_AT }),
        candidate({ token: 'dev-2', claim_id: 'claim-y', decided_at: DECIDED_AT }),
      ],
      deliver,
      markDelivered,
      releaseClaim,
    }));

    expect(deliver).not.toHaveBeenCalled();
    expect(markDelivered).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({ considered: 1, delivered: 0, failed: 1 });
  });
});

describe('a token the push service has buried', () => {
  it('is dropped rather than retried forever and releases claim if no other device survives', async () => {
    const dropToken = vi.fn(async () => {});
    const releaseClaim = vi.fn(async () => {});
    const result = await handleSendPush(deps({
      deliver: async () => ({ ok: false, tokenGone: true }),
      dropToken,
      releaseClaim,
    }));

    expect(dropToken).toHaveBeenCalledWith('token-a');
    expect(releaseClaim).toHaveBeenCalledWith('user-a', CLAIM_ID);
    expect(result.body).toMatchObject({ tokensDropped: 1, failed: 0, delivered: 0 });
  });

  it('does not mark a person delivered on the strength of a dead device', async () => {
    const markDelivered = vi.fn(async () => {});
    const releaseClaim = vi.fn(async () => {});
    await handleSendPush(deps({
      deliver: async () => ({ ok: false, tokenGone: true }),
      markDelivered,
      releaseClaim,
    }));
    expect(markDelivered).not.toHaveBeenCalled();
    expect(releaseClaim).toHaveBeenCalledWith('user-a', CLAIM_ID);
  });

  it('still delivers to the surviving device of the same person and marks with claim', async () => {
    const dropToken = vi.fn(async () => {});
    const markDelivered = vi.fn(async () => {});
    const releaseClaim = vi.fn(async () => {});
    await handleSendPush(deps({
      listCandidates: async () => [
        candidate({ token: 'gone' }),
        candidate({ token: 'here' }),
      ],
      deliver: async (c) => (c.token === 'gone' ? { ok: false, tokenGone: true } : { ok: true }),
      dropToken,
      markDelivered,
      releaseClaim,
    }));

    expect(dropToken).toHaveBeenCalledWith('gone');
    expect(markDelivered).toHaveBeenCalledWith('user-a', DECIDED_AT, CLAIM_ID);
    expect(releaseClaim).not.toHaveBeenCalled();
  });
});

describe('nothing to do', () => {
  it('is a normal outcome, not an error', async () => {
    const result = await handleSendPush(deps({ listCandidates: async () => [] }));
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ considered: 0, delivered: 0 });
  });
});

describe('one recipient failing does not silence the rest of the batch', () => {
  it('keeps going when delivery to one person throws', async () => {
    const markDelivered = vi.fn(async () => {});
    const releaseClaim = vi.fn(async () => {});
    const result = await handleSendPush(deps({
      listCandidates: async () => [
        candidate({ user_id: 'first', token: 'boom', claim_id: 'claim-1' }),
        candidate({ user_id: 'second', token: 'fine', claim_id: 'claim-2' }),
      ],
      deliver: async (c) => {
        if (c.token === 'boom') throw new Error('ECONNRESET');
        return { ok: true };
      },
      markDelivered,
      releaseClaim,
    }));

    expect(releaseClaim).toHaveBeenCalledWith('first', 'claim-1');
    expect(markDelivered).toHaveBeenCalledWith('second', DECIDED_AT, 'claim-2');
    expect(markDelivered).toHaveBeenCalledTimes(1);
    expect(result.body).toMatchObject({ considered: 2, delivered: 1, failed: 1 });
  });

  it('does not mark a person delivered when their only device threw', async () => {
    const markDelivered = vi.fn(async () => {});
    const releaseClaim = vi.fn(async () => {});
    await handleSendPush(deps({
      deliver: async () => { throw new Error('ECONNRESET'); },
      markDelivered,
      releaseClaim,
    }));

    expect(markDelivered).not.toHaveBeenCalled();
    expect(releaseClaim).toHaveBeenCalledWith('user-a', CLAIM_ID);
  });
});

describe('the send decision and claim reach the mark', () => {
  it('marks against the batch decision time and exact claim ID', async () => {
    const markDelivered = vi.fn(async () => {});
    await handleSendPush(deps({ markDelivered }));

    expect(markDelivered).toHaveBeenCalledWith('user-a', DECIDED_AT, CLAIM_ID);
  });

  it('passes the odd decision value and claim through untouched', async () => {
    const odd = '2026-08-21T12:00:00.123456+09:00';
    const markDelivered = vi.fn(async () => {});
    await handleSendPush(deps({
      listCandidates: async () => [candidate({ decided_at: odd, claim_id: 'claim-custom' })],
      markDelivered,
    }));

    expect(markDelivered).toHaveBeenCalledWith('user-a', odd, 'claim-custom');
  });

  it('sends one mark per person across several devices, with one decision time and claim', async () => {
    const markDelivered = vi.fn(async () => {});
    await handleSendPush(deps({
      listCandidates: async () => [
        candidate({ user_id: 'multi', token: 'phone', claim_id: 'claim-multi' }),
        candidate({ user_id: 'multi', token: 'tablet', claim_id: 'claim-multi' }),
        candidate({ user_id: 'multi', token: 'watch', claim_id: 'claim-multi' }),
      ],
      markDelivered,
    }));

    expect(markDelivered).toHaveBeenCalledTimes(1);
    expect(markDelivered).toHaveBeenCalledWith('multi', DECIDED_AT, 'claim-multi');
  });
});
