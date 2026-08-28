import { expect, test } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';

const PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=',
  'base64',
);

const CONNECTED = {
  userId: 'user-creator',
  displayName: '춘향',
  role: 'gomsin' as const,
  coupleId: 'couple-1',
  partnerPresent: true,
  partnerUserId: 'user-partner',
  partnerName: '몽룡',
};

test('선택한 사진을 글 바로 아래에서 확인·삭제하고 launch flag OFF에서도 저장한다', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    const created: string[] = [];
    const revoked: string[] = [];
    const createObjectURL = URL.createObjectURL.bind(URL);
    const revokeObjectURL = URL.revokeObjectURL.bind(URL);
    Object.defineProperty(window, '__composeObjectUrlStats', {
      value: { created, revoked },
      configurable: false,
    });
    URL.createObjectURL = (value) => {
      const url = createObjectURL(value);
      created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      revoked.push(url);
      revokeObjectURL(url);
    };
  });
  const { dailyRecordWrites, unrouted } = await installMockBackend(context, CONNECTED);
  const storageWrites: string[] = [];
  context.on('request', (request) => {
    if (request.method() !== 'GET' && request.url().includes('/storage/v1/object/')) {
      storageWrites.push(request.url());
    }
  });
  const page = await context.newPage();
  await page.goto('/compose');

  const textarea = page.getByRole('textbox', { name: '오늘 남길 글' });
  await expect(textarea).toBeVisible({ timeout: 20_000 });
  const picker = page.locator('input[type="file"]');
  await picker.setInputFiles({ name: 'today.png', mimeType: 'image/png', buffer: PHOTO });

  const preview = page.getByRole('img', { name: '선택한 사진 1' });
  await expect(preview).toBeVisible();
  const textareaBox = await textarea.boundingBox();
  const previewBox = await preview.boundingBox();
  expect(textareaBox).toBeTruthy();
  expect(previewBox).toBeTruthy();
  expect(previewBox!.y).toBeGreaterThanOrEqual(textareaBox!.y + textareaBox!.height);

  const remove = page.getByRole('button', { name: '선택한 사진 1 빼기' });
  const removeBox = await remove.boundingBox();
  expect(removeBox?.width).toBeGreaterThanOrEqual(44);
  expect(removeBox?.height).toBeGreaterThanOrEqual(44);
  await remove.click();
  await expect(preview).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const stats = (window as Window & {
      __composeObjectUrlStats?: { created: string[]; revoked: string[] };
    }).__composeObjectUrlStats;
    return { created: stats?.created.length ?? 0, revoked: stats?.revoked.length ?? 0 };
  })).toEqual({ created: 1, revoked: 1 });

  await picker.setInputFiles({ name: 'today.png', mimeType: 'image/png', buffer: PHOTO });
  await textarea.fill('사진과 함께 남긴 오늘');
  expect(dailyRecordWrites).toHaveLength(0);
  expect(storageWrites).toHaveLength(0);
  await testInfo.attach('compose-photo-preview', {
    body: await page.screenshot({ fullPage: true }),
    contentType: 'image/png',
  });

  const save = page.getByRole('button', { name: '남기기', exact: true });
  await save.evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect(page).toHaveURL(/\/home$/, { timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => {
    const stats = (window as Window & {
      __composeObjectUrlStats?: { created: string[]; revoked: string[] };
    }).__composeObjectUrlStats;
    const created = stats?.created ?? [];
    const revoked = stats?.revoked ?? [];
    return created.filter((url) => !revoked.includes(url)).length;
  })).toBe(0);
  const createdObjectUrls = await page.evaluate(() => (
    (window as Window & {
      __composeObjectUrlStats?: { created: string[]; revoked: string[] };
    }).__composeObjectUrlStats?.created.length ?? 0
  ));
  expect(createdObjectUrls).toBeGreaterThanOrEqual(2);
  // One record insert plus one attachment patch. A duplicate save would add
  // another pair before the route transition.
  expect(dailyRecordWrites).toHaveLength(2);
  const finalWrite = dailyRecordWrites.at(-1)!;
  expect(finalWrite.log_text).toBe('사진과 함께 남긴 오늘');
  expect(finalWrite.attachments).toEqual([
    // Photo sanitization strips source metadata and normalizes the upload to JPEG.
    expect.objectContaining({ type: 'photo', path: expect.stringMatching(/^couple-1\/[0-9a-f-]+\/[A-Za-z0-9._-]+\.jpg$/) }),
  ]);
  expect(unrouted, `unrouted supabase calls: ${unrouted.join(', ')}`).toEqual([]);
  await context.close();
});

test('floor 조회가 연속 실패하면 평문을 보내지 않고 닫힌 설정 대신 재시도를 안내한다', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { dailyRecordWrites } = await installMockBackend(context, {
    ...CONNECTED,
    failures: {
      // 503 is already retried by supabase-js transport; 500 isolates the one
      // bounded application retry added by floorGuard without a long backoff.
      crypto_write_floor: { status: 500, code: 'PGRST000', message: 'temporarily unavailable' },
    },
  });
  const page = await context.newPage();
  await page.goto('/compose');
  await page.getByRole('textbox', { name: '오늘 남길 글' }).fill('조회 실패 시 평문 금지');
  await page.getByRole('button', { name: '남기기', exact: true }).click();

  await expect(page.getByText('지금은 이 기록을 안전하게 저장할 수 없어요.', { exact: false }))
    .toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: '다시 시도' })).toBeVisible();
  await expect(page.getByRole('button', { name: '설정 열기' })).toHaveCount(0);
  expect(dailyRecordWrites).toHaveLength(0);
  await context.close();
});
