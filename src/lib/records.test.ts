import { describe, it, expect, vi } from 'vitest';
import {
  classifyMediaFile,
  buildMediaPath,
  MAX_BYTES,
  MEDIA_ACCEPT,
  isCanonicalRecordMediaPath,
  deleteRecordFromDB,
  saveRecordToDB,
} from '@/lib/records';

const { mockFrom, mockSupabase } = vi.hoisted(() => {
  const mockFrom = vi.fn();
  const mockSupabase = { from: mockFrom };
  return { mockFrom, mockSupabase };
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

  it('classifies allowed video types', () => {
    for (const mime of ['video/mp4', 'video/quicktime', 'video/webm']) {
      const result = classifyMediaFile({ type: mime, size: 1024 });
      expect(result, mime).not.toHaveProperty('error');
      expect((result as { type: string }).type).toBe('video');
    }
  });

  it('classifies allowed audio types as voice', () => {
    for (const mime of ['audio/mp4', 'audio/mpeg', 'audio/webm', 'audio/ogg', 'audio/wav']) {
      const result = classifyMediaFile({ type: mime, size: 1024 });
      expect(result, mime).not.toHaveProperty('error');
      expect((result as { type: string }).type).toBe('voice');
    }
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

    expect(
      classifyMediaFile({ type: 'video/mp4', size: MAX_BYTES.video + 1 }),
    ).toHaveProperty('error');
    // A video that would be too large as a photo is still fine as a video.
    expect(
      classifyMediaFile({ type: 'video/mp4', size: MAX_BYTES.photo + 1 }),
    ).not.toHaveProperty('error');

    expect(
      classifyMediaFile({ type: 'audio/webm', size: MAX_BYTES.voice + 1 }),
    ).toHaveProperty('error');
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
  it('covers photo, video and audio so the file picker shows all three', () => {
    expect(MEDIA_ACCEPT).toContain('image/');
    expect(MEDIA_ACCEPT).toContain('video/');
    expect(MEDIA_ACCEPT).toContain('audio/');
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

describe('deleteRecordFromDB', () => {
  const recordId = 'rec-001';
  const userId = 'user-001';
  const coupleId = 'couple-001';

  it('calls .from(daily_records).delete().eq(id).eq(user_id).eq(couple_id).select(id).maybeSingle()', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: recordId }, error: null });
    const select = vi.fn().mockReturnValue({ maybeSingle });
    const eqCoupleId = vi.fn().mockReturnValue({ select });
    const eqUserId = vi.fn().mockReturnValue({ eq: eqCoupleId });
    const eqId = vi.fn().mockReturnValue({ eq: eqUserId });
    const del = vi.fn().mockReturnValue({ eq: eqId });
    mockFrom.mockReturnValue({ delete: del });

    const result = await deleteRecordFromDB(recordId, userId, coupleId);

    expect(result).toEqual({ ok: true });
    expect(mockFrom).toHaveBeenCalledWith('daily_records');
    expect(eqId).toHaveBeenCalledWith('id', recordId);
    expect(eqUserId).toHaveBeenCalledWith('user_id', userId);
    expect(eqCoupleId).toHaveBeenCalledWith('couple_id', coupleId);
    expect(select).toHaveBeenCalledWith('id');
    expect(maybeSingle).toHaveBeenCalled();
  });

  it('reports not_found when no row is returned', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    const select = vi.fn().mockReturnValue({ maybeSingle });
    const eqCoupleId = vi.fn().mockReturnValue({ select });
    const eqUserId = vi.fn().mockReturnValue({ eq: eqCoupleId });
    const eqId = vi.fn().mockReturnValue({ eq: eqUserId });
    const del = vi.fn().mockReturnValue({ eq: eqId });
    mockFrom.mockReturnValue({ delete: del });

    const result = await deleteRecordFromDB(recordId, userId, coupleId);

    // The filters pin id + owner + couple, so an empty result is an ownership
    // answer -- not a transport failure, and never a connection message.
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('classifies an RLS rejection as forbidden rather than a connection problem', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'permission denied for table daily_records' },
    });
    const select = vi.fn().mockReturnValue({ maybeSingle });
    const eqCoupleId = vi.fn().mockReturnValue({ select });
    const eqUserId = vi.fn().mockReturnValue({ eq: eqCoupleId });
    const eqId = vi.fn().mockReturnValue({ eq: eqUserId });
    const del = vi.fn().mockReturnValue({ eq: eqId });
    mockFrom.mockReturnValue({ delete: del });

    const result = await deleteRecordFromDB(recordId, userId, coupleId);

    expect(result).toEqual({ ok: false, reason: 'forbidden' });
  });

  it('classifies an expired session as auth_expired', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: 'PGRST301', message: 'JWT expired' },
    });
    const select = vi.fn().mockReturnValue({ maybeSingle });
    const eqCoupleId = vi.fn().mockReturnValue({ select });
    const eqUserId = vi.fn().mockReturnValue({ eq: eqCoupleId });
    const eqId = vi.fn().mockReturnValue({ eq: eqUserId });
    const del = vi.fn().mockReturnValue({ eq: eqId });
    mockFrom.mockReturnValue({ delete: del });

    const result = await deleteRecordFromDB(recordId, userId, coupleId);

    expect(result).toEqual({ ok: false, reason: 'auth_expired' });
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
    mockFrom.mockReturnValue({ upsert });
    return upsert;
  }

  it('reports ok on a successful upsert', async () => {
    mockUpsert(null);
    expect(await saveRecordToDB(record, 'couple-001', 'user-001')).toEqual({ ok: true });
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
});
