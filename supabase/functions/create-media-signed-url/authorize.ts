/**
 * create-media-signed-url 의 순수 검증/인가 로직.
 *
 * 네트워크·Supabase 클라이언트와 분리해 두어 Deno 테스트로 직접 검증할 수 있습니다.
 * index.ts 는 이 모듈의 판단 결과만 따릅니다.
 */

export const MEDIA_BUCKET = 'couple-media';
export const SIGNED_URL_TTL_SECONDS = 60 * 10; // 10분

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 업로더(src/lib/records.ts)가 만드는 파일명: {uuid}.{ext} */
const FILE_NAME_PATTERN = /^[0-9a-f-]{36}\.[a-z0-9]{2,5}$/i;

export type PathRejection =
  | 'missing'
  | 'traversal'
  | 'shape'
  | 'not_uuid'
  | 'bad_filename';

export interface ParsedMediaPath {
  coupleId: string;
  recordId: string;
  fileName: string;
}

/**
 * 경로 검증: 정확히 `{coupleId}/{recordId}/{uuid}.{ext}` 형태만 허용합니다.
 * 임의 스토리지 경로에 서명해 주지 않는 것이 이 함수의 핵심 목적입니다.
 */
export function parseMediaPath(
  path: unknown,
): { ok: true; value: ParsedMediaPath } | { ok: false; reason: PathRejection } {
  if (typeof path !== 'string' || path.length === 0) {
    return { ok: false, reason: 'missing' };
  }
  // 상위 디렉터리 접근 / 절대경로 / 백슬래시 / 인코딩 우회 차단
  if (
    path.includes('..') ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('%2e') ||
    path.includes('%2E') ||
    path.includes('\0')
  ) {
    return { ok: false, reason: 'traversal' };
  }

  const segments = path.split('/');
  if (segments.length !== 3) return { ok: false, reason: 'shape' };

  const [coupleId, recordId, fileName] = segments;
  if (!UUID_PATTERN.test(coupleId) || !UUID_PATTERN.test(recordId)) {
    return { ok: false, reason: 'not_uuid' };
  }
  if (!FILE_NAME_PATTERN.test(fileName)) {
    return { ok: false, reason: 'bad_filename' };
  }

  return { ok: true, value: { coupleId, recordId, fileName } };
}

export interface MembershipRow {
  couple_id: string;
}

export interface RecordRow {
  id: string;
  user_id: string;
  is_private: boolean;
}

export interface AccessDecision {
  allow: boolean;
  status: number;
  error?: string;
}

/**
 * 인가 판단:
 *  1. 요청자가 해당 커플의 active 멤버여야 한다.
 *  2. 레코드가 그 커플 소속이어야 한다.
 *  3. 비공개 기록의 미디어는 작성자만 볼 수 있다. (파트너도 불가)
 */
export function decideMediaAccess(input: {
  userId: string;
  parsed: ParsedMediaPath;
  membership: MembershipRow | null;
  record: RecordRow | null;
}): AccessDecision {
  const { userId, parsed, membership, record } = input;

  if (!membership || membership.couple_id !== parsed.coupleId) {
    return { allow: false, status: 403, error: 'Forbidden' };
  }
  if (!record || record.id !== parsed.recordId) {
    return { allow: false, status: 404, error: 'Not found' };
  }
  if (record.is_private && record.user_id !== userId) {
    return { allow: false, status: 403, error: 'Forbidden' };
  }
  return { allow: true, status: 200 };
}

export function pathRejectionStatus(reason: PathRejection): number {
  return reason === 'missing' ? 400 : 400;
}
