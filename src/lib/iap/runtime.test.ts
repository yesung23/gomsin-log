import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  availability: vi.fn(),
  addListener: vi.fn(),
  currentEntitlements: vi.fn(async () => ({ transactions: [] })),
  sync: vi.fn(async () => undefined),
  purchase: vi.fn(async () => ({ status: 'cancelled' as const })),
  finish: vi.fn(async () => undefined),
  invoke: vi.fn(async (_name: string, options: { body: Record<string, unknown> }) => {
    if (options.body.action === 'status') {
      return { data: { entitlements: [], exportCredits: 0 }, error: null };
    }
    return { data: null, error: null };
  }),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => 'ios',
  },
}));

vi.mock('@gomsinlog/capacitor-storekit', () => ({
  GomsinlogStoreKit: {
    availability: h.availability,
    addListener: h.addListener,
    currentEntitlements: h.currentEntitlements,
    sync: h.sync,
    purchase: h.purchase,
    finish: h.finish,
  },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: h.invoke } },
}));

import {
  appleIapSnapshot,
  bindAppleIapAccount,
  clearAppleIapAccount,
} from './runtime';

const ACCOUNT_A = '00000000-0000-4000-8000-00000000000a';
const ACCOUNT_B = '00000000-0000-4000-8000-00000000000b';
const XCODE = { available: true, environment: 'xcode' as const };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe('Apple IAP runtime account binding', () => {
  beforeEach(() => {
    clearAppleIapAccount();
    h.availability.mockReset();
    h.addListener.mockReset().mockImplementation(async () => ({
      remove: vi.fn(async () => undefined),
    }));
    h.currentEntitlements.mockClear();
    h.invoke.mockClear();
  });

  it('keeps the newest account when availability calls finish in reverse order', async () => {
    const availabilityA = deferred<typeof XCODE>();
    const availabilityB = deferred<typeof XCODE>();
    h.availability
      .mockImplementationOnce(() => availabilityA.promise)
      .mockImplementationOnce(() => availabilityB.promise);

    const bindingA = bindAppleIapAccount(ACCOUNT_A);
    const bindingB = bindAppleIapAccount(ACCOUNT_B);

    availabilityB.resolve(XCODE);
    await bindingB;
    availabilityA.resolve(XCODE);
    await bindingA;

    expect(appleIapSnapshot()).toMatchObject({ accountId: ACCOUNT_B, phase: 'ready' });
    expect(h.addListener).toHaveBeenCalledTimes(1);
  });

  it('removes the previous account listener before waiting for the next availability', async () => {
    const removeA = vi.fn(async () => undefined);
    h.availability.mockResolvedValueOnce(XCODE);
    h.addListener.mockResolvedValueOnce({ remove: removeA });
    await bindAppleIapAccount(ACCOUNT_A);

    const availabilityB = deferred<typeof XCODE>();
    h.availability.mockImplementationOnce(() => availabilityB.promise);
    const bindingB = bindAppleIapAccount(ACCOUNT_B);
    const callsBeforeAvailability = removeA.mock.calls.length;

    availabilityB.resolve(XCODE);
    await bindingB;

    expect(callsBeforeAvailability).toBe(1);
    expect(appleIapSnapshot().accountId).toBe(ACCOUNT_B);
  });

  it('invalidates a pending account bind when the user logs out', async () => {
    const availabilityA = deferred<typeof XCODE>();
    h.availability.mockImplementationOnce(() => availabilityA.promise);

    const bindingA = bindAppleIapAccount(ACCOUNT_A);
    clearAppleIapAccount();
    availabilityA.resolve(XCODE);
    await bindingA;

    expect(appleIapSnapshot()).toMatchObject({ accountId: null, phase: 'idle' });
    expect(h.addListener).not.toHaveBeenCalled();
  });
});
