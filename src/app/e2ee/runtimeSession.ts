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
import { E2eeRuntimeError, activateCoupleProtection, installE2eeRuntime } from './runtime';
import {
  registerE2eeCoupleAuthorityUnlink,
} from './runtimeLifecycle';
import { setRecordCryptoEnvironment } from '@/lib/records';

export const E2EE_RUNTIME_INSTALLATION_ID = 'gomsinlog-e2ee-runtime-v1';

export type RuntimeSessionResult =
  | { status: 'installed'; deviceId: string; coupleProtection: CoupleProtectionOutcomeReason | 'not_attempted' }
  | {
      status: 'guarded';
      reason: 'bootstrap_incomplete'
        | 'secure_storage_unavailable'
        | 'runtime_unavailable'
        /** Protected local state is unusable; no replacement authority is minted. */
    }
  | { status: 'stale' };

/**
 * Why couple protection is or is not active for the installed session.
 *
 * `not_paired` means the server reports no couple scope this account owns a live
 * key for. That covers a solo account, a pending invitation, and a couple whose
 * pairing ceremony has not yet produced a CSK.
 *
 * `keys_pending` means a couple scope exists but this device cannot yet use its
 * CSK. `unavailable` means activation was attempted and refused. Neither ever
 * downgrades a shared write: both leave the floor unactivated and the write
 * failing closed rather than falling back to plaintext.
 */
export type CoupleProtectionOutcomeReason =
  | 'activated'
  | 'not_paired'
  | 'keys_pending'
  | 'unavailable';

function floorGuard(repository: E2eeRepository): RecordCryptoEnvironment {
  return {
    // If the floor cannot be read, treating it as active is the only honest
    // answer. A single transient PostgREST/schema-cache failure gets one bounded
    // retry first; both failures still become floor=1, so availability never
    // turns into a plaintext downgrade.
    floorFor: async (domain, scopeId) => {
      try {
        return await repository.getWriteFloor(domain, scopeId);
      } catch {
        try {
          return await repository.getWriteFloor(domain, scopeId);
        } catch {
          return 1;
        }
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
  /** Reported couple id, used only for honest status reporting (see below). */
  activeCoupleId?: string | null;
  /** Session hydration installs the runtime first; connected lifecycle owns activation. */
  activateCoupleProtection?: boolean;
  isCurrentSession?: () => boolean;
};

/**
 * Activate the couple write floor for the one couple the server says this
 * account actually holds.
 *
 * The couple is never taken from client state. `listOwnedCoupleScopeIds()` is
 * server-authoritative, and `activateCoupleProtection` independently re-checks
 * the pinned two-party lifecycle and requires a verified CSK, so a former
 * partner, a stale pairing, or a pending invitation cannot activate a floor.
 *
 * A failure here is never fatal to the session: the verified runtime stays
 * installed and shared writes keep failing closed above the floor.
 */
async function activateOwnedCoupleProtection(input: {
  userId: string;
  deviceId: string;
  environment: RecordCryptoEnvironment;
  repository: E2eeRepository;
  localState: E2eeLocalState;
  /**
   * The couple this session believes it is in, used only to tell a pending CSK
   * apart from having no couple at all. It never selects the scope that gets a
   * floor: that stays server-authoritative.
   */
  activeCoupleId?: string | null;
  isCurrentSession: () => boolean;
}): Promise<CoupleProtectionOutcomeReason> {
  let owned: string[];
  try {
    owned = await input.repository.listOwnedCoupleScopeIds();
  } catch {
    return 'unavailable';
  }
  if (!input.isCurrentSession()) return 'unavailable';
  if (owned.length === 0) {
    // No live couple key. Distinguish a solo/pending account from a real active
    // couple whose CSK has not been issued yet: the second one is a protection
    // gap a person may need to act on, and calling it `not_paired` would hide it.
    if (!input.activeCoupleId) return 'not_paired';
    try {
      const snapshot = await input.repository.getCoupleAuthorizationSnapshot(input.activeCoupleId);
      return snapshot.currentUserActiveCoupleId === input.activeCoupleId
        && snapshot.activeUserIds.length === 2
        ? 'keys_pending'
        : 'not_paired';
    } catch {
      return 'unavailable';
    }
  }
  // V1 is a two-person product: exactly one couple scope is the only shape whose
  // floor this session may activate. More than one is an unexpected server state,
  // and guessing which one to protect is not an acceptable resolution.
  if (owned.length !== 1) return 'unavailable';

  try {
    await activateCoupleProtection({
      userId: input.userId,
      deviceId: input.deviceId,
      coupleId: owned[0],
      repository: input.repository,
      localState: input.localState,
      environment: input.environment,
      isCurrentSession: input.isCurrentSession,
    });
    return 'activated';
  } catch {
    // Includes a pending CSK, an unlinked/non-canonical pinned authority, and a
    // server lifecycle that is not the pinned two-party state.
    return 'unavailable';
  }
}

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
    const coupleProtection = input.activateCoupleProtection === false
      ? 'not_attempted' as const
      : await activateOwnedCoupleProtection({
        userId: input.userId,
        deviceId: installed.deviceId,
        environment: installed.environment,
        repository: input.repository,
        localState: input.localState,
        activeCoupleId: input.activeCoupleId,
        isCurrentSession: isCurrent,
      });
    if (!isCurrent()) {
      installed.close();
      return { status: 'stale' };
    }
    return { status: 'installed', deviceId: installed.deviceId, coupleProtection };
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
  activeCoupleId?: string | null;
  activateCoupleProtection?: boolean;
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
  let protectedStateUnavailable = false;
  if (localKeys) {
    try {
      localState = await createProtectedE2eeLocalState({
        installationId: E2EE_RUNTIME_INSTALLATION_ID,
        userId: input.userId,
        localKeys,
      });
    } catch (error) {
      // The exact cause is deliberately not surfaced here: it may describe a
      // device keystore. The floor guard below still prevents a downgrade.
      //
      // One cause is distinguished internally: protected ciphertext that exists
      // while its local key is gone. That is a recovery case, and it must never
      // be retried as a fresh initialization that would replace authority over
      // existing ciphertext.
      const code = error instanceof Error ? error.message : '';
      protectedStateUnavailable = code === 'E_PROTECTED_STATE_KEY_MISSING'
        || code === 'E_PROTECTED_STATE_UNREADABLE';
      localState = null;
    }
  }
  if (input.isCurrentSession && !input.isCurrentSession()) {
    return { status: 'stale' };
  }
  if (protectedStateUnavailable) {
    // The existing recovery use case requires a usable local-state capability
    // and does not define a safe replacement protocol for this local key/blob.
    // Do not invent that protocol here; remain guarded and honest.
    return { status: 'guarded', reason: 'secure_storage_unavailable' };
  }
  return installE2eeRuntimeForSession({
    userId: input.userId,
    repository,
    localState,
    deviceKeys,
    localKeys,
    installationId: E2EE_RUNTIME_INSTALLATION_ID,
    hasSealedOutbox: input.hasSealedOutbox,
    activeCoupleId: input.activeCoupleId,
    activateCoupleProtection: input.activateCoupleProtection,
    isCurrentSession: input.isCurrentSession,
  });
}

/**
 * Complete couple protection for an account whose pairing became usable after
 * its runtime was installed — the real product order when a partner accepts an
 * invitation while the inviter's app is already open.
 *
 * This re-installs the verified runtime for the current device rather than
 * trusting any cached environment, then activates the floor for the single
 * server-owned couple scope. It is safe to call repeatedly: an already-active
 * floor is a no-op, and every failure keeps shared writes closed.
 */
export async function activateCoupleProtectionForAuthenticatedSession(input: {
  userId: string;
  supabaseClient: SupabaseClient | null;
  hasSealedOutbox?: () => Promise<boolean>;
  activeCoupleId?: string | null;
  isCurrentSession?: () => boolean;
}): Promise<CoupleProtectionOutcomeReason> {
  const isCurrent = () => input.isCurrentSession?.() ?? true;
  if (!input.supabaseClient || !isCurrent()) return 'unavailable';
  const installed = await installE2eeRuntimeForAuthenticatedSession({
    ...input,
    activateCoupleProtection: true,
  });
  if (installed.status !== 'installed') return 'unavailable';
  if (installed.coupleProtection === 'not_attempted') return 'unavailable';
  return installed.coupleProtection;
}
