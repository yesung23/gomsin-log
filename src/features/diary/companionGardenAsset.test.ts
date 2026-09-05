import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('companion garden exact historical character source', () => {
  it('keeps the approved original WebP byte-for-byte', () => {
    const asset = readFileSync(resolve(process.cwd(), 'src/assets/characters/paper-pair-v1.webp'));
    expect(createHash('sha256').update(asset).digest('hex')).toBe(
      'cac84b0179f4f0d05a655b4c41c03b644a7fdd67d3701c51a9de30c5f04ff856',
    );
  });
});

describe('companion garden generated tree assets', () => {
  const expectedAssets = {
    'garden-tree-stage-1-v1.webp': '2bede6e90d41283bd4c0770325bf98b09c0f4111a73f8d5f1b6214a769ac04d3',
    'garden-tree-stage-2-v1.webp': 'b4545ca7d6cc65e8ed83c0e1cb9174c0e90933310f19ccf024211d9babf53de9',
    'garden-tree-stage-3-v1.webp': '0d179c00d3f09cf690a70b7c1ae587d74a2ad05081df6d60a2967507f7def5fd',
    'garden-tree-stage-4-v1.webp': 'e184c7936cdfbf1fdfc8014ad0034a68701f8771139285d8670aacd8e8c1114b',
  } as const;

  it.each(Object.entries(expectedAssets))('keeps %s byte-for-byte', (filename, expectedHash) => {
    const asset = readFileSync(resolve(process.cwd(), 'src/assets/garden', filename));
    expect(createHash('sha256').update(asset).digest('hex')).toBe(expectedHash);
  });
});

describe('companion garden display derivatives', () => {
  const displayAssets = [
    ['characters/garden/paper-companion-peach-v1.webp', 'c646f359ed9712c9636764fa81974ab101aded102d6b2047403b1cffc906aa3a', 30_000],
    ['characters/garden/paper-companion-sage-v1.webp', 'f7fcac03b5f77ec4c9d4df460810e8400f578fb7dbe4e07acd21b31190c4b6da', 31_000],
    ['characters/garden/paper-accessory-boots-v1.webp', '030ed065e94b57016914422a6ff8b0c5f2d39472e11311dabec3e7fe03c50cf0', 21_000],
    ['characters/garden/paper-accessory-sneakers-v1.webp', '07db720b8ce689c6fb76d51d181c30f30258580679209dfce9aa44d671c5cf95', 23_000],
    ['characters/garden/paper-accessory-letter-v1.webp', '9f95ba713bcd17b74af4f35cfc8ed86b4ca1640827eb0235936285e9b1e6864d', 20_000],
    ['characters/garden/paper-accessory-dogtag-v1.webp', 'f1e267dbce70d878373ef423f05292a69b64a3690a931d117067d1f6ae6b9ba9', 17_000],
    ['characters/garden/paper-accessory-plane-v1.webp', 'af1302fd97dd9fdb09876f54cd24b2386a9ed57af694413b19361836702d874a', 16_000],
    ['garden/garden-tree-stage-1-display-v1.webp', '9182ef337e8338d56fac3e9b030d80bfaed45b8562e841a4bf869fc89162171a', 34_000],
    ['garden/garden-tree-stage-2-display-v1.webp', 'b74deccb904fdce8f28c40367bedade5e9f18ef1bc5c2456bfd440418cfd20c6', 93_000],
    ['garden/garden-tree-stage-3-display-v1.webp', 'deedcefd7416252d0fedaed36ed89a2a6c78bc5245d5d99f1631e9497b0bd081', 140_000],
    ['garden/garden-tree-stage-4-display-v1.webp', '04c5de32e0f3bdbf25a5a642378216ef06a53d7e5d90d04ef58b9638e4bf9023', 174_000],
  ] as const;

  it.each(displayAssets)('keeps %s deterministic and within its transfer budget', (relativePath, expectedHash, maxBytes) => {
    const path = resolve(process.cwd(), 'src/assets', relativePath);
    const asset = readFileSync(path);
    expect(createHash('sha256').update(asset).digest('hex')).toBe(expectedHash);
    expect(statSync(path).size).toBeLessThanOrEqual(maxBytes);
  });
});
