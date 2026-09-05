import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * M-2 and M-4: the two ways `records.ts` used to lie about media.
 *
 * M-2 -- `uploadRecordMedia()` held the real Storage error and returned a fixed
 * '파일을 올리지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.'. `classifyServerError`
 * was already imported in the file and used twice elsewhere, so an RLS rejection
 * on the storage INSERT policy, a 413 on an oversized object and an expired JWT
 * were all reported as a connection problem the user could not fix by checking
 * their connection.
 *
 * M-4 -- when `createSignedUrls()` failed, `signValidatedAttachments()` logged
 * and returned the attachments with no `url`, and `fetchRecordsResultFromDB()`
 * still answered `{ ok: true, records }`. The record loaded "successfully" with
 * media that could not render and nothing anywhere saying why. The fix must keep
 * the record readable -- a signing failure is not a reason to lose a diary entry
 * -- while making the attachment state honest.
 */

const { mockFrom, mockUpload, mockCreateSignedUrls, mockSupabase, mockSanitizePhoto } = vi.hoisted(() => {
  const mockFrom = vi.fn();
  const mockUpload = vi.fn();
  const mockCreateSignedUrls = vi.fn();
  const mockSanitizePhoto = vi.fn();
  const mockSupabase = {
    from: mockFrom,
    storage: {
      from: () => ({
        upload: mockUpload,
        createSignedUrls: mockCreateSignedUrls,
        remove: vi.fn(async () => ({ error: null })),
      }),
    },
  };
  return { mockFrom, mockUpload, mockCreateSignedUrls, mockSupabase, mockSanitizePhoto };
});

vi.mock('@/lib/supabase', () => ({
  supabase: mockSupabase,
  isSupabaseConfigured: true,
}));

vi.mock('@/lib/imageSanitization', () => ({
  sanitizePhotoForUpload: mockSanitizePhoto,
}));

import { uploadRecordMedia, fetchRecordsResultFromDB } from '@/lib/records';
import { serverErrorMessage } from '@/lib/serverErrors';

const COUPLE_ID = '11111111-1111-4111-8111-111111111111';
const RECORD_ID = '22222222-2222-4222-8222-222222222222';
const STABLE_OBJECT_ID = '33333333-3333-4333-8333-333333333333';

function pngFile(): File {
  return new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' });
}

// ---------------------------------------------------------------------------
// M-2: upload failure
// ---------------------------------------------------------------------------

describe('M-2: uploadRecordMedia classifies the Storage error it is holding', () => {
  beforeEach(() => {
    mockUpload.mockReset();
    mockSanitizePhoto.mockReset().mockImplementation(async (file: File) => ({
      file: new File([file], 'photo.jpg', { type: 'image/jpeg' }),
      ext: 'jpg',
    }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  async function errorFor(storageError: unknown): Promise<string> {
    mockUpload.mockResolvedValue({ error: storageError });
    const result = await uploadRecordMedia(pngFile(), COUPLE_ID, RECORD_ID);
    expect(result).toHaveProperty('error');
    return (result as { error: string }).error;
  }

  it('reports an RLS rejection as a permission problem, not a connection one', async () => {
    const message = await errorFor({ code: '42501', message: 'row-level security' });
    expect(message).toBe(`파일을 올리지 못했어요. ${serverErrorMessage('forbidden')}`);
    expect(message).toContain('권한이 없어요');
    // The classified answer names the COUPLE link, which is the real cause of a
    // 42501 here. What it must never do is send the user to check the network.
    expect(message).not.toContain('인터넷 연결');
    expect(message).not.toBe('파일을 올리지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.');
  });

  it('reports an expired session as an expired session', async () => {
    const message = await errorFor({ code: 'PGRST301', message: 'JWT expired' });
    expect(message).toBe(`파일을 올리지 못했어요. ${serverErrorMessage('auth_expired')}`);
    expect(message).toContain('다시 로그인해 주세요');
    expect(message).not.toContain('연결 상태');
  });

  it('does not blame the connection for a 413', async () => {
    const message = await errorFor({ status: 413, message: 'Payload too large' });
    expect(message).not.toContain('연결 상태');
    expect(message).not.toContain('인터넷 연결');
  });

  it('reports a server failure as a server failure', async () => {
    const message = await errorFor({ status: 500, message: 'boom' });
    expect(message).toBe(`파일을 올리지 못했어요. ${serverErrorMessage('server')}`);
  });

  it.each([
    [{ code: '42501', message: 'rls' }, 'forbidden'],
    [{ code: 'PGRST301', message: 'JWT expired' }, 'auth_expired'],
    [{ status: 500, message: 'boom' }, 'server'],
    [new TypeError('Failed to fetch'), 'unreachable'],
  ])('preserves the classified cause for durable replay: %#', async (storageError, reason) => {
    mockUpload.mockResolvedValue({ error: storageError });
    const result = await uploadRecordMedia(pngFile(), COUPLE_ID, RECORD_ID);
    expect(result).toMatchObject({ reason });
  });

  it('gives these four causes more than one distinct message', async () => {
    // The defect was that all of them produced the SAME sentence.
    const messages = new Set([
      await errorFor({ code: '42501', message: 'rls' }),
      await errorFor({ code: 'PGRST301', message: 'JWT expired' }),
      await errorFor({ status: 500, message: 'boom' }),
      await errorFor({ status: 413, message: 'too large' }),
    ]);
    expect(messages.size).toBeGreaterThan(1);
  });

  it('PRESERVATION: a successful upload still returns the attachment', async () => {
    mockUpload.mockResolvedValue({ error: null });
    const result = await uploadRecordMedia(pngFile(), COUPLE_ID, RECORD_ID, '내 사진');
    expect(result).not.toHaveProperty('error');
    const { attachment } = result as { attachment: { type: string; name: string; path: string } };
    expect(attachment.type).toBe('photo');
    expect(attachment.name).toBe('내 사진');
    expect(attachment.path.startsWith(`${COUPLE_ID}/${RECORD_ID}/`)).toBe(true);
    expect(attachment.path.endsWith('.jpg')).toBe(true);
    expect(mockUpload).toHaveBeenCalledWith(
      attachment.path,
      expect.objectContaining({ name: 'photo.jpg', type: 'image/jpeg' }),
      { contentType: 'image/jpeg', upsert: false },
    );
  });

  it('does not persist the device source filename when no explicit display name was chosen', async () => {
    mockUpload.mockResolvedValue({ error: null });

    const result = await uploadRecordMedia(pngFile(), COUPLE_ID, RECORD_ID);

    expect(result).not.toHaveProperty('error');
    const { attachment } = result as { attachment: { name: string } };
    expect(attachment.name).toBe('photo.jpg');
    expect(attachment.name).not.toBe('photo.png');
  });

  it('reuses the exact durable object id supplied by an outbox replay', async () => {
    mockUpload.mockResolvedValue({ error: null });

    const result = await uploadRecordMedia(
      pngFile(),
      COUPLE_ID,
      RECORD_ID,
      undefined,
      STABLE_OBJECT_ID,
    );

    expect(result).toEqual({
      attachment: {
        type: 'photo',
        name: 'photo.jpg',
        path: `${COUPLE_ID}/${RECORD_ID}/${STABLE_OBJECT_ID}.jpg`,
      },
    });
    expect(mockUpload).toHaveBeenCalledWith(
      `${COUPLE_ID}/${RECORD_ID}/${STABLE_OBJECT_ID}.jpg`,
      expect.objectContaining({ name: 'photo.jpg', type: 'image/jpeg' }),
      { contentType: 'image/jpeg', upsert: false },
    );
  });

  it('reconciles a duplicate stable object after a lost upload response', async () => {
    mockUpload.mockResolvedValue({
      error: { statusCode: 409, code: 'Duplicate', message: 'The resource already exists' },
    });

    const result = await uploadRecordMedia(
      pngFile(),
      COUPLE_ID,
      RECORD_ID,
      undefined,
      STABLE_OBJECT_ID,
    );

    expect(result).toEqual({
      attachment: {
        type: 'photo',
        name: 'photo.jpg',
        path: `${COUPLE_ID}/${RECORD_ID}/${STABLE_OBJECT_ID}.jpg`,
      },
    });
  });

  it('returns the exact candidate attachment when a stable upload response is ambiguous', async () => {
    mockUpload.mockResolvedValue({ error: new TypeError('Failed to fetch') });

    const result = await uploadRecordMedia(
      pngFile(),
      COUPLE_ID,
      RECORD_ID,
      undefined,
      STABLE_OBJECT_ID,
    );

    expect(result).toMatchObject({
      reason: 'unreachable',
      uncertainAttachment: {
        type: 'photo',
        name: 'photo.jpg',
        path: `${COUPLE_ID}/${RECORD_ID}/${STABLE_OBJECT_ID}.jpg`,
      },
    });
  });

  it('rejects a malformed stable object id before touching Storage', async () => {
    const result = await uploadRecordMedia(
      pngFile(),
      COUPLE_ID,
      RECORD_ID,
      undefined,
      '../not-an-object-id',
    );

    expect(result).toEqual({
      error: '첨부 파일 식별자가 올바르지 않아 업로드하지 않았어요.',
      reason: 'unknown',
    });
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockSanitizePhoto).not.toHaveBeenCalled();
  });

  it('never uploads the original when privacy sanitization fails', async () => {
    mockSanitizePhoto.mockResolvedValueOnce({ error: '사진을 안전하게 처리하지 못했어요.' });

    const result = await uploadRecordMedia(pngFile(), COUPLE_ID, RECORD_ID);

    expect(result).toEqual({ error: '사진을 안전하게 처리하지 못했어요.', reason: 'unknown' });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('PRESERVATION: local validation failures keep their own specific copy', async () => {
    const tooBig = new File([new Uint8Array(1)], 'big.png', { type: 'image/png' });
    Object.defineProperty(tooBig, 'size', { value: 999 * 1024 * 1024 });
    const result = await uploadRecordMedia(tooBig, COUPLE_ID, RECORD_ID);
    expect((result as { error: string }).error).toContain('파일이 너무 커요');
    // Rejected before any request was issued.
    expect(mockUpload).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// M-4: signing failure
// ---------------------------------------------------------------------------

const attachmentRow = {
  type: 'photo',
  name: 'photo.png',
  path: `${COUPLE_ID}/${RECORD_ID}/a.png`,
};

function mockRecordPages(pages: Array<{ data: unknown[] | null; error: unknown }>) {
  let pageIndex = 0;
  mockFrom.mockReset();
  mockFrom.mockImplementation(() => {
    const page = pages[pageIndex++] ?? { data: [], error: null };
    const builder = {
      select: () => builder,
      eq: () => builder,
      or: () => builder,
      order: () => builder,
      limit: async () => page,
    };
    return builder;
  });
}

function mockRecordRows(attachments = [attachmentRow]) {
  mockRecordPages([
    {
      data: [
        {
          id: RECORD_ID,
          record_date: '2026-03-01',
          record_time: '10:00',
          log_text: '오늘의 기록',
          reaction: null,
          attachments,
          is_private: false,
          emotion_flow: [],
          emotion_updated_at: null,
          created_at: '2026-03-01T10:00:00.123456Z',
          user_id: '44444444-4444-4444-8444-444444444444',
        },
      ],
      error: null,
    },
    { data: [], error: null },
  ]);
}

describe('M-4: a media-signing failure is surfaced instead of passing silently', () => {
  beforeEach(() => {
    mockCreateSignedUrls.mockReset();
    mockRecordRows();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('still returns the record, so a signing failure is not data loss', async () => {
    mockCreateSignedUrls.mockResolvedValue({ data: null, error: { code: '42501', message: 'rls' } });
    const result = await fetchRecordsResultFromDB(COUPLE_ID);
    expect(result.ok).toBe(true);
    expect(result.records).toHaveLength(1);
    expect(result.records[0].log).toBe('오늘의 기록');
  });

  it('no longer claims everything is fine: the result names the cause', async () => {
    mockCreateSignedUrls.mockResolvedValue({ data: null, error: { code: '42501', message: 'rls' } });
    const result = await fetchRecordsResultFromDB(COUPLE_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.mediaUnavailable).toBe('forbidden');
  });

  it('marks the affected attachment rather than leaving it indistinguishably bare', async () => {
    mockCreateSignedUrls.mockResolvedValue({ data: null, error: { status: 500, message: 'boom' } });
    const result = await fetchRecordsResultFromDB(COUPLE_ID);
    if (!result.ok) throw new Error('expected ok');
    const attachment = result.records[0].attachments![0];
    expect(attachment.url).toBeUndefined();
    // This is the whole point: "no url" now carries a reason.
    expect(attachment.urlUnavailable).toBe('server');
    expect(result.mediaUnavailable).toBe('server');
  });

  it('keeps text records readable when the Storage client rejects instead of returning an error', async () => {
    mockCreateSignedUrls.mockRejectedValueOnce(new TypeError('malformed Storage response'));

    const result = await fetchRecordsResultFromDB(COUPLE_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected records to remain readable');
    expect(result.records[0].log).toBe('오늘의 기록');
    expect(result.records[0].attachments![0]).toMatchObject({
      ...attachmentRow,
      urlUnavailable: 'unknown',
    });
    expect(result.records[0].attachments![0].url).toBeUndefined();
    expect(result.mediaUnavailable).toBe('unknown');
  });

  it('classifies an expired session on the signing call as such', async () => {
    mockCreateSignedUrls.mockResolvedValue({
      data: null,
      error: { code: 'PGRST301', message: 'JWT expired' },
    });
    const result = await fetchRecordsResultFromDB(COUPLE_ID);
    if (!result.ok) throw new Error('expected ok');
    expect(result.mediaUnavailable).toBe('auth_expired');
    expect(result.records[0].attachments![0].urlUnavailable).toBe('auth_expired');
  });

  it('marks a single object withheld from an otherwise successful batch', async () => {
    // No error, but the requested path is absent from the response.
    mockCreateSignedUrls.mockResolvedValue({ data: [], error: null });
    const result = await fetchRecordsResultFromDB(COUPLE_ID);
    if (!result.ok) throw new Error('expected ok');
    expect(result.records[0].attachments![0].url).toBeUndefined();
    expect(result.records[0].attachments![0].urlUnavailable).toBe('unknown');
    expect(result.mediaUnavailable).toBe('unknown');
  });

  it.each([
    [{ status: 403, message: 'forbidden' }, 'forbidden'],
    [{ status: 500, message: 'server failed' }, 'server'],
  ])('classifies a top-level Storage response error: %#', async (error, expected) => {
    mockCreateSignedUrls.mockResolvedValue({ data: null, error });

    const result = await fetchRecordsResultFromDB(COUPLE_ID);

    if (!result.ok) throw new Error('expected records to remain readable');
    expect(result.records[0].attachments![0].urlUnavailable).toBe(expected);
    expect(result.mediaUnavailable).toBe(expected);
  });

  it.each([0, 1, 2])(
    'keeps first/middle/last per-entry authorization failures scoped to entry %i',
    async (failedIndex) => {
      const attachments = [
        { type: 'photo' as const, name: 'first.png', path: `${COUPLE_ID}/${RECORD_ID}/first.png` },
        { type: 'video' as const, name: 'middle.mp4', path: `${COUPLE_ID}/${RECORD_ID}/middle.mp4` },
        { type: 'voice' as const, name: 'last.m4a', path: `${COUPLE_ID}/${RECORD_ID}/last.m4a` },
      ];
      mockRecordRows(attachments);
      mockCreateSignedUrls.mockResolvedValue({
        data: attachments.map((attachment, index) => index === failedIndex
          ? { path: attachment.path, signedUrl: null, error: { status: 403, message: 'denied' } }
          : {
              path: attachment.path,
              signedUrl: `https://signed.example/${index}`,
              error: null,
            }),
        error: null,
      });

      const result = await fetchRecordsResultFromDB(COUPLE_ID);

      if (!result.ok) throw new Error('expected records to remain readable');
      expect(result.records[0].attachments?.map(({ type, name, path }) => ({
        type,
        name,
        path,
      }))).toEqual(attachments);
      result.records[0].attachments?.forEach((attachment, index) => {
        if (index === failedIndex) {
          expect(attachment.url).toBeUndefined();
          expect(attachment.urlUnavailable).toBe('forbidden');
        } else {
          expect(attachment.url).toBe(`https://signed.example/${index}`);
          expect(attachment.urlUnavailable).toBeUndefined();
        }
      });
    },
  );

  it('matches signed URLs by path when the response order changes', async () => {
    const attachments = [
      { type: 'photo' as const, name: 'a.png', path: `${COUPLE_ID}/${RECORD_ID}/a.png` },
      { type: 'photo' as const, name: 'b.png', path: `${COUPLE_ID}/${RECORD_ID}/b.png` },
      { type: 'photo' as const, name: 'c.png', path: `${COUPLE_ID}/${RECORD_ID}/c.png` },
    ];
    mockRecordRows(attachments);
    mockCreateSignedUrls.mockResolvedValue({
      data: [...attachments].reverse().map((attachment) => ({
        path: attachment.path,
        signedUrl: `https://signed.example/${attachment.name}`,
        error: null,
      })),
      error: null,
    });

    const result = await fetchRecordsResultFromDB(COUPLE_ID);

    if (!result.ok) throw new Error('expected records to remain readable');
    expect(result.records[0].attachments?.map((attachment) => attachment.url)).toEqual([
      'https://signed.example/a.png',
      'https://signed.example/b.png',
      'https://signed.example/c.png',
    ]);
  });

  it('preserves duplicate same-path attachment metadata and order', async () => {
    const duplicatePath = `${COUPLE_ID}/${RECORD_ID}/shared.bin`;
    const attachments = [
      { type: 'photo' as const, name: '원본 사진', path: duplicatePath },
      { type: 'video' as const, name: '같은 경로 영상 메타데이터', path: duplicatePath },
    ];
    mockRecordRows(attachments);
    mockCreateSignedUrls.mockResolvedValue({
      data: [{ path: duplicatePath, signedUrl: 'https://signed.example/shared', error: null }],
      error: null,
    });

    const result = await fetchRecordsResultFromDB(COUPLE_ID);

    if (!result.ok) throw new Error('expected records to remain readable');
    expect(result.records[0].attachments).toEqual([
      { ...attachments[0], url: 'https://signed.example/shared', urlUnavailable: undefined },
      { ...attachments[1], url: 'https://signed.example/shared', urlUnavailable: undefined },
    ]);
    expect(mockCreateSignedUrls).toHaveBeenCalledWith([duplicatePath], 60 * 60);
  });

  it('keeps mixed success, proven denial, and missing entries precise in one batch', async () => {
    const attachments = [
      { type: 'photo' as const, name: 'ok.png', path: `${COUPLE_ID}/${RECORD_ID}/ok.png` },
      { type: 'photo' as const, name: 'denied.png', path: `${COUPLE_ID}/${RECORD_ID}/denied.png` },
      { type: 'photo' as const, name: 'missing.png', path: `${COUPLE_ID}/${RECORD_ID}/missing.png` },
    ];
    mockRecordRows(attachments);
    mockCreateSignedUrls.mockResolvedValue({
      data: [
        { path: attachments[0].path, signedUrl: 'https://signed.example/ok', error: null },
        { path: attachments[1].path, signedUrl: null, error: { code: '42501' } },
      ],
      error: null,
    });

    const result = await fetchRecordsResultFromDB(COUPLE_ID);

    if (!result.ok) throw new Error('expected records to remain readable');
    expect(result.records[0].attachments).toEqual([
      { ...attachments[0], url: 'https://signed.example/ok', urlUnavailable: undefined },
      { ...attachments[1], url: undefined, urlUnavailable: 'forbidden' },
      { ...attachments[2], url: undefined, urlUnavailable: 'unknown' },
    ]);
  });

  it.each([
    ['a string-only error', { path: attachmentRow.path, signedUrl: null, error: 'denied' }, 'unknown'],
    ['a proven 403', { path: attachmentRow.path, signedUrl: null, error: { status: 403 } }, 'forbidden'],
    ['a proven 42501', { path: attachmentRow.path, signedUrl: null, error: { code: '42501' } }, 'forbidden'],
    ['an absent URL alone', { path: attachmentRow.path, signedUrl: null, error: null }, 'unknown'],
    ['a URL/error contradiction', {
      path: attachmentRow.path,
      signedUrl: 'https://signed.example/contradiction',
      error: { status: 403 },
    }, 'unknown'],
  ])('classifies %s without inventing authorization', async (_label, entry, expected) => {
    mockCreateSignedUrls.mockResolvedValue({ data: [entry], error: null });

    const result = await fetchRecordsResultFromDB(COUPLE_ID);

    if (!result.ok) throw new Error('expected records to remain readable');
    expect(result.records[0].attachments![0]).toMatchObject({
      ...attachmentRow,
      urlUnavailable: expected,
    });
    expect(result.records[0].attachments![0].url).toBeUndefined();
  });

  it('treats a null response path as unknown', async () => {
    mockCreateSignedUrls.mockResolvedValue({
      data: [{ path: null, signedUrl: 'https://signed.example/unbound', error: null }],
      error: null,
    });

    const result = await fetchRecordsResultFromDB(COUPLE_ID);

    if (!result.ok) throw new Error('expected records to remain readable');
    expect(result.records[0].attachments![0].url).toBeUndefined();
    expect(result.records[0].attachments![0].urlUnavailable).toBe('unknown');
  });

  it('ignores response entries for paths that were not requested', async () => {
    mockCreateSignedUrls.mockResolvedValue({
      data: [{
        path: `${COUPLE_ID}/${RECORD_ID}/external.png`,
        signedUrl: 'https://signed.example/external',
        error: null,
      }],
      error: null,
    });

    const result = await fetchRecordsResultFromDB(COUPLE_ID);

    if (!result.ok) throw new Error('expected records to remain readable');
    expect(result.records[0].attachments![0]).toMatchObject({
      ...attachmentRow,
      urlUnavailable: 'unknown',
    });
    expect(result.records[0].attachments![0].url).toBeUndefined();
  });

  it('PRESERVATION: a successful signing attaches the URL and flags nothing', async () => {
    mockCreateSignedUrls.mockResolvedValue({
      data: [{ path: attachmentRow.path, signedUrl: 'https://signed.example/a.png' }],
      error: null,
    });
    const result = await fetchRecordsResultFromDB(COUPLE_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.mediaUnavailable).toBeUndefined();
    const attachment = result.records[0].attachments![0];
    expect(attachment.url).toBe('https://signed.example/a.png');
    expect(attachment.urlUnavailable).toBeUndefined();
  });

  it('PRESERVATION: records with no attachments are unaffected and never sign', async () => {
    mockRecordRows([]);
    const result = await fetchRecordsResultFromDB(COUPLE_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.mediaUnavailable).toBeUndefined();
    expect(mockCreateSignedUrls).not.toHaveBeenCalled();
  });

  it('PRESERVATION: a records QUERY failure is still a hard failure', async () => {
    mockRecordPages([{ data: null, error: { code: '42501', message: 'rls' } }]);
    const result = await fetchRecordsResultFromDB(COUPLE_ID);
    expect(result.ok).toBe(false);
    expect(result.records).toEqual([]);
  });
});
