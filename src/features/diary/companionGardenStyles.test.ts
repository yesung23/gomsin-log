import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('companion garden motion CSS', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/styles/index.css'), 'utf8');

  it('has walking, immediate press feedback, and a continuous held wriggle', () => {
    expect(css).toContain('@keyframes garden-walk-bob');
    expect(css).toContain('.garden-companion-walking');
    expect(css).toContain('@keyframes garden-lift-wriggle');
    expect(css).toContain('.garden-companion-lifted');
    expect(css).toContain('.garden-companion-pressed');
    expect(css).toMatch(/garden-lift-wriggle[^;]*infinite/);
  });

  it('turns autonomous visual motion off for reduced-motion users', () => {
    const reducedAt = css.lastIndexOf('@media (prefers-reduced-motion: reduce)');
    expect(reducedAt).toBeGreaterThan(-1);
    const reduced = css.slice(reducedAt);
    expect(reduced).toContain('.garden-companion-position');
    expect(reduced).toContain('.garden-companion-walking');
    expect(reduced).toContain('.garden-companion-lifted');
    expect(reduced).toContain('.garden-companion-pressed');
    expect(reduced).toContain('animation: none');
    expect(reduced).toContain('transition: none');
  });
});
