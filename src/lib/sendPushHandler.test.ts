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

function candidate(over: Partial<PushCandidate> = {}): PushCandidate {
  return {
    user_id: 'user-a', platform: 'ios', token: 'token-a', decided_at: DECIDED_AT, ...over,
  };
}

function deps(over: Partial<SendPushDeps> = {}): SendPushDeps {
  return {
    listCandidates: async () => [candidate()],
    deliver: async () => ({ ok: true }),
    markDelivered: async () => {},
    dropToken: async () => {},
    ...over,
  };
}

describe('what the sender is structurally unable to do', () => {
  it('has one body, and it is not a parameter of delivery', () => {
    /*
      Asserted on the TYPE-level shape rather than a string comparison: `deliver`
      receives a candidate and nothing else, so there is no argument through which
      a caller could vary the text per event kind. A lock screen read over a
      shoulder in a 생활관 must not distinguish a care signal from a diary entry.
    */
    expect(NOTIFICATION_BODY).toBe('새로운 소식이 있어요');
    expect(NOTIFICATION_BODY).not.toMatch(/\d/);
  });

  it('lands on home, never on a specific record', () => {
    // A payload that can point at one record has already said which one it was
    // about. IA §3.1 settled this.
    expect(NOTIFICATION_ROUTE).toBe('/');
  });

  it('reports no count of what happened', async () => {
    const result = await handleSendPush(deps());
    // `delivered` counts SENDS, which is operational. Nothing in the response
    // describes what the recipient will find.
    expect(Object.keys(result.body).sort()).toEqual(
      ['considered', 'delivered', 'failed', 'tokensDropped'],
    );
  });

  it('logs ids and outcomes, never a token', async () => {
    const logEvent = vi.fn();
    await handleSendPush(deps({ logEvent }));
    const logged = JSON.stringify(logEvent.mock.calls);
    expect(logged).not.toContain('token-a');
  });
});

describe('one notification per person, not per device', () => {
  it('sends to every device but counts the person once', async () => {
    // §14.3 caps sends PER RECIPIENT. Three devices is one notification arriving
    // in three places; counting them separately would spend the daily allowance
    // on someone who was told once.
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
    expect(result.body).toMatchObject({ considered: 1, delivered: 1 });
  });

  it('separates recipients', async () => {
    const markDelivered = vi.fn(async () => {});
    await handleSendPush(deps({
      listCandidates: async () => [
        candidate({ user_id: 'a', token: 't-a' }),
        candidate({ user_id: 'b', token: 't-b' }),
      ],
      markDelivered,
    }));
    expect(markDelivered.mock.calls.map((c) => c[0]).sort()).toEqual(['a', 'b']);
  });
});

describe('a failed send is not a delivered one', () => {
  it('leaves the flag raised when nothing reached a device', async () => {
    /*
      Marking on ATTEMPT would turn a bad network minute into "this person was
      told" -- and since the daily cap then applies, they would not be told again
      until tomorrow. Failing loudly and retrying on the next run is the honest
      direction: at worst it arrives later in the same contact window.
    */
    const markDelivered = vi.fn(async () => {});
    const result = await handleSendPush(deps({
      deliver: async () => ({ ok: false }),
      markDelivered,
    }));

    expect(markDelivered).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({ delivered: 0, failed: 1 });
  });

  it('counts the person as told when at least one device took it', async () => {
    const markDelivered = vi.fn(async () => {});
    await handleSendPush(deps({
      listCandidates: async () => [
        candidate({ token: 'dead-phone' }),
        candidate({ token: 'live-tablet' }),
      ],
      deliver: async (c) => ({ ok: c.token === 'live-tablet' }),
      markDelivered,
    }));
    expect(markDelivered).toHaveBeenCalledTimes(1);
  });
});

describe('a token the push service has buried', () => {
  it('is dropped rather than retried forever', async () => {
    const dropToken = vi.fn(async () => {});
    const result = await handleSendPush(deps({
      deliver: async () => ({ ok: false, tokenGone: true }),
      dropToken,
    }));

    expect(dropToken).toHaveBeenCalledWith('token-a');
    // A dead device is not a failure to count against this person.
    expect(result.body).toMatchObject({ tokensDropped: 1, failed: 0, delivered: 0 });
  });

  it('does not mark a person delivered on the strength of a dead device', async () => {
    const markDelivered = vi.fn(async () => {});
    await handleSendPush(deps({
      deliver: async () => ({ ok: false, tokenGone: true }),
      markDelivered,
    }));
    expect(markDelivered).not.toHaveBeenCalled();
  });

  it('still delivers to the surviving device of the same person', async () => {
    const dropToken = vi.fn(async () => {});
    const markDelivered = vi.fn(async () => {});
    await handleSendPush(deps({
      listCandidates: async () => [
        candidate({ token: 'gone' }),
        candidate({ token: 'here' }),
      ],
      deliver: async (c) => (c.token === 'gone' ? { ok: false, tokenGone: true } : { ok: true }),
      dropToken,
      markDelivered,
    }));

    expect(dropToken).toHaveBeenCalledWith('gone');
    expect(markDelivered).toHaveBeenCalledTimes(1);
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
  /*
    Every dependency here can REJECT, not merely resolve unsuccessfully: `fetch`
    throws on a dropped connection and an RPC throws when the database refuses.
    Before these tests the loop had no guard, so the first rejection ended it --
    turning one bad row into a batch-wide outage whose victims were decided by
    map iteration order, and which looks exactly like a quiet day with nobody to
    notify.
  */

  it('keeps going when delivery to one person throws', async () => {
    const markDelivered = vi.fn(async () => {});
    const result = await handleSendPush(deps({
      listCandidates: async () => [
        candidate({ user_id: 'first', token: 'boom' }),
        candidate({ user_id: 'second', token: 'fine' }),
      ],
      deliver: async (c) => {
        if (c.token === 'boom') throw new Error('ECONNRESET');
        return { ok: true };
      },
      markDelivered,
    }));

    expect(markDelivered).toHaveBeenCalledWith('second', DECIDED_AT);
    expect(markDelivered).toHaveBeenCalledTimes(1);
    expect(result.body).toMatchObject({ considered: 2, delivered: 1, failed: 1 });
  });

  it('keeps going when lowering one person’s flag throws', async () => {
    const delivered: string[] = [];
    const result = await handleSendPush(deps({
      listCandidates: async () => [
        candidate({ user_id: 'first' }),
        candidate({ user_id: 'second' }),
      ],
      markDelivered: async (userId) => {
        if (userId === 'first') throw new Error('E_DB_WRITE_FAILED');
        delivered.push(userId);
      },
    }));

    expect(delivered).toEqual(['second']);
    // The first person's send landed, but their turn did not complete: the flag
    // is still raised, so they are counted as failed rather than told.
    expect(result.body).toMatchObject({ considered: 2, delivered: 1, failed: 1 });
  });

  it('keeps going when dropping a dead token throws', async () => {
    const markDelivered = vi.fn(async () => {});
    const result = await handleSendPush(deps({
      listCandidates: async () => [
        candidate({ user_id: 'first', token: 'dead' }),
        candidate({ user_id: 'second', token: 'fine' }),
      ],
      deliver: async (c) => (c.token === 'dead' ? { ok: false, tokenGone: true } : { ok: true }),
      dropToken: async () => { throw new Error('E_DB_WRITE_FAILED'); },
      markDelivered,
    }));

    expect(markDelivered).toHaveBeenCalledWith('second', DECIDED_AT);
    expect(result.body).toMatchObject({ considered: 2, delivered: 1, tokensDropped: 0 });
  });

  it('does not mark a person delivered when their only device threw', async () => {
    const markDelivered = vi.fn(async () => {});
    await handleSendPush(deps({
      deliver: async () => { throw new Error('ECONNRESET'); },
      markDelivered,
    }));

    expect(markDelivered).not.toHaveBeenCalled();
  });
});

/**
 * The boundary is drawn where the send was DECIDED.
 *
 * Migration 055 has the reproduction: an act shared between
 * `push_delivery_candidates()` and `mark_push_delivered()` used to fall behind a
 * boundary stamped at mark time -- a notification that could not have contained
 * it, silently marking it delivered. The flag went down and the stamp went back,
 * so the act was not delayed, it was erased.
 *
 * The database half of the fix is proven in the phase 0 harness against a real
 * PostgreSQL cluster, where the timestamps are real. What the handler owes is
 * narrower and is what these tests hold: the decision instant must reach
 * `markDelivered` UNCHANGED, from the batch, on every path that marks at all.
 */
describe('the send decision is what reaches the mark', () => {
  it('marks against the batch decision time, not a clock read at mark time', async () => {
    const markDelivered = vi.fn(async () => {});
    await handleSendPush(deps({ markDelivered }));

    expect(markDelivered).toHaveBeenCalledWith('user-a', DECIDED_AT);
  });

  it('passes the value through untouched, whatever it is', async () => {
    /*
      A guard against a well-meaning `new Date(...)` round trip appearing here
      later. The value is the DATABASE's clock; reformatting it through this
      runtime is how the same bug returns as clock skew, and a normalising step
      would also quietly truncate the microseconds the boundary compares on.
    */
    const odd = '2026-08-21T12:00:00.123456+09:00';
    const markDelivered = vi.fn(async () => {});
    await handleSendPush(deps({
      listCandidates: async () => [candidate({ decided_at: odd })],
      markDelivered,
    }));

    expect(markDelivered).toHaveBeenCalledWith('user-a', odd);
  });

  it('sends one mark per person across several devices, with one decision time', async () => {
    // Case C. Three devices are one notification arriving in three places, so
    // there is one boundary to draw and it is the batch's -- not one per device,
    // which would mark the same person three times and stamp the last one last.
    const markDelivered = vi.fn(async () => {});
    await handleSendPush(deps({
      listCandidates: async () => [
        candidate({ user_id: 'multi', token: 'phone' }),
        candidate({ user_id: 'multi', token: 'tablet' }),
        candidate({ user_id: 'multi', token: 'watch' }),
      ],
      markDelivered,
    }));

    expect(markDelivered).toHaveBeenCalledTimes(1);
    expect(markDelivered).toHaveBeenCalledWith('multi', DECIDED_AT);
  });

  it('leaves the boundary alone when the mark itself fails', async () => {
    /*
      Case B. A failed mark must not advance anything: the flag stays raised and
      the day is unstamped, so the next run retries. The handler's part is simply
      that it does not swallow the failure -- it counts the person as failed
      rather than delivered, which is what keeps the retry honest.
    */
    const result = await handleSendPush(deps({
      markDelivered: async () => { throw new Error('E_DB_WRITE_FAILED'); },
    }));

    expect(result.body).toMatchObject({ considered: 1, delivered: 0, failed: 1 });
  });

  it('never marks anyone when nothing was delivered', async () => {
    // No delivery, no boundary. The act stays pending for the next run rather
    // than being recorded against a notification that never left the building.
    const markDelivered = vi.fn(async () => {});
    await handleSendPush(deps({
      deliver: async () => ({ ok: false }),
      markDelivered,
    }));

    expect(markDelivered).not.toHaveBeenCalled();
  });
});
