import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '@/lib/useStore';
import { readProfileAvatar, saveProfileAvatar, type ProfileAvatar, type AvatarSaveResult } from './profileAvatars';

const CHANGED = 'gomsinlog:profile-avatar-changed';

/** Small, memory-only projection. Uses the existing profile invalidation channel;
 * image bytes never enter AppState, localStorage, URLs, or Realtime messages. */
export function useProfileAvatar(ownerId: string | undefined) {
  const { state, coupleLifecycle, sharedSyncStatus, deletionStatus } = useStore();
  const viewerId = state.authenticatedUser?.id;
  const couple = state.profile.couple;
  const own = !!viewerId && ownerId === viewerId;
  const allowed = !!ownerId && !!viewerId && state.profile.id === viewerId
    && deletionStatus?.kind === 'clear'
    && (own || (coupleLifecycle === 'connected' && couple.connected && couple.status === 'active'
      && !!couple.coupleId && couple.partnerUserId === ownerId && sharedSyncStatus !== 'unavailable'));
  const key = allowed ? `${viewerId}:${ownerId}:${own ? 'self' : couple.coupleId}` : null;
  const currentKey = useRef(key);
  const identityGeneration = useRef(0);
  const loadSequence = useRef(0);
  const writing = useRef(false);
  const [snapshot, setSnapshot] = useState<{ key: string; avatar: ProfileAvatar } | null>(null);
  const [readStatus, setReadStatus] = useState<{ key: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useLayoutEffect(() => {
    ++identityGeneration.current;
    ++loadSequence.current;
    // A temporarily forbidden identity must earn a fresh read even if it later
    // returns to the same key. Never revive its old authorized snapshot.
    setSnapshot(null);
    setReadStatus(null);
    currentKey.current = key;
    return () => { currentKey.current = null; };
  }, [key]);

  const reload = useCallback(async (signal?: AbortSignal) => {
    if (!key || !ownerId) return;
    const sequence = ++loadSequence.current;
    const result = await readProfileAvatar(ownerId, signal);
    if (signal?.aborted || currentKey.current !== key || sequence !== loadSequence.current) return;
    setReadStatus({ key, ok: result.ok });
    // On a failed reauthorization, remove the image rather than retain a stale
    // partner photo. A failed save itself leaves the last confirmed image intact.
    setSnapshot(result.ok ? { key, avatar: result.avatar } : null);
  }, [key, ownerId]);

  useEffect(() => {
    const controller = new AbortController();
    void reload(controller.signal);
    const refresh = () => { if (document.visibilityState !== 'hidden') void reload(controller.signal); };
    const changed = (event: Event) => {
      if ((event as CustomEvent<{ ownerId?: string }>).detail?.ownerId === ownerId) refresh();
    };
    window.addEventListener(CHANGED, changed);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      controller.abort();
      window.removeEventListener(CHANGED, changed);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [reload, ownerId, state.profile]);

  const save = useCallback(async (dataUrl: string | null): Promise<AvatarSaveResult> => {
    if (!own || !key || !ownerId || currentKey.current !== key || writing.current
      || snapshot?.key !== key || readStatus?.key !== key || !readStatus.ok) {
      return { ok: false, reason: 'unavailable' };
    }
    writing.current = true;
    const generation = identityGeneration.current;
    setBusy(true);
    // An older pending fetch must not overwrite this mutation's response.
    ++loadSequence.current;
    try {
      const result = await saveProfileAvatar({
        ownerId, expectedVersion: snapshot.avatar.version, operationId: crypto.randomUUID(), dataUrl,
      });
      if (currentKey.current !== key || identityGeneration.current !== generation) return { ok: false, reason: 'unavailable' };
      if (result.ok) {
        ++loadSequence.current;
        setSnapshot({ key, avatar: result.avatar });
        window.dispatchEvent(new CustomEvent(CHANGED, { detail: { ownerId } }));
      } else if (result.reason === 'conflict') {
        void reload();
      }
      return result;
    } catch { return { ok: false, reason: 'unavailable' }; }
    finally { writing.current = false; setBusy(false); }
  }, [key, own, ownerId, snapshot, readStatus, reload]);

  return {
    dataUrl: key && snapshot?.key === key ? snapshot.avatar.dataUrl : null,
    version: key && snapshot?.key === key ? snapshot.avatar.version : null,
    ready: !!key && readStatus?.key === key && readStatus.ok,
    allowed,
    busy,
    save,
    reload,
  };
}
