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

function mockRecordRows() {
  mockFrom.mockReset();
  mockFrom.mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        order: () => ({
          order: async () => ({
            data: [
              {
                id: RECORD_ID,
                record_date: '2026-03-01',
                record_time: '10:00',
                log_text: '오늘의 기록',
                reaction: null,
                attachments: [attachmentRow],
                is_private: false,
                emotion_flow: [],
                emotion_updated_at: null,
                created_at: '2026-03-01T10:00:00Z',
                user_id: 'user-1',
              },
            ],
            error: null,
          }),
        }),
      }),
    }),
  }));
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
    expect(result.records[0].attachments![0].urlUnavailable).toBe('forbidden');
    expect(result.mediaUnavailable).toBe('forbidden');
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
    mockFrom.mockReset();
    mockFrom.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            order: async () => ({
              data: [
                {
                  id: RECORD_ID,
                  record_date: '2026-03-01',
                  record_time: '10:00',
                  log_text: '글만 있는 기록',
                  reaction: null,
                  attachments: [],
                  is_private: false,
                  emotion_flow: [],
                  emotion_updated_at: null,
                  created_at: '2026-03-01T10:00:00Z',
                  user_id: 'user-1',
                },
              ],
              error: null,
            }),
          }),
        }),
      }),
    }));
    const result = await fetchRecordsResultFromDB(COUPLE_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.mediaUnavailable).toBeUndefined();
    expect(mockCreateSignedUrls).not.toHaveBeenCalled();
  });

  it('PRESERVATION: a records QUERY failure is still a hard failure', async () => {
    mockFrom.mockReset();
    mockFrom.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            order: async () => ({ data: null, error: { code: '42501', message: 'rls' } }),
          }),
        }),
      }),
    }));
    const result = await fetchRecordsResultFromDB(COUPLE_ID);
    expect(result.ok).toBe(false);
    expect(result.records).toEqual([]);
  });
});
