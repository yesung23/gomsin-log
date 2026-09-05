import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import React from 'react';
import type { DailyRecord } from '@/types';
import {
  getOrCreateRecordMediaMutationOwnerToken,
  listRecordMediaMutationJournalEntries,
  writeRecordMediaMutationJournalEntry,
} from '@/lib/recordMediaMutationJournal';

/**
 * Media replacement on an EXISTING record.
 *
 * Ordering is not a style choice. Storage RLS requires the `daily_records` row to
 * exist before any object may be written under `{coupleId}/{recordId}/`, and the
 * lifecycle contract requires every upload to be reserved before Storage and
 * every logical removal to retire its object in the same row transaction:
 *
 *     begin -> upload -> patch row (activate desired + retire removed)
 *
 * Once the patch request is issued, a failed response is ambiguous. The client
 * reconciles the operation id and never issues authenticated Storage DELETE.
 */

const {
  mockSupabase,
  saveRecordToDB,
  uploadRecordMedia,
  beginRecordMediaMutation,
  getRecordMediaMutationStatus,
  abandonRecordMediaMutation,
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
    beginRecordMediaMutation: vi.fn(),
    getRecordMediaMutationStatus: vi.fn(),
    abandonRecordMediaMutation: vi.fn(),
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
  beginRecordMediaMutation: (...args: unknown[]) => {
    const request = args[0] as { baseContentRevision: number; newMediaIds: string[] };
    callOrder.push(`begin:${request.baseContentRevision}:${request.newMediaIds.length}`);
    return beginRecordMediaMutation(...(args as []));
  },
  getRecordMediaMutationStatus: (...args: unknown[]) => {
    callOrder.push('status');
    return getRecordMediaMutationStatus(...(args as []));
  },
  abandonRecordMediaMutation: (...args: unknown[]) => {
    callOrder.push('abandon');
    return abandonRecordMediaMutation(...(args as []));
  },
  resolveAttachmentUrls: async (attachments: unknown[]) => attachments,
  classifyMediaFile: (file: { type: string }) =>
    file.type.startsWith('image/')
      ? { ext: 'png', type: 'photo' }
      : { error: '지원하지 않는 파일 형식이에요.' },
  isCanonicalRecordMediaPath: (path: unknown, coupleId: string, recordId: string) =>
    typeof path === 'string' && path.startsWith(`${coupleId}/${recordId}/`),
  isValidMediaObjectId: (value: string) => (
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ),
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

let lastResult: {
  ok: boolean;
  failedFiles: string[];
  retryableFailedFileIndexes?: number[];
  error?: string;
} | null = null;

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
  contentRevision: 1,
  attachments: [{ type: 'photo', name: 'existing.png', path: EXISTING_PATH }],
};

async function setup(
  props: React.ComponentProps<typeof Probe> = {},
  record: DailyRecord = baseRecord,
) {
  fetchFullStateFromDB.mockResolvedValue({
    setupComplete: true,
    records: [record],
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
    sessionStorage.clear();
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
    saveRecordToDB.mockReset().mockImplementation(async (
      _record: DailyRecord,
      _coupleId: string,
      _userId: string,
      intent: { expectedRevision?: number },
    ) => ({ ok: true, contentRevision: (intent.expectedRevision ?? 0) + 1 }));
    uploadRecordMedia.mockReset().mockImplementation(async (
      file: File,
      coupleId: string,
      recordId: string,
      _displayName: string | undefined,
      objectId: string,
    ) => ({
      attachment: { type: 'photo', name: file.name, path: `${coupleId}/${recordId}/${objectId}.png` },
    }));
    beginRecordMediaMutation.mockReset().mockImplementation(async (
      request: { baseContentRevision: number },
    ) => ({
      ok: true,
      state: 'pending',
      targetContentRevision: request.baseContentRevision + 1,
    }));
    getRecordMediaMutationStatus.mockReset().mockResolvedValue({ ok: true, state: 'pending' });
    abandonRecordMediaMutation.mockReset().mockResolvedValue({ ok: true, state: 'abandoned' });
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

  it('retires removals once, then reserves and commits the replacement in the next revision', async () => {
    await setup({ addFiles: [pngFile('new.png')], removePaths: [EXISTING_PATH] });

    await act(async () => {
      screen.getByText('edit-media').click();
    });
    await waitFor(() => expect(lastResult).not.toBeNull());

    expect(lastResult?.ok).toBe(true);
    // Logical retirement is in the first DB transaction; physical cleanup is
    // worker-owned and never appears in the authenticated client call order.
    expect(callOrder).toEqual([
      'begin:1:0',
      'patchRow',
      'begin:2:1',
      'upload:new.png',
      'patchRow',
    ]);
    const replacementId = (beginRecordMediaMutation.mock.calls[1]?.[0] as {
      newMediaIds: string[];
    }).newMediaIds[0];
    await waitFor(() =>
      expect(screen.getByTestId('attachments')).toHaveTextContent(replacementId),
    );
    expect(screen.getByTestId('attachments')).not.toHaveTextContent('existing.png');
  });

  it('abandons an uploaded reservation after an authoritative forbidden patch failure', async () => {
    saveRecordToDB.mockResolvedValue({ ok: false, reason: 'forbidden' });
    await setup({ addFiles: [pngFile('new.png')] });

    await act(async () => {
      screen.getByText('edit-media').click();
    });
    await waitFor(() => expect(lastResult).not.toBeNull());

    expect(lastResult?.ok).toBe(false);
    expect(callOrder).toEqual([
      'begin:1:1',
      'upload:new.png',
      'patchRow',
      'abandon',
    ]);
    expect(abandonRecordMediaMutation).toHaveBeenCalledTimes(1);
    // Local state is unchanged: no phantom success.
    expect(screen.getByTestId('attachments')).toHaveTextContent(EXISTING_PATH);
  });

  it('accepts a committed media patch when only its response was lost', async () => {
    saveRecordToDB
      .mockResolvedValueOnce({ ok: true, contentRevision: 2 })
      .mockResolvedValueOnce({ ok: false, reason: 'offline' });
    getRecordMediaMutationStatus.mockResolvedValueOnce({
      ok: true,
      state: 'committed',
      targetContentRevision: 3,
    });
    await setup({ addFiles: [pngFile('new.png')], removePaths: [EXISTING_PATH] });

    await act(async () => { screen.getByText('edit-media').click(); });
    await waitFor(() => expect(lastResult).not.toBeNull());

    expect(lastResult?.ok).toBe(true);
    expect(getRecordMediaMutationStatus).toHaveBeenCalledTimes(1);
    expect(abandonRecordMediaMutation).not.toHaveBeenCalled();
    const replacementId = (beginRecordMediaMutation.mock.calls[1]?.[0] as {
      newMediaIds: string[];
    }).newMediaIds[0];
    await waitFor(() =>
      expect(screen.getByTestId('attachments')).toHaveTextContent(replacementId),
    );
  });

  it('accepts a committed publication update when only its response was lost and adopts the newer revision', async () => {
    saveRecordToDB.mockResolvedValue({ ok: false, reason: 'offline' });
    getRecordMediaMutationStatus.mockResolvedValueOnce({
      ok: true,
      state: 'committed',
      targetContentRevision: 2,
    });
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
    await setup({ addFiles: [pngFile('new.png')] });

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
  });

  it('does not let an older response-loss read-back overwrite a newer local revision', async () => {
    let resolveReadBack!: (result: { ok: true; records: DailyRecord[] }) => void;
    const readBack = new Promise<{ ok: true; records: DailyRecord[] }>((resolve) => {
      resolveReadBack = resolve;
    });
    saveRecordToDB
      .mockResolvedValueOnce({ ok: false, reason: 'offline' })
      .mockResolvedValueOnce({ ok: true, contentRevision: 8 });
    getRecordMediaMutationStatus.mockResolvedValueOnce({
      ok: true,
      state: 'committed',
      targetContentRevision: 2,
    });
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
    getRecordMediaMutationStatus.mockResolvedValueOnce({
      ok: true,
      state: 'committed',
      targetContentRevision: 2,
    });
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
    getRecordMediaMutationStatus.mockResolvedValueOnce({
      ok: true,
      state: 'committed',
      targetContentRevision: 2,
    });
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
    expect(saveRecordToDB.mock.calls[1]?.[3]).toMatchObject({
      kind: 'update',
      expectedRevision: 7,
      mediaOperationId: expect.any(String),
    });
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

  it('deduplicates lifecycle paths for an ordinary edit without changing duplicate content attachments', async () => {
    const duplicateRecord: DailyRecord = {
      ...baseRecord,
      attachments: [
        ...(baseRecord.attachments || []),
        { type: 'photo', name: 'duplicate display.png', path: EXISTING_PATH },
      ],
    };
    await setup({}, duplicateRecord);

    await act(async () => { screen.getByText('publish').click(); });
    await waitFor(() => expect(screen.getByTestId('update-result')).toHaveTextContent('ok'));

    const request = beginRecordMediaMutation.mock.calls[0]?.[0] as {
      existingPaths: string[];
    };
    expect(request.existingPaths).toEqual([EXISTING_PATH]);
    expect((saveRecordToDB.mock.calls[0]?.[0] as DailyRecord).attachments).toHaveLength(2);
  });

  it('continues an ordinary text/visibility operation after its begin response is lost', async () => {
    beginRecordMediaMutation.mockResolvedValueOnce({ ok: false, reason: 'offline' });
    getRecordMediaMutationStatus.mockResolvedValueOnce({
      ok: true,
      state: 'pending',
      targetContentRevision: 2,
    });
    await setup();

    await act(async () => { screen.getByText('publish').click(); });
    await waitFor(() => expect(screen.getByTestId('update-result')).toHaveTextContent('ok'));

    expect(beginRecordMediaMutation).toHaveBeenCalledTimes(1);
    expect(getRecordMediaMutationStatus).toHaveBeenCalledTimes(1);
    expect(saveRecordToDB).toHaveBeenCalledTimes(1);
    const beginRequest = beginRecordMediaMutation.mock.calls[0]?.[0] as { operationId: string };
    const statusRequest = getRecordMediaMutationStatus.mock.calls[0]?.[0] as { operationId: string };
    expect(statusRequest.operationId).toBe(beginRequest.operationId);
    expect((saveRecordToDB.mock.calls[0]?.[3] as { mediaOperationId: string }).mediaOperationId)
      .toBe(beginRequest.operationId);
    expect(abandonRecordMediaMutation).not.toHaveBeenCalled();
  });

  it('journals an ordinary update when both begin and status responses are lost', async () => {
    beginRecordMediaMutation.mockResolvedValueOnce({ ok: false, reason: 'offline' });
    getRecordMediaMutationStatus.mockResolvedValueOnce({ ok: false, reason: 'offline' });
    await setup();

    await act(async () => { screen.getByText('publish').click(); });
    await waitFor(() => expect(screen.getByTestId('update-result')).toHaveTextContent('offline'));

    const ownerToken = getOrCreateRecordMediaMutationOwnerToken();
    expect(listRecordMediaMutationJournalEntries('user-1', ownerToken!)).toEqual([
      expect.objectContaining({
        operationId: (beginRecordMediaMutation.mock.calls[0]?.[0] as { operationId: string }).operationId,
        recordId: 'rec-1',
        userId: 'user-1',
        coupleId: 'couple-1',
      }),
    ]);
    expect(saveRecordToDB).not.toHaveBeenCalled();
  });

  it('keeps the exact opaque operation identity when both begin and status responses are lost', async () => {
    beginRecordMediaMutation.mockResolvedValueOnce({ ok: false, reason: 'offline' });
    getRecordMediaMutationStatus.mockResolvedValueOnce({ ok: false, reason: 'offline' });
    await setup({ addFiles: [pngFile('new.png')] });

    await act(async () => { screen.getByText('edit-media').click(); });
    await waitFor(() => expect(lastResult).not.toBeNull());

    const ownerToken = getOrCreateRecordMediaMutationOwnerToken();
    expect(ownerToken).not.toBeNull();
    expect(listRecordMediaMutationJournalEntries('user-1', ownerToken!)).toEqual([
      expect.objectContaining({
        operationId: (beginRecordMediaMutation.mock.calls[0]?.[0] as { operationId: string }).operationId,
        recordId: 'rec-1',
        userId: 'user-1',
        coupleId: 'couple-1',
      }),
    ]);
    expect(uploadRecordMedia).not.toHaveBeenCalled();
    expect(saveRecordToDB).not.toHaveBeenCalled();
  });

  it('abandons and clears an interrupted same-tab operation after the app resumes online', async () => {
    const ownerToken = getOrCreateRecordMediaMutationOwnerToken(sessionStorage, () => 'tab-a');
    expect(ownerToken).toBe('tab-a');
    const interrupted = {
      operationId: 'operation-interrupted',
      recordId: 'rec-1',
      userId: 'user-1',
      coupleId: 'couple-1',
    };
    expect(writeRecordMediaMutationJournalEntry(interrupted, ownerToken!)).toBe(true);
    getRecordMediaMutationStatus.mockResolvedValueOnce({ ok: true, state: 'pending' });
    abandonRecordMediaMutation.mockResolvedValueOnce({ ok: true, state: 'abandoned' });
    await setup();

    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => expect(abandonRecordMediaMutation).toHaveBeenCalledWith(
      expect.objectContaining(interrupted),
    ));

    expect(listRecordMediaMutationJournalEntries('user-1', ownerToken!)).toEqual([]);
    expect(saveRecordToDB).not.toHaveBeenCalled();
    expect(uploadRecordMedia).not.toHaveBeenCalled();
  });

  it('keeps uncertain uploads when response loss cannot be reconciled', async () => {
    saveRecordToDB.mockResolvedValue({ ok: false, reason: 'unreachable' });
    getRecordMediaMutationStatus.mockResolvedValueOnce({ ok: true, state: 'unavailable' });
    await setup({ addFiles: [pngFile('new.png')] });

    await act(async () => { screen.getByText('edit-media').click(); });
    await waitFor(() => expect(lastResult).not.toBeNull());

    expect(lastResult?.ok).toBe(false);
    expect(getRecordMediaMutationStatus).toHaveBeenCalledTimes(1);
    expect(abandonRecordMediaMutation).not.toHaveBeenCalled();
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
    expect(beginRecordMediaMutation).not.toHaveBeenCalled();
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
    expect(callOrder).toEqual(['begin:1:0', 'patchRow']);
    await waitFor(() => expect(screen.getByTestId('attachments')).toHaveTextContent(''));
  });

  it('reports logical removal success after durable cleanup is committed', async () => {
    await setup({ removePaths: [EXISTING_PATH] });

    await act(async () => {
      screen.getByText('edit-media').click();
    });
    await waitFor(() => expect(lastResult).not.toBeNull());

    // The client promises logical removal only. Physical deletion belongs to the
    // leased worker and is not represented by an authenticated Storage call.
    expect(lastResult?.ok).toBe(true);
    expect(beginRecordMediaMutation).toHaveBeenCalledTimes(1);
    expect(abandonRecordMediaMutation).not.toHaveBeenCalled();
    expect(screen.getByTestId('attachments')).toHaveTextContent('');
  });

  it('reports a partial upload failure without losing the successful ones', async () => {
    uploadRecordMedia.mockImplementation(async (
      file: File,
      coupleId: string,
      recordId: string,
      _displayName: string | undefined,
      objectId: string,
    ) =>
      file.name === 'bad.png'
        ? { error: '파일을 올리지 못했어요.' }
        : {
            attachment: {
              type: 'photo',
              name: file.name,
              path: `${coupleId}/${recordId}/${objectId}.png`,
            },
          },
    );
    await setup({ addFiles: [pngFile('good.png'), pngFile('bad.png')] });

    await act(async () => {
      screen.getByText('edit-media').click();
    });
    await waitFor(() => expect(lastResult).not.toBeNull());

    expect(lastResult?.ok).toBe(true);
    expect(lastResult?.failedFiles).toEqual(['bad.png']);
    expect(lastResult?.retryableFailedFileIndexes).toEqual([1]);
    const begins = beginRecordMediaMutation.mock.calls.map(([request]) => request as {
      baseContentRevision: number;
      existingPaths: string[];
      newMediaIds: string[];
    });
    expect(begins).toHaveLength(2);
    expect(begins[0]).toMatchObject({ baseContentRevision: 1 });
    expect(begins[0].newMediaIds).toHaveLength(1);
    expect(begins[1]).toMatchObject({ baseContentRevision: 2 });
    expect(begins[1].newMediaIds).toHaveLength(1);
    expect(begins[1].existingPaths).toEqual([
      EXISTING_PATH,
      expect.stringMatching(/^couple-1\/rec-1\/[0-9a-f-]+\.png$/),
    ]);
    await waitFor(() =>
      expect(screen.getByTestId('attachments')).toHaveTextContent(begins[1].existingPaths[1]),
    );
    expect(saveRecordToDB).toHaveBeenCalledTimes(1);
    expect(abandonRecordMediaMutation).toHaveBeenCalledTimes(1);
  });

  it('keeps an earlier one-file commit when a later begin is definitively refused', async () => {
    beginRecordMediaMutation
      .mockImplementationOnce(async (request: { baseContentRevision: number }) => ({
        ok: true,
        state: 'pending',
        targetContentRevision: request.baseContentRevision + 1,
      }))
      .mockResolvedValueOnce({ ok: false, reason: 'forbidden' });
    await setup({ addFiles: [pngFile('committed.png'), pngFile('unfinished.png')] });

    await act(async () => { screen.getByText('edit-media').click(); });
    await waitFor(() => expect(lastResult).not.toBeNull());

    expect(lastResult).toMatchObject({
      ok: true,
      failedFiles: ['unfinished.png'],
      reason: 'forbidden',
    });
    expect(lastResult).not.toHaveProperty('retryableFailedFileIndexes');
    expect(beginRecordMediaMutation).toHaveBeenCalledTimes(2);
    expect(uploadRecordMedia.mock.calls.map(([file]) => (file as File).name))
      .toEqual(['committed.png']);
    expect(saveRecordToDB).toHaveBeenCalledTimes(1);
    const [committedId] = (beginRecordMediaMutation.mock.calls[0]?.[0] as {
      newMediaIds: string[];
    }).newMediaIds;
    const [unfinishedId] = (beginRecordMediaMutation.mock.calls[1]?.[0] as {
      newMediaIds: string[];
    }).newMediaIds;
    expect(screen.getByTestId('attachments')).toHaveTextContent(committedId);
    expect(screen.getByTestId('attachments')).not.toHaveTextContent(unfinishedId);
  });

  it('continues the next one-file revision after a committed response-loss operation', async () => {
    saveRecordToDB.mockResolvedValueOnce({ ok: false, reason: 'offline' });
    getRecordMediaMutationStatus.mockResolvedValueOnce({
      ok: true,
      state: 'committed',
      targetContentRevision: 2,
    });
    uploadRecordMedia.mockImplementation(async (
      file: File,
      coupleId: string,
      recordId: string,
      _displayName: string | undefined,
      objectId: string,
    ) => file.name === 'bad.png'
      ? { error: '파일을 올리지 못했어요.', reason: 'server' }
      : {
          attachment: {
            type: 'photo',
            name: file.name,
            path: `${coupleId}/${recordId}/${objectId}.png`,
          },
        });
    await setup({ addFiles: [pngFile('good.png'), pngFile('bad.png')] });

    await act(async () => { screen.getByText('edit-media').click(); });
    await waitFor(() => expect(lastResult).not.toBeNull());

    expect(lastResult).toMatchObject({ ok: true, failedFiles: ['bad.png'] });
    expect(getRecordMediaMutationStatus).toHaveBeenCalledTimes(1);
    expect(beginRecordMediaMutation.mock.calls.map(([request]) => (
      (request as { baseContentRevision: number }).baseContentRevision
    ))).toEqual([1, 2]);
    expect(abandonRecordMediaMutation).toHaveBeenCalledTimes(1);
  });

  it('continues the exact operation when begin response is lost but status is pending', async () => {
    beginRecordMediaMutation.mockResolvedValueOnce({ ok: false, reason: 'offline' });
    getRecordMediaMutationStatus.mockResolvedValueOnce({
      ok: true,
      state: 'pending',
      targetContentRevision: 2,
    });
    await setup({ addFiles: [pngFile('new.png')] });

    await act(async () => { screen.getByText('edit-media').click(); });
    await waitFor(() => expect(lastResult).not.toBeNull());

    expect(lastResult).toMatchObject({ ok: true, failedFiles: [] });
    expect(beginRecordMediaMutation).toHaveBeenCalledTimes(1);
    expect(getRecordMediaMutationStatus).toHaveBeenCalledTimes(1);
    expect(uploadRecordMedia).toHaveBeenCalledTimes(1);
    expect(saveRecordToDB).toHaveBeenCalledTimes(1);
    const beginRequest = beginRecordMediaMutation.mock.calls[0]?.[0] as {
      operationId: string;
      newMediaIds: string[];
    };
    const statusRequest = getRecordMediaMutationStatus.mock.calls[0]?.[0] as {
      operationId: string;
    };
    expect(statusRequest.operationId).toBe(beginRequest.operationId);
    expect(uploadRecordMedia.mock.calls[0]?.[4]).toBe(beginRequest.newMediaIds[0]);
    expect((saveRecordToDB.mock.calls[0]?.[3] as { mediaOperationId: string }).mediaOperationId)
      .toBe(beginRequest.operationId);
    expect(abandonRecordMediaMutation).not.toHaveBeenCalled();
  });

  it('commits the exact stable object when Storage succeeded but its upload response was lost', async () => {
    uploadRecordMedia.mockImplementationOnce(async (
      file: File,
      coupleId: string,
      recordId: string,
      _displayName: string | undefined,
      objectId: string,
    ) => ({
      error: '서버에 요청이 닿지 않았어요. 잠시 후 다시 시도해 주세요.',
      reason: 'unreachable',
      uncertainAttachment: {
        type: 'photo',
        name: file.name,
        path: `${coupleId}/${recordId}/${objectId}.png`,
      },
    }));
    await setup({ addFiles: [pngFile('new.png')] });

    await act(async () => { screen.getByText('edit-media').click(); });
    await waitFor(() => expect(lastResult).not.toBeNull());

    expect(lastResult).toMatchObject({ ok: true, failedFiles: [] });
    expect(callOrder).toEqual(['begin:1:1', 'upload:new.png', 'patchRow']);
    expect(beginRecordMediaMutation).toHaveBeenCalledTimes(1);
    expect(uploadRecordMedia).toHaveBeenCalledTimes(1);
    expect(saveRecordToDB).toHaveBeenCalledTimes(1);
    expect(abandonRecordMediaMutation).not.toHaveBeenCalled();
    const request = beginRecordMediaMutation.mock.calls[0]?.[0] as {
      operationId: string;
      newMediaIds: string[];
    };
    const saved = saveRecordToDB.mock.calls[0]?.[0] as DailyRecord;
    expect(saved.attachments?.at(-1)?.path).toContain(request.newMediaIds[0]);
    expect((saveRecordToDB.mock.calls[0]?.[3] as { mediaOperationId: string }).mediaOperationId)
      .toBe(request.operationId);
  });

  it('abandons only after the record CAS proves an ambiguous upload did not commit', async () => {
    uploadRecordMedia.mockImplementationOnce(async (
      file: File,
      coupleId: string,
      recordId: string,
      _displayName: string | undefined,
      objectId: string,
    ) => ({
      error: '서버 응답을 확인하지 못했어요.',
      reason: 'unreachable',
      uncertainAttachment: {
        type: 'photo',
        name: file.name,
        path: `${coupleId}/${recordId}/${objectId}.png`,
      },
    }));
    saveRecordToDB.mockResolvedValueOnce({ ok: false, reason: 'server' });
    getRecordMediaMutationStatus.mockResolvedValueOnce({ ok: true, state: 'pending' });
    await setup({ addFiles: [pngFile('missing.png')] });

    await act(async () => { screen.getByText('edit-media').click(); });
    await waitFor(() => expect(lastResult).not.toBeNull());

    expect(lastResult).toMatchObject({
      ok: false,
      failedFiles: ['missing.png'],
      reason: 'server',
    });
    expect(lastResult).not.toHaveProperty('retryableFailedFileIndexes');
    expect(callOrder).toEqual([
      'begin:1:1',
      'upload:missing.png',
      'patchRow',
      'status',
      'abandon',
    ]);
    expect(saveRecordToDB).toHaveBeenCalledTimes(1);
    expect(getRecordMediaMutationStatus).toHaveBeenCalledTimes(1);
    expect(abandonRecordMediaMutation).toHaveBeenCalledTimes(1);
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
      retryableFailedFileIndexes: [0, 1],
      error: '파일을 올리지 못했어요.',
      reason: 'unknown',
    });
    expect(callOrder).toEqual([
      'begin:1:2',
      'upload:good.png',
      'upload:bad.png',
      'abandon',
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
