import { expect, test, type Page } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { NO_SPACE } from './scenarios';

const GENERAL_NEW_ACCOUNT = {
  ...NO_SPACE,
  newAccount: true,
  relationshipContext: 'general',
  createCoupleId: 'couple-general-e2e',
} as const;

async function assertViewportFits(page: Page) {
  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.scrollWidth - layout.clientWidth, 'onboarding must not overflow horizontally').toBeLessThanOrEqual(1);
}

for (const width of [320, 390]) {
  test(`general-couple creator completes onboarding without military identity at ${width}px`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    const { unrouted } = await installMockBackend(context, GENERAL_NEW_ACCOUNT);
    const page = await context.newPage();
    const pageErrors: string[] = [];
    const rpcRequests: Array<{ path: string; body: unknown }> = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/rest/v1/rpc/')) {
        rpcRequests.push({ path: url.pathname, body: request.postDataJSON?.() });
      }
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: '곰신로그를 어떻게 사용할까요?' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: /저는 곰신 커플이 아니에요/ }).click();

    const genderGroup = page.getByRole('group', { name: '성별' });
    await expect(genderGroup).toBeVisible();
    await expect(genderGroup.getByRole('button', { name: '답하지 않을래요' })).toHaveAttribute('aria-pressed', 'true');
    await assertViewportFits(page);

    await page.getByRole('button', { name: '다음' }).click();
    await expect(page.getByRole('heading', { name: '어떻게 불러드리면 될까요?' })).toBeVisible();
    await page.getByLabel('내 닉네임 (2~12자)').fill('하루');
    await page.getByRole('button', { name: '다음' }).click();

    await expect(page.getByRole('heading', { name: '우리 둘만의 로그를 시작해볼까요?' })).toBeVisible();
    await page.getByRole('button', { name: '다음' }).click();
    await expect(page.getByText(/^\d{6}$/)).toBeVisible();

    const creationCall = rpcRequests.find((call) => call.path.endsWith('/create_couple_and_invitation_v2'));
    expect(creationCall).toBeDefined();
    expect(creationCall?.body).toMatchObject({
      p_role: 'gomsin',
      p_relationship_context: 'general',
    });

    await page.getByRole('button', { name: '다음' }).click();
    await expect(page.getByRole('heading', { name: '둘은 언제부터 함께였나요?' })).toBeVisible();
    await page.getByRole('button', { name: '다음' }).click();
    await expect(page.getByRole('heading', { name: '언제 알려드리면 좋을까요?' })).toBeVisible();
    await expect(page.getByText('복무 정보를 알려주세요.')).toHaveCount(0);
    await expect(page.getByText(/군화|입대|전역|군종/)).toHaveCount(0);
    await assertViewportFits(page);

    await page.getByRole('button', { name: '지금은 설정하지 않을래요' }).click();
    await expect(page.getByRole('heading', { name: '우리 둘만의 곰신로그가 준비됐어요.' })).toBeVisible();
    await page.screenshot({ path: `e2e/.artifacts/general-onboarding/general-${width}.png` });

    expect(pageErrors).toEqual([]);
    expect(unrouted).toEqual([]);
    await context.close();
  });

  test(`military onboarding remains explicit and operable at ${width}px`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    const { unrouted } = await installMockBackend(context, {
      ...NO_SPACE,
      newAccount: true,
      role: 'soldier',
    });
    const page = await context.newPage();

    await page.goto('/');
    await expect(page.getByRole('heading', { name: '곰신로그를 어떻게 사용할까요?' })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: '나는 군화예요' }).click();
    await expect(page.getByRole('button', { name: '나는 군화예요' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: /저는 곰신 커플이 아니에요/ })).toHaveAttribute('aria-pressed', 'false');
    await assertViewportFits(page);
    await page.screenshot({ path: `e2e/.artifacts/general-onboarding/military-${width}.png` });

    expect(unrouted).toEqual([]);
    await context.close();
  });
}
