import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { installMockBackend } from './fixtures/mockBackend';
import { CREATOR, PARTNER } from './scenarios';

const OUT = 'ui-audit-results/service-growth';
test.beforeAll(async () => { await mkdir(OUT, { recursive: true }); });

test('곰신은 군인 파트너의 읽기 전용 레벨별 EXP를 실제 화면에서 본다', async ({ page }) => {
  let partnerServiceRpcCalls = 0;
  page.on('request', (req) => {
    if (req.url().includes('/rest/v1/rpc/get_partner_service_info')) {
      partnerServiceRpcCalls += 1;
    }
  });

  const { unrouted } = await installMockBackend(page.context(), CREATOR);
  await page.goto('/search');

  await expect(page.getByTestId('gomsin-search-surface')).toBeVisible();
  await expect(page.getByTestId('soldier-service-info')).toBeVisible();
  await expect(page.getByText('몽룡의 복무')).toBeVisible();
  await expect(page.getByTestId('service-exp-readout')).toContainText('EXP');
  await expect(page.getByRole('button', { name: '복무 정보 수정' })).toHaveCount(0);

  const toggle = page.getByRole('button', { name: '전체 단계' });
  await expect(toggle).toHaveCSS('min-height', '44px');
  await toggle.click();
  await expect(page.getByTestId('service-tier-rail')).toBeVisible();
  await expect(page.getByTestId('service-tier-step-7')).toContainText('왕고');
  await page.screenshot({ path: `${OUT}/gomsin-partner-service-390.png`, fullPage: true });
  expect(unrouted).toEqual([]);
  expect(partnerServiceRpcCalls).toBe(1);
});

test('군인은 자기 복무 카드를 수정할 수 있고 상대 projection 호출을 하지 않는다', async ({ page }) => {
  let partnerServiceRpcCalls = 0;
  page.on('request', (req) => {
    if (req.url().includes('/rest/v1/rpc/get_partner_service_info')) {
      partnerServiceRpcCalls += 1;
    }
  });

  const { unrouted } = await installMockBackend(page.context(), PARTNER);
  await page.goto('/search');

  await expect(page.getByTestId('soldier-search-surface')).toBeVisible();
  await expect(page.getByText('내 복무')).toBeVisible();
  await expect(page.getByRole('button', { name: '복무 정보 수정' })).toBeVisible();
  await page.screenshot({ path: `${OUT}/soldier-own-service-390.png`, fullPage: true });
  expect(unrouted).toEqual([]);
  expect(partnerServiceRpcCalls).toBe(0);
});
