import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import React from 'react';
import type { DailyRecord } from '@/types';

/**
 * Media replacement on an EXISTING record.
 *
 * Ordering is not a style choice. Storage RLS requires the `daily_records` row to
 * exist before any object may be written under `{coupleId}/{recordId}/`, and the
 * no-orphans rule requires the removed objects to be deleted only AFTER the row
 * has stopped referencing them:
 *
 *     upload -> patch row -> remove old objects
 *
 * If the patch fails, the newly uploaded objects must be deleted again and the row
 * left untouched: no orphaned bytes, and no phantom success.
 */

const {
  mockSupabase,
  saveRecordToDB,
  uploadRecordMedia,
  removeRecordMedia,
  fetchMyCoupleState,
  fetchFullStateFromDB,
  callOrder,
} = vi.hoisted(() => {
  const callOrder: string[] = [];
  const channel = {
    on: vi.fn(function on() { return channel; }),
    subscribe: vi.fn(function subscribe() { return channel; }),
  };
  return {
    callOrder,
    saveRecordToDB: vi.fn(),
    uploadRecordMedia: vi.fn(),
    removeRecordMedia: vi.fn(),
    fetchMyCoupleState: vi.fn(),
    fetchFullStateFromDB: vi.fn(),
    mockSupabase: {
      auth: {
        onAuthStateChange: vi.fn(),
        getUser: vi.fn(),
        refreshSession: vi.fn(),
        signOut: vi.fn().mockResolvedValue({ error: null }),
      },
      from: vi.fn(),
      rpc: vi.fn(),
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(),
    },
  };
});

const authCallbacks: ((event: string, session: unknown) => void)[] = [];
mockSupabase.auth.onAuthStateChange.mockImplementation(
  (cb: (event: string, session: unknown) => void) => {
    authCallbacks.push(cb);
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  },
);

vi.mock('@/lib/supabase', () => ({
  supabase: mockSupabase,
  isSupabaseConfigured: true,
  authRepository: { signOut: vi.fn().mockResolvedValue(undefined) },
  disconnectCoupleFromDB: vi.fn().mockResolvedValue(true),
  deleteAccountFromDB: vi.fn().mockResolvedValue(true),
  saveCoupleAnniversary: vi.fn().mockResolvedValue(true),
  fetchMyCoupleState: (...args: unknown[]) => fetchMyCoupleState(...(args as [])),
}));

const FULL_STATE_UNAVAILABLE = Symbol('full-state-unavailable');
vi.mock('@/lib/sync', () => ({
  fetchFullStateFromDB: (userId: string) => fetchFullStateFromDB(userId),
  fetchFullStateResultFromDB: async (userId: string) => {
    const result = await fetchFullStateFromDB(userId);
    return result === FULL_STATE_UNAVAILABLE
      ? { ok: false, reason: 'unknown' }
      : { ok: true, state: result };
  },
  FULL_STATE_UNAVAILABLE,
}));

vi.mock('@/lib/records', () => ({
  saveRecordToDB: (...args: unknown[]) => {
    callOrder.push('patchRow');
    return saveRecordToDB(...(args as []));
  },
  deleteRecordFromDB: vi.fn().mockResolvedValue({ ok: true }),
  fetchRecordsFromDB: vi.fn().mockResolvedValue([]),
  fetchRecordsResultFromDB: vi.fn().mockResolvedValue({ ok: true, records: [] }),
  uploadRecordMedia: (...args: unknown[]) => {
    callOrder.push(`upload:${(args[0] as File).name}`);
    return uploadRecordMedia(...(args as []));
  },
  removeRecordMedia: (...args: unknown[]) => {
    callOrder.push(`remove:${(args[0] as string[]).join('|')}`);
    return removeRecordMedia(...(args as []));
  },
  resolveAttachmentUrls: async (attachments: unknown[]) => attachments,
  classifyMediaFile: (file: { type: string }) =>
    file.type.startsWith('image/')
      ? { ext: 'png', type: 'photo' }
      : { error: '지원하지 않는 파일 형식이에요.' },
  isCanonicalRecordMediaPath: (path: unknown, coupleId: string, recordId: string) =>
    typeof path === 'string' && path.startsWith(`${coupleId}/${recordId}/`),
  MEDIA_ACCEPT: 'image/png',
}));

vi.mock('@/app/e2ee/runtimeSession', () => ({
  installE2eeRuntimeForAuthenticatedSession: vi.fn().mockResolvedValue({ status: 'guarded' }),
}));

vi.mock('@/lib/events', () => ({
  fetchEventsFromDB: vi.fn().mockResolvedValue([]),
  fetchEventsResultFromDB: vi.fn().mockResolvedValue({ ok: true, events: [] }),
  saveEventToDB: vi.fn().mockResolvedValue(null),
  updateEventInDB: vi.fn().mockResolvedValue(null),
  deleteEventFromDB: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/trips', () => ({
  fetchTripsFromDB: vi.fn().mockResolvedValue([]),
  fetchTripsResultFromDB: vi.fn().mockResolvedValue({ ok: true, trips: [] }),
  reconcileParentTrips: (trips: unknown[]) => trips,
}));

const { StoreProvider } = await import('@/lib/store');
const { useStore } = await import('@/lib/useStore');

let lastResult: { ok: boolean; failedFiles: string[]; error?: string } | null = null;

const EXISTING_PATH = 'couple-1/rec-1/existing.png';

function Probe({
  addFiles = [] as File[],
  removePaths = [] as string[],
  recordId = 'rec-1',
}: { addFiles?: File[]; removePaths?: string[]; recordId?: string }) {
  const { state, isReady, updateRecordMedia } = useStore();
  const record = state.records.find((r) => r.id === 'rec-1');
  return (
    <div>
      <span data-testid="ready">{isReady ? 'ready' : 'loading'}</span>
      <span data-testid="attachments">
        {(record?.attachments || []).map((a) => a.path ?? a.name).join(',')}
      </span>
      <button
        onClick={() => {
          void updateRecordMedia(recordId, { addFiles, removePaths }).then((result) => {
            lastResult = result;
          });
        }}
      >
        edit-media
      </button>
    </div>
  );
}

function emitAuth(event: string, userId: string | null) {
  const session = userId
    ? { user: { id: userId, email: `${userId}@example.com`, app_metadata: { provider: 'google' } } }
    : null;
  authCallbacks.forEach((cb) => cb(event, session));
}

const baseRecord: DailyRecord = {
  id: 'rec-1',
  userId: 'user-1',
  date: '2026-01-01',
  time: '10:00',
  authorRole: 'gomsin',
  log: 'hello',
  isPrivate: false,
  createdAt: '2026-01-01T10:00:00.000Z',
  attachments: [{ type: 'photo', name: 'existing.png', path: EXISTING_PATH }],
};

async function setup(props: React.ComponentProps<typeof Probe> = {}) {
  fetchFullStateFromDB.mockResolvedValue({
    setupComplete: true,
    records: [baseRecord],
    events: [],
    trips: [],
    profile: {
      id: 'user-1',
      myName: '춘향',
      role: 'gomsin',
      couple: {
        coupleId: 'couple-1',
        partnerName: '몽룡',
        coupleCode: '',
        connected: true,
        status: 'active',
      },
      military: {} as never,
      contact: {} as never,
    } as never,
  });

  render(
    <StoreProvider>
      <Probe {...props} />
    </StoreProvider>,
  );
  await waitFor(() => expect(authCallbacks.length).toBeGreaterThan(0));
  await act(async () => {
    emitAuth('SIGNED_IN', 'user-1');
  });
  await waitFor(() => expect(screen.getByTestId('ready')).toHaveTextContent('ready'));
  callOrder.length = 0;
}

function pngFile(name: string): File {
  return new File(['x'], name, { type: 'image/png' });
}

describe('updateRecordMedia', () => {
  beforeEach(() => {
    authCallbacks.length = 0;
    localStorage.clear();
    callOrder.length = 0;
    lastResult = null;
    // The shared setup's `vi.restoreAllMocks()` strips implementations, including
    // the auth-listener registration, so it is re-armed here.
    mockSupabase.auth.onAuthStateChange.mockReset().mockImplementation(
      (cb: (event: string, session: unknown) => void) => {
        authCallbacks.push(cb);
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    );
    saveRecordToDB.mockReset().mockResolvedValue({ ok: true });
    uploadRecordMedia.mockReset().mockImplementation(async (file: File) => ({
      attachment: { type: 'photo', name: file.name, path: `couple-1/rec-1/${file.name}` },
    }));
    removeRecordMedia.mockReset().mockResolvedValue(undefined);
    fetchMyCoupleState.mockReset().mockResolvedValue({ ok: false, reason: 'server' });
    fetchFullStateFromDB.mockReset();
    mockSupabase.auth.getUser.mockReset().mockResolvedValue({
      data: { user: { id: 'user-1', app_metadata: { provider: 'google' } } },
      error: null,
    });
    mockSupabase.rpc.mockReset().mockResolvedValue({ data: 'couple-1', error: null });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('uploads, then patches the row, then removes the replaced objects', async () => {
    await setup({ addFiles: [pngFile('new.png')], removePaths: [EXISTING_PATH] });

    await act(async () => {
      screen.getByText('edit-media').click();
    });
    await waitFor(() => expect(lastResult).not.toBeNull());

    expect(lastResult?.ok).toBe(true);
    // The exact ordering storage RLS and the no-orphans rule require.
    expect(callOrder).toEqual([
      'upload:new.png',
      'patchRow',
      `remove:${EXISTING_PATH}`,
    ]);
    await waitFor(() =>
      expect(screen.getByTestId('attachments')).toHaveTextContent('couple-1/rec-1/new.png'),
    );
    expect(screen.getByTestId('attachments')).not.toHaveTextContent('existing.png');
  });

  it('rolls back uploaded objects and leaves the row untouched when the patch fails', async () => {
    saveRecordToDB.mockResolvedValue({ ok: false, reason: 'forbidden' });
    await setup({ addFiles: [pngFile('new.png')], removePaths: [EXISTING_PATH] });

    await act(async () => {
      screen.getByText('edit-media').click();
    });
    await waitFor(() => expect(lastResult).not.toBeNull());

    expect(lastResult?.ok).toBe(false);
    // The newly uploaded object is deleted again...
    expect(callOrder).toEqual([
      'upload:new.png',
      'patchRow',
      'remove:couple-1/rec-1/new.png',
    ]);
    // ...and the object the user asked to remove is NOT deleted, because the row
    // still references it.
    expect(removeRecordMedia).not.toHaveBeenCalledWith([EXISTING_PATH]);
    // Local state is unchanged: no phantom success.
    expect(screen.getByTestId('attachments')).toHaveTextContent(EXISTING_PATH);
  });

  it('reports the classified cause, never a connection message, for a forbidden patch', async () => {
    saveRecordToDB.mockResolvedValue({ ok: false, reason: 'forbidden' });
    await setup({ addFiles: [pngFile('new.png')] });

    await act(async () => {
      screen.getByText('edit-media').click();
    });
    await waitFor(() => expect(lastResult).not.toBeNull());

    expect(lastResult?.error).toBe('권한이 없어요. 커플 공간 연결 상태를 확인해 주세요.');
    expect(lastResult?.error).not.toContain('인터넷');
  });

  it('refuses a path outside the record\'s own namespace and issues no request', async () => {
    await setup({ removePaths: ['couple-1/rec-OTHER/secret.png'] });

    await act(async () => {
      screen.getByText('edit-media').click();
    });
    await waitFor(() => expect(lastResult).not.toBeNull());

    expect(lastResult?.ok).toBe(false);
    expect(lastResult?.error).toContain('첨부 파일 경로가 올바르지 않아');
    expect(callOrder).toEqual([]);
    expect(removeRecordMedia).not.toHaveBeenCalled();
    expect(saveRecordToDB).not.toHaveBeenCalled();
  });

  it('refuses a path belonging to another couple', async () => {
    await setup({ removePaths: ['couple-OTHER/rec-1/secret.png'] });

    await act(async () => {
      screen.getByText('edit-media').click();
    });
    await waitFor(() => expect(lastResult).not.toBeNull());

    expect(lastResult?.ok).toBe(false);
    expect(callOrder).toEqual([]);
  });

  it('removes an attachment with no upload at all', async () => {
    await setup({ removePaths: [EXISTING_PATH] });

    await act(async () => {
      screen.getByText('edit-media').click();
    });
    await waitFor(() => expect(lastResult).not.toBeNull());

    expect(lastResult?.ok).toBe(true);
    expect(callOrder).toEqual(['patchRow', `remove:${EXISTING_PATH}`]);
    await waitFor(() => expect(screen.getByTestId('attachments')).toHaveTextContent(''));
  });

  it('succeeds even if cleanup of the removed object fails, and says nothing false', async () => {
    removeRecordMedia.mockRejectedValue(new Error('storage unavailable'));
    await setup({ removePaths: [EXISTING_PATH] });

    await act(async () => {
      screen.getByText('edit-media').click();
    });
    await waitFor(() => expect(lastResult).not.toBeNull());

    // The row no longer references the object, so the user's intent WAS carried
    // out. Unreferenced bytes are logged, not surfaced as a failure.
    expect(lastResult?.ok).toBe(true);
    expect(screen.getByTestId('attachments')).toHaveTextContent('');
  });

  it('reports a partial upload failure without losing the successful ones', async () => {
    uploadRecordMedia.mockImplementation(async (file: File) =>
      file.name === 'bad.png'
        ? { error: '파일을 올리지 못했어요.' }
        : { attachment: { type: 'photo', name: file.name, path: `couple-1/rec-1/${file.name}` } },
    );
    await setup({ addFiles: [pngFile('good.png'), pngFile('bad.png')] });

    await act(async () => {
      screen.getByText('edit-media').click();
    });
    await waitFor(() => expect(lastResult).not.toBeNull());

    expect(lastResult?.ok).toBe(true);
    expect(lastResult?.failedFiles).toEqual(['bad.png']);
    await waitFor(() =>
      expect(screen.getByTestId('attachments')).toHaveTextContent('couple-1/rec-1/good.png'),
    );
  });

  it('refuses to touch a record that is not in local state', async () => {
    await setup({ recordId: 'rec-missing', addFiles: [pngFile('new.png')] });

    await act(async () => {
      screen.getByText('edit-media').click();
    });
    await waitFor(() => expect(lastResult).not.toBeNull());

    expect(lastResult?.ok).toBe(false);
    expect(callOrder).toEqual([]);
  });

  it('is a no-op when neither files nor paths are supplied', async () => {
    await setup({});

    await act(async () => {
      screen.getByText('edit-media').click();
    });
    await waitFor(() => expect(lastResult).not.toBeNull());

    expect(lastResult?.ok).toBe(true);
    expect(callOrder).toEqual([]);
  });
});
