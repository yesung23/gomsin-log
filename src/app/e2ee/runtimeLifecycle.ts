/**
 * Dependency-free lifecycle hook for account/session teardown.
 *
 * Store code imports this tiny module so auth tests and the auth shell do not
 * load crypto/records adapters just to clear a capability that may not exist.
 */
let teardown: (() => void) | null = null;

export function registerE2eeRuntimeTeardown(callback: (() => void) | null): void {
  teardown = callback;
}

export function clearE2eeRuntime(): void {
  const current = teardown;
  teardown = null;
  current?.();
}
