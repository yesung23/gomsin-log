import { test, expect, type Browser, type Page } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { CREATOR } from './scenarios';

/**
 * Contrast of the coral action surface, measured in a real Chromium paint.
 *
 * This exists because the number cannot be computed from the stylesheet. The
 * tokens are `oklch()`, and docs/kiro/AI_HANDOFF.md §4.1 records that parsing the
 * `oklch()` string yields the wrong ratio -- the value has to be rasterised and
 * sampled. So every colour below is assigned to a live element, read back with
 * getComputedStyle, painted onto a 2D canvas and read out byte-for-byte.
 *
 * Two things are asserted, and the second is what makes the first meaningful:
 *
 *   1. Every rendered `bg-coral-strong` surface that carries text clears WCAG AA.
 *   2. The pairing it REPLACED still fails, at the ratio AI_HANDOFF measured.
 *
 * Without (2) this file would keep passing if someone quietly redefined
 * `--coral-strong` back to `--coral`.
 */

const AA_NORMAL_TEXT = 4.5;
/** WCAG 1.4.11 for a filled control against the surface behind it. */
const AA_NON_TEXT = 3;

type Sampled = { css: string; rgb: [number, number, number] };
type Measured = {
  route: string;
  label: string;
  background: Sampled;
  foreground: Sampled;
  ratio: number;
};

/**
 * Injected into the page. Declared as a string-free function so Playwright
 * serialises it; everything it needs is created inside the browser.
 */
function measureInPage(selector: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
  if (!context) throw new Error('no 2d context');

  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.position = 'fixed';
  probe.style.left = '-9999px';
  document.body.appendChild(probe);

  function sample(css: string) {
    probe.style.color = '';
    probe.style.color = css;
    const computed = getComputedStyle(probe).color;
    // An unsupported fillStyle is silently IGNORED by canvas, which would report
    // the previous colour as this one. Seed a known value so that shows up.
    context!.fillStyle = 'rgb(1, 2, 3)';
    context!.fillStyle = computed;
    context!.fillRect(0, 0, 1, 1);
    const data = context!.getImageData(0, 0, 1, 1).data;
    return { css, rgb: [data[0], data[1], data[2]] as [number, number, number] };
  }

  function luminance(rgb: [number, number, number]) {
    const linear = rgb.map((channel) => {
      const c = channel / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  }

  function ratio(a: [number, number, number], b: [number, number, number]) {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
  }

  const selfCheck = {
    red: sample('rgb(255, 0, 0)').rgb,
    black: sample('oklch(0 0 0)').rgb,
    white: sample('oklch(1 0 0)').rgb,
  };

  const found: Array<{ label: string; background: ReturnType<typeof sample>; foreground: ReturnType<typeof sample>; ratio: number }> = [];
  for (const element of Array.from(document.querySelectorAll(selector))) {
    const text = (element.textContent ?? '').trim();
    if (!text) continue;
    const box = element.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) continue;
    const style = getComputedStyle(element);
    const background = sample(style.backgroundColor);
    const foreground = sample(style.color);
    found.push({
      label: text.slice(0, 24),
      background,
      foreground,
      ratio: ratio(background.rgb, foreground.rgb),
    });
  }

  // The pairing this token replaced, and the surface a filled control sits on.
  const tokenOf = (name: string) =>
    getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const reference = {
    coralWithLightLabel: ratio(
      sample(tokenOf('--coral')).rgb,
      sample(tokenOf('--coral-foreground')).rgb,
    ),
    coralStrongOnBackground: ratio(
      sample(tokenOf('--coral-strong')).rgb,
      sample(tokenOf('--background')).rgb,
    ),
    coralStrongAsTextOnCard: ratio(
      sample(tokenOf('--coral-strong')).rgb,
      sample(tokenOf('--card')).rgb,
    ),
    /*
     * `--coral-fill` was split out on 2026-08-09 so the primary CTA could be pink
     * while `--coral-strong` stays dark enough to be coral INK on a card. The two
     * therefore have DIFFERENT obligations and both are measured:
     *   - the fill must carry its label at 4.5:1
     *   - the ink must clear 4.5:1 on a card, which is asserted above
     * Retuning the shared token to pink is what this pair prevents; it failed here
     * first, at 2.00:1 as text.
     */
    coralFillWithItsLabel: ratio(
      sample(tokenOf('--coral-fill')).rgb,
      sample(tokenOf('--coral-fill-foreground')).rgb,
    ),
  };

  probe.remove();
  return { selfCheck, found, reference, theme: document.documentElement.dataset.theme ?? 'light' };
}

async function open(browser: Browser, colorScheme: 'light' | 'dark') {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme,
  });
  await installMockBackend(context, CREATOR);
  /*
   * `colorScheme` alone does NOT put this app in dark mode.
   *
   * `preferredTheme()` reads `prefers-color-scheme` only when there is no stored
   * preference, and mockBackend seeds `gomsinlog.state.v2` with `theme: 'light'`
   * so the very first paint is authenticated and stable. The stored value wins,
   * exactly as it does for a real user who once chose a theme.
   *
   * So the preference is set the same way mockBackend sets
   * `hasSeenInstallPrompt`: through the store's own persisted state, before any
   * app script runs. Init scripts run in registration order, so this merges over
   * the seed rather than racing it.
   */
  await context.addInitScript((theme) => {
    const key = 'gomsinlog.state.v2';
    const raw = window.localStorage.getItem(key);
    const stored = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    window.localStorage.setItem(key, JSON.stringify({ ...stored, theme }));
  }, colorScheme);
  const page = await context.newPage();
  return { context, page };
}

async function goto(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator('#root')).not.toBeEmpty();
  /*
    앱이 떴다는 표식은 **탭바 자체**다 (2026-08-23).

    앞선 판은 `마이` 라는 글자를 찾았다. V4가 탭바에서 눈으로 읽는 글자를 걷어내면서
    (인스타의 근육 기억을 빌리려면 글자가 없어야 한다) 그 글자가 사라졌고, 이 헬퍼를
    지나는 거의 모든 스펙이 한꺼번에 멈췄다.

    이름이 아니라 **구조**를 본다: 하단 내비게이션이 다섯 칸을 그렸는가. 라벨이 또
    바뀌어도 이 단언은 같은 것을 지킨다 -- 그리고 칸 하나가 사라지면 여기서 걸린다.
  */
  await expect(page.getByRole('tablist', { name: '하단 내비게이션' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('tablist', { name: '하단 내비게이션' }).getByRole('tab')).toHaveCount(5);
}

/**
 * Routes chosen because each one paints a different KIND of coral action: a
 * floating CTA over content, a toolbar button, a full-width form submit and a
 * destructive-flow confirm.
 */
const ROUTES = ['/record', '/schedule', '/my', '/settings'];

for (const colorScheme of ['light', 'dark'] as const) {
  test(`coral action surfaces clear WCAG AA in ${colorScheme}`, async ({ browser }) => {
    const { context, page } = await open(browser, colorScheme);
    const measured: Measured[] = [];
    let reference: { coralWithLightLabel: number; coralStrongOnBackground: number; coralStrongAsTextOnCard: number } | null = null;

    for (const route of ROUTES) {
      await goto(page, route);
      /*
       * Both filled-coral tokens. `bg-coral-fill` is the pink primary CTA and
       * `bg-coral-strong` is what remains on small dark-filled elements (selected
       * calendar cell, numbered step bullets), and a label on either has to clear
       * AA. Matching only the old class silently stopped measuring every primary
       * button the moment the fill was split out.
       *
       * `ink-fill` 은 V4 가 같은 자리에 놓은 세 번째 토큰이다 (2026-08-23). 종이로
       * 옮기면서 채워진 1차 동작이 산호빛에서 잉크로 바뀌었고 -- `Button` 의
       * `primary` 가 곧 `ink-fill` 이다 -- 이 목록을 따라 옮기지 않았더니 네 화면에서
       * 잴 것이 **0개**가 됐다. 아래의 `>= 3` 이 그 사실을 잡았다: 색이 바뀌었을 뿐
       * 라벨이 바닥을 지켜야 한다는 규칙은 그대로다.
       */
      const result = await page.evaluate(
        measureInPage,
        '[class*="bg-coral-strong"],[class*="bg-coral-fill"],[class*="ink-fill"]',
      );

      // If canvas cannot rasterise the computed colour, every number is garbage.
      expect(result.selfCheck.red, 'canvas rasterisation').toEqual([255, 0, 0]);
      expect(result.selfCheck.black, 'canvas understands oklch()').toEqual([0, 0, 0]);
      expect(result.selfCheck.white, 'canvas understands oklch()').toEqual([255, 255, 255]);
      expect(result.theme, `theme under prefers-color-scheme: ${colorScheme}`).toBe(colorScheme);

      reference = result.reference;
      for (const entry of result.found) measured.push({ route, ...entry });
    }

    await context.close();

    /*
      A selector typo, or a screen that stopped rendering, must not pass silently.

      앞선 판은 `>= 3` 이었다. 그 숫자는 산호빛이 채워진 1차 동작을 독점하던 때
      네 화면에서 실제로 세어지던 수였고, V4 가 채워진 동작을 잉크로 옮기면서
      같은 네 화면의 실측이 2 가 됐다 -- 종이 디자인은 채우기보다 **테두리**를
      더 쓴다(`ink-chip` · `ink-box`).

      숫자를 2 로 낮추면 다음에 또 낮추게 되고, 라우트를 늘려 3 을 맞추면 그 라우트는
      대비를 재려고가 아니라 숫자를 채우려고 있는 것이 된다. 그래서 개수 대신 이
      단언이 원래 잡으려던 **성질**을 쓴다: 아무것도 재지 않았거나, 화면 하나에서만
      재고 있으면(= 나머지가 안 그려지고 있으면) 실패한다.
    */
    expect(measured.length, '채워진 동작 표면을 하나도 재지 못했다').toBeGreaterThan(0);
    /*
      그리고 **이름 있는 자리** 하나를 못박는다.

      개수로 거는 트립와이어를 두 번 틀렸다. `>= 3` 은 산호빛 시절의 실측치였고,
      그 다음 시도인 "서로 다른 화면 둘 이상" 은 더 나빴다 -- 초록으로 만들어 준
      둘째 화면이 `/schedule` 의 **에러 상태**에 뜨는 `다시 시도` 버튼이었다.
      화면이 정상이면 그 버튼이 없으므로 실행마다 흔들렸고, 무엇보다 **깨진 화면이
      커버리지로 세어지고 있었다.**

      그래서 세는 대신 지목한다. `/record` 의 떠 있는 `기록 남기기` 는 컴포저 시트가
      열려 있지 않은 한 언제나 있는, 이 앱에서 가장 중요한 채워진 동작이다. 그것이
      재어지지 않았다면 선택자가 틀렸거나 그 화면이 그려지지 않은 것이고, 둘 다
      이 단언이 잡으려던 바로 그것이다.
    */
    const routesMeasured = new Set(measured.map((entry) => entry.route));
    expect(
      routesMeasured.has('/record'),
      `/record 의 기록 남기기를 재지 못했다. 잰 화면: ${[...routesMeasured].join(', ') || '없음'}`,
    ).toBe(true);

    const failing = measured
      .filter((entry) => entry.ratio < AA_NORMAL_TEXT)
      .map((entry) => `${entry.route} "${entry.label}" ${entry.ratio.toFixed(2)}:1 `
        + `(${entry.background.rgb.join(',')} vs ${entry.foreground.rgb.join(',')})`);
    expect(failing, 'coral surfaces below AA 4.5:1').toEqual([]);

    // The replaced pairing must still be measurably broken, otherwise the token
    // split has been undone and this test would be guarding nothing.
    expect(reference!.coralWithLightLabel).toBeLessThan(AA_NORMAL_TEXT);
    expect(reference!.coralWithLightLabel).toBeGreaterThan(1.5);

    // The filled control also has to be visible AS a control (WCAG 1.4.11), and
    // the same token has to work as coral ink on a card.
    expect(reference!.coralStrongOnBackground).toBeGreaterThanOrEqual(AA_NON_TEXT);
    expect(reference!.coralStrongAsTextOnCard).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);

    // The pink CTA fill has to carry its own label. This is the assertion that
    // makes the fill/ink split safe: it fails if someone lightens the label or
    // points `primary` back at a token whose pairing was never measured.
    expect(reference!.coralFillWithItsLabel).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });
}
