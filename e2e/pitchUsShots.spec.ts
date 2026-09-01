import { test, expect } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { PARTNER, TODAY } from './scenarios';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = 'ui-audit-results/pitch';
const PHOTO_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'photos');
const FILES = ['sunset.jpg', 'night.jpg', 'cafe.jpg', 'sky.jpg', 'food.jpg', 'letter.jpg'];

test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

const CAPTIONS = [
  '\uc6b0\ub9ac \ucc98\uc74c \ub9cc\ub09c \ub0a0',
  '\uac19\uc774 \ubcf8 \ubc24\ud558\ub298',
  '\uc790\uae30\uac00 \uc88b\uc544\ud558\ub294 \uce74\ud398',
  '\uc624\ub298 \ud558\ub298 \uc9c4\uc9dc \uc608\ubcd0\uc5b4',
  '\ud63c\uc790 \uba39\uc740 \uc810\uc2ec',
  '\ubc1b\uc740 \ud3b8\uc9c0',
];

test('pitch us grid', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const base = (PARTNER.records ?? [])[0];

  const published = CAPTIONS.map((caption, i) => ({
    ...base,
    id: 'pitch-post-' + (i + 1),
    user_id: i % 2 === 0 ? 'user-creator' : 'user-partner',
    record_date: TODAY,
    record_time: String(9 + i).padStart(2, '0') + ':30',
    log_text: caption,
    is_private: false,
    is_profile_post: true,
    emotion_flow: [],
    attachments: [{
      type: 'photo',
      name: 'photo-' + (i + 1) + '.jpg',
      path: 'couple-1/pitch-post-' + (i + 1) + '/photo-' + (i + 1) + '.jpg',
    }],
    created_at: TODAY + 'T' + String(9 + i).padStart(2, '0') + ':30:00Z',
  }));

  await installMockBackend(context, { ...PARTNER, records: published });

  const cache = new Map<string, Buffer>();
  await context.route('**/storage/v1/object/**', async (route) => {
    const req = route.request();
    if (req.method() !== 'GET' || req.url().includes('/object/sign/')) return route.fallback();
    const m = req.url().match(/pitch-post-(\d)/);
    const file = FILES[(m ? Number(m[1]) - 1 : 0) % FILES.length];
    if (!cache.has(file)) cache.set(file, await readFile(join(PHOTO_DIR, file)));
    return route.fulfill({ status: 200, contentType: 'image/jpeg', body: cache.get(file)! });
  });

  const page = await context.newPage();
  await page.goto('/us');
  await expect(page.getByTestId('post-grid')).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId('post-grid').locator('[data-kind="photo"]').first())
    .toBeVisible({ timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: OUT + '/08-us.png', fullPage: true });
  await context.close();
});
