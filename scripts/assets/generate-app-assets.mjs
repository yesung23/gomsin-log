/**
 * Deterministic app-asset pipeline.
 *
 * ONE source of truth -- `public/favicon.svg` -- is rasterised into every raster
 * asset the two stores and the PWA need. Nothing here is hand-drawn, so the
 * brand mark can be changed in one file and `npm run assets:generate` reproduces
 * the whole set.
 *
 * Why this script exists at all: before it, `public/manifest.json` declared every
 * icon as `image/svg+xml`, `public/icons/apple-touch-icon.png` was a 528 KB
 * 1024x1024 JPEG with a `.png` extension sitting in a 180x180 slot, and the two
 * native projects still carried Capacitor's default logo. Google Play requires a
 * 512x512 32-bit PNG, Android adaptive icons require separate foreground and
 * background layers, and App Store Connect rejects a 1024x1024 icon that has an
 * alpha channel.
 *
 * Format rules encoded below, and re-checked by `npm run verify:assets`:
 *   - PWA / Play listing icons: 512x512 and 192x192, RGBA (alpha kept, because
 *     the rounded corners are part of the mark on the web).
 *   - PWA maskable icon: full-bleed, opaque, mark inside the inner 80% safe
 *     zone, so a launcher mask cannot clip the heart.
 *   - apple-touch-icon: 180x180, OPAQUE. iOS applies its own corner mask and
 *     renders alpha as black.
 *   - iOS AppIcon (1024x1024): OPAQUE. An alpha channel is an App Store
 *     validation failure.
 *   - Android adaptive foreground: 108dp-proportioned canvas, transparent, mark
 *     at 46% of the canvas -- inside the 72/108 (66.7%) safe zone that survives
 *     every launcher mask.
 *
 * Usage:
 *   npm run assets:generate            # write assets
 *   npm run assets:generate -- --check # fail if any asset is missing/stale-sized
 */

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import sharp from 'sharp';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const SOURCE = 'public/favicon.svg';

/** Brand background. Must equal the `fill` of the backing <rect> in the source. */
const BRAND_BACKGROUND = '#1B2340';

/** Density buckets Android ships, and the launcher-icon size each one wants. */
const ANDROID_DENSITIES = [
  { dir: 'mdpi', launcher: 48, foreground: 108 },
  { dir: 'hdpi', launcher: 72, foreground: 162 },
  { dir: 'xhdpi', launcher: 96, foreground: 216 },
  { dir: 'xxhdpi', launcher: 144, foreground: 324 },
  { dir: 'xxxhdpi', launcher: 192, foreground: 432 },
];

/** Splash canvases, matching the drawable buckets `cap add android` created. */
const ANDROID_SPLASHES = [
  { dir: 'drawable', width: 480, height: 320 },
  { dir: 'drawable-port-mdpi', width: 320, height: 480 },
  { dir: 'drawable-port-hdpi', width: 480, height: 800 },
  { dir: 'drawable-port-xhdpi', width: 720, height: 1280 },
  { dir: 'drawable-port-xxhdpi', width: 960, height: 1600 },
  { dir: 'drawable-port-xxxhdpi', width: 1280, height: 1920 },
  { dir: 'drawable-land-mdpi', width: 480, height: 320 },
  { dir: 'drawable-land-hdpi', width: 800, height: 480 },
  { dir: 'drawable-land-xhdpi', width: 1280, height: 720 },
  { dir: 'drawable-land-xxhdpi', width: 1600, height: 960 },
  { dir: 'drawable-land-xxxhdpi', width: 1920, height: 1280 },
];

const checkOnly = process.argv.includes('--check');
const written = [];

/**
 * The mark on its own, with the backing plate removed.
 *
 * The Android adaptive-icon foreground layer and the splash screens draw the
 * heart over a separately declared background, so the source's <rect> plate and
 * its decorative <circle> have to go. Both removals are asserted: if the source
 * is redrawn in a way that breaks these selectors, this throws instead of
 * silently emitting an icon with a plate baked into the foreground.
 */
function markOnlySvg(source) {
  let svg = source;
  const before = svg;
  svg = svg.replace(/\s*<rect\b[^>]*\/>/, '');
  if (svg === before) {
    throw new Error(`${SOURCE}: expected a self-closing <rect> backing plate to strip.`);
  }
  const afterRect = svg;
  svg = svg.replace(/\s*<circle\b[^>]*\/>/, '');
  if (svg === afterRect) {
    throw new Error(`${SOURCE}: expected a self-closing decorative <circle> to strip.`);
  }
  if (!source.includes(`fill="${BRAND_BACKGROUND}"`)) {
    throw new Error(`${SOURCE}: backing plate is no longer ${BRAND_BACKGROUND}; update BRAND_BACKGROUND.`);
  }
  return svg;
}

const PNG_OPTIONS = { compressionLevel: 9, effort: 10, palette: false, adaptiveFiltering: false };

/**
 * PNG encoder settings held constant so repeated runs are byte-stable.
 *
 * The flatten runs as a SECOND pass, on the already-composited buffer. sharp
 * applies operations in a fixed pipeline order in which `composite` comes after
 * `flatten`, so calling `.flatten()` on a pipeline that also composites leaves
 * the alpha channel in place -- which is exactly the "1024x1024 icon still has
 * alpha" failure App Store validation rejects.
 */
async function encode(pipeline, { opaque }) {
  const rendered = await pipeline.png(PNG_OPTIONS).toBuffer();
  if (!opaque) return rendered;
  return sharp(rendered).flatten({ background: BRAND_BACKGROUND }).png(PNG_OPTIONS).toBuffer();
}

/** Format facts read straight out of the PNG IHDR chunk (spec 11.2.2). */
function pngHeader(buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.subarray(0, 8).equals(signature)) throw new Error('not a PNG');
  if (buffer.subarray(12, 16).toString('ascii') !== 'IHDR') throw new Error('no IHDR');
  const colourType = buffer.readUInt8(25);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colourType,
    hasAlpha: colourType === 4 || colourType === 6 || buffer.includes(Buffer.from('tRNS', 'ascii')),
  };
}

/**
 * Format rules the stores enforce, checked on the bytes rather than on intent.
 *
 * Keyed by output path; a path with no rule is only checked for byte equality.
 */
const FORMAT_RULES = {
  'public/icons/icon-192.png': { size: 192, alpha: true },
  'public/icons/icon-512.png': { size: 512, alpha: true },
  'public/icons/icon-maskable-512.png': { size: 512, alpha: false },
  'public/icons/apple-touch-icon.png': { size: 180, alpha: false },
  // An alpha channel here is an App Store validation failure.
  'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png': { size: 1024, alpha: false },
};

const problems = [];

async function emit(relativePath, buffer) {
  const absolute = resolve(repoRoot, relativePath);
  const digest = createHash('sha256').update(buffer).digest('hex').slice(0, 12);
  written.push({ path: relativePath, bytes: buffer.length, sha256: digest });

  const rule = FORMAT_RULES[relativePath];
  if (rule) {
    const header = pngHeader(buffer);
    if (header.width !== rule.size || header.height !== rule.size) {
      problems.push(`${relativePath}: expected ${rule.size}x${rule.size}, got ${header.width}x${header.height}`);
    }
    if (header.hasAlpha !== rule.alpha) {
      problems.push(
        `${relativePath}: expected hasAlpha=${rule.alpha}, got ${header.hasAlpha}`
        + (rule.alpha ? '' : ' (an alpha channel here is a store rejection)'),
      );
    }
  }

  if (checkOnly) {
    // Compare against what is committed. The generator is deterministic, so any
    // difference means the checked-in asset is stale or was hand-edited.
    let onDisk;
    try {
      onDisk = await readFile(absolute);
    } catch {
      problems.push(`${relativePath}: missing; run \`npm run assets:generate\``);
      return;
    }
    if (!onDisk.equals(buffer)) {
      problems.push(
        `${relativePath}: stale (${onDisk.length} bytes on disk, ${buffer.length} regenerated);`
        + ' run `npm run assets:generate`',
      );
    }
    return;
  }

  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, buffer);
}

/** Square render of the full mark, corners and all. */
function square(source, size) {
  return sharp(Buffer.from(source), { density: 900 }).resize(size, size, { fit: 'contain' });
}

/** Full-bleed brand plate with the mark centred at `coverage` of the canvas. */
async function plate(markSvg, width, height, coverage) {
  const markSize = Math.round(Math.min(width, height) * coverage);
  const mark = await sharp(Buffer.from(markSvg), { density: 900 })
    .resize(markSize, markSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: BRAND_BACKGROUND,
    },
  }).composite([{ input: mark, gravity: 'centre' }]);
}

/** Transparent canvas with the mark centred -- the adaptive-icon foreground. */
async function transparentLayer(markSvg, size, coverage) {
  const markSize = Math.round(size * coverage);
  const mark = await sharp(Buffer.from(markSvg), { density: 900 })
    .resize(markSize, markSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: mark, gravity: 'centre' }]);
}

/** Circular crop for the legacy `ic_launcher_round` slot. */
async function circular(source, size) {
  const flat = await square(source, size).png().toBuffer();
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">`
    + `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
  );
  return sharp(flat).composite([{ input: mask, blend: 'dest-in' }]);
}

async function main() {
  const source = await readFile(resolve(repoRoot, SOURCE), 'utf8');
  const markSvg = markOnlySvg(source);

  // --- Web / PWA ---------------------------------------------------------
  await emit('public/icons/icon-192.png', await encode(square(source, 192), { opaque: false }));
  // 512x512 32-bit PNG: also exactly what the Play Console listing wants.
  await emit('public/icons/icon-512.png', await encode(square(source, 512), { opaque: false }));
  // Maskable: full bleed. The mark SVG's heart occupies 63% of its own
  // viewBox width, so a 0.85 canvas coverage puts the heart at ~54% of the
  // icon -- comfortably inside the inner 80% safe circle every launcher mask
  // preserves, and large enough not to look lost.
  await emit(
    'public/icons/icon-maskable-512.png',
    await encode(await plate(markSvg, 512, 512, 0.85), { opaque: true }),
  );
  // 180x180 and opaque: iOS masks the corners itself and paints alpha black.
  await emit(
    'public/icons/apple-touch-icon.png',
    await encode(square(source, 180), { opaque: true }),
  );

  // --- Android launcher icons -------------------------------------------
  for (const density of ANDROID_DENSITIES) {
    const base = `android/app/src/main/res/mipmap-${density.dir}`;
    // Legacy (pre-API-26) launcher slot: alpha kept so the rounded silhouette
    // shows instead of a navy square in launchers that do not mask.
    await emit(`${base}/ic_launcher.png`, await encode(square(source, density.launcher), { opaque: false }));
    await emit(`${base}/ic_launcher_round.png`, await encode(await circular(source, density.launcher), { opaque: false }));
    // Adaptive foreground: transparent. 0.85 canvas coverage puts the heart at
    // ~54% of the 108dp canvas, inside the 72/108 (66.7%) safe zone.
    await emit(
      `${base}/ic_launcher_foreground.png`,
      await encode(await transparentLayer(markSvg, density.foreground, 0.85), { opaque: false }),
    );
  }

  // --- Android splash ---------------------------------------------------
  for (const splash of ANDROID_SPLASHES) {
    await emit(
      `android/app/src/main/res/${splash.dir}/splash.png`,
      await encode(await plate(markSvg, splash.width, splash.height, 0.42), { opaque: true }),
    );
  }

  // --- iOS --------------------------------------------------------------
  // 1024x1024, OPAQUE. An alpha channel here fails App Store validation.
  await emit(
    'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png',
    await encode(square(source, 1024), { opaque: true }),
  );
  const iosSplash = await encode(await plate(markSvg, 2732, 2732, 0.18), { opaque: true });
  for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
    await emit(`ios/App/App/Assets.xcassets/Splash.imageset/${name}`, iosSplash);
  }

  const label = checkOnly ? 'verified' : 'wrote';
  for (const entry of written) {
    console.log(`${label} ${entry.path} (${entry.bytes} bytes, sha256:${entry.sha256})`);
  }

  if (problems.length > 0) {
    console.error(`\n${problems.length} asset problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `${written.length} assets ${checkOnly ? 'verified byte-for-byte against' : 'generated from'} ${SOURCE}.`,
  );
}

await main();
