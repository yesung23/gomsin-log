import { test, expect } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { TODAY, record } from './scenarios';

/**
 * 게시물 만들기가 **실제로 저장되어 격자에 나타나는가.**
 *
 * jsdom 은 시트 리마운트와 배경 탭을 재현하지 못한다. 시뮬레이터에서 공유를 눌렀는데
 * 아무것도 저장되지 않는 증상을 봤고, 원인은 두 가지였다: 초안이 시트 안에 있어 리마운트에
 * 사라진 것과, 단계마다 시트 높이가 달라 같은 자리를 눌렀을 때 배경 탭이 되어 초안을
 * 버린 것. 둘을 고친 뒤 이곳에서 실제 저장을 판정한다.
 *
 * 판정 기준은 **사용자가 보는 것**이다 -- 격자에 게시물이 나타나는가. 내부 payload 관찰은
 * 보조 근거로만 쓴다.
 */

const PARTNER_PHOTO = record({
  id: 'rec-existing-photo',
  user_id: 'user-creator',
  log_text: '기존 사진 기록',
  record_time: '10:00',
  attachments: [{ type: 'photo', name: 'old.jpg', path: 'couple-1/rec-existing-photo/old.jpg' }],
});

test('스토리 사진은 비공개 새 기록 아래로 복사되어 게시물 격자에 나타난다', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { dailyRecordWrites, unrouted } = await installMockBackend(context, {
    userId: 'user-creator',
    displayName: '춘향',
    role: 'gomsin',
    coupleId: 'couple-1',
    partnerPresent: true,
    partnerUserId: 'user-partner',
    partnerName: '몽룡',
    records: [PARTNER_PHOTO],
  });
  const page = await context.newPage();
  const browserErrors: string[] = [];
  const storageRequests: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text());
  });
  page.on('request', (request) => {
    if (request.url().includes('/storage/v1/object/')) {
      storageRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });

  await page.goto('/us');
  /*
    공유 워크스페이스가 준비될 때까지 기다린다.

    `sharedSyncStatus` 가 아직 확인되지 않은 동안 앱은 "공유 정보를 아직 확인하지 못해
    잠시 숨겨 뒀어요" 를 띄우고 공유 쓰기를 막는다. 그것은 설계된 보호 동작이므로 테스트가
    그 상태에서 저장을 기대하면 제품이 아니라 테스트가 틀린 것이다. 기존 사진 기록이 격자에
    보이는 것이 워크스페이스가 열렸다는 신호다.
  */
  await expect(page.getByRole('button', { name: '게시물 만들기' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: /사진 게시물 열기/ })).toBeVisible({ timeout: 20_000 });
  const plusBox = await page.getByRole('button', { name: '게시물 만들기' }).boundingBox();
  expect(plusBox?.width).toBeGreaterThanOrEqual(44);
  expect(plusBox?.height).toBeGreaterThanOrEqual(44);

  // 1단계: 시트 열기
  await page.getByRole('button', { name: '게시물 만들기' }).click();
  await expect(page.getByTestId('post-composer')).toBeVisible();
  await expect(page.getByText('사진만 올릴 수 있어요. 최대 10장.')).toBeVisible();

  // 스토리에서 기존 사진 하나 담기
  await page.getByTestId('post-source-photo').first().click();

  // 사진 한 장은 불필요한 순서 단계를 건너뛰고 바로 글 쓰기로 간다.
  await page.getByRole('button', { name: '다음' }).click();
  await expect(page.getByText('글 쓰기')).toBeVisible();
  await expect(page.getByText('순서 정하기')).toHaveCount(0);
  await page.getByTestId('post-caption').fill('브라우저에서 만든 게시물');
  for (const target of [
    page.getByRole('button', { name: '이전 단계' }),
    page.getByTestId('post-share'),
    page.getByRole('switch', { name: /나만 보기/ }),
  ]) {
    const box = await target.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  const screenshotPath = testInfo.outputPath('post-composer-caption.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach('post-composer-caption', { path: screenshotPath, contentType: 'image/png' });
  await page.getByRole('switch', { name: /나만 보기/ }).click();
  await page.getByTestId('post-share').click();

  /*
    실패했을 때 무엇이 막았는지 화면에서 읽어 남긴다.

    `publishPost` 는 실패 시 시트를 열어 두고 토스트로 이유를 말한다. 그 이유를 보지 않고
    "저장되지 않았다" 만 기록하면 제품 결함인지 테스트 전제가 틀린 것인지 구분할 수 없다.
  */
  const composerStillOpen = await page.getByTestId('post-composer')
    .waitFor({ state: 'detached', timeout: 20_000 })
    .then(() => false)
    .catch(() => true);
  if (composerStillOpen) {
    const banner = await page.locator('[role="status"]').allInnerTexts();
    const toasts = await page.locator('[data-sonner-toast], [role="alert"]').allInnerTexts();
    throw new Error(
      `공유 후에도 시트가 닫히지 않았다.\nstatus=${JSON.stringify(banner)}\ntoast=${JSON.stringify(toasts)}\nwrites=${dailyRecordWrites.length}\nbrowserErrors=${JSON.stringify(browserErrors)}\nstorageRequests=${JSON.stringify(storageRequests)}\nunrouted=${JSON.stringify(unrouted)}`,
    );
  }

  // 사용자가 보는 증거: 격자에 오늘 게시물이 나타난다.
  await expect(page.getByRole('button', { name: new RegExp(`${TODAY} 사진 게시물`) }))
    .toBeVisible({ timeout: 20_000 });

  // 보조 근거: 저장 요청이 계약대로 나갔다.
  expect(dailyRecordWrites.length).toBeGreaterThan(0);
  const written = dailyRecordWrites.at(-1)!;
  expect(written.log_text).toBe('브라우저에서 만든 게시물');
  expect(written.is_private).toBe(true);
  expect(written.record_date).toBe(TODAY);
  const attachments = written.attachments as Array<{ path?: string }>;
  expect(attachments).toHaveLength(1);
  expect(attachments[0].path).toMatch(new RegExp(`^couple-1/${String(written.id)}/[^/]+\\.jpg$`));
  expect(attachments[0].path).not.toContain(PARTNER_PHOTO.id as string);
  expect(storageRequests.some((entry) => (
    entry.startsWith('POST /storage/v1/object/couple-media/couple-1/')
    && !entry.includes(PARTNER_PHOTO.id as string)
  ))).toBe(true);

  expect(unrouted, `unrouted supabase calls: ${unrouted.join(', ')}`).toEqual([]);
  await context.close();
});

test('보호 설정 전 공개 게시물은 쓰지 않고 설정 경로를 안내한다', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const { dailyRecordWrites } = await installMockBackend(context, {
    userId: 'user-creator',
    displayName: '춘향',
    role: 'gomsin',
    coupleId: 'couple-1',
    partnerPresent: true,
    partnerUserId: 'user-partner',
    partnerName: '몽룡',
    records: [PARTNER_PHOTO],
  });
  const page = await context.newPage();

  await page.goto('/us');
  // 첫 테스트와 같은 이유로 공유 워크스페이스가 열릴 때까지 기다린다.
  await expect(page.getByRole('button', { name: /사진 게시물 열기/ })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '게시물 만들기' }).click();
  await page.getByTestId('post-source-photo').first().click();
  await page.getByRole('button', { name: '다음' }).click();
  await page.getByTestId('post-share').click();

  await expect(page.getByTestId('post-composer')).toBeVisible();
  await expect(page.getByText(/기록 보호 설정이 필요해요/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: '설정 열기' })).toBeVisible();
  expect(dailyRecordWrites).toHaveLength(0);
  await context.close();
});
