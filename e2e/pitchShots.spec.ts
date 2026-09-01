/**
 * 신청서·소개자료용 화면 캡처.
 *
 * 기존 캡처 스펙은 계약 검증용 문자열(`공개기록입니다`)을 쓰기 때문에 실제 커플이
 * 쓰는 모습으로 보이지 않는다. 이 스펙은 같은 mock backend 위에 자연스러운 한국어
 * 기록만 얹어 화면을 찍는다. 제품 코드는 건드리지 않으며 어떤 계약도 주장하지 않는다.
 */
import { test, expect } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { CREATOR, PARTNER, record, TODAY } from './scenarios';
import { mkdir } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PHOTO_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'photos');

/**
 * 경로 → 사진 파일. mock backend의 1x1 단색 응답을 덮어써서 게시물·스토리·격자에
 * 서로 다른 사진이 보이게 한다. 캡처 목적이며 제품 계약을 바꾸지 않는다.
 */
const PHOTO_BY_KEY: Record<string, string> = {
  'p-1': 'sky.jpg',
  'p-2': 'food.jpg',
  'p-3': 'cafe.jpg',
  'p-4': 'night.jpg',
  'p-5': 'letter.jpg',
  'p-6': 'sunset.jpg',
};

async function servePhotos(context: import('@playwright/test').BrowserContext) {
  const cache = new Map<string, Buffer>();
  await context.route('**/storage/v1/object/**', async (route) => {
    const req = route.request();
    const url = req.url();
    // 서명 요청과 업로드는 mock backend가 계속 처리한다.
    if (req.method() !== 'GET' || url.includes('/object/sign/')) return route.fallback();
    const hit = Object.keys(PHOTO_BY_KEY).find((k) => url.includes(k));
    const file = hit ? PHOTO_BY_KEY[hit] : 'sunset.jpg';
    if (!cache.has(file)) cache.set(file, await readFile(join(PHOTO_DIR, file)));
    return route.fulfill({ status: 200, contentType: 'image/jpeg', body: cache.get(file)! });
  });
}

function photos(recordId: string, count = 1) {
  return Array.from({ length: count }, (_, i) => ({
    type: 'photo',
    name: 'photo-' + (i + 1) + '.jpg',
    path: 'couple-1/' + recordId + '/' + (i + 1) + '.jpg',
  }));
}

const OUT = 'ui-audit-results/pitch';
test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

function yesterday() {
  const d = new Date(`${TODAY}T00:00:00+09:00`);
  d.setDate(d.getDate() - 1);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

const LIFELIKE = [
  record({
    id: 'p-1', user_id: 'user-creator', record_time: '08:12',
    log_text: '자기야 좋은 아침! 오늘 비 온다는데 감기 조심해 사랑해',
    attachments: photos('p-1'),
  }),
  record({
    id: 'p-2', user_id: 'user-creator', record_time: '13:24',
    log_text: '점심에 돈까스 나왔는데 자기 제일 좋아하는 거잖아 혼자 먹으니까 괜히 보고싶었어ㅠㅠ',
    attachments: photos('p-2'),
  }),
  record({
    id: 'p-3', user_id: 'user-creator', record_time: '19:47',
    log_text: '발표 끝났어!! 손 엄청 떨렸는데 교수님이 잘했다고 하셨어ㅎㅎ 자기한테 제일 먼저 말하고 싶었는데 통화할 때 자랑할래',
    attachments: photos('p-3'),
  }),
  record({
    id: 'p-4', user_id: 'user-partner', record_time: '21:08',
    log_text: '오늘 훈련 진짜 길었다.. 그래도 저녁에 하늘 봤는데 달이 너무 밝아서 자기 생각났어 보고싶다',
    attachments: photos('p-4'),
  }),
  record({
    id: 'p-5', user_id: 'user-partner', record_date: yesterday(), record_time: '20:41',
    log_text: '편지 잘 받았어 세 번 읽었다ㅋㅋ 진짜 힘났어 나도 사랑해',
    attachments: photos('p-5'),
    created_at: `${yesterday()}T20:41:00Z`,
  }),
];

LIFELIKE.push(
  record({
    id: 'p-6', user_id: 'user-creator', record_date: yesterday(), record_time: '18:52',
    log_text: '집 가는 길에 노을이 너무 예뻐서 한참 봤어. 나중에 같이 보자 우리',
    attachments: photos('p-6', 3),
    created_at: `${yesterday()}T18:52:00Z`,
  }),
);

/**
 * 우리 탭 격자는 is_profile_post 사진 기록만 모은다. 소개 자료에서 격자가 비어
 * 보이지 않도록 발행된 사진 기록을 넣는다.
 */
const GRID_KEYS = ['p-1', 'p-2', 'p-3', 'p-4', 'p-6'];
const GRID_TEXT = ['우리 처음 만난 날', '자기가 좋아하는 거', '오늘의 기록', '같이 본 밤하늘', '함께 보고 싶은 노을'];
GRID_KEYS.forEach((key, i) => {
  const hh = String(i + 12).padStart(2, '0');
  LIFELIKE.push(
    record({
      id: 'g-' + (i + 1),
      user_id: i % 2 === 0 ? 'user-creator' : 'user-partner',
      record_date: TODAY,
      record_time: hh + ':30',
      log_text: GRID_TEXT[i],
      attachments: [{ type: 'photo', name: 'g.jpg', path: 'couple-1/' + key + '/1.jpg' }],
      is_profile_post: true,
      created_at: TODAY + 'T' + hh + ':30:00Z',
    }),
  );
});

function markRow(recordId: string, actor: string) {
  return {
    id: `mark-${recordId}`,
    record_id: recordId,
    couple_id: 'couple-1',
    actor_user_id: actor,
    created_at: `${TODAY}T12:00:00.000Z`,
    is_completed: false,
  };
}

const MARKED = [markRow('p-3', 'user-partner'), markRow('p-4', 'user-creator')];
const GOMSIN = { ...CREATOR, records: [...LIFELIKE], talkAboutMarks: MARKED };
const SOLDIER = { ...PARTNER, records: [...LIFELIKE], talkAboutMarks: MARKED };

const SCENES = [
  { name: '01-home-gomsin', scenario: GOMSIN, path: '/home', ready: 'home-core' },
  { name: '02-home-soldier', scenario: SOLDIER, path: '/home', ready: 'home-core' },
  { name: '03-story-partner', scenario: SOLDIER, path: '/story/partner', ready: undefined },
  { name: '04-saved-topics', scenario: SOLDIER, path: '/saved', ready: undefined },
  { name: '05-call-mode', scenario: SOLDIER, path: '/call', ready: undefined },
  { name: '06-diary', scenario: GOMSIN, path: '/diary', ready: undefined },
  { name: '07-shop', scenario: GOMSIN, path: '/shop', ready: undefined },
  { name: '08-us', scenario: SOLDIER, path: '/us', ready: undefined },
  { name: '09-schedule', scenario: GOMSIN, path: '/schedule', ready: undefined },
  { name: '10-search-service', scenario: SOLDIER, path: '/search', ready: undefined },
  { name: '11-record', scenario: SOLDIER, path: '/record', ready: undefined },
  { name: '12-compose', scenario: GOMSIN, path: '/compose', ready: undefined },
];

for (const scene of SCENES) {
  test(scene.name, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await installMockBackend(context, scene.scenario);
    await servePhotos(context);
    const page = await context.newPage();
    await page.goto(scene.path);
    if (scene.ready) {
      await expect(page.getByTestId(scene.ready)).toBeVisible({ timeout: 15_000 });
    } else {
      await page.waitForLoadState('networkidle');
    }
    await page.waitForTimeout(700);
    if (scene.path === '/us') {
      // 격자 타일이 붙을 시간을 준다. 화면 계약은 usArchiveShots가 소유한다.
      await page.waitForTimeout(1400);
      await page.waitForTimeout(400);
    }
    await page.screenshot({ path: `${OUT}/${scene.name}.png`, fullPage: true });
    await context.close();
  });
}
