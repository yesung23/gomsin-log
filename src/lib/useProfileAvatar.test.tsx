import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }));
vi.mock('./profileAvatars', () => ({ readProfileAvatar: api.read, saveProfileAvatar: api.save }));
let viewer = 'owner';
let partner = 'partner';
let connected = true;
let sync = 'live';
let deletion = 'clear';
let profile: object;
function rebuildProfile() { profile = { id: viewer, couple: { coupleId: 'couple', connected, status: connected ? 'active' : 'disconnected', partnerUserId: partner } }; }
vi.mock('@/lib/useStore', () => ({ useStore: () => ({
  state: { authenticatedUser: { id: viewer }, profile }, coupleLifecycle: connected ? 'connected' : 'disconnected',
  sharedSyncStatus: sync, deletionStatus: { kind: deletion },
}) }));
import { useProfileAvatar } from './useProfileAvatar';
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
const avatar = (dataUrl: string | null) => ({ ok: true, avatar: { version: 'version', dataUrl } });
beforeEach(() => {
  viewer = 'owner'; partner = 'partner'; connected = true; sync = 'live'; deletion = 'clear'; rebuildProfile();
  api.read.mockReset().mockResolvedValue(avatar('photo'));
  api.save.mockReset();
});
describe('profile avatar identity and lifecycle', () => {
  it('uses the exact partner and immediately hides their photo on disconnect', async () => {
    const view = renderHook(() => useProfileAvatar(partner));
    await waitFor(() => expect(view.result.current.dataUrl).toBe('photo'));
    expect(api.read.mock.calls[0][0]).toBe('partner');
    connected = false; rebuildProfile(); view.rerender();
    expect(view.result.current.dataUrl).toBeNull();
    expect(api.read).toHaveBeenCalledTimes(1);
  });
  it('discards a delayed response after changing accounts', async () => {
    const pending = deferred<ReturnType<typeof avatar>>();
    api.read.mockReturnValueOnce(pending.promise);
    const view = renderHook(() => useProfileAvatar('owner'));
    viewer = 'new-account'; partner = 'different'; rebuildProfile(); view.rerender();
    await act(async () => { pending.resolve(avatar('old-face')); });
    expect(view.result.current.dataUrl).toBeNull();
  });
  it.each(['sync', 'deletion'])('hides a previously loaded partner photo when %s becomes unverified', async (kind) => {
    const view = renderHook(() => useProfileAvatar(partner));
    await waitFor(() => expect(view.result.current.dataUrl).toBe('photo'));
    if (kind === 'sync') sync = 'unavailable'; else deletion = 'pending';
    view.rerender();
    expect(view.result.current.dataUrl).toBeNull();
  });
  it('refreshes on the existing profile invalidation and online recovery', async () => {
    const view = renderHook(() => useProfileAvatar(partner));
    await waitFor(() => expect(view.result.current.dataUrl).toBe('photo'));
    api.read.mockResolvedValue(avatar('new-face')); rebuildProfile(); view.rerender();
    await waitFor(() => expect(view.result.current.dataUrl).toBe('new-face'));
    api.read.mockResolvedValue(avatar(null));
    act(() => { window.dispatchEvent(new Event('online')); });
    await waitFor(() => expect(view.result.current.dataUrl).toBeNull());
  });
  it('does not clear the last confirmed photo when a replacement fails', async () => {
    const view = renderHook(() => useProfileAvatar(viewer));
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    api.save.mockResolvedValue({ ok: false, reason: 'unavailable' });
    await act(async () => { expect((await view.result.current.save('replacement')).ok).toBe(false); });
    expect(view.result.current.dataUrl).toBe('photo');
  });
  it('never allows the partner photo to be changed through the hook', async () => {
    const view = renderHook(() => useProfileAvatar(partner));
    await waitFor(() => expect(view.result.current.ready).toBe(true));
    await act(async () => { expect((await view.result.current.save(null)).ok).toBe(false); });
    expect(api.save).not.toHaveBeenCalled();
  });
});
