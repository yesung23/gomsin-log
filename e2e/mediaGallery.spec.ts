import { test, expect, type Page } from '@playwright/test';
import { installMockBackend } from './fixtures/mockBackend';
import { CREATOR, TODAY, record } from './scenarios';

/**
 * The media surfaces, in a real browser, with real images.
 *
 * ## Why this file has to exist separately
 *
 * `e2e/scenarios.ts` gives every record `attachments: []`. That was harmless
 * while media was a 68px thumbnail beside the prose, and it stopped being
 * harmless when media became the largest thing on the screen: the whole gallery,
 * the carousel, the fullscreen viewer and the photo grid had **no browser
 * coverage at all**, and the jsdom suite structurally cannot supply it -- it
 * computes no layout, so `aspect-ratio`, `100cqw` and `overflow` are invisible to
 * it. `uiAudit.spec.ts` photographs the app, but with the stock fixtures it
 * photographs an app with no photographs in it.
 *
 * ## What it actually proves
 *
 * Three things a unit test cannot:
 *
 *   1. A slide has non-zero width. Astryx wraps carousel children in
 *      `flex-shrink: 0` with no width, so `w-full` collapses to nothing; the fix
 *      is `100cqw` against an `@container`, and only a layout engine can confirm
 *      it resolved.
 *   2. Nothing overflows horizontally at 320px, which is the narrowest supported
 *      screen and the one full-bleed media is most likely to break.
 *   3. The record row still contains its media rather than drawing over the
 *      record below -- the original defect the 68px column was introduced to fix.
 */

/**
 * A real 80x100 coral PNG, generated rather than hand-typed.
 *
 * The first version of this constant was a hand-written base64 string that
 * decoded to nothing. Chromium answered the request 200 with `image/png`, the
 * `<img>` fired `error` anyway because the bytes were not a picture, the
 * gallery's own recovery re-signed once, got the same URL back and correctly
 * settled on `이 파일을 열 수 없어요` -- so every geometry assertion in this file
 * passed against an empty aspect box while nothing was on screen. Hence the
 * `naturalWidth` check below: a box is not a photograph.
 *
 * 4:5, matching the gallery's crop, and a visible colour so the captured
 * screenshots show something a person can actually review.
 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAFAAAABkCAIAAACemCBBAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAA' +
    '+ElEQVR4nO3X0Q0AQQgCUWufmi3gqtj4cS+xAAUFnK1f1Zx3YOAwnJXODUe0otJsaa9NUvBI0kq0' +
    'TJbO85BvqXvDYEu9gGDOIcdwTyGYc8gxHIaz0rnhiFZUmi3tD2rOOzBwGM5K54YjWlFptrTXJil4' +
    'JGklWiZL53nIt9S9YbClXkAw55BjuKcQzDnkGA7DWenccEQrKs2W9gc15x0YOAxnpXPDEa2oNFva' +
    'a5MUPJK0Ei2TpfM85Fvq3jDYUi8gmHPIMdxTCOYccgyH4ax0bjiiFZVmS/uDmvMODByGs9K54YhW' +
    'VJot7bVJCh5JWomWydJ5Hvrvt/QBbk+JlC7nxAsAAAAASUVORK5CYII=',
  'base64',
);

const PHOTO_RECORD = record({
  id: 'rec-photos',
  user_id: 'user-creator',
  log_text: '오늘 본 노을',
  record_time: '18:40',
  attachments: [
    { type: 'photo', name: 'sunset-1.jpg', path: 'couple-1/rec-photos/1.jpg' },
    { type: 'photo', name: 'sunset-2.jpg', path: 'couple-1/rec-photos/2.jpg' },
    { type: 'photo', name: 'sunset-3.jpg', path: 'couple-1/rec-photos/3.jpg' },
  ],
});

const SINGLE_PHOTO_RECORD = record({
  id: 'rec-one-photo',
  user_id: 'user-creator',
  log_text: '아침',
  record_time: '08:10',
  attachments: [{ type: 'photo', name: 'morning.jpg', path: 'couple-1/rec-one-photo/1.jpg' }],
});

const WITH_MEDIA = {
  ...CREATOR,
  records: [...CREATOR.records, SINGLE_PHOTO_RECORD, PHOTO_RECORD],
};

async function boot(
  browser: import('@playwright/test').Browser,
  viewport = { width: 390, height: 844 },
): Promise<Page> {
  const context = await browser.newContext({ viewport });
  await installMockBackend(context, WITH_MEDIA);
  /*
   * The mock backend signs every object to `/storage/v1/object/signed-stub`,
   * which returns nothing. An `<img>` pointed at it fires `error`, the gallery
   * falls back to the filename, and the layout under test never renders. Serving
   * real bytes is the only way the aspect box gets a real image to crop.
   */
  await context.route('**/*signed-stub*', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG }),
  );
  return context.newPage();
}

async function ready(page: Page) {
  await expect(page.getByText('마이', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
}

/**
 * The tab bar exists before the records arrive.
 *
 * Waiting only for `ready()` and then switching lenses photographed an empty
 * grid: the shared-sync banner was still up, the day had zero records, and the
 * assertion failed on a product that was mid-fetch rather than wrong.
 */
async function recordsLoaded(page: Page) {
  await expect(page.getByText('오늘 본 노을')).toBeVisible({ timeout: 20_000 });
}

/**
 * The lens switch.
 *
 * Astryx renders `SegmentedControl` as a `radiogroup` of `radio`s, not as
 * buttons -- which is the correct APG mapping for "pick one of these" and is why
 * a `getByRole('button')` query silently matched nothing. Scoped by test id as
 * well, because `사진` also names one of the media filter chips below it.
 */
function lens(page: Page, name: '타임라인' | '사진') {
  return page.getByTestId('record-lens').getByRole('radio', { name, exact: true });
}

/** Horizontal overflow anywhere in the document. The one defect full-bleed media causes. */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(0, doc.scrollWidth - doc.clientWidth);
  });
}

test('a record with three photos swipes, and every slide has real width', async ({ browser }) => {
  const page = await boot(browser);
  await page.goto('/record');
  await ready(page);
  await recordsLoaded(page);

  const carousel = page.getByTestId('record-media-carousel');
  await expect(carousel).toBeVisible();

  const slides = carousel.getByTestId('record-attachment');
  await expect(slides).toHaveCount(3);

  const track = await carousel.boundingBox();
  expect(track, 'the carousel should have a box').not.toBeNull();

  /*
   * The photo has to have DECODED, not merely have a box. An `<img>` whose src
   * 404s still lays out at the aspect box's size, so every geometry assertion
   * below would pass on a gallery showing nothing at all.
   */
  const decoded = await carousel.locator('img').first().evaluate(
    (node) => (node as HTMLImageElement).naturalWidth,
  );
  expect(decoded, 'the photo should have decoded').toBeGreaterThan(0);

  for (let i = 0; i < 3; i += 1) {
    const box = await slides.nth(i).boundingBox();
    expect(box, `slide ${i} should have a box`).not.toBeNull();
    /*
     * The collapse this guards against renders at ~0px. Requiring most of the
     * track's width also catches the subtler failure where a slide sizes to its
     * image's intrinsic 2px instead of to the column.
     */
    expect(box!.width, `slide ${i} width`).toBeGreaterThan(track!.width * 0.7);
    expect(box!.height, `slide ${i} height`).toBeGreaterThan(100);
  }

  await page.screenshot({ path: './ui-audit-results/after/media-carousel-390.png' });
  await page.context().close();
});

test('a single photo fills the content column and stays inside its own row', async ({ browser }) => {
  const page = await boot(browser);
  await page.goto('/record');
  await ready(page);
  await recordsLoaded(page);

  const row = page.locator('#record-rec-one-photo');
  await expect(row).toBeVisible();

  const rowBox = await row.boundingBox();
  const media = row.getByTestId('record-attachment').first();
  const mediaBox = await media.boundingBox();

  expect(mediaBox!.width).toBeGreaterThan(150);
  /*
   * The defect the 68px column was introduced to fix: absolutely-positioned
   * media contributed no height and drew over the record below. Media is back to
   * full width, so this asserts the row still contains it.
   */
  expect(mediaBox!.y + mediaBox!.height).toBeLessThanOrEqual(rowBox!.y + rowBox!.height + 1);

  await page.context().close();
});

test('the photo lens shows a grid, and opens a photo full-screen', async ({ browser }) => {
  const page = await boot(browser);
  await page.goto('/record');
  await ready(page);
  await recordsLoaded(page);

  await lens(page, '사진').click();

  const cells = page.getByRole('button', { name: /크게 보기/ });
  await expect(cells.first()).toBeVisible();
  // 3 from the carousel record + 1 single = 4 frames, voice excluded.
  await expect(cells).toHaveCount(4);
  await page.screenshot({ path: './ui-audit-results/after/media-grid-390.png' });

  await page.context().close();
});

test('a photo opens full-screen, and Escape closes it', async ({ browser }) => {
  /*
   * Opened from the TIMELINE lens rather than the grid, and as the first action
   * after the records land.
   *
   * The mock backend aborts the realtime channel, so the store correctly flips
   * `sharedSyncStatus` to `unavailable` a few seconds after load and stops
   * showing rows it can no longer vouch for. That is right, and it means every
   * extra round-trip before this click is a chance for the photo to be gone.
   * Both entry points render the same `Lightbox`, so opening from the shorter
   * path proves the same thing.
   */
  const page = await boot(browser);
  const expand = page.getByRole('button', { name: 'morning.jpg 크게 보기' });

  /*
   * Reload until the tap lands.
   *
   * `sharedSyncStatus` flips to `unavailable` a few seconds after load -- the
   * mock aborts the realtime channel and the store stops showing rows it can no
   * longer vouch for, which is correct. The photo therefore has a short window,
   * and a click that arrives after it waits out its timeout on an element that
   * has legitimately gone. Reloading re-opens the window; three attempts is far
   * more than the one it normally takes.
   */
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto('/record');
    await ready(page);
    try {
      /*
       * Clicked near the top-left of the photo rather than at its centre.
       * A 4:5 photo is taller than the space between the app bar and the
       * floating `지금의 마음 남기기` CTA, so the geometric centre of the overlay
       * can sit underneath that fixed layer and Playwright's actionability check
       * correctly refuses. A person taps the part of the picture they can see.
       */
      await expand.click({ timeout: 8_000, position: { x: 24, y: 24 } });
      break;
    } catch {
      if (attempt === 2) throw new Error('the expand control never became clickable');
    }
  }

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: './ui-audit-results/after/media-lightbox-390.png' });

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await page.context().close();
});

test('nothing overflows at 320px, in either lens', async ({ browser }) => {
  const page = await boot(browser, { width: 320, height: 568 });
  await page.goto('/record');
  await ready(page);
  await recordsLoaded(page);

  expect(await horizontalOverflow(page), 'timeline lens at 320').toBe(0);
  await page.screenshot({ path: './ui-audit-results/after/media-timeline-320.png' });

  await lens(page, '사진').click();
  await expect(page.getByRole('button', { name: /크게 보기/ }).first()).toBeVisible();
  expect(await horizontalOverflow(page), 'photo lens at 320').toBe(0);
  await page.screenshot({ path: './ui-audit-results/after/media-grid-320.png' });

  await page.context().close();
});

test("상대방의 오늘 shows the partner's photo at full width", async ({ browser }) => {
  /*
   * The partner's own record carries the media here, so this exercises the home
   * widget's copy of the gallery rather than the 기록 tab's.
   */
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await installMockBackend(context, {
    ...CREATOR,
    userId: 'user-partner',
    displayName: '몽룡',
    role: 'soldier',
    partnerName: '춘향',
    records: [
      record({
        id: 'rec-partner-photo',
        user_id: 'user-creator',
        log_text: '점심 먹다가 생각났어',
        record_date: TODAY,
        record_time: '12:10',
        attachments: [{ type: 'photo', name: 'lunch.jpg', path: 'couple-1/rec-partner-photo/1.jpg' }],
      }),
    ],
  });
  await context.route('**/*signed-stub*', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PNG }),
  );
  const page = await context.newPage();

  await page.goto('/home');
  await ready(page);

  const widget = page.getByTestId('widget-partner-day');
  await expect(widget).toBeVisible();
  const media = widget.getByTestId('record-attachment').first();
  await expect(media).toBeVisible();
  expect((await media.boundingBox())!.width).toBeGreaterThan(150);

  expect(await horizontalOverflow(page)).toBe(0);
  await page.screenshot({ path: './ui-audit-results/after/media-partner-day-390.png' });
  await context.close();
});
