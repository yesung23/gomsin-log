/**
 * Dependency-free lifecycle hook for account/session teardown.
 *
 * Store code imports this tiny module so auth tests and the auth shell do not
 * load crypto/records adapters just to clear a capability that may not exist.
 */
import { clearAllCoupleProtectionRequirements } from './coupleProtectionBarrier';

type RuntimeTeardownSlot = {
  token: symbol;
  callback: () => void;
};

export type E2eeRuntimeTeardownRegistration = {
  /** Clear only the capability installed by this exact registration. */
  clear(): void;
};

export type E2eeRuntimeProviderRegistration = {
  /** Release one mounted Provider; the last Provider clears the shared runtime. */
  unregister(): void;
};

let teardown: RuntimeTeardownSlot | null = null;
let coupleAuthorityUnlink: ((coupleId: string) => Promise<void>) | null = null;
const mountedProviders = new Set<symbol>();

export function registerE2eeRuntimeTeardown(
  callback: (() => void) | null,
): E2eeRuntimeTeardownRegistration {
  const token = Symbol('e2ee-runtime-teardown');
  teardown = callback ? { token, callback } : null;
  let active = true;
  return {
    clear: () => {
      if (!active) return;
      active = false;
      if (teardown?.token !== token) return;
      clearE2eeRuntimeCapabilities();
    },
  };
}

/** Replace record/outbox capabilities without discarding session authority state. */
export function clearE2eeRuntimeCapabilities(): void {
  const current = teardown;
  teardown = null;
  current?.callback();
}

/**
 * Keep the process-wide runtime alive while at least one StoreProvider remains
 * mounted. This matters during shell replacement and tests with two Providers:
 * an old tree must not clear capabilities installed for the surviving tree.
 */
export function registerE2eeRuntimeProvider(): E2eeRuntimeProviderRegistration {
  const token = Symbol('e2ee-runtime-provider');
  mountedProviders.add(token);
  let active = true;
  return {
    unregister: () => {
      if (!active) return;
      active = false;
      mountedProviders.delete(token);
      if (mountedProviders.size === 0) clearE2eeRuntime();
    },
  };
}

/**
 * The protected local authority is session-scoped just like the runtime keys.
 *
 * Keeping this alongside, rather than inside, the record crypto environment
 * lets the account/couple shell revoke a pinned couple transcript even when
 * this device has no usable CSK.  A missing handler is safe: it means this
 * device never opened protected E2EE state for the account.
 */
export function registerE2eeCoupleAuthorityUnlink(
  callback: ((coupleId: string) => Promise<void>) | null,
): void {
  coupleAuthorityUnlink = callback;
}

export async function markE2eeCoupleAuthorityUnlinked(coupleId: string): Promise<void> {
  if (!coupleId) return;
  await coupleAuthorityUnlink?.(coupleId);
}

export function clearE2eeRuntime(): void {
  clearE2eeRuntimeCapabilities();
  coupleAuthorityUnlink = null;
  clearAllCoupleProtectionRequirements();
}
