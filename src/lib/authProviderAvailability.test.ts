import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchAuthProviderAvailabilityFrom,
  parseAuthProviderAvailability,
} from '@/lib/supabase';

describe('auth provider availability', () => {
  it('enables only providers the server explicitly reports as true', () => {
    expect(parseAuthProviderAvailability({
      external: { google: true, apple: false, email: true, phone: true },
    })).toEqual({ google: true, apple: false, email: true });
  });

  it('fails closed for malformed or missing settings', () => {
    expect(parseAuthProviderAvailability(null)).toEqual({
      google: false,
      apple: false,
      email: false,
    });
    expect(parseAuthProviderAvailability({ external: { google: 'true', apple: 1 } })).toEqual({
      google: false,
      apple: false,
      email: false,
    });
  });

  it('reads the public settings endpoint and clears its timeout after success', async () => {
    vi.useFakeTimers();
    let observedSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      observedSignal = init?.signal ?? undefined;
      expect(String(input)).toBe('https://project.example/auth/v1/settings');
      expect(init?.headers).toEqual({ apikey: 'public-key' });
      expect(init?.cache).toBe('no-store');
      return new Response(JSON.stringify({
        external: { apple: true, google: true, email: false },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(fetchAuthProviderAvailabilityFrom({
      supabaseUrl: 'https://project.example',
      publishableKey: 'public-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 25,
    })).resolves.toEqual({ apple: true, google: true, email: false });

    await vi.advanceTimersByTimeAsync(25);
    expect(observedSignal?.aborted).toBe(false);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('aborts a provider-settings request that never settles', async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let observedSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      observedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        observedSignal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });

    const result = fetchAuthProviderAvailabilityFrom({
      supabaseUrl: 'https://project.example',
      publishableKey: 'public-key',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 25,
    });
    await vi.advanceTimersByTimeAsync(25);

    await expect(result).resolves.toBeNull();
    expect(observedSignal?.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    consoleError.mockRestore();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
});
