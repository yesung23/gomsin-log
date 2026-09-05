import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import sharp from 'sharp';

// Source-mode Vite only. No real accounts, customer photos, or remote uploads.
const baseUrl = new URL(process.argv[2] ?? 'http://127.0.0.1:4176');
if (baseUrl.protocol !== 'http:' || baseUrl.hostname !== '127.0.0.1' || baseUrl.username || baseUrl.password) {
  throw new Error('Use an isolated 127.0.0.1 source server');
}
const browser = await chromium.launch();
const page = await browser.newPage();
await page.route('**/*', (route) => new URL(route.request().url()).origin === baseUrl.origin ? route.continue() : route.abort());
const results = [];
try {
  await page.goto(baseUrl.href);
  for (const fixture of [
    { name: 'small-640', width: 640, height: 480, detail: false, rotate: false },
    { name: 'detailed-12MP', width: 4032, height: 3024, detail: true, rotate: false },
    { name: 'oriented-12MP', width: 4032, height: 3024, detail: false, rotate: true },
  ]) {
    // Deterministic synthetic grain/edges exercise compression. They do NOT
    // establish aesthetic quality on portraits, skin, foliage, or printed books.
    const raw = Buffer.alloc(fixture.width * fixture.height * 3);
    let random = 17;
    for (let y = 0; y < fixture.height; y++) {
      for (let x = 0; x < fixture.width; x++) {
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        const noise = (random >>> 24) * (fixture.detail ? 0.7 : 0.08);
        const offset = (y * fixture.width + x) * 3;
        raw[offset] = Math.min(255, x / fixture.width * 160 + noise);
        raw[offset + 1] = Math.min(255, y / fixture.height * 160 + noise);
        raw[offset + 2] = Math.min(255, ((x >> 4) + (y >> 4)) % 2 * 140 + noise);
      }
    }
    const original = await sharp(raw, { raw: { width: fixture.width, height: fixture.height, channels: 3 } })
      .withMetadata({ orientation: fixture.rotate ? 6 : 1 }).jpeg({ quality: 90 }).toBuffer();
    const result = await page.evaluate(async ({ base64 }) => {
      const { sanitizePhotoForUpload, calculateSanitizedPhotoSize } = await import('/src/lib/imageSanitization.ts');
      const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
      const source = new File([bytes], 'synthetic-private-original.jpg', { type: 'image/jpeg' });
      const start = performance.now();
      const prepared = await sanitizePhotoForUpload(source);
      if ('error' in prepared) throw new Error(prepared.error);
      const elapsedMs = performance.now() - start;
      const base64Of = (blob) => new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onerror = reject;
        reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(blob);
      });
      const actual = await base64Of(prepared.file);
      const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
      const candidates = [];
      try {
        for (const edge of [640, 2560]) {
          const size = calculateSanitizedPhotoSize(bitmap.width, bitmap.height, edge);
          const canvas = document.createElement('canvas'); canvas.width = size.width; canvas.height = size.height;
          const context = canvas.getContext('2d', { alpha: false });
          context.fillStyle = '#fff'; context.fillRect(0, 0, size.width, size.height);
          context.drawImage(bitmap, 0, 0, size.width, size.height);
          const candidate = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.84));
          candidates.push({ proposedEdge: edge, bytes: candidate.size, ...size });
        }
      } finally { bitmap.close(); }
      return { actual, elapsedMs, name: prepared.file.name, candidates };
    }, { base64: original.toString('base64') });
    const output = Buffer.from(result.actual, 'base64');
    const metadata = await sharp(output).metadata();
    assert.equal(result.name, 'photo.jpg');
    assert.equal(metadata.format, 'jpeg');
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.orientation, undefined);
    assert.ok(Math.max(metadata.width, metadata.height) <= 2048);
    assert.equal(metadata.height > metadata.width, fixture.rotate);
    if (fixture.width === 640) assert.equal(metadata.width, 640);
    results.push({ fixture: fixture.name, sourceKiB: +(original.length / 1024).toFixed(1),
      actualKiB: +(output.length / 1024).toFixed(1), actualPixels: `${metadata.width}x${metadata.height}`,
      desktopElapsedMs: +result.elapsedMs.toFixed(1),
      proposed640KiB: +(result.candidates[0].bytes / 1024).toFixed(1),
      proposed2560KiB: +(result.candidates[1].bytes / 1024).toFixed(1) });
  }
  console.log('SYNTHETIC DESKTOP BENCHMARK — actual sanitizer, no uploads. Not iPhone or print-quality proof.');
  console.table(results);
} finally { await browser.close(); }
