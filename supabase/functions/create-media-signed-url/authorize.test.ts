import { assertEquals } from 'jsr:@std/assert@1';
import {
  MEDIA_BUCKET,
  SIGNED_URL_TTL_SECONDS,
  decideMediaAccess,
  parseMediaPath,
  type ParsedMediaPath,
} from './authorize.ts';

/**
 * Deno 테스트: 실행 방법
 *   deno test --allow-read supabase/functions/create-media-signed-url/authorize.test.ts
 */

const COUPLE = '11111111-1111-4111-8111-111111111111';
const RECORD = '22222222-2222-4222-8222-222222222222';
const OTHER_COUPLE = '33333333-3333-4333-8333-333333333333';
const OTHER_RECORD = '44444444-4444-4444-8444-444444444444';
const FILE = '55555555-5555-4555-8555-555555555555.jpg';
const VALID_PATH = `${COUPLE}/${RECORD}/${FILE}`;

const OWNER = 'user-owner';
const PARTNER = 'user-partner';

function parsed(): ParsedMediaPath {
  return { coupleId: COUPLE, recordId: RECORD, fileName: FILE };
}

// ---------------------------------------------------------------------
// 경로 검증 — 임의 경로 서명 차단
// ---------------------------------------------------------------------

Deno.test('올바른 경로를 파싱한다', () => {
  const result = parseMediaPath(VALID_PATH);
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.value.coupleId, COUPLE);
    assertEquals(result.value.recordId, RECORD);
    assertEquals(result.value.fileName, FILE);
  }
});

Deno.test('path가 없거나 문자열이 아니면 거부한다', () => {
  for (const bad of [undefined, null, '', 123, {}, []]) {
    const result = parseMediaPath(bad);
    assertEquals(result.ok, false);
    if (!result.ok) assertEquals(result.reason, 'missing');
  }
});

Deno.test('상위 디렉터리 접근·절대경로·백슬래시·인코딩 우회를 거부한다', () => {
  const attacks = [
    `${COUPLE}/../${OTHER_COUPLE}/${FILE}`,
    `/${COUPLE}/${RECORD}/${FILE}`,
    `../${COUPLE}/${RECORD}/${FILE}`,
    `${COUPLE}\\${RECORD}\\${FILE}`,
    `${COUPLE}/%2e%2e/${FILE}`,
    `${COUPLE}/%2E%2E/${FILE}`,
  ];
  for (const attack of attacks) {
    const result = parseMediaPath(attack);
    assertEquals(result.ok, false, `허용되면 안 됨: ${attack}`);
  }
});

Deno.test('세 조각이 아닌 경로를 거부한다', () => {
  const bad = [
    COUPLE,
    `${COUPLE}/${RECORD}`,
    `${COUPLE}/${RECORD}/sub/${FILE}`,
    `${COUPLE}/${RECORD}/${FILE}/`,
  ];
  for (const p of bad) {
    const result = parseMediaPath(p);
    assertEquals(result.ok, false, `허용되면 안 됨: ${p}`);
  }
});

Deno.test('UUID가 아닌 커플/레코드 식별자를 거부한다', () => {
  for (const p of [
    `not-a-uuid/${RECORD}/${FILE}`,
    `${COUPLE}/not-a-uuid/${FILE}`,
    `*/${RECORD}/${FILE}`,
  ]) {
    const result = parseMediaPath(p);
    assertEquals(result.ok, false, `허용되면 안 됨: ${p}`);
    if (!result.ok) assertEquals(result.reason, 'not_uuid');
  }
});

Deno.test('업로더 규칙에 맞지 않는 파일명을 거부한다', () => {
  for (const name of ['secret', 'x.js', '../etc/passwd', 'a'.repeat(80) + '.jpg', '.env']) {
    const result = parseMediaPath(`${COUPLE}/${RECORD}/${name}`);
    assertEquals(result.ok, false, `허용되면 안 됨: ${name}`);
  }
});

// ---------------------------------------------------------------------
// 인가 판단
// ---------------------------------------------------------------------

Deno.test('active 멤버가 공개 기록의 미디어를 요청하면 허용한다', () => {
  const decision = decideMediaAccess({
    userId: PARTNER,
    parsed: parsed(),
    membership: { couple_id: COUPLE },
    record: { id: RECORD, user_id: OWNER, is_private: false },
  });
  assertEquals(decision.allow, true);
  assertEquals(decision.status, 200);
});

Deno.test('멤버십이 없으면 403', () => {
  const decision = decideMediaAccess({
    userId: PARTNER,
    parsed: parsed(),
    membership: null,
    record: { id: RECORD, user_id: OWNER, is_private: false },
  });
  assertEquals(decision.allow, false);
  assertEquals(decision.status, 403);
});

Deno.test('다른 커플의 멤버십으로는 접근할 수 없다', () => {
  const decision = decideMediaAccess({
    userId: PARTNER,
    parsed: parsed(),
    membership: { couple_id: OTHER_COUPLE },
    record: { id: RECORD, user_id: OWNER, is_private: false },
  });
  assertEquals(decision.allow, false);
  assertEquals(decision.status, 403);
});

Deno.test('레코드를 찾을 수 없으면 404', () => {
  const decision = decideMediaAccess({
    userId: OWNER,
    parsed: parsed(),
    membership: { couple_id: COUPLE },
    record: null,
  });
  assertEquals(decision.allow, false);
  assertEquals(decision.status, 404);
});

Deno.test('요청 경로와 다른 레코드가 조회되면 404', () => {
  const decision = decideMediaAccess({
    userId: OWNER,
    parsed: parsed(),
    membership: { couple_id: COUPLE },
    record: { id: OTHER_RECORD, user_id: OWNER, is_private: false },
  });
  assertEquals(decision.allow, false);
  assertEquals(decision.status, 404);
});

Deno.test('비공개 기록의 미디어는 파트너가 볼 수 없다', () => {
  const decision = decideMediaAccess({
    userId: PARTNER,
    parsed: parsed(),
    membership: { couple_id: COUPLE },
    record: { id: RECORD, user_id: OWNER, is_private: true },
  });
  assertEquals(decision.allow, false);
  assertEquals(decision.status, 403);
});

Deno.test('비공개 기록의 미디어는 작성자 본인은 볼 수 있다', () => {
  const decision = decideMediaAccess({
    userId: OWNER,
    parsed: parsed(),
    membership: { couple_id: COUPLE },
    record: { id: RECORD, user_id: OWNER, is_private: true },
  });
  assertEquals(decision.allow, true);
});

// ---------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------

Deno.test('버킷은 couple-media로 고정되어 있다', () => {
  assertEquals(MEDIA_BUCKET, 'couple-media');
});

Deno.test('Signed URL 만료는 10분이다', () => {
  assertEquals(SIGNED_URL_TTL_SECONDS, 600);
});
