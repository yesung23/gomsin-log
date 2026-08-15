/**
 * Dependency-free lifecycle hook for account/session teardown.
 *
 * Store code imports this tiny module so auth tests and the auth shell do not
 * load crypto/records adapters just to clear a capability that may not exist.
 */
let teardown: (() => void) | null = null;
let coupleAuthorityUnlink: ((coupleId: string) => Promise<void>) | null = null;

export function registerE2eeRuntimeTeardown(callback: (() => void) | null): void {
  teardown = callback;
}

/** Replace record/outbox capabilities without discarding session authority state. */
export function clearE2eeRuntimeCapabilities(): void {
  const current = teardown;
  teardown = null;
  current?.();
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
}
