import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * H-1: the store-facing icons are real rasters in the formats the stores accept.
 *
 * Before `scripts/assets/generate-app-assets.mjs` existed, `public/manifest.json`
 * declared every icon as `image/svg+xml` (Chrome's install prompt and the Play
 * listing both want PNG), `apple-touch-icon.png` was a 1024x1024 JPEG with a
 * `.png` extension sitting in a 180x180 slot, and both native projects carried
 * Capacitor's default logo.
 *
 * Two format rules are outright rejections rather than warnings:
 *   - Google Play wants a 512x512 32-bit (RGBA) PNG.
 *   - App Store Connect rejects a 1024x1024 app icon that has an alpha channel.
 *
 * So this reads the PNG signature and IHDR chunk directly. No image library is
 * involved: the assertion is over the bytes that ship, which is the only thing
 * the stores look at.
 *
 * PNG layout (spec 11.2.2): 8-byte signature, then a chunk whose 4-byte length
 * is followed by the type "IHDR", then width (u32be), height (u32be), bit depth
 * (u8), colour type (u8). Colour type 2 = truecolour (RGB, no alpha), 6 =
 * truecolour with alpha (RGBA).
 */

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const COLOUR_TYPES: Record<number, string> = {
  0: 'greyscale',
  2: 'rgb',
  3: 'palette',
  4: 'greyscale+alpha',
  6: 'rgba',
};

interface PngHeader {
  width: number;
  height: number;
  bitDepth: number;
  colourType: string;
  hasAlphaChannel: boolean;
  bytes: number;
}

function readPng(relativePath: string): PngHeader {
  const buffer = readFileSync(resolve(process.cwd(), relativePath));
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`${relativePath} is not a PNG (a renamed JPEG is the usual cause).`);
  }
  if (buffer.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new Error(`${relativePath}: first chunk is not IHDR.`);
  }
  const colourTypeByte = buffer.readUInt8(25);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    bitDepth: buffer.readUInt8(24),
    colourType: COLOUR_TYPES[colourTypeByte] ?? `unknown(${colourTypeByte})`,
    // Colour types 4 and 6 carry an alpha channel; a tRNS chunk can also add
    // transparency to 0/2/3, so that is checked separately below.
    hasAlphaChannel: colourTypeByte === 4 || colourTypeByte === 6,
    bytes: buffer.length,
  };
}

/** True when the file declares transparency through a tRNS chunk. */
function hasTransparencyChunk(relativePath: string): boolean {
  return readFileSync(resolve(process.cwd(), relativePath)).includes(Buffer.from('tRNS', 'ascii'));
}

const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'public/manifest.json'), 'utf8')) as {
  icons: { src: string; sizes: string; type: string; purpose: string }[];
};

describe('the App Store icon', () => {
  const path = 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png';

  it('is a 1024x1024 PNG', () => {
    const png = readPng(path);
    expect(png.width).toBe(1024);
    expect(png.height).toBe(1024);
    expect(png.bitDepth).toBe(8);
  });

  it('has NO alpha channel, which is an App Store validation failure', () => {
    const png = readPng(path);
    expect(png.hasAlphaChannel).toBe(false);
    expect(png.colourType).toBe('rgb');
    expect(hasTransparencyChunk(path)).toBe(false);
  });

  it('is referenced by the asset catalog as the single 1024 slot', () => {
    const contents = readFileSync(
      resolve(process.cwd(), 'ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json'),
      'utf8',
    );
    expect(contents).toContain('AppIcon-512@2x.png');
  });
});

describe('the Play / PWA icons', () => {
  it('the 512 icon is a 512x512 32-bit PNG', () => {
    const png = readPng('public/icons/icon-512.png');
    expect([png.width, png.height]).toEqual([512, 512]);
    expect(png.colourType).toBe('rgba');
    expect(png.bitDepth).toBe(8);
  });

  it('the 192 icon is a 192x192 PNG', () => {
    const png = readPng('public/icons/icon-192.png');
    expect([png.width, png.height]).toEqual([192, 192]);
    expect(png.colourType).toBe('rgba');
  });

  it('the maskable icon is 512x512 and opaque, so a launcher mask has full bleed', () => {
    const png = readPng('public/icons/icon-maskable-512.png');
    expect([png.width, png.height]).toEqual([512, 512]);
    expect(png.hasAlphaChannel).toBe(false);
    expect(hasTransparencyChunk('public/icons/icon-maskable-512.png')).toBe(false);
  });

  it('apple-touch-icon is a 180x180 opaque PNG, not a renamed JPEG', () => {
    const png = readPng('public/icons/apple-touch-icon.png');
    expect([png.width, png.height]).toEqual([180, 180]);
    expect(png.hasAlphaChannel).toBe(false);
  });
});

describe('public/manifest.json declares the rasters, not the SVG', () => {
  it('no fixed-size slot is filled with an SVG', () => {
    // The scalable `sizes: "any"` favicon may stay an SVG -- that is what the
    // field is for. What broke installation was declaring 192x192 and 512x512 as
    // image/svg+xml, because Chrome's install prompt and the Play listing both
    // require a raster at those sizes.
    const svgIcons = manifest.icons.filter((icon) => icon.type === 'image/svg+xml');
    expect(svgIcons.map((icon) => icon.sizes)).toEqual(['any']);
    expect(svgIcons.map((icon) => icon.src)).toEqual(['/favicon.svg']);
    expect(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.type === 'image/png'))
      .toBe(true);
    expect(manifest.icons.some((icon) => icon.sizes === '192x192' && icon.type === 'image/png'))
      .toBe(true);
  });

  it('every PNG entry names the right type, size and an existing file', () => {
    const pngIcons = manifest.icons.filter((icon) => icon.src.endsWith('.png'));
    expect(pngIcons.length).toBeGreaterThanOrEqual(3);
    for (const icon of pngIcons) {
      expect(icon.type, icon.src).toBe('image/png');
      const png = readPng(`public${icon.src}`);
      expect(icon.sizes, icon.src).toBe(`${png.width}x${png.height}`);
    }
  });

  it('splits purpose, so one icon is maskable and the others are not', () => {
    const maskable = manifest.icons.filter((icon) => icon.purpose.includes('maskable'));
    expect(maskable.length).toBe(1);
    expect(maskable[0].src).toBe('/icons/icon-maskable-512.png');
    // "any maskable" on a non-full-bleed icon is how a launcher ends up clipping
    // the mark; the 192/512 icons keep their rounded silhouette as `any`.
    for (const icon of manifest.icons) {
      if (icon.src === '/icons/icon-maskable-512.png') continue;
      expect(icon.purpose, icon.src).not.toContain('maskable');
    }
  });

  it('the service worker precaches the icons the manifest declares', () => {
    const sw = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');
    for (const icon of manifest.icons.filter((i) => i.src.endsWith('.png'))) {
      expect(sw, icon.src).toContain(`'${icon.src}'`);
    }
    // The deleted SVG icons must not be precached, or install fails on a 404.
    expect(sw).not.toContain('icon-192.svg');
    expect(sw).not.toContain('icon-512.svg');
  });

  it('activates a fully cached update without waiting for a toast interaction', () => {
    const sw = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');
    // A stale PWA shell can keep an old API contract alive after deployment.
    // Cache completion is the safe activation boundary: every app asset is
    // content-hashed and the next navigation therefore loads one whole release.
    expect(sw).toContain('.then(() => self.skipWaiting())');
  });
});

describe('the Android adaptive icon has both layers', () => {
  it('declares a background colour and a foreground drawable', () => {
    const adaptive = readFileSync(
      resolve(process.cwd(), 'android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml'),
      'utf8',
    );
    expect(adaptive).toContain('<background android:drawable="@color/ic_launcher_background"');
    expect(adaptive).toContain('<foreground android:drawable="@mipmap/ic_launcher_foreground"');
  });

  it('ships a foreground raster for every density, with alpha for the mask', () => {
    for (const [density, size] of [
      ['mdpi', 108],
      ['hdpi', 162],
      ['xhdpi', 216],
      ['xxhdpi', 324],
      ['xxxhdpi', 432],
    ] as const) {
      const png = readPng(
        `android/app/src/main/res/mipmap-${density}/ic_launcher_foreground.png`,
      );
      expect([png.width, png.height], density).toEqual([size, size]);
      expect(png.hasAlphaChannel, density).toBe(true);
    }
  });

  it('the background colour matches the generator and the source mark', () => {
    const colour = readFileSync(
      resolve(process.cwd(), 'android/app/src/main/res/values/ic_launcher_background.xml'),
      'utf8',
    );
    const generator = readFileSync(
      resolve(process.cwd(), 'scripts/assets/generate-app-assets.mjs'),
      'utf8',
    );
    expect(colour).toContain('#1B2340');
    expect(generator).toContain("BRAND_BACKGROUND = '#1B2340'");
    expect(readFileSync(resolve(process.cwd(), 'public/favicon.svg'), 'utf8')).toContain('#1B2340');
  });

  it('ships a legacy launcher raster for every density too', () => {
    for (const [density, size] of [
      ['mdpi', 48],
      ['hdpi', 72],
      ['xhdpi', 96],
      ['xxhdpi', 144],
      ['xxxhdpi', 192],
    ] as const) {
      for (const name of ['ic_launcher', 'ic_launcher_round']) {
        const png = readPng(`android/app/src/main/res/mipmap-${density}/${name}.png`);
        expect([png.width, png.height], `${density}/${name}`).toEqual([size, size]);
      }
    }
  });
});
