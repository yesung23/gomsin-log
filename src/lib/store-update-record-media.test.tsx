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
 * Once the patch request is issued, a failed response is ambiguous: deleting the
 * new object can break a row whose response was merely lost. Read back before
 * claiming success, and prefer a possible orphan over user-visible data loss.
 */

const {
  mockSupabase,
  saveRecordToDB,
  uploadRecordMedia,
  removeRecordMedia,
  fetchRecordsResultFromDB,
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
    fetchRecordsResultFromDB: vi.fn(),
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
  fetchRecordsResultFromDB: (...args: unknown[]) => fetchRecordsResultFromDB(...(args as [])),
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
  activateCoupleProtectionForAuthenticatedSession: vi.fn().mockResolvedValue('not_paired'),
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
  allOrNothing = false,
}: { addFiles?: File[]; removePaths?: string[]; recordId?: string; allOrNothing?: boolean }) {
  const { state, isReady, updateRecord, updateRecordMedia } = useStore();
  const record = state.records.find((r) => r.id === 'rec-1');
  return (
    <div>
      <span data-testid="ready">{isReady ? 'ready' : 'loading'}</span>
      <span data-testid="attachments">
        {(record?.attachments || []).map((a) => a.path ?? a.name).join(',')}
      </span>
      <span data-testid="update-result" />
      <span data-testid="record-state">
        {record ? JSON.stringify({
          isPrivate: record.isPrivate,
          isProfilePost: record.isProfilePost,
          talkAbout: record.talkAbout,
          contentRevision: record.contentRevision,
          log: record.log,
        }) : ''}
      </span>
      <button
        onClick={() => {
          void updateRecord('rec-1', { isPrivate: false, isProfilePost: true }).then((result) => {
            screen.getByTestId('update-result').textContent = result.ok ? 'ok' : result.reason;
          });
        }}
      >
        publish
      </button>
      <button
        onClick={() => {
          void updateRecord('rec-1', {
            isPrivate: false,
            isProfilePost: true,
            talkAbout: true,
            log: 'newer local state',
          });
        }}
      >
        publish-newer
      </button>
      <button
        onClick={() => {
          void updateRecordMedia(recordId, { addFiles, removePaths, allOrNothing }).then((result) => {
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
    fetchRecordsResultFromDB.mockReset().mockResolvedValue({ ok: true, records: [] });
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

  it('rolls back uploads after an authoritative forbidden patch failure', async () => {
    saveRecordToDB.mockResolvedValue({ ok: false, reason: 'forbidden' });
    await setup({ addFiles: [pngFile('new.png')], removePaths: [EXISTING_PATH] });

    await act(async () => {
      screen.getByText('edit-media').click();
    });
    await waitFor(() => expect(lastResult).not.toBeNull());

    expect(lastResult?.ok).toBe(false);
    expect(callOrder).toEqual([
      'upload:new.png',
      'patchRow',
      'remove:couple-1/rec-1/new.png',
    ]);
    expect(removeRecordMedia).toHaveBeenCalledWith(['couple-1/rec-1/new.png']);
    // The object the user asked to remove is also retained because the row may
    // still reference it.
    expect(removeRecordMedia).not.toHaveBeenCalledWith([EXISTING_PATH]);
    // Local state is unchanged: no phantom success.
    expect(screen.getByTestId('attachments')).toHaveTextContent(EXISTING_PATH);
  });

  it('accepts a committed media patch when only its response was lost', async () => {
    saveRecordToDB.mockResolvedValue({ ok: false, reason: 'offline' });
    fetchRecordsResultFromDB.mockResolvedValue({
      ok: true,
      records: [{
        ...baseRecord,
        contentRevision: 2,
        attachments: [{
          type: 'photo',
          name: 'new.png',
          path: 'couple-1/rec-1/new.png',
        }],
      }],
    });
    await setup({ addFiles: [pngFile('new.png')], removePaths: [EXISTING_PATH] });

    await act(async () => { screen.getByText('edit-media').click(); });
    await waitFor(() => expect(lastResult).not.toBeNull());

    expect(lastResult?.ok).toBe(true);
    expect(removeRecordMedia).not.toHaveBeenCalledWith(['couple-1/rec-1/new.png']);
    expect(removeRecordMedia).toHaveBeenCalledWith([EXISTING_PATH]);
    await waitFor(() =>
      expect(screen.getByTestId('attachments')).toHaveTextContent('couple-1/rec-1/new.png'),
    );
  });

  it('accepts a committed publication update when only its response was lost and adopts the newer revision', async () => {
    saveRecordToDB.mockResolvedValue({ ok: false, reason: 'offline' });
    fetchRecordsResultFromDB.mockResolvedValue({
      ok: true,
      records: [{
        ...baseRecord,
        isPrivate: false,
        isProfilePost: true,
        contentRevision: 7,
      }],
    });
    await setup();

    await act(async () => { screen.getByText('publish').click(); });
    await waitFor(() => expect(screen.getByTestId('update-result')).toHaveTextContent('ok'));
    expect(fetchRecordsResultFromDB).toHaveBeenCalledWith('couple-1');
    expect(screen.getByTestId('record-state')).toHaveTextContent('"isProfilePost":true');
    expect(screen.getByTestId('record-state')).toHaveTextContent('"contentRevision":7');
  });

  it('does not let a delayed normal success overwrite a newer local revision', async () => {
    let resolveFirstSave!: (result: { ok: true; contentRevision: number }) => void;
    const firstSave = new Promise<{ ok: true; contentRevision: number }>((resolve) => {
      resolveFirstSave = resolve;
    });
    saveRecordToDB
      .mockImplementationOnce(() => firstSave)
      .mockResolvedValueOnce({ ok: true, contentRevision: 8 });
    await setup();

    await act(async () => { screen.getByText('publish').click(); });
    await waitFor(() => expect(saveRecordToDB).toHaveBeenCalledTimes(1));

    await act(async () => { screen.getByText('publish-newer').click(); });
    await waitFor(() => {
      expect(screen.getByTestId('record-state')).toHaveTextContent('"contentRevision":8');
      expect(screen.getByTestId('record-state')).toHaveTextContent('"talkAbout":true');
      expect(screen.getByTestId('record-state')).toHaveTextContent('"log":"newer local state"');
    });

    await act(async () => {
      resolveFirstSave({ ok: true, contentRevision: 7 });
    });

    await waitFor(() => {
      expect(screen.getByTestId('record-state')).toHaveTextContent('"contentRevision":8');
      expect(screen.getByTestId('record-state')).toHaveTextContent('"talkAbout":true');
      expect(screen.getByTestId('record-state')).toHaveTextContent('"log":"newer local state"');
      expect(screen.getByTestId('attachments')).toHaveTextContent(EXISTING_PATH);
    });
  });

  it('does not let a delayed media success overwrite a newer local revision', async () => {
    let resolveMediaSave!: (result: { ok: true; contentRevision: number }) => void;
    const mediaSave = new Promise<{ ok: true; contentRevision: number }>((resolve) => {
      resolveMediaSave = resolve;
    });
    saveRecordToDB
      .mockImplementationOnce(() => mediaSave)
      .mockResolvedValueOnce({ ok: true, contentRevision: 8 });
    await setup({ addFiles: [pngFile('new.png')], removePaths: [EXISTING_PATH] });

    await act(async () => { screen.getByText('edit-media').click(); });
    await waitFor(() => expect(saveRecordToDB).toHaveBeenCalledTimes(1));

    await act(async () => { screen.getByText('publish-newer').click(); });
    await waitFor(() => {
      expect(screen.getByTestId('record-state')).toHaveTextContent('"contentRevision":8');
      expect(screen.getByTestId('record-state')).toHaveTextContent('"talkAbout":true');
      expect(screen.getByTestId('record-state')).toHaveTextContent('"log":"newer local state"');
    });

    await act(async () => {
      resolveMediaSave({ ok: true, contentRevision: 7 });
    });

    await waitFor(() => expect(lastResult?.ok).toBe(true));
    expect(screen.getByTestId('record-state')).toHaveTextContent('"contentRevision":8');
    expect(screen.getByTestId('record-state')).toHaveTextContent('"talkAbout":true');
    expect(screen.getByTestId('record-state')).toHaveTextContent('"log":"newer local state"');
    expect(screen.getByTestId('attachments')).toHaveTextContent(EXISTING_PATH);
    expect(screen.getByTestId('attachments')).not.toHaveTextContent('new.png');
    expect(removeRecordMedia).not.toHaveBeenCalledWith([EXISTING_PATH]);
  });

  it('does not let an older response-loss read-back overwrite a newer local revision', async () => {
    let resolveReadBack!: (result: { ok: true; records: DailyRecord[] }) => void;
    const readBack = new Promise<{ ok: true; records: DailyRecord[] }>((resolve) => {
      resolveReadBack = resolve;
    });
    saveRecordToDB
      .mockResolvedValueOnce({ ok: false, reason: 'offline' })
      .mockResolvedValueOnce({ ok: true, contentRevision: 8 });
    fetchRecordsResultFromDB.mockImplementationOnce(() => readBack);
    await setup();

    await act(async () => { screen.getByText('publish').click(); });
    await waitFor(() => expect(fetchRecordsResultFromDB).toHaveBeenCalledWith('couple-1'));

    await act(async () => { screen.getByText('publish-newer').click(); });
    await waitFor(() => {
      expect(screen.getByTestId('record-state')).toHaveTextContent('"contentRevision":8');
      expect(screen.getByTestId('record-state')).toHaveTextContent('"talkAbout":true');
    });

    await act(async () => {
      resolveReadBack({
        ok: true,
        records: [{
          ...baseRecord,
          isPrivate: false,
          isProfilePost: true,
          contentRevision: 7,
        }],
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('record-state')).toHaveTextContent('"contentRevision":8');
      expect(screen.getByTestId('record-state')).toHaveTextContent('"talkAbout":true');
      expect(screen.getByTestId('record-state')).toHaveTextContent('"log":"newer local state"');
    });
  });

  it('does not let an equal-revision delayed read-back overwrite a newer local snapshot', async () => {
    let resolveReadBack!: (result: { ok: true; records: DailyRecord[] }) => void;
    const readBack = new Promise<{ ok: true; records: DailyRecord[] }>((resolve) => {
      resolveReadBack = resolve;
    });
    saveRecordToDB
      .mockResolvedValueOnce({ ok: false, reason: 'offline' })
      .mockResolvedValueOnce({ ok: true, contentRevision: 7 });
    fetchRecordsResultFromDB.mockImplementationOnce(() => readBack);
    await setup();

    await act(async () => { screen.getByText('publish').click(); });
    await waitFor(() => expect(fetchRecordsResultFromDB).toHaveBeenCalledWith('couple-1'));

    await act(async () => { screen.getByText('publish-newer').click(); });
    await waitFor(() => {
      expect(screen.getByTestId('record-state')).toHaveTextContent('"contentRevision":7');
      expect(screen.getByTestId('record-state')).toHaveTextContent('"talkAbout":true');
      expect(screen.getByTestId('record-state')).toHaveTextContent('"log":"newer local state"');
    });

    await act(async () => {
      resolveReadBack({
        ok: true,
        records: [{
          ...baseRecord,
          isPrivate: false,
          isProfilePost: true,
          contentRevision: 7,
        }],
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId('record-state')).toHaveTextContent('"contentRevision":7');
      expect(screen.getByTestId('record-state')).toHaveTextContent('"talkAbout":true');
      expect(screen.getByTestId('record-state')).toHaveTextContent('"log":"newer local state"');
      expect(screen.getByTestId('attachments')).toHaveTextContent(EXISTING_PATH);
    });
  });

  it('refuses to reconcile a response-loss snapshot without an authoritative revision', async () => {
    saveRecordToDB.mockResolvedValue({ ok: false, reason: 'offline' });
    fetchRecordsResultFromDB.mockResolvedValue({
      ok: true,
      records: [{
        ...baseRecord,
        isPrivate: false,
        isProfilePost: true,
        contentRevision: undefined,
      }],
    });
    await setup();

    await act(async () => { screen.getByText('publish').click(); });
    await waitFor(() => expect(screen.getByTestId('update-result')).toHaveTextContent('offline'));
    expect(screen.getByTestId('record-state')).not.toHaveTextContent('"isProfilePost":true');
    expect(screen.getByTestId('attachments')).toHaveTextContent(EXISTING_PATH);
  });

  it('keeps authoritative newer attachments after response-loss reconciliation for the next CAS update', async () => {
    saveRecordToDB
      .mockResolvedValueOnce({ ok: false, reason: 'offline' })
      .mockResolvedValueOnce({ ok: true, contentRevision: 8 });
    fetchRecordsResultFromDB.mockResolvedValue({
      ok: true,
      records: [{
        ...baseRecord,
        isPrivate: false,
        isProfilePost: true,
        contentRevision: 7,
        attachments: [{
          type: 'photo',
          name: 'newer.png',
          path: 'couple-1/rec-1/newer.png',
        }],
      }],
    });
    await setup();

    await act(async () => { screen.getByText('publish').click(); });
    await waitFor(() => expect(screen.getByTestId('update-result')).toHaveTextContent('ok'));
    expect(screen.getByTestId('attachments')).toHaveTextContent('couple-1/rec-1/newer.png');
    expect(screen.getByTestId('attachments')).not.toHaveTextContent(EXISTING_PATH);

    await act(async () => { screen.getByText('publish').click(); });
    await waitFor(() => expect(saveRecordToDB).toHaveBeenCalledTimes(2));
    expect(saveRecordToDB.mock.calls[1]?.[3]).toEqual({ kind: 'update', expectedRevision: 7 });
  });

  it('keeps an ambiguous publication update failed when read-back is mismatched or unavailable', async () => {
    saveRecordToDB.mockResolvedValue({ ok: false, reason: 'offline' });
    fetchRecordsResultFromDB.mockResolvedValueOnce({
      ok: true,
      records: [{ ...baseRecord, isPrivate: true, contentRevision: 7 }],
    });
    await setup();

    await act(async () => { screen.getByText('publish').click(); });
    await waitFor(() => expect(screen.getByTestId('update-result')).toHaveTextContent('offline'));
    expect(screen.getByTestId('record-state')).not.toHaveTextContent('"isProfilePost":true');

    fetchRecordsResultFromDB.mockResolvedValueOnce({
      ok: false,
      records: [],
      error: new Error('read-back unavailable'),
    });
    await act(async () => { screen.getByText('publish').click(); });
    await waitFor(() => expect(screen.getByTestId('update-result')).toHaveTextContent('offline'));
  });

  it('keeps uncertain uploads when response loss cannot be reconciled', async () => {
    saveRecordToDB.mockResolvedValue({ ok: false, reason: 'unreachable' });
    fetchRecordsResultFromDB.mockResolvedValue({ ok: false, records: [], error: new Error('unreachable') });
    await setup({ addFiles: [pngFile('new.png')] });

    await act(async () => { screen.getByText('edit-media').click(); });
    await waitFor(() => expect(lastResult).not.toBeNull());

    expect(lastResult?.ok).toBe(false);
    expect(removeRecordMedia).not.toHaveBeenCalledWith(['couple-1/rec-1/new.png']);
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

  it('all-or-nothing mode rolls back every new upload and leaves the row untouched', async () => {
    uploadRecordMedia.mockImplementation(async (file: File) =>
      file.name === 'bad.png'
        ? { error: '파일을 올리지 못했어요.' }
        : { attachment: { type: 'photo', name: file.name, path: `couple-1/rec-1/${file.name}` } },
    );
    await setup({
      addFiles: [pngFile('good.png'), pngFile('bad.png')],
      allOrNothing: true,
    });

    await act(async () => {
      screen.getByText('edit-media').click();
    });
    await waitFor(() => expect(lastResult).not.toBeNull());

    expect(lastResult).toEqual({
      ok: true,
      failedFiles: ['good.png', 'bad.png'],
    });
    expect(callOrder).toEqual([
      'upload:good.png',
      'upload:bad.png',
      'remove:couple-1/rec-1/good.png',
    ]);
    expect(saveRecordToDB).not.toHaveBeenCalled();
    expect(screen.getByTestId('attachments')).toHaveTextContent(EXISTING_PATH);
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
