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

  it('reports RECOVERY_REQUIRED when protected ciphertext outlives its local key', async () => {
    stubPorts();
    // This is the state a reinstall or keystore loss produces: the sealed state is
    // still on the device but the key that opens it is gone.
    vi.spyOn(protectedLocalState, 'createProtectedE2eeLocalState')
      .mockRejectedValue(new Error('E_PROTECTED_STATE_KEY_MISSING'));
    const getRecoveryIdentity = vi.fn().mockResolvedValue({ id: 'recovery-identity' });
    vi.spyOn(repositoryModule, 'createSupabaseE2eeRepository')
      .mockReturnValue({ getRecoveryIdentity } as never);

    // Reporting TEMPORARILY_UNAVAILABLE here hid the only action that can restore
    // the device, and SETUP_REQUIRED would have offered replacement authority
    // over ciphertext that already exists.
    await expect(loadSettingsBootstrapFacts({
      userId: 'user-1',
      coupleId: null,
      supabaseClient: CLIENT,
    })).resolves.toEqual({ status: 'RECOVERY_REQUIRED' });
    expect(getRecoveryIdentity).toHaveBeenCalledWith('user-1');
  });

  it('does not claim recovery is possible without a server recovery identity', async () => {
    stubPorts();
    vi.spyOn(protectedLocalState, 'createProtectedE2eeLocalState')
      .mockRejectedValue(new Error('E_PROTECTED_STATE_UNREADABLE'));
    vi.spyOn(repositoryModule, 'createSupabaseE2eeRepository')
      .mockReturnValue({ getRecoveryIdentity: vi.fn().mockResolvedValue(null) } as never);

    // With nothing to verify a kit against, recovery cannot be offered. This must
    // still never become SETUP_REQUIRED.
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
