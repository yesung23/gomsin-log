import { afterEach, describe, expect, it, vi } from 'vitest';
import * as keystore from '@/crypto/keystore';
import * as repositoryModule from '@/data/e2ee/SupabaseE2eeRepository';
import * as protectedLocalState from './protectedLocalState';
import { loadSettingsBootstrapFacts } from './settingsFacts';

const CLIENT = {} as never;

function stubPorts() {
  vi.spyOn(keystore, 'getDeviceKeyPort').mockReturnValue({} as never);
  vi.spyOn(keystore, 'getLocalKeyPort').mockReturnValue({} as never);
}

describe('settings protection facts', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reports secure-storage-unavailable when protected ciphertext outlives its local key', async () => {
    stubPorts();
    // This is the state a reinstall or keystore loss produces: the sealed state is
    // still on the device but the key that opens it is gone.
    vi.spyOn(protectedLocalState, 'createProtectedE2eeLocalState')
      .mockRejectedValue(new Error('E_PROTECTED_STATE_KEY_MISSING'));
    vi.spyOn(repositoryModule, 'createSupabaseE2eeRepository')
      .mockReturnValue({} as never);

    // The current recovery use case cannot safely replace this local key/blob.
    // Do not offer an unreachable button or a replacement-authority shortcut.
    await expect(loadSettingsBootstrapFacts({
      userId: 'user-1',
      coupleId: null,
      supabaseClient: CLIENT,
    })).resolves.toEqual({ status: 'SECURE_STORAGE_UNAVAILABLE' });
  });

  it('keeps an unreadable protected blob out of the kit-recovery route', async () => {
    stubPorts();
    vi.spyOn(protectedLocalState, 'createProtectedE2eeLocalState')
      .mockRejectedValue(new Error('E_PROTECTED_STATE_UNREADABLE'));
    vi.spyOn(repositoryModule, 'createSupabaseE2eeRepository')
      .mockReturnValue({ getRecoveryIdentity: vi.fn() } as never);

    // UNREADABLE means the existing key/blob authentication failed, not that a
    // Recovery Kit has already been proven able to repair the local state.
    await expect(loadSettingsBootstrapFacts({
      userId: 'user-1',
      coupleId: null,
      supabaseClient: CLIENT,
    })).resolves.toEqual({ status: 'SECURE_STORAGE_UNAVAILABLE' });
  });

  it('keeps an unrelated failure temporary rather than inventing a recovery case', async () => {
    stubPorts();
    vi.spyOn(protectedLocalState, 'createProtectedE2eeLocalState')
      .mockRejectedValue(new Error('network down'));
    vi.spyOn(repositoryModule, 'createSupabaseE2eeRepository')
      .mockReturnValue({ getRecoveryIdentity: vi.fn() } as never);

    await expect(loadSettingsBootstrapFacts({
      userId: 'user-1',
      coupleId: null,
      supabaseClient: CLIENT,
    })).resolves.toEqual({ status: 'TEMPORARILY_UNAVAILABLE' });
  });
});
