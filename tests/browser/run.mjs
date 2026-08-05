/**
 * 실제 Chromium 브라우저 검증 (프로덕션 번들 + 목 Supabase 백엔드).
 *
 * 실행:
 *   npm run build:e2e && npm run test:browser
 *
 * 요구사항:
 *   - playwright-core (devDependency)
 *   - Chromium/Chrome 실행 파일. CHROME_PATH로 지정 가능 (기본 /usr/local/bin/chrome)
 *
 * 이 스크립트는 dist-e2e(모의 Supabase URL로 빌드된 번들)를 정적 서버로 띄우고,
 * page.route로 모든 Supabase 요청을 가로채 형태가 동일한 응답을 돌려줍니다.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import {
  AUTH_STORAGE_KEY,
  MOCK_ORIGIN,
  TINY_PNG_DATA_URL,
  createSupabaseRouter,
  makeDb,
  makeSession,
} from './mockSupabase.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const DIST = join(ROOT, 'dist-e2e');
const CHROME_PATH = process.env.CHROME_PATH || '/usr/local/bin/chrome';
const APP_STATE_KEY = 'gomsinlog.state.v2';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

// ---------------------------------------------------------------------
// 정적 서버 (SPA fallback)
// ---------------------------------------------------------------------
function startServer() {
  const server = createServer(async (req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let filePath = join(DIST, urlPath);
    if (!existsSync(filePath) || urlPath.endsWith('/')) {
      filePath = join(DIST, 'index.html'); // SPA fallback → /service 등 직접 진입 지원
    }
    try {
      const buf = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
      res.end(buf);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return new Promise((res) => {
    server.listen(0, '127.0.0.1', () => res({ server, port: server.address().port }));
  });
}

// ---------------------------------------------------------------------
// 미니 테스트 하네스
// ---------------------------------------------------------------------
const results = [];
let currentName = '';

function assert(cond, message) {
  if (!cond) throw new Error(`assertion failed: ${message}`);
}
function assertEq(actual, expected, message) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${message} — expected ${e}, got ${a}`);
}

async function test(name, fn) {
  currentName = name;
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`  ✓ ${name} (${Date.now() - started}ms)`);
  } catch (error) {
    results.push({ name, ok: false, ms: Date.now() - started, error: String(error.message || error) });
    console.log(`  ✗ ${name}\n      ${error.message || error}`);
  }
}

// ---------------------------------------------------------------------
// 페이지 준비 helper
// ---------------------------------------------------------------------
async function newPage(browser, baseUrl, { db, session, appState, viewport } = {}) {
  const context = await browser.newContext({
    viewport: viewport || { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    // PWA 서비스워커가 fetch를 가로채면 page.route 목이 우회되므로 차단합니다.
    serviceWorkers: 'block',
  });
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  if (db) {
    await page.route(`${MOCK_ORIGIN}/**`, createSupabaseRouter(db));
  }
  // realtime 웹소켓은 목이 없으므로 즉시 닫아 노이즈를 줄입니다.
  if (typeof page.routeWebSocket === 'function') {
    await page.routeWebSocket(/realtime/, (ws) => ws.close());
  }

  const seed = { AUTH_STORAGE_KEY, APP_STATE_KEY, session: session || null, appState: appState || null };
  await page.addInitScript((s) => {
    if (s.session) localStorage.setItem(s.AUTH_STORAGE_KEY, JSON.stringify(s.session));
    if (s.appState) localStorage.setItem(s.APP_STATE_KEY, JSON.stringify(s.appState));
  }, seed);

  page.__consoleErrors = consoleErrors;
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  return { context, page };
}

function baseProfile(role = 'gomsin', onboarded = true) {
  return {
    id: 'user-a',
    display_name: role === 'gomsin' ? '춘향' : '몽룡',
    role,
    avatar_path: null,
    onboarding_completed_at: onboarded ? '2026-01-01T00:00:00.000Z' : null,
    military_info:
      role === 'soldier'
        ? {
            branch: 'army',
            militaryStatus: 'serving',
            enlistmentDate: '2026-02-05',
            expectedDischargeDate: '2027-08-05',
            dischargeDateSource: 'calculated',
          }
        : null,
  };
}

function connectedDb(role = 'gomsin', extra = {}) {
  const coupleId = '11111111-1111-4111-8111-111111111111';
  return makeDb({
    userId: 'user-a',
    coupleId,
    profiles: baseProfile(role, true),
    coupleMembers: [{ couple_id: coupleId, status: 'active', role }],
    couples: { id: coupleId, anniversary_date: '2026-06-01' },
    partnerProfile: [{ display_name: role === 'gomsin' ? '몽룡' : '춘향' }],
    contactPreferences: {
      user_id: 'user-a',
      weekday_start: '18:00',
      weekday_end: '21:00',
      weekend_start: '12:00',
      weekend_end: '21:00',
    },
    ...extra,
  });
}

function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function dbRecord(over) {
  return {
    id: over.id,
    user_id: over.user_id ?? 'user-b',
    couple_id: '11111111-1111-4111-8111-111111111111',
    record_date: over.record_date ?? todayStr(),
    record_time: over.record_time ?? '12:00',
    log_text: over.log_text ?? '',
    reaction: over.reaction ?? null,
    attachments: over.attachments ?? [],
    is_private: over.is_private ?? false,
    emotion_flow: over.emotion_flow ?? [],
    emotion_updated_at: null,
    created_at: `${over.record_date ?? todayStr()}T12:00:00.000Z`,
  };
}

// ---------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------
async function main() {
  if (!existsSync(DIST)) {
    console.error(`dist-e2e 가 없습니다. 먼저 실행: npm run build:e2e`);
    process.exit(1);
  }
  if (!existsSync(CHROME_PATH)) {
    console.error(`Chromium 실행 파일을 찾을 수 없습니다: ${CHROME_PATH}`);
    process.exit(1);
  }

  const { server, port } = await startServer();
  const baseUrl = `http://127.0.0.1:${port}/`;
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  console.log(`\n프로덕션 번들 브라우저 검증 (${baseUrl})\n`);

  // ===================================================================
  // 1. 생성자(creator) 온보딩
  // ===================================================================
  await test('생성자 온보딩: 역할 → 닉네임 → 공간 생성(RPC) → 기념일 → 완료', async () => {
    const db = makeDb({
      userId: 'user-a',
      profiles: baseProfile('gomsin', false),
      coupleMembers: [],
      couples: null,
      partnerProfile: [],
    });
    const { context, page } = await newPage(browser, baseUrl, {
      db,
      session: makeSession('user-a'),
      // 주의: 인증된 사용자가 step 0에서 진행할 버튼이 없는 기존 결함(baseline)이 있어
      // step 1부터 시작하도록 상태를 주입합니다. (아래 별도 테스트로 결함 자체를 고정)
      appState: { onboardingStep: 1, setupComplete: false, isDemoMode: false },
    });
    try {
      await page.locator('button', { hasText: '나는 곰신이에요' }).click();
      await page.locator('button', { hasText: '다음' }).first().click();

      await page.locator('input[type=text]').first().fill('춘향');
      await page.locator('button', { hasText: '다음' }).first().click();

      // 기본값 = 새로운 우리 공간 만들기
      await page.locator('button', { hasText: '다음' }).first().click();
      await page.waitForTimeout(700);

      assert(
        db.calls.some((c) => c.includes('rpc/create_couple_and_invitation')),
        'create_couple_and_invitation RPC가 호출되어야 함',
      );
      let text = await page.locator('body').innerText();
      assert(text.includes('초대 코드가 생성되었습니다'), '초대 코드 생성 안내가 보여야 함');
      assert(text.includes('둘은 언제부터 함께였나요'), '기념일 단계로 진행해야 함');

      // 기념일 입력 → (곰신은 step 4에서 step 7로 점프) → 마지막 CTA로 완료
      await page.locator('input[type=date]').first().fill('2026-06-01');
      await page.locator('button', { hasText: '완료' }).first().click();
      await page.waitForTimeout(500);

      text = await page.locator('body').innerText();
      assert(text.includes('준비됐어요'), '완료 단계(step 7)로 진행해야 함');

      await page.locator('button', { hasText: '오늘의 첫 순간 남기기' }).click();
      await page.waitForTimeout(900);

      text = await page.locator('body').innerText();
      assert(text.includes('오늘의 기록'), '온보딩을 마치고 홈 화면으로 진입해야 함');

      const stored = JSON.parse(
        await page.evaluate((k) => localStorage.getItem(k), APP_STATE_KEY),
      );
      assertEq(stored.profile.couple.anniversaryDate, '2026-06-01', '기념일이 저장되어야 함');
      assertEq(stored.profile.myName, '춘향', '닉네임이 저장되어야 함');
      // 회귀: 예시 이름/날짜가 저장되면 안 된다
      assertEq(stored.profile.couple.partnerName, '', '상대 이름에 예시값을 저장하면 안 됨');
      assertEq(
        stored.profile.military.enlistmentDate,
        undefined,
        '곰신 온보딩에서 입대일 예시값이 저장되면 안 됨',
      );
    } finally {
      await context.close();
    }
  });

  await test('[기존 결함 고정] 인증된 사용자가 온보딩 step 0에서 진행할 수 없다', async () => {
    // baseline(bf6ba0b)부터 존재하는 결함. 수정 시 이 테스트를 기대값과 함께 갱신할 것.
    const db = makeDb({
      userId: 'user-a',
      profiles: baseProfile('gomsin', false),
      coupleMembers: [],
      couples: null,
      partnerProfile: [],
    });
    const { context, page } = await newPage(browser, baseUrl, {
      db,
      session: makeSession('user-a'),
    });
    try {
      await page.waitForTimeout(600);
      const labels = await page.locator('button').allInnerTexts();
      assertEq(
        labels.some((l) => l.includes('다음')),
        false,
        '현재 step 0에는 진행 버튼이 없다(결함). 수정되면 이 기대값을 true로 바꿀 것',
      );
      assert(
        labels.some((l) => l.includes('데모 공간 먼저 둘러보기')),
        '데모 진입 버튼은 존재해야 함',
      );
    } finally {
      await context.close();
    }
  });

  // ===================================================================
  // 2. 참여자(joiner) 온보딩
  // ===================================================================
  await test('참여자 온보딩: 초대코드 입력 → consume_invitation 호출 → 연결', async () => {
    const db = makeDb({
      userId: 'user-b',
      profiles: { ...baseProfile('soldier', false), id: 'user-b', display_name: '' },
      coupleMembers: [],
      couples: null,
      partnerProfile: [],
    });
    const { context, page } = await newPage(browser, baseUrl, {
      db,
      session: makeSession('user-b', 'joiner@example.test'),
      appState: { onboardingStep: 1, setupComplete: false, isDemoMode: false },
    });
    try {
      await page.locator('button', { hasText: '나는 군화예요' }).click();
      await page.locator('button', { hasText: '다음' }).first().click();

      await page.locator('input[type=text]').first().fill('몽룡');
      await page.locator('button', { hasText: '다음' }).first().click();

      // 참여 모드로 전환 후 코드 입력
      await page.locator('button', { hasText: '초대 코드가 있어요' }).click();
      await page.locator('input[type=text]').first().fill('654321');
      await page.locator('button', { hasText: '다음' }).first().click();
      await page.waitForTimeout(700);

      assert(
        db.calls.some((c) => c.includes('rpc/consume_invitation')),
        'consume_invitation RPC가 호출되어야 함',
      );
      const text = await page.locator('body').innerText();
      assert(text.includes('커플 공간 연결 성공'), '연결 성공 안내가 보여야 함');
    } finally {
      await context.close();
    }
  });

  await test('참여자 온보딩: 잘못된 길이의 코드는 서버를 호출하지 않는다', async () => {
    const db = makeDb({
      userId: 'user-b',
      profiles: { ...baseProfile('soldier', false), id: 'user-b', display_name: '' },
      coupleMembers: [],
      couples: null,
      partnerProfile: [],
    });
    const { context, page } = await newPage(browser, baseUrl, {
      db,
      session: makeSession('user-b'),
      appState: { onboardingStep: 3, setupComplete: false, isDemoMode: false },
    });
    try {
      await page.locator('button', { hasText: '초대 코드가 있어요' }).click();
      await page.locator('input[type=text]').first().fill('123');
      await page.locator('button', { hasText: '다음' }).first().click();
      await page.waitForTimeout(500);

      assert(
        !db.calls.some((c) => c.includes('rpc/consume_invitation')),
        '6자리가 아니면 RPC를 호출하면 안 됨',
      );
      const text = await page.locator('body').innerText();
      assert(text.includes('6자리'), '6자리 안내 메시지가 보여야 함');
    } finally {
      await context.close();
    }
  });

  // ===================================================================
  // 3. 공개/비공개 기록 가시성
  // ===================================================================
  await test('공개/비공개 가시성: 상대 비공개 기록 본문이 DOM/스토리지에 없다', async () => {
    const db = connectedDb('gomsin', {
      dailyRecords: [
        dbRecord({ id: 'r-shared', user_id: 'user-b', log_text: '상대가 공유한 이야기', record_time: '09:00' }),
        dbRecord({
          id: 'r-partner-private',
          user_id: 'user-b',
          log_text: '상대의 비밀 이야기',
          is_private: true,
          record_time: '10:00',
        }),
        dbRecord({ id: 'r-mine-private', user_id: 'user-a', log_text: '내 비밀 이야기', is_private: true, record_time: '11:00' }),
      ],
    });
    const { context, page } = await newPage(browser, baseUrl, { db, session: makeSession('user-a') });
    try {
      await page.waitForTimeout(600);
      // 기록 화면으로 이동
      await page.goto(`${baseUrl}record?date=${todayStr()}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(400);

      const bodyText = await page.locator('body').innerText();
      assert(bodyText.includes('상대가 공유한 이야기'), '상대의 공유 기록은 보여야 함');
      assert(bodyText.includes('내 비밀 이야기'), '내 비공개 기록은 나에게 보여야 함');
      assert(
        !bodyText.includes('상대의 비밀 이야기'),
        '상대의 비공개 기록 본문이 화면에 노출되면 안 됨',
      );

      const stored = await page.evaluate((k) => localStorage.getItem(k), APP_STATE_KEY);
      assert(
        !stored.includes('내 비밀 이야기'),
        '비공개 기록 본문이 localStorage에 평문으로 남으면 안 됨',
      );
    } finally {
      await context.close();
    }
  });

  // ===================================================================
  // 4. 감정 흐름/요약 개수 = 가시 기록 수
  // ===================================================================
  await test('오늘 요약: 사용한 기록 수와 화면 표시 개수가 일치한다', async () => {
    const db = connectedDb('gomsin', {
      dailyRecords: [
        dbRecord({ id: 'm1', user_id: 'user-a', log_text: '내 기록 1', record_time: '08:00' }),
        dbRecord({ id: 'm2', user_id: 'user-a', log_text: '내 기록 2', record_time: '09:00' }),
        dbRecord({ id: 'p1', user_id: 'user-b', log_text: '상대 공유', record_time: '10:00' }),
        dbRecord({ id: 'p2', user_id: 'user-b', log_text: '상대 비공개', is_private: true, record_time: '11:00' }),
        dbRecord({ id: 'y1', user_id: 'user-a', log_text: '어제 기록', record_date: '2020-01-01' }),
      ],
    });
    const { context, page } = await newPage(browser, baseUrl, { db, session: makeSession('user-a') });
    try {
      await page.waitForTimeout(700);
      // 오늘의 타임라인 배지 = 내 기록 2 + 상대 공유 1 = 3 (상대 비공개/과거 제외)
      const badge = page.locator('h3', { hasText: '오늘의 타임라인' });
      const text = await badge.first().innerText();
      const shown = Number((text.match(/(\d+)/) || [])[1]);
      assertEq(shown, 3, '오늘 타임라인 개수는 가시 기록 수(3)와 같아야 함');

      const bodyText = await page.locator('body').innerText();
      assert(!bodyText.includes('상대 비공개'), '상대 비공개 기록은 타임라인에 없어야 함');
      assert(!bodyText.includes('어제 기록'), '다른 날짜 기록은 오늘 타임라인에 없어야 함');
    } finally {
      await context.close();
    }
  });

  // ===================================================================
  // 5. 사진 추가 → 미리보기 → 저장 실패 → 재시도/복구
  // ===================================================================
  await test('사진: 추가 → 미리보기 표시', async () => {
    const db = connectedDb('gomsin');
    const { context, page } = await newPage(browser, baseUrl, { db, session: makeSession('user-a') });
    try {
      await page.waitForTimeout(600);
      await page.locator('button', { hasText: '한줄남기기' }).first().click();
      await page.locator('input[type=file]').setInputFiles({
        name: 'photo.png',
        mimeType: 'image/png',
        buffer: Buffer.from(TINY_PNG_DATA_URL.split(',')[1], 'base64'),
      });
      await page.waitForTimeout(300);
      const preview = page.locator('img[alt="photo.png"]');
      assertEq(await preview.count(), 1, '미리보기 썸네일이 1개 있어야 함');
      assertEq(
        await page.locator('button[aria-label="photo.png 첨부 제거"]').count(),
        1,
        '첨부 제거 버튼이 있어야 함',
      );
    } finally {
      await context.close();
    }
  });

  await test('사진 업로드 실패: 성공으로 표시하지 않고 파일을 남겨 재시도 가능', async () => {
    const db = connectedDb('gomsin', { uploadShouldFail: true });
    const { context, page } = await newPage(browser, baseUrl, { db, session: makeSession('user-a') });
    try {
      await page.waitForTimeout(600);
      await page.locator('button', { hasText: '한줄남기기' }).first().click();
      await page.locator('textarea').first().fill('사진과 함께');
      await page.locator('input[type=file]').setInputFiles({
        name: 'fail.png',
        mimeType: 'image/png',
        buffer: Buffer.from(TINY_PNG_DATA_URL.split(',')[1], 'base64'),
      });
      await page.waitForTimeout(200);
      await page.locator('button', { hasText: '저장' }).first().click();
      await page.waitForTimeout(900);

      const bodyText = await page.locator('body').innerText();
      assert(
        bodyText.includes('올리지 못했어요'),
        `업로드 실패를 사용자에게 알려야 함 (실제: ${bodyText.slice(0, 200)})`,
      );
      assert(
        !bodyText.includes('전해졌어요'),
        '업로드가 실패했는데 성공 메시지를 보여주면 안 됨',
      );
      // 재시도용으로 파일이 남아 있어야 함
      assertEq(
        await page.locator('img[alt="fail.png"]').count(),
        1,
        '실패한 파일은 재시도를 위해 컴포저에 남아 있어야 함',
      );
    } finally {
      await context.close();
    }
  });

  await test('첨부 반영 실패: 업로드된 객체를 롤백해 고아 객체를 남기지 않는다', async () => {
    const db = connectedDb('gomsin', { attachUpdateShouldFail: true });
    const { context, page } = await newPage(browser, baseUrl, { db, session: makeSession('user-a') });
    try {
      await page.waitForTimeout(600);
      await page.locator('button', { hasText: '한줄남기기' }).first().click();
      await page.locator('textarea').first().fill('롤백 확인');
      await page.locator('input[type=file]').setInputFiles({
        name: 'orphan.png',
        mimeType: 'image/png',
        buffer: Buffer.from(TINY_PNG_DATA_URL.split(',')[1], 'base64'),
      });
      await page.waitForTimeout(200);
      await page.locator('button', { hasText: '저장' }).first().click();
      await page.waitForTimeout(1200);

      assert(db.storageRemoved.length > 0, '업로드된 객체 삭제(롤백)가 호출되어야 함');
      assertEq(db.storageObjects.length, 0, '스토리지에 고아 객체가 남아 있으면 안 됨');
      const bodyText = await page.locator('body').innerText();
      assert(bodyText.includes('올리지 못했어요'), '첨부 실패를 사용자에게 알려야 함');
    } finally {
      await context.close();
    }
  });

  await test('사진 재시도 성공: 업로드가 회복되면 저장이 완료된다', async () => {
    const db = connectedDb('gomsin', { uploadShouldFail: true });
    const { context, page } = await newPage(browser, baseUrl, { db, session: makeSession('user-a') });
    try {
      await page.waitForTimeout(600);
      await page.locator('button', { hasText: '한줄남기기' }).first().click();
      await page.locator('textarea').first().fill('첫 시도');
      await page.locator('input[type=file]').setInputFiles({
        name: 'retry.png',
        mimeType: 'image/png',
        buffer: Buffer.from(TINY_PNG_DATA_URL.split(',')[1], 'base64'),
      });
      await page.waitForTimeout(200);
      await page.locator('button', { hasText: '저장' }).first().click();
      await page.waitForTimeout(900);

      // 서버 회복 후 재시도
      db.uploadShouldFail = false;
      await page.locator('button', { hasText: '저장' }).first().click();
      await page.waitForTimeout(1200);

      assert(db.storageObjects.length >= 1, '재시도 시 업로드가 성공해야 함');
      const bodyText = await page.locator('body').innerText();
      assert(bodyText.includes('전해졌어요'), '재시도 성공 메시지가 보여야 함');
    } finally {
      await context.close();
    }
  });

  await test('저장 버튼 연타로 서버 변경을 중복 발생시킬 수 없다', async () => {
    const db = connectedDb('gomsin');
    const { context, page } = await newPage(browser, baseUrl, { db, session: makeSession('user-a') });
    try {
      await page.waitForTimeout(600);
      await page.locator('button', { hasText: '한줄남기기' }).first().click();
      await page.locator('textarea').first().fill('중복 저장 방지 확인');

      // 같은 tick에서 연속 클릭 — React state 기반 가드만으로는 막히지 않는 경로
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find(
          (b) => b.textContent.trim() === '저장',
        );
        btn.click();
        btn.click();
        btn.click();
      });
      await page.waitForTimeout(1500);

      const inserts = db.calls.filter((c) => c.startsWith('POST /rest/v1/daily_records'));
      assertEq(inserts.length, 1, `daily_records 저장은 1회만 일어나야 함 (실제 ${inserts.length}회)`);
      const matching = db.dailyRecords.filter((r) => r.log_text === '중복 저장 방지 확인');
      assertEq(matching.length, 1, '중복 레코드가 생성되면 안 됨');
    } finally {
      await context.close();
    }
  });

  // ===================================================================
  // 6. 기념일 편집
  // ===================================================================
  await test('기념일 편집: 저장 시 couples PATCH 호출 + 화면 재계산', async () => {
    const db = connectedDb('gomsin');
    const { context, page } = await newPage(browser, baseUrl, { db, session: makeSession('user-a') });
    try {
      await page.goto(`${baseUrl}us`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);

      await page.locator('button', { hasText: '사귄 날짜' }).first().click();
      await page.locator('input[type=date]').first().fill('2024-03-01');
      await page.locator('button', { hasText: '저장' }).first().click();
      await page.waitForTimeout(600);

      const patched = db.calls.some((c) => c.startsWith('PATCH /rest/v1/couples'));
      assert(patched, 'couples 테이블 PATCH가 호출되어야 함');
      assertEq(db.couples.anniversary_date, '2024-03-01', 'DB에 새 기념일이 반영되어야 함');

      const bodyText = await page.locator('body').innerText();
      assert(/함께한 지 \+\d+일째/.test(bodyText), '함께한 일수가 재계산되어 표시되어야 함');
      assert(bodyText.includes('2024년 3월 1일'), '수정된 날짜가 화면에 보여야 함');
    } finally {
      await context.close();
    }
  });

  await test('기념일 편집: 미래 날짜는 거부한다', async () => {
    const db = connectedDb('gomsin');
    const { context, page } = await newPage(browser, baseUrl, { db, session: makeSession('user-a') });
    try {
      await page.goto(`${baseUrl}us`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      await page.locator('button', { hasText: '사귄 날짜' }).first().click();
      await page.locator('input[type=date]').first().fill('2099-01-01');
      await page.locator('button', { hasText: '저장' }).first().click();
      await page.waitForTimeout(400);

      const bodyText = await page.locator('body').innerText();
      assert(bodyText.includes('오늘보다 뒤일 수 없어요'), '미래 날짜 거부 메시지가 보여야 함');
      assert(
        !db.calls.some((c) => c.startsWith('PATCH /rest/v1/couples')),
        '거부된 값으로 서버를 변경하면 안 됨',
      );
    } finally {
      await context.close();
    }
  });

  // ===================================================================
  // 7. 군화 기록 생성
  // ===================================================================
  await test('군화(soldier) 홈에서 기록을 생성할 수 있다', async () => {
    const db = connectedDb('soldier');
    const { context, page } = await newPage(browser, baseUrl, { db, session: makeSession('user-a') });
    try {
      await page.waitForTimeout(700);
      const bodyText = await page.locator('body').innerText();
      assert(bodyText.includes('오늘의 기록'), '군화 홈에 기록 컴포저가 있어야 함');

      await page.locator('button', { hasText: '한줄남기기' }).first().click();
      await page.locator('textarea').first().fill('군화가 남긴 기록');
      await page.locator('button', { hasText: '저장' }).first().click();
      await page.waitForTimeout(900);

      const inserted = db.dailyRecords.find((r) => r.log_text === '군화가 남긴 기록');
      assert(inserted, '군화의 기록이 서버에 저장되어야 함');
      assertEq(inserted.user_id, 'user-a', '작성자가 현재 사용자여야 함');
    } finally {
      await context.close();
    }
  });

  // ===================================================================
  // 8. /service 라우트
  // ===================================================================
  await test('/service 직접 진입: 복무 현황이 실제 값으로 렌더링된다', async () => {
    const db = connectedDb('soldier');
    const { context, page } = await newPage(browser, baseUrl, { db, session: makeSession('user-a') });
    try {
      await page.goto(`${baseUrl}service`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);

      const bodyText = await page.locator('body').innerText();
      assert(bodyText.includes('복무 현황'), '복무 현황 화면이 렌더링되어야 함');
      assert(/복무율 \d+\.\d%/.test(bodyText), '복무율이 계산되어 표시되어야 함');
      assert(bodyText.includes('진급 예정일'), '진급 예정 타임라인이 있어야 함');
      assert(bodyText.includes('이병') && bodyText.includes('병장'), '계급 목록이 표시되어야 함');
      assert(!bodyText.includes('다음 업데이트에서 만나요'), '준비 중 플레이스홀더가 남아 있으면 안 됨');
    } finally {
      await context.close();
    }
  });

  await test('/service: 복무 정보가 없으면 입력 유도만 보이고 가짜 D-Day가 없다', async () => {
    const db = connectedDb('gomsin', { profiles: { ...baseProfile('gomsin', true), military_info: null } });
    const { context, page } = await newPage(browser, baseUrl, { db, session: makeSession('user-a') });
    try {
      await page.goto(`${baseUrl}service`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
      const bodyText = await page.locator('body').innerText();
      assert(bodyText.includes('복무 정보를 입력해 주세요'), '입력 유도 빈 상태가 보여야 함');
      assert(!/D-\d+/.test(bodyText), `미설정 상태에서 D-Day가 표시되면 안 됨 (실제: ${bodyText.slice(0, 200)})`);
    } finally {
      await context.close();
    }
  });

  // ===================================================================
  // 9. 390/412/430 폭 × 라이트/다크
  // ===================================================================
  for (const width of [390, 412, 430]) {
    for (const theme of ['light', 'dark']) {
      await test(`레이아웃 ${width}px / ${theme}: 가로 스크롤 없음 + 테마 적용`, async () => {
        const db = connectedDb('gomsin', {
          dailyRecords: [dbRecord({ id: 'v1', user_id: 'user-b', log_text: '상대 공유 기록' })],
        });
        const { context, page } = await newPage(browser, baseUrl, {
          db,
          session: makeSession('user-a'),
          viewport: { width, height: 900 },
          appState: {
            theme,
            widgetLayout: [
              'today_briefing',
              'service_progress',
              'contact_window',
              'next_anniversary',
              'next_vacation',
              'memories',
              'today_condition',
              'my_memo',
              'upcoming_schedule',
              'record_shortcut',
              'dday',
              'today_word',
            ],
            hasSeenInstallPrompt: true,
            myMemo: '',
            myMemoOwnerId: null,
            setupComplete: true,
            onboardingStep: 0,
            isDemoMode: false,
            authenticatedUser: null,
            profile: {
              myName: '춘향',
              role: 'gomsin',
              couple: { partnerName: '몽룡', coupleCode: '', connected: true, status: 'active' },
              military: { branch: 'army', militaryStatus: 'unknown', dischargeDateSource: 'unknown' },
              contact: {
                weekdayStart: '18:00',
                weekdayEnd: '21:00',
                weekendStart: '12:00',
                weekendEnd: '21:00',
                enabled: true,
              },
            },
            records: [],
            events: [],
            trips: [],
          },
        });
        try {
          await page.waitForTimeout(800);

          const appliedTheme = await page.evaluate(() => document.documentElement.dataset.theme);
          assertEq(appliedTheme, theme, '테마 속성이 적용되어야 함');

          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          assert(overflow <= 1, `가로 스크롤이 발생함 (초과 ${overflow}px)`);

          // 모든 위젯이 렌더링되었는지 (레지스트리 12종)
          const bodyText = await page.locator('body').innerText();
          for (const label of ['오늘의 브리핑', '복무 진행률', '연락 가능 시간', '메모장', '다가오는 일정']) {
            assert(bodyText.includes(label), `${label} 위젯이 렌더링되어야 함`);
          }

          // 하단 내비게이션이 화면 안에 있는지
          const navBox = await page.locator('[aria-label="하단 내비게이션"]').boundingBox();
          assert(navBox, '하단 내비게이션이 존재해야 함');
          assert(navBox.x >= 0 && navBox.x + navBox.width <= width + 1, '내비게이션이 화면을 벗어남');

          const fatal = page.__consoleErrors.filter(
            (e) => !/realtime|websocket|Failed to load resource/i.test(e),
          );
          assertEq(fatal, [], `콘솔 오류가 없어야 함`);
        } finally {
          await context.close();
        }
      });
    }
  }

  await browser.close();
  server.close();

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n브라우저 테스트: ${passed} passed, ${failed} failed (총 ${results.length})\n`);
  if (failed > 0) {
    console.log('실패 목록:');
    results.filter((r) => !r.ok).forEach((r) => console.log(`  - ${r.name}: ${r.error}`));
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('runner crashed:', error);
  process.exit(1);
});
