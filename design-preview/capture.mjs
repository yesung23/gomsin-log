// Screenshot the design preview and audit every frame for horizontal overflow.
//
// Serves the built preview over a throwaway localhost server (ES modules are
// blocked over file://) and captures each device frame element individually, so
// each PNG is exactly the phone viewport.
//
// Every screen is captured in the `normal` state across both viewports and both
// themes. The four state-heavy screens additionally get 빈/로딩/오류/긴 텍스트, which
// is where layout actually breaks.
//
// Usage:
//   npx vite build --config design-preview/vite.config.ts --outDir <dist>
//   node design-preview/capture.mjs <dist> <outDir>

import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const dist = resolve(process.argv[2]);
const outDir = resolve(process.argv[3]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const rel = url.pathname === '/' ? '/index.html' : url.pathname;
    const body = await readFile(join(dist, rel));
    res.writeHead(200, { 'Content-Type': MIME[extname(rel)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
await mkdir(outDir, { recursive: true });

/** Screens whose empty/loading/error/long variants are worth a PNG each. */
const STATE_HEAVY = new Set([
  'soldier-home',
  'gomsin-home',
  'record-timeline',
  'trip-detail',
  'pending',
]);
const EXTRA_STATES = ['empty', 'loading', 'error', 'long'];

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1500, height: 1200 },
  deviceScaleFactor: 1.5,
});
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);

const screenIds = await page.$$eval('[data-screen-btn]', (els) =>
  els.map((e) => e.getAttribute('data-screen-btn')),
);

const problems = [];
let count = 0;

async function captureCurrent() {
  const frames = page.locator('[data-frame]');
  const n = await frames.count();
  for (let i = 0; i < n; i += 1) {
    const frame = frames.nth(i);
    const id = await frame.getAttribute('data-frame');
    const [screen, state, theme, width] = id.split('|');
    await frame.screenshot({ path: join(outDir, `${screen}--${state}--${theme}--${width}.png`) });
    count += 1;
  }
  // Audit while the DOM for this combination is live.
  const rows = await page.evaluate(() => {
    const out = [];
    for (const frame of document.querySelectorAll('[data-frame]')) {
      out.push({
        id: frame.getAttribute('data-frame'),
        clientWidth: frame.clientWidth,
        scrollWidth: frame.scrollWidth,
      });
    }
    return out;
  });
  for (const r of rows) {
    if (r.scrollWidth > r.clientWidth) {
      problems.push(`${r.id}  client=${r.clientWidth} scroll=${r.scrollWidth}`);
    }
  }
}

for (const id of screenIds) {
  await page.click(`[data-screen-btn="${id}"]`);
  await page.click('[data-state-btn="normal"]');
  await page.waitForTimeout(120);
  await captureCurrent();

  if (STATE_HEAVY.has(id)) {
    for (const st of EXTRA_STATES) {
      await page.click(`[data-state-btn="${st}"]`);
      await page.waitForTimeout(120);
      await captureCurrent();
    }
  }
}

console.log(`captured ${count} frames -> ${outDir}`);
console.log(`screens: ${screenIds.length}`);
if (problems.length === 0) {
  console.log('horizontal overflow: NONE across every captured combination');
} else {
  console.log(`horizontal overflow: ${problems.length} PROBLEM(S)`);
  for (const p of problems) console.log(`  ${p}`);
}

await browser.close();
server.close();
