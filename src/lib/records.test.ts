import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  classifyMediaFile,
  buildMediaPath,
  beginRecordMediaMutation,
  getRecordMediaMutationStatus,
  abandonRecordMediaMutation,
  MAX_BYTES,
  MEDIA_ACCEPT,
  MEDIA_POLICY_REFUSAL,
  isCanonicalRecordMediaPath,
  deleteRecordFromDB,
  downloadRecordPhotoForReuse,
  fetchRecordsFromDB,
  saveRecordToDB,
  setRecordCryptoEnvironment,
} from '@/lib/records';
import { AES_KEY_BYTES, importAesKey } from '@/crypto/suite';
import type { RecordCryptoEnvironment, ScopeEpoch } from '@/app/records/contentCrypto';
import {
  clearCoupleProtectionRequirement,
  requireCoupleProtection,
} from '@/app/e2ee/coupleProtectionBarrier';

const { mockFrom, mockRpc, mockStorageDownload, mockSupabase } = vi.hoisted(() => {
  const mockFrom = vi.fn();
  const mockRpc = vi.fn();
  const mockStorageDownload = vi.fn();
  const mockSupabase = {
    from: mockFrom,
    rpc: mockRpc,
    storage: {
      from: vi.fn(() => ({ download: mockStorageDownload })),
    },
  };
  return { mockFrom, mockRpc, mockStorageDownload, mockSupabase };
});

vi.mock('@/lib/supabase', () => ({
  supabase: mockSupabase,
  isSupabaseConfigured: true,
}));

describe('classifyMediaFile', () => {
  it('classifies allowed photo types', () => {
    for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'image/heic']) {
      const result = classifyMediaFile({ type: mime, size: 1024 });
      expect(result, mime).not.toHaveProperty('error');
      expect((result as { type: string }).type).toBe('photo');
    }
  });

  // PRODUCT_V3 §12.3/§12.4, executed 2026-08-21: video and voice uploads stay shut
  // until the encrypted media foundation (P6). The refusal is a decision, so it
  // must not borrow the sentence that means "we could not read this file" — one
  // reads as a policy, the other as a bug the user should retry around.
  it('refuses video types by policy rather than calling them unsupported', () => {
    for (const mime of ['video/mp4', 'video/quicktime', 'video/webm']) {
      const result = classifyMediaFile({ type: mime, size: 1024 });
      expect(result, mime).toHaveProperty('error');
      expect((result as { error: string }).error, mime).toBe(MEDIA_POLICY_REFUSAL);
    }
  });

  it('refuses audio types by policy rather than calling them unsupported', () => {
    for (const mime of ['audio/mp4', 'audio/mpeg', 'audio/webm', 'audio/ogg', 'audio/wav']) {
      const result = classifyMediaFile({ type: mime, size: 1024 });
      expect(result, mime).toHaveProperty('error');
      expect((result as { error: string }).error, mime).toBe(MEDIA_POLICY_REFUSAL);
    }
  });

  // The two refusals must stay distinguishable. If they ever collapse into one
  // string, the gate above silently becomes indistinguishable from a parse
  // failure and this assertion is what notices.
  it('separates a policy refusal from an unreadable format', () => {
    const byPolicy = classifyMediaFile({ type: 'video/mp4', size: 1024 });
    const unsupported = classifyMediaFile({ type: 'application/zip', size: 1024 });

    expect((byPolicy as { error: string }).error).not.toBe(
      (unsupported as { error: string }).error,
    );
  });

  it('rejects types that are not on the allowlist', () => {
    for (const mime of [
      'application/pdf',
      'text/html',
      'application/zip',
      'application/x-msdownload',
      'image/svg+xml', // scriptable, deliberately excluded
      '',
    ]) {
      const result = classifyMediaFile({ type: mime, size: 1024 });
      expect(result, mime).toHaveProperty('error');
    }
  });

  it('is case insensitive about the MIME type', () => {
    expect(classifyMediaFile({ type: 'IMAGE/JPEG', size: 10 })).not.toHaveProperty('error');
  });

  it('rejects empty files', () => {
    expect(classifyMediaFile({ type: 'image/png', size: 0 })).toHaveProperty('error');
  });

  it('enforces a per-kind size ceiling', () => {
    expect(
      classifyMediaFile({ type: 'image/png', size: MAX_BYTES.photo + 1 }),
    ).toHaveProperty('error');
    expect(
      classifyMediaFile({ type: 'image/png', size: MAX_BYTES.photo }),
    ).not.toHaveProperty('error');

    // MAX_BYTES still carries video and voice ceilings for the P6 re-admission,
    // but no size makes those kinds acceptable today: the policy gate runs first,
    // so both a tiny and an oversized video come back with the same sentence.
    // Asserting that keeps a future size-check refactor from quietly reordering
    // the two and letting a small video through.
    for (const size of [1024, MAX_BYTES.photo + 1, MAX_BYTES.video + 1]) {
      expect((classifyMediaFile({ type: 'video/mp4', size }) as { error: string }).error).toBe(
        MEDIA_POLICY_REFUSAL,
      );
    }
    expect(
      (classifyMediaFile({ type: 'audio/webm', size: MAX_BYTES.voice + 1 }) as { error: string })
        .error,
    ).toBe(MEDIA_POLICY_REFUSAL);
  });

  it('returns a Korean, user-facing message on rejection', () => {
    const result = classifyMediaFile({ type: 'application/zip', size: 10 });
    expect((result as { error: string }).error).toMatch(/[가-힣]/);
  });
});

describe('buildMediaPath', () => {
  it('matches the layout the storage RLS policies expect', () => {
    const coupleId = '11111111-1111-1111-1111-111111111111';
    const recordId = '22222222-2222-2222-2222-222222222222';
    const path = buildMediaPath(coupleId, recordId, 'jpg');

    const segments = path.split('/');
    // Policy reads foldername[1] = coupleId and foldername[2] = recordId.
    expect(segments).toHaveLength(3);
    expect(segments[0]).toBe(coupleId);
    expect(segments[1]).toBe(recordId);
    expect(segments[2].endsWith('.jpg')).toBe(true);
  });

  it('never reuses a filename for the same record', () => {
    const paths = new Set(
      Array.from({ length: 200 }, () => buildMediaPath('couple', 'record', 'png')),
    );
    expect(paths.size).toBe(200);
  });
});

describe('MEDIA_ACCEPT', () => {
  // The picker must not offer what the next step refuses. Being handed a file
  // chooser that lists videos and then being told videos are closed is the
  // worst of both: the app looks broken instead of deliberate.
  it('offers only what classifyMediaFile will accept', () => {
    expect(MEDIA_ACCEPT).toContain('image/');
    expect(MEDIA_ACCEPT).not.toContain('video/');
    expect(MEDIA_ACCEPT).not.toContain('audio/');
  });

  it('keeps every offered MIME type actually acceptable', () => {
    for (const mime of MEDIA_ACCEPT.split(',')) {
      expect(classifyMediaFile({ type: mime, size: 1024 }), mime).not.toHaveProperty('error');
    }
  });
});

describe('isCanonicalRecordMediaPath', () => {
  const couple = 'couple-abc';
  const record = 'record-123';

  it('accepts a valid 3-segment path', () => {
    expect(isCanonicalRecordMediaPath(`${couple}/${record}/file.jpg`, couple, record)).toBe(true);
  });

  it('accepts a filename containing a UUID', () => {
    expect(isCanonicalRecordMediaPath(`${couple}/${record}/a1b2c3d4-e5f6.png`, couple, record)).toBe(true);
  });

  it('accepts a filename with dots and dashes', () => {
    expect(isCanonicalRecordMediaPath(`${couple}/${record}/photo-2026.01.31.webp`, couple, record)).toBe(true);
  });

  it('rejects a 4-segment (nested) path', () => {
    expect(isCanonicalRecordMediaPath(`${couple}/${record}/nested/file.jpg`, couple, record)).toBe(false);
  });

  it('rejects a 2-segment (insufficient) path', () => {
    expect(isCanonicalRecordMediaPath(`${couple}/file.jpg`, couple, record)).toBe(false);
  });

  it('rejects when couple ID does not match', () => {
    expect(isCanonicalRecordMediaPath(`wrong-couple/${record}/file.jpg`, couple, record)).toBe(false);
  });

  it('rejects when record ID does not match', () => {
    expect(isCanonicalRecordMediaPath(`${couple}/wrong-record/file.jpg`, couple, record)).toBe(false);
  });

  it('rejects an empty filename', () => {
    expect(isCanonicalRecordMediaPath(`${couple}/${record}/`, couple, record)).toBe(false);
  });

  it('rejects a filename starting with a dot', () => {
    expect(isCanonicalRecordMediaPath(`${couple}/${record}/.hidden`, couple, record)).toBe(false);
  });

  it('rejects a filename containing a slash', () => {
    expect(isCanonicalRecordMediaPath(`${couple}/${record}/a/b`, couple, record)).toBe(false);
  });

  it('rejects an external URL', () => {
    expect(isCanonicalRecordMediaPath('https://evil.com/tracker.gif', couple, record)).toBe(false);
  });

  it('rejects undefined path', () => {
    expect(isCanonicalRecordMediaPath(undefined, couple, record)).toBe(false);
  });

  it('rejects null path', () => {
    expect(isCanonicalRecordMediaPath(null, couple, record)).toBe(false);
  });

  it('rejects numeric path', () => {
    expect(isCanonicalRecordMediaPath(123, couple, record)).toBe(false);
  });

  it('rejects when coupleId is empty string', () => {
    expect(isCanonicalRecordMediaPath(`${couple}/${record}/file.jpg`, '', record)).toBe(false);
  });

  it('rejects when recordId is empty string', () => {
    expect(isCanonicalRecordMediaPath(`${couple}/${record}/file.jpg`, couple, '')).toBe(false);
  });
});

describe('downloadRecordPhotoForReuse', () => {
  afterEach(() => {
    mockStorageDownload.mockReset();
  });

  it('downloads only a canonical source photo and returns a new File', async () => {
    mockStorageDownload.mockResolvedValue({
      data: new Blob(['photo'], { type: 'image/jpeg' }),
      error: null,
    });

    const result = await downloadRecordPhotoForReuse(
      { type: 'photo', name: 'source.jpg', path: 'couple-1/record-1/source.jpg' },
      'couple-1',
      'record-1',
    );

    expect(mockStorageDownload).toHaveBeenCalledWith(
      'couple-1/record-1/source.jpg',
      {},
      { cache: 'no-store' },
    );
    expect(result).toHaveProperty('file');
    expect((result as { file: File }).file.name).toBe('source.jpg');
    expect((result as { file: File }).file.type).toBe('image/jpeg');
  });

  it('rejects a path owned by another record before touching Storage', async () => {
    const result = await downloadRecordPhotoForReuse(
      { type: 'photo', name: 'source.jpg', path: 'couple-1/record-other/source.jpg' },
      'couple-1',
      'record-1',
    );

    expect(result).toHaveProperty('error');
    expect(mockStorageDownload).not.toHaveBeenCalled();
  });

  it('fails closed when Storage returns non-photo bytes', async () => {
    mockStorageDownload.mockResolvedValue({
      data: new Blob(['<html>'], { type: 'text/html' }),
      error: null,
    });

    const result = await downloadRecordPhotoForReuse(
      { type: 'photo', name: 'source.jpg', path: 'couple-1/record-1/source.jpg' },
      'couple-1',
      'record-1',
    );

    expect(result).toHaveProperty('error');
  });

  it('classifies an RLS rejection instead of blaming the connection', async () => {
    mockStorageDownload.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    });

    const result = await downloadRecordPhotoForReuse(
      { type: 'photo', name: 'source.jpg', path: 'couple-1/record-1/source.jpg' },
      'couple-1',
      'record-1',
    );

    expect(result).toEqual({
      error: '기존 사진을 불러오지 못했어요. 권한이 없어요. 커플 공간 연결 상태를 확인해 주세요.',
    });
  });
});

describe('fetchRecordsFromDB profile-post metadata', () => {
  afterEach(() => mockFrom.mockReset());

  it('maps explicit profile posts without changing the stored record time', async () => {
    let pageIndex = 0;
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      or: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(async () => pageIndex++ === 0
        ? {
            data: [{
              id: '11111111-1111-4111-8111-111111111111',
              user_id: '22222222-2222-4222-8222-222222222222',
              record_date: '2026-08-28',
              record_time: '09:07:33',
              log_text: '아침 기록',
              attachments: [],
              is_private: false,
              is_profile_post: true,
              created_at: '2026-08-28T00:07:33.000000Z',
              content_revision: 1,
              cipher_format: 0,
            }],
            error: null,
          }
        : { data: [], error: null }),
    };
    mockFrom.mockReturnValue(builder);

    const [mapped] = await fetchRecordsFromDB('couple-1');

    expect(mapped.time).toBe('09:07:33');
    expect(mapped.isProfilePost).toBe(true);
  });
});

describe('deleteRecordFromDB', () => {
  const recordId = 'rec-001';
  const userId = 'user-001';
  const coupleId = 'couple-001';

  it('routes deletion through the atomic owner RPC instead of direct table DELETE', async () => {
    mockRpc.mockResolvedValueOnce({ data: true, error: null });

    const result = await deleteRecordFromDB(recordId, userId, coupleId);

    expect(result).toEqual({ ok: true });
    expect(mockRpc).toHaveBeenCalledWith('delete_my_record', {
      p_record_id: recordId,
      p_expected_user_id: userId,
      p_expected_couple_id: coupleId,
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('maps the RPC non-disclosure false result to not_found', async () => {
    mockRpc.mockResolvedValueOnce({ data: false, error: null });

    const result = await deleteRecordFromDB(recordId, userId, coupleId);

    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('classifies an RLS rejection as forbidden rather than a connection problem', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'permission denied for table daily_records' },
    });

    const result = await deleteRecordFromDB(recordId, userId, coupleId);

    expect(result).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('classifies an expired session as auth_expired', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST301', message: 'JWT expired' },
    });

    const result = await deleteRecordFromDB(recordId, userId, coupleId);

    expect(result).toEqual({ ok: false, reason: 'auth_expired' });
  });
});

describe('record media mutation RPCs', () => {
  const request = {
    operationId: '40000000-0000-4000-8000-000000000001',
    recordId: '20000000-0000-4000-8000-000000000001',
    userId: '10000000-0000-4000-8000-000000000001',
    coupleId: '30000000-0000-4000-8000-000000000001',
    baseContentRevision: 7,
    existingPaths: ['30000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001/old.jpg'],
    newMediaIds: ['50000000-0000-4000-8000-000000000001'],
  };

  it('begins the exact base-to-target manifest before upload', async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        operation_id: request.operationId,
        state: 'pending',
        base_content_revision: 7,
        target_content_revision: 8,
        desired_object_count: 2,
      },
      error: null,
    });

    await expect(beginRecordMediaMutation(request)).resolves.toEqual({
      ok: true,
      state: 'pending',
      targetContentRevision: 8,
    });
    expect(mockRpc).toHaveBeenCalledWith('begin_record_media_mutation', {
      p_operation_id: request.operationId,
      p_record_id: request.recordId,
      p_expected_user_id: request.userId,
      p_expected_couple_id: request.coupleId,
      p_base_content_revision: 7,
      p_target_content_revision: 8,
      p_existing_paths: request.existingPaths,
      p_new_media_ids: request.newMediaIds,
    });
  });

  it('uses status to distinguish a committed lost response from pending work', async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        operation_id: request.operationId,
        state: 'committed',
        base_content_revision: 7,
        target_content_revision: 8,
        desired_object_count: 2,
      },
      error: null,
    });

    await expect(getRecordMediaMutationStatus(request)).resolves.toEqual({
      ok: true,
      state: 'committed',
      targetContentRevision: 8,
    });
    expect(mockRpc).toHaveBeenCalledWith('record_media_mutation_status', {
      p_operation_id: request.operationId,
      p_record_id: request.recordId,
      p_expected_user_id: request.userId,
      p_expected_couple_id: request.coupleId,
    });
  });

  it('abandons by opaque operation identity and never calls Storage DELETE', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { operation_id: request.operationId, state: 'abandoned' },
      error: null,
    });

    await expect(abandonRecordMediaMutation(request)).resolves.toEqual({
      ok: true,
      state: 'abandoned',
    });
    expect(mockRpc).toHaveBeenCalledWith('abandon_record_media_mutation', {
      p_operation_id: request.operationId,
      p_record_id: request.recordId,
      p_expected_user_id: request.userId,
      p_expected_couple_id: request.coupleId,
    });
    expect(mockSupabase.storage.from).not.toHaveBeenCalled();
  });
});

describe('saveRecordToDB', () => {
  const record = {
    id: 'rec-001',
    date: '2026-02-01',
    time: '09:00',
    authorRole: 'gomsin' as const,
    log: 'hello',
    isPrivate: false,
    createdAt: '2026-02-01T09:00:00.000Z',
  };

  function mockUpsert(error: unknown) {
    const upsert = vi.fn().mockResolvedValue({ error });
    // The production contract uses INSERT for an explicit create intent. Keep
    // the old helper name because these tests also cover the unchanged legacy
    // save result shape.
    mockFrom.mockReturnValue({ insert: upsert, upsert });
    return upsert;
  }

  it('reports ok on a successful upsert', async () => {
    const insert = mockUpsert(null);
    expect(await saveRecordToDB(record, 'couple-001', 'user-001')).toEqual({
      ok: true,
      contentRevision: 1,
    });
    const payload = insert.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('is_profile_post');
  });

  it('persists explicit profile publication as clear routing metadata', async () => {
    const insert = mockUpsert(null);
    await saveRecordToDB({ ...record, isProfilePost: true }, 'couple-001', 'user-001');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ is_profile_post: true }));
  });

  it('can explicitly clear profile publication without changing record identity', async () => {
    const insert = mockUpsert(null);
    await saveRecordToDB({ ...record, isProfilePost: false }, 'couple-001', 'user-001');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ is_profile_post: false }));
  });

  it('advances a successful legacy plaintext update to expectedRevision plus one', async () => {
    const eqCouple = vi.fn().mockResolvedValue({ error: null });
    const eqUser = vi.fn().mockReturnValue({ eq: eqCouple });
    const eqId = vi.fn().mockReturnValue({ eq: eqUser });
    const update = vi.fn().mockReturnValue({ eq: eqId });
    mockFrom.mockReturnValue({ update });

    const result = await saveRecordToDB(
      { ...record, contentRevision: 7 },
      'couple-001',
      'user-001',
      { kind: 'update', expectedRevision: 7, mediaOperationId: 'operation-1' },
    );

    expect(result).toEqual({ ok: true, contentRevision: 8 });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      last_media_operation_id: 'operation-1',
    }));
  });

  it('reports forbidden for an RLS rejection, never a connection failure', async () => {
    mockUpsert({ code: '42501', message: 'new row violates row-level security policy' });
    const result = await saveRecordToDB(record, 'couple-001', 'user-001');
    expect(result).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('reports auth_expired for an expired JWT', async () => {
    mockUpsert({ code: 'PGRST301', message: 'JWT expired' });
    const result = await saveRecordToDB(record, 'couple-001', 'user-001');
    expect(result).toEqual({ ok: false, reason: 'auth_expired' });
  });

  it('refuses without a couple id or user id and does not issue a request', async () => {
    const upsert = mockUpsert(null);
    expect((await saveRecordToDB(record, '', 'user-001')).ok).toBe(false);
    expect((await saveRecordToDB(record, 'couple-001', '')).ok).toBe(false);
    expect(upsert).not.toHaveBeenCalled();
  });

  afterEach(() => {
    setRecordCryptoEnvironment(null);
    clearCoupleProtectionRequirement('user-001', 'couple-001');
    clearCoupleProtectionRequirement('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  });

  async function encryptedEnvironment(): Promise<RecordCryptoEnvironment> {
    const scopeKey = await importAesKey(
      new Uint8Array(AES_KEY_BYTES).fill(7),
      ['encrypt', 'decrypt'],
    );
    const epoch: ScopeEpoch = {
      domain: 'couple',
      scopeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      epoch: 4n,
      state: 'ACTIVE',
    };
    return {
      floorFor: async () => 1,
      epochsFor: async () => [epoch],
      scopeKeyFor: async () => scopeKey,
    };
  }

  const encryptedRecord = {
    ...record,
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  };

  function mockEncryptedResponse(
    data: { content_revision: number } | null,
    error: unknown = null,
  ) {
    const maybeSingle = vi.fn().mockResolvedValue({ data, error });
    const select = vi.fn().mockReturnValue({ maybeSingle });
    const insert = vi.fn().mockReturnValue({ select });
    const eqCouple = vi.fn().mockReturnValue({ select });
    const eqUser = vi.fn().mockReturnValue({ eq: eqCouple });
    const eqId = vi.fn().mockReturnValue({ eq: eqUser });
    const update = vi.fn().mockReturnValue({ eq: eqId });
    mockFrom.mockReturnValue({ insert, update });
    return { insert, update, select, maybeSingle };
  }

  it('uses the real encrypted client contract for create -> edit -> edit revisions', async () => {
    setRecordCryptoEnvironment(await encryptedEnvironment());
    const first = mockEncryptedResponse({ content_revision: 1 });
    const created = await saveRecordToDB(
      encryptedRecord,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '11111111-1111-4111-8111-111111111111',
      { kind: 'create' },
    );
    expect(created).toEqual({ ok: true, contentRevision: 1 });
    expect(first.insert).toHaveBeenCalledTimes(1);
    expect(first.insert.mock.calls[0][0]).toMatchObject({
      cipher_format: 1,
      content_revision: 1,
      key_domain: 'couple',
      key_epoch: '4',
      log_text: '',
      reaction: null,
      attachments: [],
      emotion_flow: [],
      record_time: null,
    });
    expect(first.insert.mock.calls[0][0]).not.toHaveProperty('is_profile_post');

    const second = mockEncryptedResponse({ content_revision: 2 });
    const edited = await saveRecordToDB(
      { ...encryptedRecord, log: 'edit one', contentRevision: 1 },
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '11111111-1111-4111-8111-111111111111',
      { kind: 'update', expectedRevision: 1 },
    );
    expect(edited).toEqual({ ok: true, contentRevision: 2 });
    expect(second.update.mock.calls[0][0]).toMatchObject({ content_revision: 2 });

    const third = mockEncryptedResponse({ content_revision: 3 });
    const editedAgain = await saveRecordToDB(
      { ...encryptedRecord, log: 'edit two', contentRevision: 2 },
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '11111111-1111-4111-8111-111111111111',
      { kind: 'update', expectedRevision: 2 },
    );
    expect(editedAgain).toEqual({ ok: true, contentRevision: 3 });
    expect(third.update.mock.calls[0][0]).toMatchObject({ content_revision: 3 });
  });

  it('uses the actual legacy revision for plaintext -> ciphertext transition', async () => {
    setRecordCryptoEnvironment(await encryptedEnvironment());
    const query = mockEncryptedResponse({ content_revision: 8 });

    const result = await saveRecordToDB(
      { ...encryptedRecord, contentRevision: 7 },
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '11111111-1111-4111-8111-111111111111',
      { kind: 'update', expectedRevision: 7 },
    );

    expect(result).toEqual({ ok: true, contentRevision: 8 });
    expect(query.update.mock.calls[0][0]).toMatchObject({
      cipher_format: 1,
      content_revision: 8,
    });
  });

  it('keeps a stale encrypted update as a server CAS failure', async () => {
    setRecordCryptoEnvironment(await encryptedEnvironment());
    const query = mockEncryptedResponse(null, {
      code: '40001',
      message: 'E2EE_REVISION_CAS: expected revision 3, got 2',
    });

    const result = await saveRecordToDB(
      { ...encryptedRecord, contentRevision: 1 },
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '11111111-1111-4111-8111-111111111111',
      { kind: 'update', expectedRevision: 1 },
    );

    expect(result.ok).toBe(false);
    expect(query.update.mock.calls[0][0]).toMatchObject({ content_revision: 2 });
  });

  it('reports protection-required separately when the write floor has no usable key', async () => {
    setRecordCryptoEnvironment({
      floorFor: async () => 1,
      epochsFor: async () => [],
      scopeKeyFor: async () => null,
    });

    const result = await saveRecordToDB(
      encryptedRecord,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '11111111-1111-4111-8111-111111111111',
      { kind: 'create' },
    );

    expect(result).toEqual({ ok: false, reason: 'server', protectionRequired: true });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('blocks shared plaintext while an authoritative connected-couple barrier is active', async () => {
    setRecordCryptoEnvironment({
      floorFor: async () => 0,
      epochsFor: async () => [],
      scopeKeyFor: async () => null,
    });
    const userId = '11111111-1111-4111-8111-111111111111';
    const coupleId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    requireCoupleProtection(userId, coupleId);

    const result = await saveRecordToDB(
      { ...encryptedRecord, isPrivate: false },
      coupleId,
      userId,
      { kind: 'create' },
    );

    expect(result).toEqual({ ok: false, reason: 'server', protectionRequired: true });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('uses INSERT for create replay, so a lost response cannot silently update an existing id', async () => {
    setRecordCryptoEnvironment(await encryptedEnvironment());
    const query = mockEncryptedResponse(null, { code: '23505', message: 'duplicate key value' });

    const result = await saveRecordToDB(
      encryptedRecord,
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '11111111-1111-4111-8111-111111111111',
      { kind: 'create' },
    );

    expect(result.ok).toBe(false);
    expect(query.insert).toHaveBeenCalledTimes(1);
    expect(query.update).not.toHaveBeenCalled();
  });
});
