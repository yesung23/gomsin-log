import type { SupabaseClient } from '@supabase/supabase-js';
import { getDeviceKeyPort, getLocalKeyPort } from '@/crypto/keystore';
import { createSupabaseE2eeRepository } from '@/data/e2ee/SupabaseE2eeRepository';
import { createProtectedE2eeLocalState } from './protectedLocalState';
import { produceBootstrapFacts } from './bootstrapFacts';
import { E2EE_RUNTIME_INSTALLATION_ID } from './runtimeSession';
import {
  deviceProtectionStatusFromFacts,
  type DeviceProtectionSnapshot,
} from './deviceProtectionStatus';

/** Pending invitation spaces do not yet have a shared crypto scope. */
export function activeCoupleScopeId(input: {
  coupleId?: string;
  connected: boolean;
  status: string;
}): string | null {
  return input.connected && input.status === 'active' && input.coupleId
    ? input.coupleId
    : null;
}

/** Composition boundary for Settings; the component consumes facts only. */
export async function loadSettingsBootstrapFacts(input: {
  userId: string;
  coupleId: string | null;
  supabaseClient: SupabaseClient | null;
}): Promise<DeviceProtectionSnapshot> {
  if (!input.supabaseClient) return { status: 'TEMPORARILY_UNAVAILABLE' };
  const deviceKeys = getDeviceKeyPort();
  const localKeyPort = getLocalKeyPort();
  if (!deviceKeys || !localKeyPort) return { status: 'SECURE_STORAGE_UNAVAILABLE' };
  try {
    // Settings must read the same account-bound protected state as the runtime.
    // A distinct namespace makes a completed bootstrap look absent and invites
    // a dangerous "start again" interpretation on a replacement device.
    const localState = await createProtectedE2eeLocalState({
      installationId: E2EE_RUNTIME_INSTALLATION_ID,
      userId: input.userId,
      localKeys: localKeyPort,
    });
    if (!localState) return { status: 'SECURE_STORAGE_UNAVAILABLE' };
    const repository = createSupabaseE2eeRepository(input.supabaseClient);
    const [facts, recoveryIdentity] = await Promise.all([
      produceBootstrapFacts({
        userId: input.userId,
        coupleId: input.coupleId,
        repository,
        localState,
        deviceKeys,
      }),
      // This is intentionally queried even when the local bootstrap is gone:
      // it is the evidence that makes a missing local key a recovery case.
      repository.getRecoveryIdentity(input.userId),
    ]);
    return {
      status: deviceProtectionStatusFromFacts({
        facts,
        hasServerRecoveryIdentity: !!recoveryIdentity,
      }),
      facts,
    };
  } catch {
    return { status: 'TEMPORARILY_UNAVAILABLE' };
  }
}
