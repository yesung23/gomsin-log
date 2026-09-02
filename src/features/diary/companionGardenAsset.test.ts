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
