/**
 * SPIKE ONLY — memory/throughput baseline for a 45 MB media object.
 *
 * This measures the WebCrypto single-shot AES-GCM BASELINE only. It is NOT a
 * candidate production media format: single-shot gives no truncation detection
 * per chunk, no resumable-upload story, and no byte-range playback. It exists
 * to establish the floor that any real Streaming AEAD candidate is compared
 * against.
 *
 * No product media format is defined or selected here.
 *
 *   node --expose-gc spike/e2ee-1a1/tools/media-baseline.mjs
 */

import { webcrypto as wc } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SIZE = 45 * 1024 * 1024; // the current per-video ceiling in src/lib/records.ts
const subtle = wc.subtle;

const mb = (bytes) => +(bytes / 1024 / 1024).toFixed(1);
const peak = () => mb(process.memoryUsage().rss);

function makePlaintext() {
  // Deterministic filler; never real user media.
  const buf = new Uint8Array(SIZE);
  for (let i = 0; i < SIZE; i += 4096) buf[i] = i & 0xff;
  return buf;
}

const baselineRss = peak();
const key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
const nonce = wc.getRandomValues(new Uint8Array(12));

const plaintext = makePlaintext();
const afterAlloc = peak();

let t = performance.now();
const sealed = new Uint8Array(
  await subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, key, plaintext),
);
const encMs = performance.now() - t;
const afterEncrypt = peak();

t = performance.now();
const opened = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, key, sealed));
const decMs = performance.now() - t;
const afterDecrypt = peak();

if (opened.length !== SIZE) throw new Error('round-trip length mismatch');

// Truncation behaviour of the single-shot form.
let truncationDetected = false;
try {
  await subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, key, sealed.subarray(0, sealed.length - 1024));
} catch {
  truncationDetected = true;
}

// A truncated single-shot ciphertext fails only at the very end, after the whole
// object has been transferred and processed. That is the property a streaming
// construction improves on.
const report = {
  _comment: 'SPIKE ONLY baseline. Not a production media format proposal.',
  runtime: `node ${process.version} (${process.platform}/${process.arch})`,
  fileSizeMB: mb(SIZE),
  singleShotAesGcm: {
    encryptMs: Math.round(encMs),
    decryptMs: Math.round(decMs),
    encryptMBps: +(mb(SIZE) / (encMs / 1000)).toFixed(1),
    decryptMBps: +(mb(SIZE) / (decMs / 1000)).toFixed(1),
    rssBaselineMB: baselineRss,
    rssAfterAllocMB: afterAlloc,
    rssAfterEncryptMB: afterEncrypt,
    rssAfterDecryptMB: afterDecrypt,
    rssGrowthMB: +(afterDecrypt - baselineRss).toFixed(1),
    truncationDetected,
    limitations: [
      'Whole plaintext and whole ciphertext are resident simultaneously.',
      'Truncation is detected only after the entire object is processed.',
      'No per-chunk authentication, so no byte-range playback and no partial decrypt.',
      'No resumable-upload story: the ciphertext is one indivisible blob.',
    ],
  },
};

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'vectors', 'generated');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'media-baseline.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
