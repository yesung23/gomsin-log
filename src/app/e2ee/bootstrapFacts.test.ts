import { describe, expect, it } from 'vitest';
import { produceBootstrapFacts, produceBootstrapState } from './bootstrapFacts';
import { createMemoryAccount, createMemoryServer } from './testing/memoryEnvironment';

describe('canonical BootstrapFacts producer', () => {
  it('cannot fabricate READY from optimistic runtime/key booleans', async () => {
    const server = createMemoryServer();
    const account = createMemoryAccount(server);
    const device = account.devices[0];
    const fakeRuntime = {
      floorFor: async () => 1,
      epochsFor: async () => [{ domain: 'personal' as const, scopeId: account.userId, epoch: 1n, state: 'ACTIVE' as const }],
      scopeKeyFor: async () => ({ extractable: false } as CryptoKey),
    };
    const fakeLck = { has: async () => true } as never;

    const facts = await produceBootstrapFacts({
      userId: account.userId,
      repository: device.deps.repository,
      localState: account.localState,
      deviceKeys: device.deviceKeys,
      runtime: fakeRuntime,
      lck: fakeLck,
    });

    expect(facts.hasLocalIdentity).toBe(false);
    expect(facts.recoveryCreated).toBe(false);
    expect(facts.deviceEnrolled).toBe(false);
    expect(await produceBootstrapState({
      userId: account.userId,
      repository: device.deps.repository,
      localState: account.localState,
      deviceKeys: device.deviceKeys,
      runtime: fakeRuntime,
      lck: fakeLck,
    })).toBe('UNINITIALIZED');
  });
});
