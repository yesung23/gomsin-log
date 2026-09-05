import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  classifyMediaFile,
  buildMediaPath,
  beginRecordMediaMutation,
  beginRecordPhotoMutation,
  getRecordPhotoRenditionCapability,
  getRecordMediaMutationStatus,
  abandonRecordMediaMutation,
  MAX_BYTES,
  MEDIA_ACCEPT,
  MEDIA_POLICY_REFUSAL,
  isCanonicalRecordMediaPath,
  deleteRecordFromDB,
  downloadRecordPhotoForReuse,
  fetchRecordsFromDB,
  fetchRecordsResultFromDB,
  resolveAttachmentUrls,
  saveRecordToDB,
  setRecordCryptoEnvironment,
  uploadRecordPhotoRendition,
} from '@/lib/records';
import { prepareRecordPhotoRenditions, type PreparedRecordPhotoRendition } from '@/lib/recordPhotoRenditions';
import { AES_KEY_BYTES, importAesKey } from '@/crypto/suite';
import type { RecordCryptoEnvironment, ScopeEpoch } from '@/app/records/contentCrypto';
import {
  clearCoupleProtectionRequirement,
  requireCoupleProtection,
} from '@/app/e2ee/coupleProtectionBarrier';

const { mockCreateSignedUrls, mockFrom, mockRpc, mockStorageDownload, mockStorageUpload, mockSupabase } = vi.hoisted(() => {
  const mockCreateSignedUrls = vi.fn();
  const mockFrom = vi.fn();
  const mockRpc = vi.fn();
  const mockStorageDownload = vi.fn();
  const mockStorageUpload = vi.fn();
  const mockSupabase = {
    from: mockFrom,
    rpc: mockRpc,
    storage: {
      from: vi.fn(() => ({
        createSignedUrls: mockCreateSignedUrls,
        download: mockStorageDownload,
        upload: mockStorageUpload,
      })),
    },
  };
  return { mockCreateSignedUrls, mockFrom, mockRpc, mockStorageDownload, mockStorageUpload, mockSupabase };
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

describe('fetchRecordsResultFromDB photo display enrichment', () => {
  const RECORD_ID = '11111111-1111-4111-8111-111111111111';
  const MASTER_ID = '33333333-3333-4333-8333-333333333333';
  const THUMBNAIL_ID = '44444444-4444-4444-8444-444444444444';
  const SECOND_MASTER_ID = '88888888-8888-4888-8888-888888888888';
  const SECOND_THUMBNAIL_ID = '99999999-9999-4999-8999-999999999999';
  const SOURCE_REVISION = '55555555-5555-4555-8555-555555555555';
  const COUPLE_ID = '66666666-6666-4666-8666-666666666666';
  const masterPath = `${COUPLE_ID}/${RECORD_ID}/${MASTER_ID}.jpg`;
  const thumbnailPath = `${COUPLE_ID}/${RECORD_ID}/${THUMBNAIL_ID}.jpg`;

  function installRecordPage(
    attachments: unknown[] = [{ type: 'photo', name: 'photo.jpg', path: masterPath }],
    rowOverrides: Record<string, unknown> = {},
  ) {
    let pageIndex = 0;
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      or: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(async () => pageIndex++ === 0
        ? {
            data: [{
              id: RECORD_ID,
              user_id: '22222222-2222-4222-8222-222222222222',
              record_date: '2026-09-05',
              record_time: '09:07:33',
              log_text: '사진 기록',
              attachments,
              is_private: false,
              created_at: '2026-09-05T00:07:33.000000Z',
              content_revision: 9,
              media_contract_version: 1,
              last_media_operation_id: '77777777-7777-4777-8777-777777777777',
              cipher_format: 0,
              ...rowOverrides,
            }],
            error: null,
          }
        : { data: [], error: null }),
    };
    mockFrom.mockReturnValue(builder);
  }

  function metadata(overrides: Record<string, unknown> = {}) {
    return {
      record_id: RECORD_ID,
      media_id: MASTER_ID,
      source_revision: SOURCE_REVISION,
      screen_master: {
        media_object_id: MASTER_ID,
        width_px: 2048,
        height_px: 1536,
        byte_size: 900_000,
        sha256: 'a'.repeat(64),
        mime_type: 'image/jpeg',
      },
      thumbnail: {
        media_object_id: THUMBNAIL_ID,
        width_px: 640,
        height_px: 480,
        byte_size: 90_000,
        sha256: 'b'.repeat(64),
        mime_type: 'image/jpeg',
      },
      ...overrides,
    };
  }

  afterEach(() => {
    mockCreateSignedUrls.mockReset();
    mockFrom.mockReset();
    mockRpc.mockReset();
  });

  it('joins an authorized pair by record and canonical master id, then signs both variants', async () => {
    installRecordPage();
    mockRpc.mockResolvedValueOnce({ data: [metadata()], error: null });
    mockCreateSignedUrls.mockImplementation(async (paths: string[]) => ({
      data: paths.map((path) => ({ path, signedUrl: `https://media.test/${path}` })),
      error: null,
    }));

    const result = await fetchRecordsResultFromDB(COUPLE_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('record fetch failed');
    expect(mockRpc).toHaveBeenCalledWith('get_record_photo_metadata', {
      p_record_ids: [RECORD_ID],
    });
    expect(mockCreateSignedUrls).toHaveBeenCalledWith(
      [masterPath, thumbnailPath],
      3600,
    );
    expect(result.records[0].attachments?.[0]).toMatchObject({
      path: masterPath,
      url: `https://media.test/${masterPath}`,
      photoRendition: {
        sourceRevision: SOURCE_REVISION,
        screenMaster: { mediaObjectId: MASTER_ID, widthPx: 2048, heightPx: 1536 },
        thumbnail: {
          mediaObjectId: THUMBNAIL_ID,
          path: thumbnailPath,
          url: `https://media.test/${thumbnailPath}`,
          widthPx: 640,
          heightPx: 480,
        },
      },
    });
  });

  it('keeps old photo generations bound by master id when attachment order changes', async () => {
    const secondMasterPath = `${COUPLE_ID}/${RECORD_ID}/${SECOND_MASTER_ID}.jpg`;
    installRecordPage([
      { type: 'photo', name: 'second.jpg', path: secondMasterPath },
      { type: 'photo', name: 'first.jpg', path: masterPath },
    ]);
    const second = metadata({
      media_id: SECOND_MASTER_ID,
      source_revision: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      screen_master: {
        media_object_id: SECOND_MASTER_ID, width_px: 1200, height_px: 900,
        byte_size: 500_000, sha256: 'c'.repeat(64), mime_type: 'image/jpeg',
      },
      thumbnail: {
        media_object_id: SECOND_THUMBNAIL_ID, width_px: 640, height_px: 480,
        byte_size: 80_000, sha256: 'd'.repeat(64), mime_type: 'image/jpeg',
      },
    });
    mockRpc.mockResolvedValueOnce({ data: [metadata(), second], error: null });
    mockCreateSignedUrls.mockImplementation(async (paths: string[]) => ({
      data: paths.map((path) => ({ path, signedUrl: `https://media.test/${path}` })),
      error: null,
    }));

    const result = await fetchRecordsResultFromDB(COUPLE_ID);

    if (!result.ok) throw new Error('record fetch failed');
    expect(result.records[0].attachments?.map((attachment) => ({
      name: attachment.name,
      master: attachment.photoRendition?.screenMaster.mediaObjectId,
      thumbnail: attachment.photoRendition?.thumbnail.mediaObjectId,
    }))).toEqual([
      { name: 'second.jpg', master: SECOND_MASTER_ID, thumbnail: SECOND_THUMBNAIL_ID },
      { name: 'first.jpg', master: MASTER_ID, thumbnail: THUMBNAIL_ID },
    ]);
  });

  it.each([
    {
      code: 'PGRST202',
      message: 'Could not find the function public.get_record_photo_metadata(p_record_ids) in the schema cache',
    },
    { code: '42883', message: 'function public.get_record_photo_metadata(uuid[]) does not exist' },
  ])('uses the legacy master path only for a confirmed missing 090 RPC: %j', async (error) => {
    installRecordPage();
    mockRpc.mockResolvedValueOnce({ data: null, error });
    mockCreateSignedUrls.mockResolvedValueOnce({
      data: [{ path: masterPath, signedUrl: `https://media.test/${masterPath}` }],
      error: null,
    });

    const result = await fetchRecordsResultFromDB(COUPLE_ID);

    expect(result).toMatchObject({ ok: true, records: [{ attachments: [{ path: masterPath }] }] });
    if (!result.ok) throw new Error('record fetch failed');
    expect(result).not.toHaveProperty('mediaUnavailable');
    expect(result.records[0].attachments?.[0]).not.toHaveProperty('photoRendition');
  });

  it('reports a metadata permission denial and does not retain a thumbnail', async () => {
    installRecordPage();
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    });
    mockCreateSignedUrls.mockResolvedValueOnce({
      data: [{ path: masterPath, signedUrl: `https://media.test/${masterPath}` }],
      error: null,
    });

    const result = await fetchRecordsResultFromDB(COUPLE_ID);

    expect(result).toMatchObject({ ok: true, mediaUnavailable: 'forbidden' });
    if (!result.ok) throw new Error('record fetch failed');
    expect(result.records[0].attachments?.[0]).toMatchObject({
      path: masterPath,
      urlUnavailable: 'forbidden',
      photoMetadataUnavailable: 'forbidden',
    });
    expect(result.records[0].attachments?.[0]).not.toHaveProperty('url');
    expect(result.records[0].attachments?.[0]).not.toHaveProperty('photoRendition');
    expect(mockCreateSignedUrls).not.toHaveBeenCalled();
  });

  it('blocks an eligible master when the authoritative metadata response omits its row', async () => {
    installRecordPage();
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    mockCreateSignedUrls.mockResolvedValueOnce({
      data: [{ path: masterPath, signedUrl: `https://media.test/${masterPath}` }],
      error: null,
    });

    const result = await fetchRecordsResultFromDB(COUPLE_ID);

    expect(result).toMatchObject({ ok: true, mediaUnavailable: 'forbidden' });
    if (!result.ok) throw new Error('record fetch failed');
    expect(result.records[0].attachments?.[0]).toMatchObject({
      path: masterPath,
      urlUnavailable: 'forbidden',
      photoMetadataUnavailable: 'forbidden',
    });
    expect(result.records[0].attachments?.[0]).not.toHaveProperty('url');
    expect(mockCreateSignedUrls).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: 'PGRST301', message: 'JWT expired' }, 'auth_expired'],
    [{ status: 503, message: 'service unavailable' }, 'server'],
  ] as const)('blocks eligible master signing after authoritative metadata failure: %j', async (error, reason) => {
    installRecordPage();
    mockRpc.mockResolvedValueOnce({ data: null, error });
    mockCreateSignedUrls.mockResolvedValueOnce({
      data: [{ path: masterPath, signedUrl: `https://media.test/${masterPath}` }],
      error: null,
    });

    const result = await fetchRecordsResultFromDB(COUPLE_ID);

    expect(result).toMatchObject({ ok: true, mediaUnavailable: reason });
    if (!result.ok) throw new Error('record fetch failed');
    expect(result.records[0].attachments?.[0]).toMatchObject({
      urlUnavailable: reason,
      photoMetadataUnavailable: reason,
    });
    expect(result.records[0].attachments?.[0]).not.toHaveProperty('url');
    expect(mockCreateSignedUrls).not.toHaveBeenCalled();
  });

  it('carries a thrown metadata transport failure as an authority block', async () => {
    installRecordPage();
    mockRpc.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    mockCreateSignedUrls.mockResolvedValueOnce({
      data: [{ path: masterPath, signedUrl: `https://media.test/${masterPath}` }],
      error: null,
    });

    const result = await fetchRecordsResultFromDB(COUPLE_ID);

    expect(result).toMatchObject({ ok: true, mediaUnavailable: 'unreachable' });
    if (!result.ok) throw new Error('record fetch failed');
    expect(result.records[0].attachments?.[0]).toMatchObject({
      path: masterPath,
      urlUnavailable: 'unreachable',
      photoMetadataUnavailable: 'unreachable',
    });
    expect(result.records[0].attachments?.[0]).not.toHaveProperty('url');
    expect(mockCreateSignedUrls).not.toHaveBeenCalled();
  });

  it.each([
    {
      code: 'PGRST202',
      message: 'Could not find the function public.get_record_photo_metadata(other_ids) in the schema cache',
    },
    {
      code: 'PGRST202',
      message: 'Could not find the function public.get_record_photo_metadata(uuid[]) in the schema cache',
    },
    {
      code: 'PGRST202',
      message: 'Could not find the function public.other_rpc(p_record_ids) in the schema cache',
    },
    { code: '42883', message: 'function public.get_record_photo_metadata(text[]) does not exist' },
    { code: '42883', message: 'function public.other_rpc(uuid[]) does not exist' },
  ])('does not treat another function or signature as the missing photo metadata RPC: %j', async (error) => {
    installRecordPage();
    mockRpc.mockResolvedValueOnce({ data: null, error });
    mockCreateSignedUrls.mockResolvedValueOnce({
      data: [{ path: masterPath, signedUrl: `https://media.test/${masterPath}` }],
      error: null,
    });

    const result = await fetchRecordsResultFromDB(COUPLE_ID);

    expect(result).toMatchObject({ ok: true, mediaUnavailable: 'server' });
    if (!result.ok) throw new Error('record fetch failed');
    expect(result.records[0].attachments?.[0]).toMatchObject({
      urlUnavailable: 'server',
      photoMetadataUnavailable: 'server',
    });
    expect(result.records[0].attachments?.[0]).not.toHaveProperty('url');
    expect(mockCreateSignedUrls).not.toHaveBeenCalled();
  });

  it.each([
    [metadata(), metadata()],
    [metadata({ record_id: '99999999-9999-4999-8999-999999999999' })],
    [metadata({ thumbnail: { media_object_id: THUMBNAIL_ID, width_px: 641, height_px: 480,
      byte_size: 90_000, sha256: 'b'.repeat(64), mime_type: 'image/jpeg' } })],
    [metadata({ screen_master: { media_object_id: MASTER_ID, width_px: '2048', height_px: 1536,
      byte_size: 900_000, sha256: 'a'.repeat(64), mime_type: 'image/jpeg' } })],
  ])('rejects duplicate, cross-record, or malformed metadata as an unavailable enrichment', async (rpcData) => {
    installRecordPage();
    mockRpc.mockResolvedValueOnce({ data: rpcData, error: null });
    mockCreateSignedUrls.mockResolvedValueOnce({
      data: [{ path: masterPath, signedUrl: `https://media.test/${masterPath}` }],
      error: null,
    });

    const result = await fetchRecordsResultFromDB(COUPLE_ID);

    expect(result).toMatchObject({ ok: true, mediaUnavailable: 'server' });
    if (!result.ok) throw new Error('record fetch failed');
    expect(result.records[0].attachments?.[0]).toMatchObject({
      urlUnavailable: 'server',
      photoMetadataUnavailable: 'server',
    });
    expect(result.records[0].attachments?.[0]).not.toHaveProperty('url');
    expect(result.records[0].attachments?.[0]).not.toHaveProperty('photoRendition');
    expect(mockCreateSignedUrls).not.toHaveBeenCalled();
  });

  it.each([
    'auth_expired',
    'forbidden',
    'not_found',
    'offline',
    'unreachable',
    'server',
    'unknown',
  ] as const)('never signs a master carrying a metadata authority block: %s', async (reason) => {
    const blocked = {
      type: 'photo' as const,
      name: 'photo.jpg',
      path: masterPath,
      url: 'https://media.test/stale-master.jpg',
      urlUnavailable: reason,
      photoMetadataUnavailable: reason,
    };
    mockCreateSignedUrls.mockResolvedValueOnce({
      data: [{ path: masterPath, signedUrl: 'https://media.test/signer-would-succeed.jpg' }],
      error: null,
    });

    await expect(resolveAttachmentUrls([blocked], COUPLE_ID, RECORD_ID)).resolves.toEqual([{
      type: 'photo',
      name: 'photo.jpg',
      path: masterPath,
      urlUnavailable: reason,
      photoMetadataUnavailable: reason,
    }]);
    expect(mockCreateSignedUrls).not.toHaveBeenCalled();
  });

  it.each(['master', 'thumbnail', 'cross-role'] as const)(
    'rejects a %s media UUID collision across metadata batches and records',
    async (collision) => {
      const uuid = (seed: number) => {
        const head = seed.toString(16).padStart(8, '0');
        const tail = seed.toString(16).padStart(12, '0');
        return `${head}-0000-4000-8000-${tail}`;
      };
      const rows = Array.from({ length: 101 }, (_, index) => {
        const recordId = uuid(index + 1);
        const masterId = uuid(index + 1_001);
        const thumbnailId = uuid(index + 2_001);
        return {
          record_id: recordId,
          media_id: masterId,
          source_revision: uuid(index + 3_001),
          screen_master: {
            media_object_id: masterId,
            width_px: 2048,
            height_px: 1536,
            byte_size: 900_000,
            sha256: 'a'.repeat(64),
            mime_type: 'image/jpeg',
          },
          thumbnail: {
            media_object_id: thumbnailId,
            width_px: 640,
            height_px: 480,
            byte_size: 90_000,
            sha256: 'b'.repeat(64),
            mime_type: 'image/jpeg',
          },
        };
      });
      const first = rows[0];
      const last = rows.at(-1)!;
      if (collision === 'master') {
        last.media_id = first.media_id;
        last.screen_master.media_object_id = first.screen_master.media_object_id;
      } else if (collision === 'thumbnail') {
        last.thumbnail.media_object_id = first.thumbnail.media_object_id;
      } else {
        last.media_id = first.thumbnail.media_object_id;
        last.screen_master.media_object_id = first.thumbnail.media_object_id;
      }

      let pageIndex = 0;
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        or: vi.fn(() => builder),
        order: vi.fn(() => builder),
        limit: vi.fn(async () => pageIndex++ === 0
          ? {
              data: rows.map((item) => ({
                id: item.record_id,
                user_id: '22222222-2222-4222-8222-222222222222',
                record_date: '2026-09-05',
                record_time: '09:07:33',
                log_text: '사진 기록',
                attachments: [{
                  type: 'photo',
                  name: 'photo.jpg',
                  path: `${COUPLE_ID}/${item.record_id}/${item.screen_master.media_object_id}.jpg`,
                }],
                is_private: false,
                created_at: `2026-09-05T00:07:${String(item.record_id).slice(0, 2)}.000000Z`,
                content_revision: 9,
                media_contract_version: 1,
                last_media_operation_id: item.source_revision,
                cipher_format: 0,
              })),
              error: null,
            }
          : { data: [], error: null }),
      };
      mockFrom.mockReturnValue(builder);
      mockRpc
        .mockResolvedValueOnce({ data: rows.slice(0, 100), error: null })
        .mockResolvedValueOnce({ data: rows.slice(100), error: null });
      mockCreateSignedUrls.mockImplementation(async (paths: string[]) => ({
        data: paths.map((path) => ({ path, signedUrl: `https://media.test/${path}` })),
        error: null,
      }));

      const result = await fetchRecordsResultFromDB(COUPLE_ID);

      expect(result).toMatchObject({ ok: true, mediaUnavailable: 'server' });
      if (!result.ok) throw new Error('record fetch failed');
      expect(result.records.every((record) =>
        record.attachments?.[0]?.photoMetadataUnavailable === 'server')).toBe(true);
      expect(mockCreateSignedUrls).not.toHaveBeenCalled();
    },
  );

  it('does not request plaintext thumbnail metadata for an encrypted record', async () => {
    installRecordPage(undefined, { cipher_format: 1, content_envelope: '\\x00' });
    mockCreateSignedUrls.mockResolvedValueOnce({
      data: [{ path: masterPath, signedUrl: `https://media.test/${masterPath}` }],
      error: null,
    });

    const result = await fetchRecordsResultFromDB(COUPLE_ID);

    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockCreateSignedUrls).toHaveBeenCalledWith([masterPath], 3600);
    expect(result).toMatchObject({
      ok: true,
      records: [{ attachments: [{ path: masterPath, url: `https://media.test/${masterPath}` }] }],
    });
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
  async function prepareUploadFixture() {
    const close = vi.fn();
    const decode = vi.fn(async () => ({ width: 4032, height: 3024, close }));
    vi.stubGlobal('createImageBitmap', decode);
    const context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as never);
    const encode = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementationOnce((callback) => callback(new Blob(['master bytes'], { type: 'image/jpeg' })))
      .mockImplementationOnce((callback) => callback(new Blob(['thumbnail bytes'], { type: 'image/jpeg' })));
    try {
      const original = new File(['EXIF device source'], 'private-original.heic', { type: 'image/heic' });
      const result = await prepareRecordPhotoRenditions(original);
      if ('error' in result) throw new Error(result.error);
      expect(decode).toHaveBeenCalledExactlyOnceWith(original, { imageOrientation: 'from-image' });
      expect(close).toHaveBeenCalledOnce();
      expect(context.fillStyle).toBe('#ffffff');
      expect(context.drawImage.mock.calls.map((call) => call.slice(3))).toEqual([[2048, 1536], [640, 480]]);
      expect(encode).toHaveBeenCalledTimes(2);
      expect(encode.mock.calls.map((call) => call.slice(1))).toEqual([['image/jpeg', 0.84], ['image/jpeg', 0.84]]);
      return result;
    } finally { vi.unstubAllGlobals(); }
  }
  const request = {
    operationId: '40000000-0000-4000-8000-000000000001',
    recordId: '20000000-0000-4000-8000-000000000001',
    userId: '10000000-0000-4000-8000-000000000001',
    coupleId: '30000000-0000-4000-8000-000000000001',
    baseContentRevision: 7,
    existingPaths: ['30000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000001/old.jpg'],
    newMediaIds: ['50000000-0000-4000-8000-000000000001'],
  };

  it('detects the optional photo API with a read-only empty metadata request', async () => {
    mockRpc.mockResolvedValueOnce({ data: [], error: null });

    await expect(getRecordPhotoRenditionCapability()).resolves.toEqual({
      ok: true,
      supported: true,
    });
    expect(mockRpc).toHaveBeenCalledWith('get_record_photo_metadata', {
      p_record_ids: [],
    });
  });

  it.each([
    {
      code: 'PGRST202',
      message: 'Could not find the function public.get_record_photo_metadata(p_record_ids) in the schema cache',
    },
    { code: '42883', message: 'function public.get_record_photo_metadata(uuid[]) does not exist' },
  ])(
    'allows legacy fallback only for a confirmed missing photo RPC: $code',
    async (error) => {
      mockRpc.mockResolvedValueOnce({ data: null, error });

      await expect(getRecordPhotoRenditionCapability()).resolves.toEqual({
        ok: true,
        supported: false,
      });
    },
  );

  it('does not call an authentication failure an unsupported photo API', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST301', message: 'JWT expired' },
    });

    await expect(getRecordPhotoRenditionCapability()).resolves.toEqual({
      ok: false,
      reason: 'auth_expired',
    });
  });

  it.each([
    {
      code: 'PGRST202',
      message: 'Could not find the function public.get_record_photo_metadata(other_ids) in the schema cache',
    },
    {
      code: 'PGRST202',
      message: 'Could not find the function public.get_record_photo_metadata(uuid[]) in the schema cache',
    },
    { code: 'PGRST202', message: 'Could not find the function public.other_rpc(p_record_ids) in the schema cache' },
    { code: '42883', message: 'operator does not exist: uuid = text' },
    { code: '42883', message: 'function public.get_record_photo_metadata(text[]) does not exist' },
    { code: '42883', message: 'function public.internal_helper(uuid) does not exist' },
    { code: '42883' },
    { status: 500, message: 'internal server error' },
    { code: '42501', message: 'permission denied' },
  ])('never falls back for internal SQL or authorization failures: %j', async (error) => {
    mockRpc.mockResolvedValueOnce({ data: null, error });
    expect(await getRecordPhotoRenditionCapability()).toMatchObject({ ok: false });
  });

  it('rejects malformed successful capability responses', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await getRecordPhotoRenditionCapability()).toEqual({ ok: false, reason: 'server' });
  });

  it('reports thrown capability transport errors without fallback', async () => {
    mockRpc.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await getRecordPhotoRenditionCapability()).toEqual({ ok: false, reason: 'unreachable' });
  });

  it('bounds a capability request without treating a timeout as missing schema', async () => {
    vi.useFakeTimers();
    try {
      mockRpc.mockImplementationOnce(() => new Promise(() => {}));
      const pending = getRecordPhotoRenditionCapability();
      await vi.advanceTimersByTimeAsync(10_001);
      await expect(pending).resolves.toEqual({ ok: false, reason: 'unreachable' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('begins a paired photo mutation with exact frozen descriptors', async () => {
    const screenMaster = {
      mediaObjectId: '50000000-0000-4000-8000-000000000001',
      widthPx: 2048,
      heightPx: 1536,
      byteSize: 12,
      sha256: 'a'.repeat(64),
    };
    const thumbnail = {
      mediaObjectId: '60000000-0000-4000-8000-000000000001',
      widthPx: 640,
      heightPx: 480,
      byteSize: 6,
      sha256: 'b'.repeat(64),
    };
    mockRpc.mockResolvedValueOnce({
      data: {
        operation_id: request.operationId,
        state: 'pending',
        target_content_revision: 8,
      },
      error: null,
    });

    await expect(beginRecordPhotoMutation({
      ...request,
      newPhotos: [{ screenMaster, thumbnail }],
    })).resolves.toEqual({ ok: true, state: 'pending', targetContentRevision: 8 });
    expect(mockRpc).toHaveBeenCalledWith('begin_record_photo_mutation', {
      p_operation_id: request.operationId,
      p_record_id: request.recordId,
      p_expected_user_id: request.userId,
      p_expected_couple_id: request.coupleId,
      p_base_content_revision: 7,
      p_target_content_revision: 8,
      p_existing_paths: request.existingPaths,
      p_new_photos: [{
        screen_master: {
          media_object_id: screenMaster.mediaObjectId,
          width_px: 2048,
          height_px: 1536,
          byte_size: 12,
          sha256: 'a'.repeat(64),
        },
        thumbnail: {
          media_object_id: thumbnail.mediaObjectId,
          width_px: 640,
          height_px: 480,
          byte_size: 6,
          sha256: 'b'.repeat(64),
        },
      }],
    });
  });

  it('uploads the exact prepared JPEG object without re-encoding or overwrite', async () => {
    const { screenMaster: rendition, thumbnail } = await prepareUploadFixture();
    const file = rendition.file;
    expect(rendition).toMatchObject({ widthPx: 2048, heightPx: 1536, byteSize: 12,
      sha256: '33818390754e7425958f424be2c6cdaf53a38b3bb2912350076b5199ca33dea5' });
    expect(thumbnail).toMatchObject({ widthPx: 640, heightPx: 480, byteSize: 15,
      sha256: 'a16b688dbc3288e0902299c13c944a5f05fc3038c960a86ccf7f33502c903091' });
    mockStorageUpload.mockResolvedValueOnce({ error: null });

    await expect(uploadRecordPhotoRendition(
      rendition,
      'screen_master',
      request.coupleId,
      request.recordId,
      request.newMediaIds[0],
    )).resolves.toEqual({
      attachment: {
        type: 'photo',
        name: 'photo.jpg',
        path: `${request.coupleId}/${request.recordId}/${request.newMediaIds[0]}.jpg`,
      },
    });
    expect(mockStorageUpload).toHaveBeenCalledWith(
      `${request.coupleId}/${request.recordId}/${request.newMediaIds[0]}.jpg`,
      file,
      { contentType: 'image/jpeg', upsert: false },
    );
    expect(mockStorageUpload.mock.calls[0][1]).toBe(file);
    mockStorageUpload.mockResolvedValueOnce({ error: null });
    await uploadRecordPhotoRendition(thumbnail, 'thumbnail', request.coupleId, request.recordId,
      '60000000-0000-4000-8000-000000000001');
    expect(mockStorageUpload.mock.calls[1][1]).toBe(thumbnail.file);
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledTimes(2);
    expect(Object.isFrozen(rendition)).toBe(true);
  });

  it('rejects an original JPEG disguised as a prepared rendition before Storage', async () => {
    const forged: PreparedRecordPhotoRendition = {
      file: new File(['private EXIF original'], 'photo.jpg', { type: 'image/jpeg' }),
      widthPx: 800, heightPx: 600, byteSize: 21, sha256: 'a'.repeat(64),
    };
    expect(await uploadRecordPhotoRendition(forged, 'screen_master', request.coupleId,
      request.recordId, request.newMediaIds[0])).toHaveProperty('error');
    expect(mockStorageUpload).not.toHaveBeenCalled();
  });

  it('carries a thrown upload transport failure to authoritative CAS with its exact reserved path', async () => {
    const { thumbnail } = await prepareUploadFixture();
    mockStorageUpload.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(uploadRecordPhotoRendition(thumbnail, 'thumbnail', request.coupleId,
      request.recordId, request.newMediaIds[0])).resolves.toMatchObject({
      reason: 'unreachable',
      uncertainAttachment: { path: `${request.coupleId}/${request.recordId}/${request.newMediaIds[0]}.jpg` },
    });
    expect(mockStorageUpload).toHaveBeenCalledOnce();
  });

  it('preserves missing new begin as a failed operation without issuing legacy begin', async () => {
    mockRpc.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(beginRecordPhotoMutation({ ...request, newPhotos: [] })).resolves.toEqual({ ok: false, reason: 'unreachable' });
    expect(mockRpc).toHaveBeenCalledOnce();
    expect(mockRpc.mock.calls[0][0]).toBe('begin_record_photo_mutation');
  });

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

  it('never persists transient thumbnail enrichment or signed URLs', async () => {
    const insert = mockUpsert(null);
    await saveRecordToDB({
      ...record,
      attachments: [{
        type: 'photo',
        name: 'photo.jpg',
        path: 'couple-001/rec-001/33333333-3333-4333-8333-333333333333.jpg',
        url: 'https://media.test/master-signed',
        photoMetadataUnavailable: 'server',
        photoRendition: {
          sourceRevision: '55555555-5555-4555-8555-555555555555',
          screenMaster: {
            mediaObjectId: '33333333-3333-4333-8333-333333333333',
            widthPx: 2048, heightPx: 1536, byteSize: 900_000,
            sha256: 'a'.repeat(64), mimeType: 'image/jpeg',
          },
          thumbnail: {
            mediaObjectId: '44444444-4444-4444-8444-444444444444',
            widthPx: 640, heightPx: 480, byteSize: 90_000,
            sha256: 'b'.repeat(64), mimeType: 'image/jpeg',
            path: 'couple-001/rec-001/44444444-4444-4444-8444-444444444444.jpg',
            url: 'https://media.test/thumbnail-signed',
          },
        },
      }],
    }, 'couple-001', 'user-001');

    expect((insert.mock.calls[0][0] as { attachments: unknown[] }).attachments).toEqual([{
      type: 'photo',
      name: 'photo.jpg',
      path: 'couple-001/rec-001/33333333-3333-4333-8333-333333333333.jpg',
    }]);
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
