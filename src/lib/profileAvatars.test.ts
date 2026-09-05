import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), blocked: false, current: true }));
vi.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {
  rpc: (name: string, params: unknown) => ({ abortSignal: () => mocks.rpc(name, params) }),
} }));
vi.mock('@/lib/accountDeletion', () => ({
  runServerMutationBehindDeletionBarrier: async (operation: (context: { assertCurrent: () => void }) => Promise<unknown>) => {
    if (mocks.blocked) return { kind: 'blocked' };
    return { kind: 'executed', value: await operation({ assertCurrent: () => { if (!mocks.current) throw Error('stale'); } }) };
  },
}));
import { readProfileAvatar, saveProfileAvatar } from './profileAvatars';

const OWNER = '10000000-0000-4000-8000-000000000001';
const VERSION = '20000000-0000-4000-8000-000000000001';
const OPERATION = '20000000-0000-4000-8000-000000000002';
const PHOTO = 'data:image/jpeg;base64,/9j/2Q==';

beforeEach(() => { mocks.rpc.mockReset(); mocks.blocked = false; mocks.current = true; });
describe('private profile avatar repository', () => {
  it('does not mistake an unavailable read for a removed photo', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } });
    expect(await readProfileAvatar(OWNER)).toEqual({ ok: false });
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect(await readProfileAvatar(OWNER)).toEqual({ ok: true, avatar: { version: null, dataUrl: null } });
  });
  it('only accepts the exact owner and a bounded JPEG, never a URL', async () => {
    for (const row of [
      { user_id: 'other', version: VERSION, jpeg_base64: '/9j/2Q==' },
      { user_id: OWNER, version: VERSION, jpeg_base64: 'https://example.test/portrait' },
      { user_id: OWNER, version: 'bad', jpeg_base64: '/9j/2Q==' },
      { user_id: OWNER, version: VERSION, jpeg_base64: 'A'.repeat(100_000) },
    ]) {
      mocks.rpc.mockResolvedValue({ data: row, error: null });
      expect(await readProfileAvatar(OWNER)).toEqual({ ok: false });
    }
    mocks.rpc.mockResolvedValue({ data: { user_id: OWNER, version: VERSION, jpeg_base64: '/9j/2Q==' }, error: null });
    expect(await readProfileAvatar(OWNER)).toEqual({ ok: true, avatar: { version: VERSION, dataUrl: PHOTO } });
  });
  it('keeps a removal version to prevent an old upload from resurrecting the photo', async () => {
    mocks.rpc.mockResolvedValue({ data: { user_id: OWNER, version: OPERATION }, error: null });
    expect(await saveProfileAvatar({ ownerId: OWNER, expectedVersion: VERSION, operationId: OPERATION, dataUrl: null }))
      .toEqual({ ok: true, avatar: { version: OPERATION, dataUrl: null } });
    expect(mocks.rpc).toHaveBeenCalledWith('set_my_profile_avatar', {
      p_expected_user_id: OWNER, p_expected_version: VERSION, p_operation_id: OPERATION, p_jpeg_base64: null,
    });
  });
  it('cannot call the server through a pending deletion or stale identity', async () => {
    const input = { ownerId: OWNER, expectedVersion: VERSION, operationId: OPERATION, dataUrl: PHOTO };
    mocks.blocked = true;
    expect((await saveProfileAvatar(input)).ok).toBe(false);
    mocks.blocked = false;
    mocks.current = false;
    expect((await saveProfileAvatar(input)).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('reports a conflict without overwriting another device’s version', async () => {
    mocks.rpc.mockResolvedValue({ error: { code: '40001' }, data: null });
    expect(await saveProfileAvatar({ ownerId: OWNER, expectedVersion: VERSION, operationId: OPERATION, dataUrl: PHOTO }))
      .toEqual({ ok: false, reason: 'conflict' });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('reconciles a lost acknowledgement only against its own operation and bytes', async () => {
    mocks.rpc.mockRejectedValueOnce(Error('network'))
      .mockResolvedValueOnce({ data: { user_id: OWNER, version: OPERATION, jpeg_base64: '/9j/2Q==' }, error: null });
    expect((await saveProfileAvatar({ ownerId: OWNER, expectedVersion: VERSION, operationId: OPERATION, dataUrl: PHOTO })).ok).toBe(true);
    expect(mocks.rpc.mock.calls[1][0]).toBe('get_profile_avatar');
  });
  it('rejects arbitrary data URLs before they reach a server mutation', async () => {
    expect((await saveProfileAvatar({ ownerId: OWNER, expectedVersion: VERSION, operationId: OPERATION, dataUrl: 'data:image/svg+xml,<svg/>' })).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
