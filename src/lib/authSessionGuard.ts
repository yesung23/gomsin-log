type SessionIdentity = { access_token?: unknown; user?: { id?: unknown } };
type SynchronousStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storedSession(value: string | null): SessionIdentity | null {
  try {
    const session = JSON.parse(value ?? 'null') as SessionIdentity | null;
    return typeof session?.access_token === 'string' && typeof session.user?.id === 'string'
      ? session : null;
  } catch { return null; }
}

export class AppleAttemptInvalidatedError extends Error {
  constructor() {
    super('Apple sign-in no longer owns this session.');
    this.name = 'AppleAttemptInvalidatedError';
  }
}

export type AppleSessionAttempt = {
  signal: AbortSignal;
  assertCurrent: () => void;
  bindSessionResponse: (value: unknown) => void;
  finish: () => void;
};

/** One memory-only lease, retained until the native/SDK operation settles.
 * Invalidation never signs out, deletes, or restores a different session. */
export function createAuthSessionGuard() {
  let currentUserId: string | null = null;
  let signingOut = 0;
  // Keep one rejected response in memory after the attempt settles: the SDK may
  // still expose it through INITIAL_SESSION while logout awaits push cleanup.
  let rejectedSession: { token: string; userId: string } | null = null;
  let active: {
    controller: AbortController;
    token?: string;
    userId?: string;
    attempt: AppleSessionAttempt;
  } | null = null;

  const invalidate = () => {
    if (active?.token !== undefined && active.userId !== undefined) {
      rejectedSession = { token: active.token, userId: active.userId };
    }
    active?.controller.abort();
  };

  const canConsumeSession = (session: SessionIdentity | null): boolean => !(
    rejectedSession && session?.user?.id === rejectedSession.userId
    // During explicit logout, a refresh of this rejected Apple session must not
    // regain hydration authority either. Other accounts/normal refresh pass.
    && (signingOut > 0 || session.access_token === rejectedSession.token)
  );

  const ownsSession = (session: SessionIdentity | null): boolean => !!(
    active && !active.controller.signal.aborted && active.token !== undefined
    && active.token === session?.access_token && active.userId === session?.user?.id
  );

  const observeSession = (event: string, session: SessionIdentity | null) => {
    if (!canConsumeSession(session)) return;
    const userId = typeof session?.user?.id === 'string' ? session.user.id : null;
    if (event === 'SIGNED_OUT' || (userId !== currentUserId && !ownsSession(session))) invalidate();
    currentUserId = userId;
  };

  const beginAppleAttempt = (): AppleSessionAttempt => {
    if (active || signingOut > 0) throw new AppleAttemptInvalidatedError();
    const controller = new AbortController();
    const attempt: AppleSessionAttempt = {
      signal: controller.signal,
      assertCurrent: () => {
        if (active?.attempt !== attempt || controller.signal.aborted) {
          throw new AppleAttemptInvalidatedError();
        }
      },
      bindSessionResponse: (value) => {
        attempt.assertCurrent();
        const session = value as SessionIdentity | null;
        if (typeof session?.access_token === 'string' && typeof session.user?.id === 'string') {
          active!.token = session.access_token;
          active!.userId = session.user.id;
        }
      },
      finish: () => {
        if (active?.attempt === attempt) active = null;
      },
    };
    active = { controller, attempt };
    return attempt;
  };

  return {
    beginAppleAttempt,
    currentAttempt: () => active?.attempt,
    canConsumeSession,
    observeSession,
    beginSignOut: () => {
      signingOut += 1;
      invalidate();
      let finished = false;
      return () => {
        if (!finished) signingOut -= 1;
        finished = true;
      };
    },
    /** Supabase awaits JSON parsing before _saveSession. Recheck at the actual
     * synchronous write too: an account change in that gap must not save A.
     * PKCE verifier and other non-session values pass through byte-for-byte. */
    wrapStorage: (storage: SynchronousStorage): SynchronousStorage => ({
      getItem: (key) => storage.getItem(key),
      removeItem: (key) => {
        // SDK automatic removal awaits storage before emitting SIGNED_OUT.
        // Invalidate synchronously, without treating PKCE cleanup as logout.
        if (storedSession(storage.getItem(key))) invalidate();
        storage.removeItem(key);
      },
      setItem: (key, value) => {
        const session = storedSession(value);
        if (session && active && active.token === session.access_token) active.attempt.assertCurrent();
        // No await between the ownership check and the underlying commit.
        storage.setItem(key, value);
        // A fresh, still-owned Apple commit can legitimately reauthenticate the
        // same account. Do not mistake its own SIGNED_IN for the rejected one.
        if (ownsSession(session)) rejectedSession = null;
        if (session) observeSession('SESSION_WRITE', session);
      },
    }),
  };
}

export const appleSessionGuard = createAuthSessionGuard();

/** Match the SDK's browser-localStorage / memory fallback without changing its
 * storage keys, JSON representation, verifier handling, or persistence policy. */
export function authSessionStorage(): SynchronousStorage {
  try {
    if (typeof window !== 'undefined' && globalThis.localStorage) {
      const probe = `gomsinlog-auth-storage-probe-${Math.random()}`;
      globalThis.localStorage.setItem(probe, probe);
      globalThis.localStorage.removeItem(probe);
      return globalThis.localStorage;
    }
  } catch { /* The SDK also falls back to memory when localStorage is unavailable. */ }
  const memory = new Map<string, string>();
  return {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => { memory.set(key, value); },
    removeItem: (key) => { memory.delete(key); },
  };
}
