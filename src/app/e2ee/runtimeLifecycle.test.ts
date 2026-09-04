import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearE2eeRuntime,
  registerE2eeRuntimeProvider,
  registerE2eeRuntimeTeardown,
} from './runtimeLifecycle';

describe('E2EE runtime lifecycle ownership', () => {
  afterEach(() => clearE2eeRuntime());

  it('does not let a stale runtime registration clear its replacement', () => {
    const staleTeardown = vi.fn();
    const currentTeardown = vi.fn();
    const stale = registerE2eeRuntimeTeardown(staleTeardown);
    registerE2eeRuntimeTeardown(currentTeardown);

    stale.clear();

    expect(staleTeardown).not.toHaveBeenCalled();
    expect(currentTeardown).not.toHaveBeenCalled();
    clearE2eeRuntime();
    expect(currentTeardown).toHaveBeenCalledOnce();
  });

  it('keeps the shared runtime until the last mounted Provider is released', () => {
    const firstProvider = registerE2eeRuntimeProvider();
    const secondProvider = registerE2eeRuntimeProvider();
    const teardown = vi.fn();
    registerE2eeRuntimeTeardown(teardown);

    firstProvider.unregister();
    expect(teardown).not.toHaveBeenCalled();

    secondProvider.unregister();
    expect(teardown).toHaveBeenCalledOnce();
  });
});
