import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_ATTACHMENTS_PER_RECORD,
  buildLocalRecord,
  persistRecordWithMedia,
  validateMediaFiles,
  type RecordPipelineDeps,
} from '@/lib/recordPipeline';
import type { Attachment, DailyRecord } from '@/types';

/**
 * 미디어 파이프라인 회귀 테스트.
 *
 * 검증 대상 (PR #11 감사 항목):
 *  - 업로드 실패를 성공으로 보고하지 않는다
 *  - 첨부 반영 실패 시 업로드된 객체를 되돌려 고아 객체를 남기지 않는다
 *  - 형식/용량 검증이 서버 변경보다 먼저 일어난다
 *  - 재시도 대상 파일이 호출자에게 전달된다
 *  - 커플 공간이 없으면 서버를 건드리지 않는다
 */

const MAX_BYTES = 25 * 1024 * 1024;

function file(name: string, type = 'image/png', size = 1024): File {
  const f = new File([new Uint8Array(1)], name, { type });
  // File.size는 읽기 전용이라 테스트용으로 재정의합니다.
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

const draft: Omit<DailyRecord, 'id' | 'createdAt'> = {
  date: '2026-08-05',
  time: '12:00',
  authorRole: 'gomsin',
  log: '오늘의 기록',
  isPrivate: false,
};

interface Harness {
  deps: RecordPipelineDeps;
  calls: string[];
  savedRecords: DailyRecord[];
  removed: Attachment[][];
}

function harness(
  overrides: Partial<{
    saveRecord: (record: DailyRecord, attempt: number) => Promise<boolean>;
    uploadAttachment: (file: File, recordId: string) => Promise<Attachment | null>;
    removeUploaded: (attachments: Attachment[]) => Promise<number>;
  }> = {},
): Harness {
  const calls: string[] = [];
  const savedRecords: DailyRecord[] = [];
  const removed: Attachment[][] = [];
  let saveAttempt = 0;

  const deps: RecordPipelineDeps = {
    isSupported: (f) => ['image/png', 'image/jpeg', 'video/mp4'].includes(f.type),
    maxBytes: MAX_BYTES,
    newId: () => 'record-1',
    now: () => '2026-08-05T12:00:00.000Z',
    saveRecord: async (record) => {
      saveAttempt += 1;
      calls.push(`save#${saveAttempt}:${(record.attachments || []).length}`);
      savedRecords.push(record);
      if (overrides.saveRecord) return overrides.saveRecord(record, saveAttempt);
      return true;
    },
    uploadAttachment: async (f, recordId) => {
      calls.push(`upload:${f.name}`);
      if (overrides.uploadAttachment) return overrides.uploadAttachment(f, recordId);
      return { type: 'photo', name: f.name, path: `couple-1/${recordId}/${f.name}`, url: 'signed' };
    },
    removeUploaded: async (attachments) => {
      calls.push(`remove:${attachments.map((a) => a.name).join(',')}`);
      removed.push(attachments);
      if (overrides.removeUploaded) return overrides.removeUploaded(attachments);
      return attachments.length;
    },
  };

  return { deps, calls, savedRecords, removed };
}

// =====================================================================
// 사전 검증 (서버 변경 전)
// =====================================================================

describe('validateMediaFiles', () => {
  it('지원 형식·용량·개수를 통과한 파일만 수락한다', () => {
    const { accepted, rejected } = validateMediaFiles(
      [file('a.png'), file('b.jpg', 'image/jpeg')],
      { isSupported: (f) => f.type.startsWith('image/'), maxBytes: MAX_BYTES },
    );
    expect(accepted).toHaveLength(2);
    expect(rejected).toEqual([]);
  });

  it('지원하지 않는 형식을 이유와 함께 거부한다', () => {
    const { accepted, rejected } = validateMediaFiles([file('a.exe', 'application/x-msdownload')], {
      isSupported: (f) => f.type.startsWith('image/'),
      maxBytes: MAX_BYTES,
    });
    expect(accepted).toEqual([]);
    expect(rejected).toEqual([{ name: 'a.exe', reason: 'unsupported_type' }]);
  });

  it('용량 초과를 거부한다', () => {
    const { rejected } = validateMediaFiles([file('big.png', 'image/png', MAX_BYTES + 1)], {
      isSupported: () => true,
      maxBytes: MAX_BYTES,
    });
    expect(rejected).toEqual([{ name: 'big.png', reason: 'too_large' }]);
  });

  it('개수 상한을 넘는 파일을 거부한다', () => {
    const files = Array.from({ length: MAX_ATTACHMENTS_PER_RECORD + 1 }, (_, i) =>
      file(`f${i}.png`),
    );
    const { accepted, rejected } = validateMediaFiles(files, {
      isSupported: () => true,
      maxBytes: MAX_BYTES,
    });
    expect(accepted).toHaveLength(MAX_ATTACHMENTS_PER_RECORD);
    expect(rejected).toEqual([
      { name: `f${MAX_ATTACHMENTS_PER_RECORD}.png`, reason: 'too_many' },
    ]);
  });
});

describe('검증은 서버 변경보다 먼저 일어난다', () => {
  it('지원하지 않는 형식이면 레코드 저장·업로드를 아예 시도하지 않는다', async () => {
    const h = harness();
    const result = await persistRecordWithMedia(h.deps, {
      draft,
      files: [file('bad.exe', 'application/x-msdownload')],
      hasCouple: true,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_media');
    expect(result.rejectedFiles).toEqual([{ name: 'bad.exe', reason: 'unsupported_type' }]);
    expect(h.calls).toEqual([]); // 서버 변경 0회
    expect(h.savedRecords).toEqual([]);
  });

  it('용량 초과면 서버를 건드리지 않고 재시도 목록을 돌려준다', async () => {
    const h = harness();
    const result = await persistRecordWithMedia(h.deps, {
      draft,
      files: [file('huge.png', 'image/png', MAX_BYTES + 1)],
      hasCouple: true,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid_media');
    expect(result.failedFiles).toEqual(['huge.png']);
    expect(h.calls).toEqual([]);
  });

  it('일부만 유효해도 서버를 건드리지 않는다 (조용히 버리지 않음)', async () => {
    const h = harness();
    const result = await persistRecordWithMedia(h.deps, {
      draft,
      files: [file('ok.png'), file('bad.txt', 'text/plain')],
      hasCouple: true,
    });

    expect(result.ok).toBe(false);
    expect(result.rejectedFiles).toHaveLength(1);
    expect(result.failedFiles).toEqual(['ok.png', 'bad.txt']);
    expect(h.calls).toEqual([]);
  });
});

describe('커플 공간 없음 게이트', () => {
  it('활성 커플이 없으면 서버 변경을 시도하지 않는다', async () => {
    const h = harness();
    const result = await persistRecordWithMedia(h.deps, {
      draft,
      files: [file('a.png')],
      hasCouple: false,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_couple');
    expect(result.failedFiles).toEqual(['a.png']);
    expect(h.calls).toEqual([]);
  });

  it('첨부가 없어도 커플이 없으면 저장하지 않는다', async () => {
    const h = harness();
    const result = await persistRecordWithMedia(h.deps, { draft, hasCouple: false });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_couple');
    expect(h.calls).toEqual([]);
  });
});

// =====================================================================
// 정상 경로 및 순서
// =====================================================================

describe('정상 경로', () => {
  it('레코드 선저장 → 업로드 → 첨부 반영 순서로 진행한다', async () => {
    const h = harness();
    const result = await persistRecordWithMedia(h.deps, {
      draft,
      files: [file('a.png'), file('b.png')],
      hasCouple: true,
    });

    expect(result.ok).toBe(true);
    expect(result.attachmentsPersisted).toBe(true);
    expect(result.failedFiles).toEqual([]);
    expect(result.orphansCleaned).toBe(0);
    // 1회차 저장은 첨부 0개, 업로드 후 2회차 저장은 첨부 2개
    expect(h.calls).toEqual(['save#1:0', 'upload:a.png', 'upload:b.png', 'save#2:2']);
    expect(result.record?.attachments).toHaveLength(2);
    expect(result.record?.attachments?.[0].path).toBe('couple-1/record-1/a.png');
  });

  it('첨부가 없으면 저장은 한 번만 일어난다', async () => {
    const h = harness();
    const result = await persistRecordWithMedia(h.deps, { draft, hasCouple: true });

    expect(result.ok).toBe(true);
    expect(result.attachmentsPersisted).toBe(true);
    expect(h.calls).toEqual(['save#1:0']);
    expect(result.record?.attachments).toBeUndefined();
  });
});

// =====================================================================
// 실패: 레코드 저장
// =====================================================================

describe('레코드 저장 실패', () => {
  it('선저장이 실패하면 업로드를 시도하지 않고 실패로 보고한다', async () => {
    const h = harness({ saveRecord: async () => false });
    const result = await persistRecordWithMedia(h.deps, {
      draft,
      files: [file('a.png')],
      hasCouple: true,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('record_save_failed');
    expect(result.failedFiles).toEqual(['a.png']);
    expect(h.calls).toEqual(['save#1:0']);
    expect(h.calls.some((c) => c.startsWith('upload'))).toBe(false);
  });

  it('선저장이 예외를 던져도 실패로 보고한다', async () => {
    const h = harness({
      saveRecord: async () => {
        throw new Error('network down');
      },
    });
    const result = await persistRecordWithMedia(h.deps, { draft, hasCouple: true });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('record_save_failed');
  });
});

// =====================================================================
// 실패: 업로드 — 성공으로 위장하지 않는다
// =====================================================================

describe('업로드 실패', () => {
  it('업로드가 실패하면 attachmentsPersisted=false로 알리고 첨부 없이 저장된다', async () => {
    const h = harness({ uploadAttachment: async () => null });
    const result = await persistRecordWithMedia(h.deps, {
      draft,
      files: [file('a.png')],
      hasCouple: true,
    });

    expect(result.ok).toBe(true); // 본문은 저장됨
    expect(result.attachmentsPersisted).toBe(false); // 첨부는 실패 — 성공으로 뭉개지 않음
    expect(result.failedFiles).toEqual(['a.png']);
    expect(result.record?.attachments).toBeUndefined();
    expect(h.calls).toEqual(['save#1:0', 'upload:a.png']); // 2회차 저장 없음
  });

  it('업로드가 예외를 던져도 실패 파일로 집계한다', async () => {
    const h = harness({
      uploadAttachment: async () => {
        throw new Error('storage 403');
      },
    });
    const result = await persistRecordWithMedia(h.deps, {
      draft,
      files: [file('a.png')],
      hasCouple: true,
    });
    expect(result.attachmentsPersisted).toBe(false);
    expect(result.failedFiles).toEqual(['a.png']);
  });

  it('일부만 실패하면 성공한 첨부는 반영하고 실패한 파일만 재시도 목록에 담는다', async () => {
    const h = harness({
      uploadAttachment: async (f, recordId) =>
        f.name === 'bad.png'
          ? null
          : { type: 'photo', name: f.name, path: `couple-1/${recordId}/${f.name}`, url: 'signed' },
    });
    const result = await persistRecordWithMedia(h.deps, {
      draft,
      files: [file('good.png'), file('bad.png')],
      hasCouple: true,
    });

    expect(result.ok).toBe(true);
    expect(result.failedFiles).toEqual(['bad.png']);
    expect(result.attachmentsPersisted).toBe(false); // 하나라도 실패하면 완전 성공이 아니다
    expect(result.record?.attachments?.map((a) => a.name)).toEqual(['good.png']);
    expect(h.calls).toEqual(['save#1:0', 'upload:good.png', 'upload:bad.png', 'save#2:1']);
  });
});

// =====================================================================
// 실패: 첨부 반영 → 고아 객체 롤백
// =====================================================================

describe('첨부 반영 실패 시 롤백', () => {
  it('업로드된 객체를 삭제해 스토리지에 고아 객체를 남기지 않는다', async () => {
    const h = harness({
      saveRecord: async (_record, attempt) => attempt === 1, // 2회차(첨부 반영)만 실패
    });
    const result = await persistRecordWithMedia(h.deps, {
      draft,
      files: [file('a.png'), file('b.png')],
      hasCouple: true,
    });

    expect(result.ok).toBe(true);
    expect(result.attachmentsPersisted).toBe(false);
    expect(result.orphansCleaned).toBe(2);
    expect(h.removed).toHaveLength(1);
    expect(h.removed[0].map((a) => a.name)).toEqual(['a.png', 'b.png']);
    expect(h.calls).toEqual([
      'save#1:0',
      'upload:a.png',
      'upload:b.png',
      'save#2:2',
      'remove:a.png,b.png',
    ]);
  });

  it('반환된 레코드는 서버 상태와 일치하도록 첨부를 포함하지 않는다', async () => {
    const h = harness({ saveRecord: async (_r, attempt) => attempt === 1 });
    const result = await persistRecordWithMedia(h.deps, {
      draft,
      files: [file('a.png')],
      hasCouple: true,
    });
    // 서버 행에는 첨부가 없으므로 클라이언트 상태에도 넣지 않는다
    expect(result.record?.attachments).toBeUndefined();
    expect(result.failedFiles).toEqual(['a.png']); // 재시도 가능
  });

  it('롤백 삭제까지 실패하면 orphansCleaned=0으로 정직하게 보고한다', async () => {
    const h = harness({
      saveRecord: async (_r, attempt) => attempt === 1,
      removeUploaded: async () => {
        throw new Error('remove failed');
      },
    });
    const result = await persistRecordWithMedia(h.deps, {
      draft,
      files: [file('a.png')],
      hasCouple: true,
    });
    expect(result.attachmentsPersisted).toBe(false);
    expect(result.orphansCleaned).toBe(0);
    expect(result.failedFiles).toEqual(['a.png']);
  });
});

// =====================================================================
// 데모/오프라인 경로
// =====================================================================

describe('buildLocalRecord (데모/오프라인)', () => {
  const localDeps = {
    isSupported: (f: File) => f.type.startsWith('image/'),
    maxBytes: MAX_BYTES,
    newId: () => 'local-1',
    now: () => '2026-08-05T12:00:00.000Z',
    createLocalAttachment: (f: File): Attachment => ({
      type: 'photo',
      name: f.name,
      url: `blob:${f.name}`,
    }),
  };

  it('서버 없이 로컬 첨부를 만든다', () => {
    const result = buildLocalRecord({ draft, files: [file('a.png')], hasCouple: true }, localDeps);
    expect(result.ok).toBe(true);
    expect(result.attachmentsPersisted).toBe(true);
    expect(result.record?.attachments).toEqual([
      { type: 'photo', name: 'a.png', url: 'blob:a.png' },
    ]);
  });

  it('데모 모드에서도 형식·용량 검증을 동일하게 적용한다', () => {
    const bad = buildLocalRecord(
      { draft, files: [file('a.txt', 'text/plain')], hasCouple: true },
      localDeps,
    );
    expect(bad.ok).toBe(false);
    expect(bad.reason).toBe('invalid_media');

    const big = buildLocalRecord(
      { draft, files: [file('a.png', 'image/png', MAX_BYTES + 1)], hasCouple: true },
      localDeps,
    );
    expect(big.ok).toBe(false);
    expect(big.rejectedFiles[0].reason).toBe('too_large');
  });

  it('비공개 여부와 감정 흐름 등 초안 필드를 보존한다', () => {
    const result = buildLocalRecord(
      {
        draft: {
          ...draft,
          isPrivate: true,
          emotionFlow: [
            { sequence: 1, group: 'joy', displayLabel: '기쁨', source: 'user_confirmed' },
          ],
        },
        hasCouple: true,
      },
      localDeps,
    );
    expect(result.record?.isPrivate).toBe(true);
    expect(result.record?.emotionFlow).toHaveLength(1);
  });
});

// =====================================================================
// 저장 순서 불변식 (RLS 요구사항)
// =====================================================================

describe('RLS 순서 불변식', () => {
  let uploadedBeforeSave = false;

  beforeEach(() => {
    uploadedBeforeSave = false;
  });

  it('업로드는 반드시 레코드 저장 이후에 일어난다', async () => {
    let saved = false;
    const deps: RecordPipelineDeps = {
      isSupported: () => true,
      maxBytes: MAX_BYTES,
      newId: () => 'r1',
      now: () => 'now',
      saveRecord: async () => {
        saved = true;
        return true;
      },
      uploadAttachment: async (f) => {
        if (!saved) uploadedBeforeSave = true;
        return { type: 'photo', name: f.name, path: `p/${f.name}`, url: 'u' };
      },
      removeUploaded: async (a) => a.length,
    };

    await persistRecordWithMedia(deps, { draft, files: [file('a.png')], hasCouple: true });
    expect(uploadedBeforeSave).toBe(false);
  });

  it('업로드 경로는 recordId를 그대로 사용한다 (경로 규칙 유지)', async () => {
    const seen: string[] = [];
    const deps: RecordPipelineDeps = {
      isSupported: () => true,
      maxBytes: MAX_BYTES,
      newId: () => 'record-abc',
      now: () => 'now',
      saveRecord: async () => true,
      uploadAttachment: async (f, recordId) => {
        seen.push(recordId);
        return { type: 'photo', name: f.name, path: `c/${recordId}/x.png`, url: 'u' };
      },
      removeUploaded: async (a) => a.length,
    };
    await persistRecordWithMedia(deps, { draft, files: [file('a.png')], hasCouple: true });
    expect(seen).toEqual(['record-abc']);
  });
});
