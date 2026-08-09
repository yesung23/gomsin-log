import { describe, expect, it } from 'vitest';
import { parseAuthProviderAvailability } from '@/lib/supabase';

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
});
