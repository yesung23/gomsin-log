import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
