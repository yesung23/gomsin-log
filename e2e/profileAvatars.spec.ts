import { expect, test, type BrowserContext } from '@playwright/test';
import sharp from 'sharp';
import { installMockBackend, type Scenario } from './fixtures/mockBackend';
import { CREATOR } from './scenarios';

const A = '10000000-0000-4000-8000-000000000001';
const B = '10000000-0000-4000-8000-000000000002';
type Photo = { user_id: string; version: string; jpeg_base64: string | null };

test('My photo appears in both story rails, can be replaced and removed, and is not persisted locally', async ({ browser }, testInfo) => {
  const photos = new Map<string, Photo>();
  let refuseWrite = false;
  const setup = async (context: BrowserContext, id: string, partner: string) => {
    const scenario: Scenario = { ...CREATOR, userId: id, partnerUserId: partner,
      displayName: id === A ? '봄' : '여름', partnerName: id === A ? '여름' : '봄', records: [] };
    await installMockBackend(context, scenario);
    await context.route('**/rest/v1/rpc/*profile_avatar', async (route) => {
      const params = route.request().postDataJSON();
      if (route.request().url().endsWith('/get_profile_avatar')) {
        return route.fulfill({ json: [id, partner].includes(params.p_owner_user_id) ? photos.get(params.p_owner_user_id) ?? null : null });
      }
      if (refuseWrite) return route.fulfill({ status: 503, json: { code: 'unavailable' } });
      if (params.p_expected_user_id !== id || (photos.get(id)?.version ?? null) !== params.p_expected_version) {
        return route.fulfill({ status: 409, json: { code: '40001' } });
      }
      photos.set(id, { user_id: id, version: params.p_operation_id, jpeg_base64: params.p_jpeg_base64 });
      return route.fulfill({ json: { user_id: id, version: params.p_operation_id } });
    });
  };
  const a = await browser.newContext({ viewport: { width: 402, height: 874 } });
  const b = await browser.newContext({ viewport: { width: 375, height: 667 }, colorScheme: 'dark' });
  await setup(a, A, B); await setup(b, B, A);
  const owner = await a.newPage(); const partner = await b.newPage();
  await owner.goto('/my'); await partner.goto('/home');
  const source = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#dc8396' } }).jpeg().toBuffer();
  await expect(owner.getByRole('button', { name: '내 사진 고르기' })).toBeVisible();
  await owner.locator('input[type=file]').setInputFiles({ name: 'private-original-name.jpg', mimeType: 'image/jpeg', buffer: source });
  await expect(owner.getByText('프로필 사진을 바꿨어요.', { exact: true })).toBeVisible();
  const saved = photos.get(A)!;
  const metadata = await sharp(Buffer.from(saved.jpeg_base64!, 'base64')).metadata();
  expect(metadata.width).toBe(256); expect(metadata.height).toBe(256);
  expect(Buffer.from(saved.jpeg_base64!, 'base64').length).toBeLessThanOrEqual(65_536);
  expect(metadata.exif).toBeUndefined();
  await owner.goto('/home');
  const ownPhoto = owner.getByRole('button', { name: '내 스토리', exact: true }).locator('img');
  await expect(ownPhoto).toHaveAttribute('src', `data:image/jpeg;base64,${saved.jpeg_base64}`);
  // Foreground revalidation is the recovery path when a realtime event is lost.
  await partner.evaluate(() => window.dispatchEvent(new Event('focus')));
  const partnerPhoto = partner.getByRole('button', { name: '봄의 스토리' }).locator('img');
  await expect(partnerPhoto).toHaveAttribute('src', `data:image/jpeg;base64,${saved.jpeg_base64}`);
  await partner.screenshot({ path: testInfo.outputPath('partner-story-photo.png'), fullPage: true });
  expect(await owner.evaluate(() => Object.entries(localStorage).some(([key, value]) => key.startsWith('gomsinlog.avatar.') || value.includes('data:image/')))).toBe(false);

  await owner.goto('/my');
  refuseWrite = true;
  await owner.getByRole('button', { name: '내 사진 바꾸기 또는 지우기' }).click();
  await owner.locator('input[type=file]').setInputFiles({ name: 'replacement.jpg', mimeType: 'image/jpeg', buffer: source });
  await expect(owner.getByText('사진을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.', { exact: true })).toBeVisible();
  expect(photos.get(A)?.version).toBe(saved.version);
  refuseWrite = false;
  const replacement = await sharp({ create: { width: 800, height: 1200, channels: 3, background: '#6c7953' } }).jpeg().toBuffer();
  await owner.locator('input[type=file]').setInputFiles({ name: 'replacement.jpg', mimeType: 'image/jpeg', buffer: replacement });
  await expect(owner.getByText('프로필 사진을 바꿨어요.', { exact: true })).toBeVisible();
  const replaced = photos.get(A)!;
  expect(replaced.version).not.toBe(saved.version);
  expect(replaced.jpeg_base64).not.toBe(saved.jpeg_base64);
  await partner.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(partnerPhoto).toHaveAttribute('src', `data:image/jpeg;base64,${replaced.jpeg_base64}`);
  // Sonner pauses dismissal while the pointer hovers the top toast stack.
  // Move away and let feedback finish before interacting with the covered avatar.
  await owner.mouse.move(350, 550);
  await expect(owner.locator('[data-sonner-toast]')).toHaveCount(0);
  await owner.evaluate(() => window.scrollTo(0, 0));
  await owner.getByRole('button', { name: '내 사진 바꾸기 또는 지우기' }).click();
  await owner.getByRole('button', { name: '내 사진 지우고 기본 그림으로' }).click();
  await expect(owner.getByText('기본 그림으로 돌아갔어요.', { exact: true })).toBeVisible();
  await partner.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(partnerPhoto).toHaveCount(0);
  expect(photos.get(A)?.jpeg_base64).toBeNull();
  expect(photos.get(A)?.version).not.toBe(saved.version);
  await a.close(); await b.close();
});
