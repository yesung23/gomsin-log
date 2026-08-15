/**
 * Auth-session composition for the E2EE runtime.
 *
 * This is intentionally outside React.  The store supplies the current-session
 * predicate; this module installs a floor-aware guard synchronously, then
 * replaces it with verified PMK/CSK capability only after bootstrap succeeds.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RecordCryptoEnvironment } from '@/app/records/contentCrypto';
import type { E2eeLocalState, E2eeRepository } from './ports';
import type { DeviceKeyPort } from '@/crypto/keystore/DeviceKeyPort';
import type { LocalKeyPort } from '@/crypto/keystore/LocalKeyPort';
import { getDeviceKeyPort, getLocalKeyPort } from '@/crypto/keystore';
import { createSupabaseE2eeRepository } from '@/data/e2ee/SupabaseE2eeRepository';
import { createProtectedE2eeLocalState } from './protectedLocalState';
import { E2eeRuntimeError, installE2eeRuntime } from './runtime';
import {
  registerE2eeCoupleAuthorityUnlink,
} from './runtimeLifecycle';
import { setRecordCryptoEnvironment } from '@/lib/records';

export const E2EE_RUNTIME_INSTALLATION_ID = 'gomsinlog-e2ee-runtime-v1';

export type RuntimeSessionResult =
  | { status: 'installed'; deviceId: string }
  | { status: 'guarded'; reason: 'bootstrap_incomplete' | 'secure_storage_unavailable' | 'runtime_unavailable' }
  | { status: 'stale' };

function floorGuard(repository: E2eeRepository): RecordCryptoEnvironment {
  return {
    // If the floor cannot be read, treating it as active is the only honest
    // answer.  This prevents an offline/forbidden error from becoming a
    // plaintext write attempt.
    floorFor: async (domain, scopeId) => {
      try {
        return await repository.getWriteFloor(domain, scopeId);
      } catch {
        return 1;
      }
    },
    epochsFor: async () => [],
    scopeKeyFor: async () => null,
  };
}

export type InstallRuntimeForSessionInput = {
  userId: string;
  repository: E2eeRepository;
  localState: E2eeLocalState | null;
  deviceKeys: DeviceKeyPort | null;
  localKeys: LocalKeyPort | null;
  installationId: string;
  hasSealedOutbox?: () => Promise<boolean>;
  isCurrentSession?: () => boolean;
};

export async function installE2eeRuntimeForSession(
  input: InstallRuntimeForSessionInput,
): Promise<RuntimeSessionResult> {
  const isCurrent = () => input.isCurrentSession?.() ?? true;
  if (!isCurrent()) return { status: 'stale' };

  // This guard is installed before the first await. It preserves legacy writes
  // before a scope crosses its floor while refusing every post-floor write until
  // a verified PMK/CSK environment replaces it.
  setRecordCryptoEnvironment(floorGuard(input.repository));
  if (!input.localState || !input.deviceKeys || !input.localKeys) {
    return { status: 'guarded', reason: 'secure_storage_unavailable' };
  }

  let bootstrap;
  try {
    bootstrap = await input.localState.loadBootstrap(input.userId);
  } catch {
    return { status: 'guarded', reason: 'runtime_unavailable' };
  }
  if (!isCurrent()) return { status: 'stale' };
  registerE2eeCoupleAuthorityUnlink((coupleId) => input.localState!.markCoupleAuthorityUnlinked(coupleId));
  if (!bootstrap || bootstrap.state !== 'COMPLETE') {
    return { status: 'guarded', reason: 'bootstrap_incomplete' };
  }

  try {
    const installed = await installE2eeRuntime({
      userId: input.userId,
      repository: input.repository,
      localState: input.localState,
      deviceKeys: input.deviceKeys,
      localKeys: input.localKeys,
      installationId: input.installationId,
      hasSealedOutbox: input.hasSealedOutbox,
      isCurrentSession: isCurrent,
    });
    if (!isCurrent()) {
      installed.close();
      return { status: 'stale' };
    }
    return { status: 'installed', deviceId: installed.deviceId };
  } catch (error) {
    if (!isCurrent()) return { status: 'stale' };
    // Keep the floor guard in place. No installation error may restore the
    // pre-P5 null environment, including an unavailable LCK with sealed data.
    if (error instanceof E2eeRuntimeError && error.code === 'E_BOOTSTRAP_NOT_COMPLETE') {
      return { status: 'guarded', reason: 'bootstrap_incomplete' };
    }
    return { status: 'guarded', reason: 'runtime_unavailable' };
  }
}

export async function installE2eeRuntimeForAuthenticatedSession(input: {
  userId: string;
  supabaseClient: SupabaseClient | null;
  hasSealedOutbox?: () => Promise<boolean>;
  isCurrentSession?: () => boolean;
}): Promise<RuntimeSessionResult> {
  if (!input.supabaseClient) return { status: 'guarded', reason: 'secure_storage_unavailable' };
  const repository = createSupabaseE2eeRepository(input.supabaseClient);
  // This composition wrapper performs protected-state I/O before delegating to
  // `installE2eeRuntimeForSession`. Install the same fail-closed guard here,
  // synchronously, so that first await cannot leave the legacy null environment
  // available for a plaintext write or outbox replay.
  setRecordCryptoEnvironment(floorGuard(repository));
  const deviceKeys = getDeviceKeyPort();
  const localKeys = getLocalKeyPort();
  let localState: E2eeLocalState | null = null;
  if (localKeys) {
    try {
      localState = await createProtectedE2eeLocalState({
        installationId: E2EE_RUNTIME_INSTALLATION_ID,
        userId: input.userId,
        localKeys,
      });
    } catch {
      // The exact cause is deliberately not surfaced here: it may describe a
      // device keystore. The floor guard below still prevents a downgrade.
      localState = null;
    }
  }
  if (input.isCurrentSession && !input.isCurrentSession()) {
    return { status: 'stale' };
  }
  return installE2eeRuntimeForSession({
    userId: input.userId,
    repository,
    localState,
    deviceKeys,
    localKeys,
    installationId: E2EE_RUNTIME_INSTALLATION_ID,
    hasSealedOutbox: input.hasSealedOutbox,
    isCurrentSession: input.isCurrentSession,
  });
}
