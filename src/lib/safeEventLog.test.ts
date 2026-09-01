import { describe, expect, it } from 'vitest';
import { safeEventDetails } from '../../supabase/functions/_shared/safeEventLog';

describe('Edge Function platform event logging', () => {
  it('keeps only bounded operational fields and drops identifiers or messages', () => {
    expect(safeEventDetails({
      caller: 'user-uuid',
      deviceId: 'device-uuid',
      challengeId: 'challenge-uuid',
      message: 'private server response',
      path: 'couple/record/photo.jpg',
      code: 'E_WRONG_ACCOUNT',
      kind: 'authorization',
      devices: 2,
      delivered: false,
      failed: 1,
    })).toEqual({
      code: 'E_WRONG_ACCOUNT',
      kind: 'authorization',
      devices: 2,
      delivered: false,
      failed: 1,
    });
  });

  it('rejects unbounded or non-enum values even on an allowed key', () => {
    expect(safeEventDetails({
      code: 'a'.repeat(65),
      devices: -1,
      failed: 1.5,
      delivered: 'false',
    })).toEqual({});
  });
});
