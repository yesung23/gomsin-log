import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(async (
    _code: string,
    _options?: { flowId?: string },
  ) => ({ error: null as unknown })),
  setSession: vi.fn(async (_tokens: unknown) => ({ error: null as unknown })),
  browserClose: vi.fn(async () => {}),
  listener: undefined as ((event: { url: string }) => unknown) | undefined,
  listenerRemove: vi.fn(async () => {}),
  addListenerRejection: null as unknown,
  launchUrl: null as string | null,
  getLaunchUrlRejection: null as unknown,
}));

const { exchangeCodeForSession, setSession, browserClose, listenerRemove } = mocks;

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (_event: string, handler: (e: { url: string }) => unknown) => {
      if (mocks.addListenerRejection) throw mocks.addListenerRejection;
      mocks.listener = handler;
      return { remove: mocks.listenerRemove };
    }),
    getLaunchUrl: vi.fn(async () => {
      if (mocks.getLaunchUrlRejection) throw mocks.getLaunchUrlRejection;
      return mocks.launchUrl ? { url: mocks.launchUrl } : undefined;
    }),
  },
}));

vi.mock('@capacitor/browser', () => ({ Browser: { close: () => mocks.browserClose() } }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      exchangeCodeForSession: (code: string, options?: { flowId?: string }) =>
        mocks.exchangeCodeForSession(code, options),
      setSession: (tokens: unknown) => mocks.setSession(tokens),
    },
  },
}));

vi.mock('@/lib/platform', async () => {
  const actual = await vi.importActual<typeof import('@/lib/platform')>('@/lib/platform');
  return { ...actual, isNativePlatform: () => true };
});

import {
  OAUTH_RETURN_MESSAGES,
  createDeferredFailureSink,
  registerAuthDeepLinkHandler,
} from '@/lib/deepLinks';

function register() {
  const onFailure = vi.fn();
  registerAuthDeepLinkHandler(onFailure);
  const listener = mocks.listener!;
  return {
    onFailure,
    send: (url: string) => Promise.resolve(listener({ url })),
    sendTogether: (...urls: string[]) =>
      Promise.all(urls.map((url) => Promise.resolve(listener({ url })))),
  };
}

const CALLBACK = 'gomsinlog://auth/callback';
const FLOW_ID = 'flow-id-123';

function callback(code: string, flowId = FLOW_ID): string {
  return `${CALLBACK}?code=${encodeURIComponent(code)}&sb_flow_id=${encodeURIComponent(flowId)}`;
}

beforeEach(() => {
  mocks.listener = undefined;
  mocks.addListenerRejection = null;
  mocks.launchUrl = null;
  mocks.getLaunchUrlRejection = null;
  exchangeCodeForSession.mockReset().mockResolvedValue({ error: null });
  setSession.mockReset().mockResolvedValue({ error: null });
  browserClose.mockReset().mockResolvedValue(undefined);
  listenerRemove.mockReset().mockResolvedValue(undefined);
});

describe('what the OAuth callback refuses', () => {
  it('never calls setSession for a fragment token pair', async () => {
    const handler = register();

    await handler.send(
      `${CALLBACK}#access_token=attacker-access&refresh_token=attacker-refresh`,
    );

    expect(setSession).not.toHaveBeenCalled();
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(handler.onFailure).toHaveBeenCalledTimes(1);
  });

  it('never calls setSession for a query token pair', async () => {
    const handler = register();

    await handler.send(`${CALLBACK}?access_token=a&refresh_token=b`);

    expect(setSession).not.toHaveBeenCalled();
    expect(handler.onFailure).toHaveBeenCalledTimes(1);
    expect(handler.onFailure).toHaveBeenCalledWith(OAUTH_RETURN_MESSAGES.exchangeFailed);
  });

  it('refuses a callback carrying nothing at all', async () => {
    const handler = register();

    await handler.send(CALLBACK);

    expect(setSession).not.toHaveBeenCalled();
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(handler.onFailure).toHaveBeenCalledTimes(1);
  });

  it.each([
    `${CALLBACK}?code=abc123`,
    `${CALLBACK}?code=abc123&sb_flow_id=short`,
    `${CALLBACK}?code=abc123&sb_flow_id=invalid.flow.id`,
    `${CALLBACK}?code=abc123&sb_flow_id=${'a'.repeat(65)}`,
  ])('refuses a missing or invalid PKCE flow id without exchanging: %s', async (url) => {
    const handler = register();

    await handler.send(url);

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(handler.onFailure).toHaveBeenCalledWith(OAUTH_RETURN_MESSAGES.exchangeFailed);
  });

  it('ignores a URL that is not the exact callback route', async () => {
    for (const url of [
      'gomsinlog://evil/callback?code=abc123',
      'gomsinlog://auth/callbackx?code=abc123',
      'gomsinlog://auth/callback/extra?code=abc123',
      'gomsinlog://auth/callback.evil.example?code=abc123',
    ]) {
      const handler = register();
      await handler.send(url);

      expect(exchangeCodeForSession, url).not.toHaveBeenCalled();
      expect(setSession, url).not.toHaveBeenCalled();
      expect(handler.onFailure, url).not.toHaveBeenCalled();
      expect(browserClose, url).not.toHaveBeenCalled();
    }
  });
});

describe('the successful return', () => {
  it('exchanges the code and says nothing', async () => {
    const handler = register();

    await handler.send(callback('abc123'));

    expect(exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(exchangeCodeForSession).toHaveBeenCalledWith('abc123', { flowId: FLOW_ID });
    expect(handler.onFailure).not.toHaveBeenCalled();
    expect(browserClose).toHaveBeenCalledTimes(1);
  });
});

describe('a native cold-start OAuth return', () => {
  it('handles the launch URL after installing the live listener', async () => {
    mocks.launchUrl = callback('cold-start');
    const handler = register();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(exchangeCodeForSession).toHaveBeenCalledWith('cold-start', { flowId: FLOW_ID });
    expect(handler.onFailure).not.toHaveBeenCalled();
  });

  it('exchanges once when the launch lookup and live event carry the same callback', async () => {
    mocks.launchUrl = callback('same-return');
    const handler = register();

    await handler.send(callback('same-return'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(exchangeCodeForSession).toHaveBeenCalledTimes(1);
  });

  it('applies the same exact-route and PKCE checks to the launch URL', async () => {
    mocks.launchUrl = 'gomsinlog://evil/callback?code=attacker&sb_flow_id=flow-id-123';
    const handler = register();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(exchangeCodeForSession).not.toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
    expect(handler.onFailure).not.toHaveBeenCalled();
  });

  it('keeps the live listener usable when the launch lookup throws', async () => {
    mocks.getLaunchUrlRejection = new Error('private plugin detail');
    const handler = register();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(handler.onFailure).toHaveBeenCalledWith(OAUTH_RETURN_MESSAGES.exchangeFailed);

    await handler.send(callback('after-launch-lookup-failure'));
    expect(exchangeCodeForSession).toHaveBeenCalledWith(
      'after-launch-lookup-failure',
      { flowId: FLOW_ID },
    );
  });
});

describe('one report per return, and only one', () => {
  it('names a refusal', async () => {
    const handler = register();

    await handler.send(`${CALLBACK}?error=access_denied`);

    expect(handler.onFailure).toHaveBeenCalledTimes(1);
    expect(handler.onFailure).toHaveBeenCalledWith(OAUTH_RETURN_MESSAGES.refused);
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('names a failed exchange', async () => {
    exchangeCodeForSession.mockResolvedValue({ error: { message: 'flow_state_not_found' } });
    const handler = register();

    await handler.send(callback('abc123'));

    expect(handler.onFailure).toHaveBeenCalledTimes(1);
    expect(handler.onFailure).toHaveBeenCalledWith(OAUTH_RETURN_MESSAGES.exchangeFailed);
  });

  it('reports exactly once when the exchange throws', async () => {
    exchangeCodeForSession.mockRejectedValue(new Error('network down'));
    const handler = register();

    await handler.send(callback('abc123'));

    expect(handler.onFailure).toHaveBeenCalledTimes(1);
    expect(handler.onFailure).toHaveBeenCalledWith(OAUTH_RETURN_MESSAGES.exchangeFailed);
    expect(browserClose).toHaveBeenCalledTimes(1);
  });

  it('handles the next code after the exchange throws', async () => {
    exchangeCodeForSession
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ error: null });
    const handler = register();

    await handler.send(callback('throws-first'));
    await handler.send(callback('works-next'));

    expect(exchangeCodeForSession).toHaveBeenCalledTimes(2);
    expect(exchangeCodeForSession).toHaveBeenLastCalledWith('works-next', { flowId: FLOW_ID });
  });

  it('reports only after the browser is closed', async () => {
    const order: string[] = [];
    browserClose.mockImplementation(async () => { order.push('close'); });
    exchangeCodeForSession.mockResolvedValue({ error: { message: 'flow_state_not_found' } });

    const handler = register();
    handler.onFailure.mockImplementation(() => { order.push('report'); });

    await handler.send(callback('abc123'));

    expect(order).toEqual(['close', 'report']);
  });

  it('dismisses the Custom Tab on success, failure and throw', async () => {
    const ok = register();
    await ok.send(callback('ok-1'));
    expect(browserClose).toHaveBeenCalledTimes(1);

    exchangeCodeForSession.mockResolvedValue({ error: { message: 'flow_state_not_found' } });
    await register().send(callback('failed-1'));
    expect(browserClose).toHaveBeenCalledTimes(2);

    exchangeCodeForSession.mockRejectedValue(new Error('network down'));
    await register().send(callback('threw-1'));
    expect(browserClose).toHaveBeenCalledTimes(3);
  });
});

describe('duplicate callback handling', () => {
  it('exchanges one code once when delivered twice in a row', async () => {
    const handler = register();

    await handler.send(callback('abc123'));
    await handler.send(callback('abc123'));

    expect(exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(handler.onFailure).not.toHaveBeenCalled();
  });

  it('exchanges one code once when two events arrive together', async () => {
    const handler = register();

    await handler.sendTogether(callback('abc123'), callback('abc123'));

    expect(exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(handler.onFailure).not.toHaveBeenCalled();
  });

  it('serializes different codes so exchanges do not overlap', async () => {
    let releaseFirst = () => {};
    let inFlight = 0;
    let sawOverlap = false;
    exchangeCodeForSession.mockImplementation(async (code: string) => {
      inFlight += 1;
      if (inFlight > 1) sawOverlap = true;
      if (code === 'first') await new Promise<void>((resolve) => { releaseFirst = resolve; });
      inFlight -= 1;
      return { error: null };
    });

    const handler = register();
    const both = handler.sendTogether(callback('first'), callback('second'));

    await Promise.resolve();
    await Promise.resolve();
    expect(exchangeCodeForSession).toHaveBeenCalledTimes(1);

    releaseFirst();
    await both;

    expect(sawOverlap).toBe(false);
    expect(exchangeCodeForSession).toHaveBeenCalledTimes(2);
  });

  it('still handles a genuinely different code', async () => {
    const handler = register();

    await handler.send(callback('first'));
    await handler.send(callback('second'));

    expect(exchangeCodeForSession).toHaveBeenNthCalledWith(1, 'first', { flowId: FLOW_ID });
    expect(exchangeCodeForSession).toHaveBeenNthCalledWith(2, 'second', { flowId: FLOW_ID });
  });
});

describe('throwing callbacks do not wedge queue', () => {
  it('exchanges next code after onFailure throws', async () => {
    const onFailure = vi.fn(() => { throw new Error('toast blew up'); });
    registerAuthDeepLinkHandler(onFailure);
    const listener = mocks.listener!;

    exchangeCodeForSession.mockResolvedValue({ error: { message: 'flow_state_not_found' } });
    await Promise.resolve(listener({ url: callback('throws') }));
    expect(onFailure).toHaveBeenCalledTimes(1);

    exchangeCodeForSession.mockResolvedValue({ error: null });
    await Promise.resolve(listener({ url: callback('after-throw') }));

    expect(exchangeCodeForSession).toHaveBeenLastCalledWith('after-throw', { flowId: FLOW_ID });
    expect(exchangeCodeForSession).toHaveBeenCalledTimes(2);
  });

  it('exchanges next code after Browser.close throws', async () => {
    browserClose.mockRejectedValue(new Error('no browser to close'));
    const handler = register();

    await handler.send(callback('close-throws'));
    browserClose.mockResolvedValue(undefined);
    await handler.send(callback('after-close-throw'));

    expect(exchangeCodeForSession).toHaveBeenCalledTimes(2);
    expect(exchangeCodeForSession).toHaveBeenLastCalledWith('after-close-throw', { flowId: FLOW_ID });
  });

  it('bounds pending queue when the leading exchange hangs', async () => {
    let releaseHanging!: () => void;
    const hangingPromise = new Promise<void>((resolve) => { releaseHanging = resolve; });
    exchangeCodeForSession.mockImplementation(async (code: string) => {
      if (code === 'hanging') {
        await hangingPromise;
      }
      return { error: null };
    });

    const handler = register();
    const promises = [handler.send(callback('hanging'))];
    for (let i = 1; i <= 7; i += 1) {
      promises.push(handler.send(callback(`queued-${i}`)));
    }
    promises.push(handler.send(callback('dropped-1')));
    promises.push(handler.send(callback('dropped-2')));

    await Promise.resolve();
    await Promise.resolve();
    expect(exchangeCodeForSession).toHaveBeenCalledTimes(1);

    releaseHanging();
    await Promise.all(promises);

    expect(exchangeCodeForSession).toHaveBeenCalledTimes(8);
    expect(exchangeCodeForSession.mock.calls.map(([code]) => code)).not.toContain('dropped-1');
    expect(exchangeCodeForSession.mock.calls.map(([code]) => code)).not.toContain('dropped-2');
  });

  it('handles the next callback after an aborted exchange', async () => {
    exchangeCodeForSession
      .mockRejectedValueOnce(new DOMException('aborted', 'AbortError'))
      .mockResolvedValueOnce({ error: null });
    const handler = register();

    await handler.send(callback('aborted-first'));
    await handler.send(callback('works-after-abort'));

    expect(exchangeCodeForSession).toHaveBeenCalledTimes(2);
    expect(exchangeCodeForSession).toHaveBeenLastCalledWith(
      'works-after-abort',
      { flowId: FLOW_ID },
    );
  });

  it('logs no authorization code, token or raw error object', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnLog = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      exchangeCodeForSession.mockRejectedValue(
        Object.assign(new Error('boom'), { code: 'secret-auth-code' }),
      );
      const handler = register();
      await handler.send(callback('secret-auth-code', 'secret-flow-id'));
      await handler.send(`${CALLBACK}#access_token=secret-access&refresh_token=secret-refresh`);

      const printed = [...errorLog.mock.calls, ...warnLog.mock.calls]
        .flat()
        .map((part) => (typeof part === 'string' ? part : JSON.stringify(part) ?? ''))
        .join(' | ');

      expect(printed).not.toContain('secret-auth-code');
      expect(printed).not.toContain('secret-flow-id');
      expect(printed).not.toContain('secret-access');
      expect(printed).not.toContain('secret-refresh');
    } finally {
      errorLog.mockRestore();
      warnLog.mockRestore();
    }
  });
});

describe('a dropped callback is still finished for the user', () => {
  it('closes the browser and reports a failure when the pending queue is full', async () => {
    let releaseHanging!: () => void;
    const hanging = new Promise<void>((resolve) => { releaseHanging = resolve; });
    exchangeCodeForSession.mockImplementation(async (code: string) => {
      if (code === 'hanging') await hanging;
      return { error: null };
    });

    const handler = register();
    const inQueue = [handler.send(callback('hanging'))];
    for (let i = 1; i <= 7; i += 1) inQueue.push(handler.send(callback(`queued-${i}`)));

    await Promise.resolve();
    await Promise.resolve();
    expect(browserClose).not.toHaveBeenCalled();
    expect(handler.onFailure).not.toHaveBeenCalled();

    // The 9th callback cannot be queued, so it must not be abandoned silently:
    // the Custom Tab would sit there forever with no way back into the app.
    await handler.send(callback('dropped'));

    expect(browserClose).toHaveBeenCalledTimes(1);
    expect(handler.onFailure).toHaveBeenCalledTimes(1);
    expect(handler.onFailure).toHaveBeenCalledWith(OAUTH_RETURN_MESSAGES.exchangeFailed);
    expect(exchangeCodeForSession.mock.calls.map(([code]) => code)).not.toContain('dropped');

    releaseHanging();
    await Promise.all(inQueue);

    // The bound still holds and the queue recovers.
    expect(exchangeCodeForSession).toHaveBeenCalledTimes(8);
    await handler.send(callback('after-drain'));
    expect(exchangeCodeForSession).toHaveBeenCalledTimes(9);
    expect(exchangeCodeForSession).toHaveBeenLastCalledWith('after-drain', { flowId: FLOW_ID });
  });

  it('reports a drop even when dismissing the browser throws', async () => {
    browserClose.mockRejectedValue(new Error('no browser to close'));
    let releaseHanging!: () => void;
    const hanging = new Promise<void>((resolve) => { releaseHanging = resolve; });
    exchangeCodeForSession.mockImplementation(async (code: string) => {
      if (code === 'hanging') await hanging;
      return { error: null };
    });

    const handler = register();
    const inQueue = [handler.send(callback('hanging'))];
    for (let i = 1; i <= 7; i += 1) inQueue.push(handler.send(callback(`queued-${i}`)));
    await Promise.resolve();

    await expect(handler.send(callback('dropped'))).resolves.toBeUndefined();

    expect(handler.onFailure).toHaveBeenCalledWith(OAUTH_RETURN_MESSAGES.exchangeFailed);

    releaseHanging();
    await Promise.all(inQueue);
  });
});

describe('listener registration failure', () => {
  it('is handled without an unhandled rejection and tells the user once', async () => {
    mocks.addListenerRejection = new Error('appUrlOpen is not available');
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const onFailure = vi.fn();

      const dispose = registerAuthDeepLinkHandler(onFailure);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(onFailure).toHaveBeenCalledTimes(1);
      expect(onFailure).toHaveBeenCalledWith(OAUTH_RETURN_MESSAGES.exchangeFailed);
      expect(mocks.listener).toBeUndefined();

      // Tearing down a registration that never happened must also stay quiet.
      expect(() => dispose()).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  it('logs registration failure without leaking the raw plugin error', async () => {
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      mocks.addListenerRejection = Object.assign(
        new Error('secret-plugin-detail'),
        { code: 'secret-plugin-code' },
      );

      registerAuthDeepLinkHandler(vi.fn());
      await new Promise((resolve) => setTimeout(resolve, 0));

      const printed = errorLog.mock.calls
        .flat()
        .map((part) => (typeof part === 'string' ? part : JSON.stringify(part) ?? ''))
        .join(' | ');

      expect(printed).toContain('Could not register the OAuth deep link listener.');
      expect(printed).not.toContain('secret-plugin-detail');
      expect(printed).not.toContain('secret-plugin-code');
    } finally {
      errorLog.mockRestore();
    }
  });

  it('swallows a failure to remove the listener on teardown', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      listenerRemove.mockRejectedValue(new Error('already detached'));

      const dispose = registerAuthDeepLinkHandler(vi.fn());
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(() => dispose()).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(listenerRemove).toHaveBeenCalledTimes(1);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});

describe('spent-code memory bound', () => {
  it('remembers 16 codes and lets the 17th evict the oldest', async () => {
    const handler = register();

    for (let i = 0; i < 16; i += 1) await handler.send(callback(`c${i}`));
    expect(exchangeCodeForSession).toHaveBeenCalledTimes(16);

    await handler.send(callback('c15'));
    expect(exchangeCodeForSession).toHaveBeenCalledTimes(16);

    await handler.send(callback('c16'));
    await handler.send(callback('c0'));

    expect(exchangeCodeForSession).toHaveBeenCalledTimes(18);
    expect(exchangeCodeForSession).toHaveBeenLastCalledWith('c0', { flowId: FLOW_ID });
  });
});

describe('deferred failure sink', () => {
  it('holds messages until activation, then delivers them in order', () => {
    const sink = createDeferredFailureSink();
    const shown = vi.fn();

    sink.report('first');
    sink.report('second');
    expect(shown).not.toHaveBeenCalled();

    sink.activate(shown);

    expect(shown).toHaveBeenNthCalledWith(1, 'first');
    expect(shown).toHaveBeenNthCalledWith(2, 'second');
  });

  it('passes straight through once activated', () => {
    const sink = createDeferredFailureSink();
    const shown = vi.fn();

    sink.report('queued');
    sink.activate(shown);
    sink.report('later');

    expect(shown).toHaveBeenCalledTimes(2);
    expect(shown).toHaveBeenNthCalledWith(2, 'later');
  });

  it('ignores subsequent activations', () => {
    const sink = createDeferredFailureSink();
    const first = vi.fn();
    const second = vi.fn();

    sink.report('queued');
    sink.activate(first);
    sink.activate(second);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it('keeps working when the sink itself throws', () => {
    const sink = createDeferredFailureSink();
    const shown = vi.fn()
      .mockImplementationOnce(() => { throw new Error('render failed'); });

    sink.activate(shown);

    expect(() => sink.report('first')).not.toThrow();
    sink.report('second');
    expect(shown).toHaveBeenCalledTimes(2);
    expect(shown).toHaveBeenLastCalledWith('second');
  });

  it('does not throw when a queued message reaches a throwing sink', () => {
    const sink = createDeferredFailureSink();
    const shown = vi.fn(() => { throw new Error('render failed'); });

    sink.report('queued');

    expect(() => sink.activate(shown)).not.toThrow();
    expect(shown).toHaveBeenCalledTimes(1);
  });

  it('stops queueing at 8 bounded failures', () => {
    const sink = createDeferredFailureSink();
    const shown = vi.fn();

    for (let i = 0; i < 40; i += 1) sink.report(`m${i}`);
    sink.activate(shown);

    expect(shown).toHaveBeenCalledTimes(8);
    expect(shown).toHaveBeenNthCalledWith(1, 'm0');
    expect(shown).toHaveBeenNthCalledWith(8, 'm7');
  });
});
