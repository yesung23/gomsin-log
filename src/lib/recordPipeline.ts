import type { Attachment, DailyRecord } from '@/types';

/**
 * recordPipeline.ts
 *
 * 기록 저장 + 미디어 업로드의 순서/실패 처리를 한곳에 모은 순수 오케스트레이션.
 * 의존성(저장, 업로드, 삭제, 검증)을 주입받으므로 Supabase 없이 단위 테스트할 수 있고,
 * UI(store)와 테스트가 동일한 코드 경로를 사용합니다.
 *
 * 왜 이 순서인가:
 *   Storage RLS(supabase/migrations/007_storage_policies.sql)의 INSERT 정책이
 *   `daily_records`에 해당 recordId 행이 이미 존재할 것을 요구합니다.
 *   따라서 "레코드 선저장 → 업로드 → 첨부 반영" 순서가 강제됩니다.
 *
 * 실패 처리 원칙:
 *   1) 형식/용량 검증은 서버를 건드리기 전에 끝낸다. (거부 시 서버 변경 0회)
 *   2) 업로드 실패한 파일은 이름을 돌려줘서 UI가 재시도할 수 있게 한다.
 *   3) 첨부 반영(3단계)이 실패하면 이미 올라간 객체를 되돌려 삭제한다.
 *      → 스토리지에 고아 객체를 남기지 않고, 레코드 상태와 서버 상태를 일치시킨다.
 *   4) 첨부가 반영되지 않았으면 attachmentsPersisted=false로 분명히 알린다.
 *      (본문 저장 성공을 첨부 성공으로 뭉개지 않는다)
 */

export const MAX_ATTACHMENTS_PER_RECORD = 4;

export type MediaRejectionReason = 'unsupported_type' | 'too_large' | 'too_many';

export interface RejectedFile {
  name: string;
  reason: MediaRejectionReason;
}

export type AddRecordFailureReason =
  | 'no_couple'
  | 'record_save_failed'
  | 'invalid_media';

export interface AddRecordResult {
  /** 기록 본문이 저장되었는지 */
  ok: boolean;
  reason?: AddRecordFailureReason;
  /** 저장에 성공한 경우의 최종 레코드 (서버에 반영된 상태와 동일) */
  record?: DailyRecord;
  /** 서버를 건드리기 전에 거부된 파일 */
  rejectedFiles: RejectedFile[];
  /** 업로드 또는 첨부 반영에 실패해 재시도가 필요한 파일 이름 */
  failedFiles: string[];
  /** 업로드된 첨부가 레코드에 반영되었는지 */
  attachmentsPersisted: boolean;
  /** 롤백으로 정리한 스토리지 객체 수 */
  orphansCleaned: number;
}

export interface MediaValidationOptions {
  isSupported: (file: File) => boolean;
  maxBytes: number;
  maxCount?: number;
}

/**
 * 서버 변경 이전에 수행하는 형식/용량/개수 검증.
 */
export function validateMediaFiles(
  files: File[],
  options: MediaValidationOptions,
): { accepted: File[]; rejected: RejectedFile[] } {
  const maxCount = options.maxCount ?? MAX_ATTACHMENTS_PER_RECORD;
  const accepted: File[] = [];
  const rejected: RejectedFile[] = [];

  files.forEach((file, index) => {
    if (index >= maxCount) {
      rejected.push({ name: file.name, reason: 'too_many' });
      return;
    }
    if (!options.isSupported(file)) {
      rejected.push({ name: file.name, reason: 'unsupported_type' });
      return;
    }
    if (file.size > options.maxBytes) {
      rejected.push({ name: file.name, reason: 'too_large' });
      return;
    }
    accepted.push(file);
  });

  return { accepted, rejected };
}

export interface RecordPipelineDeps extends MediaValidationOptions {
  /** 레코드 upsert. 실패 시 false 또는 throw */
  saveRecord: (record: DailyRecord) => Promise<boolean>;
  /** 파일 하나 업로드. 실패 시 null 또는 throw */
  uploadAttachment: (file: File, recordId: string) => Promise<Attachment | null>;
  /** 롤백용 삭제. 삭제된 객체 수를 반환 */
  removeUploaded: (attachments: Attachment[]) => Promise<number>;
  newId: () => string;
  now: () => string;
}

export interface PersistRecordInput {
  draft: Omit<DailyRecord, 'id' | 'createdAt'>;
  files?: File[];
  /** 활성 커플 공간이 있는지 (없으면 서버 저장 불가) */
  hasCouple: boolean;
}

function emptyResult(
  reason: AddRecordFailureReason,
  rejectedFiles: RejectedFile[] = [],
  failedFiles: string[] = [],
): AddRecordResult {
  return {
    ok: false,
    reason,
    rejectedFiles,
    failedFiles,
    attachmentsPersisted: false,
    orphansCleaned: 0,
  };
}

/**
 * 서버(Supabase) 모드의 기록 저장 파이프라인.
 */
export async function persistRecordWithMedia(
  deps: RecordPipelineDeps,
  input: PersistRecordInput,
): Promise<AddRecordResult> {
  const files = input.files ?? [];

  // 1) 서버를 건드리기 전에 검증한다. 하나라도 거부되면 저장을 진행하지 않는다.
  //    (일부만 조용히 버리면 사용자가 첨부가 됐다고 오해할 수 있음)
  const { accepted, rejected } = validateMediaFiles(files, deps);
  if (rejected.length > 0) {
    return emptyResult(
      'invalid_media',
      rejected,
      files.map((f) => f.name),
    );
  }

  if (!input.hasCouple) {
    return emptyResult('no_couple', [], files.map((f) => f.name));
  }

  const baseRecord: DailyRecord = {
    ...input.draft,
    id: deps.newId(),
    createdAt: deps.now(),
  };

  // 2) 레코드 선저장 (첨부는 비운 상태로)
  let savedBase = false;
  try {
    savedBase = await deps.saveRecord({ ...baseRecord, attachments: [] });
  } catch {
    savedBase = false;
  }
  if (!savedBase) {
    return emptyResult('record_save_failed', [], files.map((f) => f.name));
  }

  // 3) 업로드
  const uploaded: Attachment[] = [];
  const failedFiles: string[] = [];
  for (const file of accepted) {
    let attachment: Attachment | null = null;
    try {
      attachment = await deps.uploadAttachment(file, baseRecord.id);
    } catch {
      attachment = null;
    }
    if (attachment) uploaded.push(attachment);
    else failedFiles.push(file.name);
  }

  const recordWithoutUploads: DailyRecord = {
    ...baseRecord,
    attachments:
      baseRecord.attachments && baseRecord.attachments.length > 0
        ? baseRecord.attachments
        : undefined,
  };

  if (uploaded.length === 0) {
    return {
      ok: true,
      record: recordWithoutUploads,
      rejectedFiles: [],
      failedFiles,
      // 올릴 첨부가 애초에 없었으면 "반영됨"으로 본다.
      attachmentsPersisted: failedFiles.length === 0,
      orphansCleaned: 0,
    };
  }

  // 4) 첨부 반영
  const finalAttachments = [...(baseRecord.attachments || []), ...uploaded];
  const finalRecord: DailyRecord = { ...baseRecord, attachments: finalAttachments };

  let attachSaved = false;
  try {
    attachSaved = await deps.saveRecord(finalRecord);
  } catch {
    attachSaved = false;
  }

  if (!attachSaved) {
    // 5) 롤백: 업로드된 객체를 삭제해 고아 객체를 남기지 않는다.
    let orphansCleaned = 0;
    try {
      orphansCleaned = await deps.removeUploaded(uploaded);
    } catch {
      orphansCleaned = 0;
    }
    return {
      ok: true,
      record: recordWithoutUploads,
      rejectedFiles: [],
      failedFiles: [...failedFiles, ...uploaded.map((a) => a.name)],
      attachmentsPersisted: false,
      orphansCleaned,
    };
  }

  return {
    ok: true,
    record: finalRecord,
    rejectedFiles: [],
    failedFiles,
    attachmentsPersisted: failedFiles.length === 0,
    orphansCleaned: 0,
  };
}

/**
 * 데모/오프라인 모드 저장. 서버를 전혀 건드리지 않지만 검증은 동일하게 적용한다.
 */
export function buildLocalRecord(
  input: PersistRecordInput,
  deps: {
    newId: () => string;
    now: () => string;
    createLocalAttachment: (file: File) => Attachment;
  } & MediaValidationOptions,
): AddRecordResult {
  const files = input.files ?? [];
  const { accepted, rejected } = validateMediaFiles(files, deps);
  if (rejected.length > 0) {
    return emptyResult('invalid_media', rejected, files.map((f) => f.name));
  }

  const localAttachments = accepted.map(deps.createLocalAttachment);
  const merged = [...(input.draft.attachments || []), ...localAttachments];

  return {
    ok: true,
    record: {
      ...input.draft,
      id: deps.newId(),
      createdAt: deps.now(),
      attachments: merged.length > 0 ? merged : undefined,
    },
    rejectedFiles: [],
    failedFiles: [],
    attachmentsPersisted: true,
    orphansCleaned: 0,
  };
}
