import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { toAuthUser } from '@/types';

type SessionUser = Parameters<typeof toAuthUser>[0];
const auth = vi.hoisted(() => ({
  callback: null as null | ((event: string, session: { user: SessionUser } | null) => void),
  user: null as SessionUser | null,
}));
const hydrate = vi.hoisted(() => vi.fn(async () => ({
  ok: true, state: { setupComplete: false, records: [] },
})));

vi.mock('@/lib/supabase', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/supabase')>(),
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      onAuthStateChange: (callback: typeof auth.callback) => {
        auth.callback = callback;
        return { data: { subscription: { unsubscribe() { auth.callback = null; } } } };
      },
      getUser: async () => ({ data: { user: auth.user }, error: null }),
    },
    rpc: async () => ({ data: false, error: null }),
  },
  fetchMyCoupleState: async () => ({ ok: false, reason: 'server' }),
}));
vi.mock('@/lib/sync', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/sync')>(),
  fetchFullStateResultFromDB: hydrate,
}));
vi.mock('@/lib/outboxStorage', () => ({
  createIndexedDbOutbox: () => ({
    all: async () => [], add: async () => {}, put: async () => {}, putMany: async () => {},
    remove: async () => {}, removeMany: async () => {},
  }),
}));
vi.mock('@/app/e2ee/runtimeLifecycle', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/app/e2ee/runtimeLifecycle')>(),
  installE2eeRuntimeForAuthenticatedSession: async () => {},
}));

import { StoreProvider } from '@/lib/store';
import { useStore } from '@/lib/useStore';

function AuthProbe() {
  const { state, isReady } = useStore();
  return <output data-testid="auth">{isReady ? JSON.stringify(state.authenticatedUser) : 'loading'}</output>;
}

beforeEach(() => {
  auth.callback = null;
  auth.user = null;
  hydrate.mockClear();
});

describe('live store auth-event provider mapping', () => {
  it('retains the loaded Apple identities and refreshes them without rehydrating account data', async () => {
    render(<StoreProvider><AuthProbe /></StoreProvider>);
    await waitFor(() => expect(auth.callback).not.toBeNull());
    auth.user = {
      id: 'apple-account', email: 'relay@example.com', app_metadata: { provider: 'apple' },
      identities: [{ provider: 'apple' }],
    };
    act(() => auth.callback!('INITIAL_SESSION', { user: auth.user! }));
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('"provider":"apple"'));
    expect(JSON.parse(screen.getByTestId('auth').textContent!)).toEqual({
      id: 'apple-account', email: 'relay@example.com', provider: 'apple', identityProviders: ['apple'],
    });
    expect(hydrate).toHaveBeenCalledOnce();

    auth.user = { id: 'apple-account', email: 'relay@example.com', app_metadata: {} };
    act(() => auth.callback!('USER_UPDATED', { user: auth.user! }));
    await waitFor(() => expect(screen.getByTestId('auth')).toHaveTextContent('"provider":"unknown"'));
    expect(JSON.parse(screen.getByTestId('auth').textContent!)).toEqual({
      id: 'apple-account', email: 'relay@example.com', provider: 'unknown',
    });
    expect(hydrate).toHaveBeenCalledOnce();
  });
});
