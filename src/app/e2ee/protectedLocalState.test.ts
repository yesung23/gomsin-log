import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('protected production E2EE local state contract', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/app/e2ee/protectedLocalState.ts'), 'utf8');

  it('stores only capability-sealed state and never uses plaintext browser storage', () => {
    expect(source).toContain('protectedCapability.seal');
    expect(source).toContain('protectedCapability.open');
    expect(source).not.toMatch(/(?:localStorage|sessionStorage|Preferences)\s*\./);
    expect(source).toContain("purpose: 'protected_state'");
  });

  it('covers bootstrap, anchors, couple authority and accepted-envelope metadata', () => {
    for (const field of ['bootstrap', 'anchors', 'coupleAuthorities', 'acceptedEnvelopes']) {
      expect(source).toContain(field);
    }
  });
});
