import { describe, it, expect, vi } from 'vitest';
import { withTimeout } from '@/lib/async';

describe('withTimeout', () => {
  it('resolves with the promise value when it settles in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000, 'fallback')).resolves.toBe('ok');
  });

  it('resolves with the fallback when the promise never settles', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const never = new Promise<string>(() => {});
    await expect(withTimeout(never, 10, 'fallback')).resolves.toBe('fallback');
  });

  it('resolves with the fallback when the promise rejects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000, 'fallback')).resolves.toBe(
      'fallback',
    );
  });

  it('does not resolve twice when the promise settles right after the timeout', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let release: (v: string) => void = () => {};
    const slow = new Promise<string>((resolve) => {
      release = resolve;
    });
    const result = await withTimeout(slow, 5, 'fallback');
    release('late');
    expect(result).toBe('fallback');
  });
});
