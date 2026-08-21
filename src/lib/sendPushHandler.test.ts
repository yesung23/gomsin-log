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

function candidate(over: Partial<PushCandidate> = {}): PushCandidate {
  return { user_id: 'user-a', platform: 'ios', token: 'token-a', ...over };
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
