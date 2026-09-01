import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ACCOUNT_DELETION_V2_PROTOCOL,
  ACCOUNT_DELETION_V2_STORAGE_KEY_PREFIX,
  LocalStorageAccountDeletionV2Storage,
  accountDeletionV2KeyFor,
  buildAccountDeletionV2RequestBody,
  decodeBase64Url32,
  encodeBase64Url32,
  generateAccountDeletionV2Capability,
  hasExactKeys,
  isCanonicalUuid,
  isUuidV4,
  isValidRecoveryToken,
  loadAccountDeletionV2Capability,
  parseAccountDeletionV2Capability,
  parseAccountDeletionV2FinalizeResponse,
  parseAccountDeletionV2PrepareResponse,
  parseAccountDeletionV2StatusResponse,
  removeAccountDeletionV2Capability,
  saveAccountDeletionV2Capability,
  serializeAccountDeletionV2Capability,
  type AccountDeletionV2Capability,
} from '@/lib/accountDeletionV2';

const VALID_USER_ID = '11111111-2222-4333-8444-555555555555';
const OTHER_USER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('Account Deletion V2 Capability Contract', () => {
  describe('1. Capability validation & generation format', () => {
    it('generates a strictly valid V2 capability using Web Crypto', () => {
      const capability = generateAccountDeletionV2Capability(VALID_USER_ID);
      expect(capability.version).toBe(2);
      expect(capability.userId).toBe(VALID_USER_ID);
      expect(isUuidV4(capability.operationId)).toBe(true);
      expect(isValidRecoveryToken(capability.recoveryToken)).toBe(true);
      expect(capability.recoveryToken.length).toBe(43);
      expect(Number.isFinite(Date.parse(capability.createdAt))).toBe(true);
    });

    it('rejects invalid or non-canonical userId during generation', () => {
      expect(() => generateAccountDeletionV2Capability('not-a-uuid')).toThrow();
      expect(() => generateAccountDeletionV2Capability('')).toThrow();
      expect(() => generateAccountDeletionV2Capability(null as any)).toThrow();
    });

    it('encodes and decodes 32-byte tokens canonically without padding', () => {
      const bytes = new Uint8Array(32);
      for (let i = 0; i < 32; i += 1) bytes[i] = i;
      const token = encodeBase64Url32(bytes);
      expect(token.length).toBe(43);
      expect(token.includes('=')).toBe(false);
      expect(token.includes('+')).toBe(false);
      expect(token.includes('/')).toBe(false);
      const decoded = decodeBase64Url32(token);
      expect(decoded).not.toBeNull();
      expect(Array.from(decoded!)).toEqual(Array.from(bytes));
    });

    it('fails closed on malformed recovery tokens', () => {
      expect(isValidRecoveryToken('short')).toBe(false);
      expect(isValidRecoveryToken('A'.repeat(42))).toBe(false);
      expect(isValidRecoveryToken('A'.repeat(44))).toBe(false);
      expect(isValidRecoveryToken('A'.repeat(43) + '=')).toBe(false);
      expect(isValidRecoveryToken('A'.repeat(42) + '+')).toBe(false);
      expect(isValidRecoveryToken(null)).toBe(false);
      expect(isValidRecoveryToken({})).toBe(false);
    });

    it('fails closed on unknown or extra keys in capability', () => {
      const valid = generateAccountDeletionV2Capability(VALID_USER_ID);
      expect(parseAccountDeletionV2Capability(valid)).not.toBeNull();

      // Extra key
      const withExtra = { ...valid, extraKey: 'attacker-injected' };
      expect(parseAccountDeletionV2Capability(withExtra)).toBeNull();

      // Missing key
      const { recoveryToken, ...missingToken } = valid;
      expect(parseAccountDeletionV2Capability(missingToken)).toBeNull();

      // Wrong version
      const wrongVersion = { ...valid, version: 1 };
      expect(parseAccountDeletionV2Capability(wrongVersion)).toBeNull();
    });
  });

  describe('2. Durable storage port & corrupt distinction', () => {
    let storageMap: Map<string, string>;
    let mockStorage: Storage;

    beforeEach(() => {
      storageMap = new Map();
      mockStorage = {
        getItem: vi.fn((k: string) => storageMap.get(k) ?? null),
        setItem: vi.fn((k: string, v: string) => { storageMap.set(k, v); }),
        removeItem: vi.fn((k: string) => { storageMap.delete(k); }),
        clear: vi.fn(() => storageMap.clear()),
        key: vi.fn(),
        length: 0,
      };
    });

    it('saves and loads valid capability for exact user', () => {
      const store = new LocalStorageAccountDeletionV2Storage(mockStorage);
      const cap = generateAccountDeletionV2Capability(VALID_USER_ID);

      expect(store.save(cap)).toBe(true);
      expect(mockStorage.setItem).toHaveBeenCalledWith(accountDeletionV2KeyFor(VALID_USER_ID), expect.any(String));

      const loaded = store.load(VALID_USER_ID);
      expect(loaded).toEqual({ kind: 'valid', capability: cap });
    });

    it('returns absent for non-existent capability', () => {
      const store = new LocalStorageAccountDeletionV2Storage(mockStorage);
      expect(store.load(VALID_USER_ID)).toEqual({ kind: 'absent' });
    });

    it('returns corrupt for invalid JSON or malformed schema and NEVER deletes corrupt data on read', () => {
      const store = new LocalStorageAccountDeletionV2Storage(mockStorage);
      const key = accountDeletionV2KeyFor(VALID_USER_ID);

      // Non-json string
      storageMap.set(key, 'broken json {');
      expect(store.load(VALID_USER_ID)).toEqual({ kind: 'corrupt' });
      expect(mockStorage.removeItem).not.toHaveBeenCalled();
      expect(storageMap.has(key)).toBe(true);

      // Schema missing fields
      storageMap.set(key, JSON.stringify({ version: 2 }));
      expect(store.load(VALID_USER_ID)).toEqual({ kind: 'corrupt' });
      expect(mockStorage.removeItem).not.toHaveBeenCalled();
      expect(storageMap.has(key)).toBe(true);

      // Wrong user binding
      const capForOther = generateAccountDeletionV2Capability(OTHER_USER_ID);
      storageMap.set(key, JSON.stringify(capForOther));
      expect(store.load(VALID_USER_ID)).toEqual({ kind: 'corrupt' });
      expect(mockStorage.removeItem).not.toHaveBeenCalled();
    });

    it('removes only upon explicit remove call', () => {
      const store = new LocalStorageAccountDeletionV2Storage(mockStorage);
      const cap = generateAccountDeletionV2Capability(VALID_USER_ID);
      store.save(cap);

      expect(store.remove(VALID_USER_ID)).toBe(true);
      expect(store.load(VALID_USER_ID)).toEqual({ kind: 'absent' });
    });
  });

  describe('3. Request body construction', () => {
    it('builds exact protocol: 2 PUT request body without extra keys', () => {
      const cap = generateAccountDeletionV2Capability(VALID_USER_ID);
      const body = buildAccountDeletionV2RequestBody('prepare', cap);

      expect(body).toEqual({
        protocol: 2,
        action: 'prepare',
        operationId: cap.operationId,
        recoveryToken: cap.recoveryToken,
      });
      expect(hasExactKeys(body, ['protocol', 'action', 'operationId', 'recoveryToken'])).toBe(true);
    });

    it('never logs recoveryToken', () => {
      const consoleSpy = vi.spyOn(console, 'log');
      const cap = generateAccountDeletionV2Capability(VALID_USER_ID);
      // Ensure serialization / validation does not log token
      serializeAccountDeletionV2Capability(cap);
      expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining(cap.recoveryToken));
      consoleSpy.mockRestore();
    });
  });

  describe('4. Response parsers preserving ambiguity', () => {
    const OP_ID = '11111111-2222-4333-8444-555555555555';

    describe('Prepare response parsing', () => {
      it('parses valid prepare response', () => {
        const res = parseAccountDeletionV2PrepareResponse({ success: true, operationId: OP_ID, state: 'prepared' }, OP_ID, 200);
        expect(res).toEqual({ kind: 'prepared', operationId: OP_ID });
      });

      it('handles 409 conflict', () => {
        const res = parseAccountDeletionV2PrepareResponse({ error: 'conflict' }, OP_ID, 409);
        expect(res).toEqual({ kind: 'conflict', error: 'Operation conflict' });
      });

      it('handles 401 unauthenticated', () => {
        const res = parseAccountDeletionV2PrepareResponse({ error: 'unauth' }, OP_ID, 401);
        expect(res).toEqual({ kind: 'unauthenticated', error: 'Authentication required' });
      });

      it('preserves 503 retryAfterSeconds as failed', () => {
        const res = parseAccountDeletionV2PrepareResponse({ error: 'temporarily unavailable', retryAfterSeconds: 5 }, OP_ID, 503);
        expect(res).toEqual({ kind: 'failed', status: 503, error: 'temporarily unavailable', retryAfterSeconds: 5 });
      });

      it('rejects mismatched operationId', () => {
        const res = parseAccountDeletionV2PrepareResponse({ success: true, operationId: 'other-id', state: 'prepared' }, OP_ID, 200);
        expect(res.kind).toBe('failed');
      });
    });

    describe('Status response parsing', () => {
      it('parses valid status response for each valid state', () => {
        for (const state of ['prepared', 'deleting', 'auth_delete_ready', 'completed'] as const) {
          const res = parseAccountDeletionV2StatusResponse({ success: true, operationId: OP_ID, state }, OP_ID, 200);
          expect(res).toEqual({ kind: 'status', operationId: OP_ID, state, retryAfterSeconds: undefined });
        }
      });

      it('parses 404 not found', () => {
        const res = parseAccountDeletionV2StatusResponse({ error: 'Operation not found' }, OP_ID, 404);
        expect(res).toEqual({ kind: 'not_found', error: 'Operation not found' });
      });

      it('handles 503 and preserves retryAfterSeconds', () => {
        const res = parseAccountDeletionV2StatusResponse({ error: 'unavailable', retryAfterSeconds: 10 }, OP_ID, 503);
        expect(res).toEqual({ kind: 'failed', status: 503, error: 'unavailable', retryAfterSeconds: 10 });
      });
    });

    describe('Finalize response parsing', () => {
      it('parses completed response with explicit proof only', () => {
        const res = parseAccountDeletionV2FinalizeResponse({ success: true, operationId: OP_ID, state: 'completed', warnings: ['w1'] }, OP_ID, 200);
        expect(res).toEqual({ kind: 'completed', operationId: OP_ID, warnings: ['w1'] });
      });

      it('parses 503 pending state with retryAfterSeconds', () => {
        const res = parseAccountDeletionV2FinalizeResponse({ error: 'pending', operationId: OP_ID, state: 'deleting', retryAfterSeconds: 3 }, OP_ID, 503);
        expect(res).toEqual({ kind: 'pending', operationId: OP_ID, state: 'deleting', retryAfterSeconds: 3 });
      });

      it('parses 409 busy state with retryAfterSeconds', () => {
        const res = parseAccountDeletionV2FinalizeResponse({ error: 'busy', operationId: OP_ID, state: 'deleting', retryAfterSeconds: 15 }, OP_ID, 409);
        expect(res).toEqual({ kind: 'busy', operationId: OP_ID, state: 'deleting', retryAfterSeconds: 15 });
      });

      it('parses 401 unauthenticated and 403 forbidden and 404 not found', () => {
        expect(parseAccountDeletionV2FinalizeResponse({}, OP_ID, 401)).toEqual({ kind: 'unauthenticated', error: 'Authentication required' });
        expect(parseAccountDeletionV2FinalizeResponse({}, OP_ID, 403)).toEqual({ kind: 'forbidden', error: 'Forbidden' });
        expect(parseAccountDeletionV2FinalizeResponse({}, OP_ID, 404)).toEqual({ kind: 'not_found', error: 'Operation not found' });
      });

      it('rejects mismatched operationId on completed response', () => {
        const res = parseAccountDeletionV2FinalizeResponse({ success: true, operationId: 'mismatched-id', state: 'completed' }, OP_ID, 200);
        expect(res.kind).toBe('failed');
      });
    });
  });
});
