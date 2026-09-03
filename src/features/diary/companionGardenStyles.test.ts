import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('companion garden motion CSS', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/styles/index.css'), 'utf8');

  it('has original pose-frame walking, immediate press feedback, and held limb-pose flailing', () => {
    expect(css).toContain('@keyframes garden-walk-frame');
    expect(css).toContain('.garden-companion-walking');
    expect(css).toContain('.garden-character-frame--walk');
    expect(css).toContain('@keyframes garden-lift-frame');
    expect(css).toContain('.garden-character-frame--lift');
    expect(css).toContain('.garden-companion-lifted');
    expect(css).toContain('.garden-companion-pressed');
    expect(css).not.toContain('@keyframes garden-walk-bob');
    expect(css).not.toContain('@keyframes garden-lift-wriggle');
  });

  it('turns autonomous visual motion off for reduced-motion users', () => {
    const reducedAt = css.lastIndexOf('@media (prefers-reduced-motion: reduce)');
    expect(reducedAt).toBeGreaterThan(-1);
    const reduced = css.slice(reducedAt);
    expect(reduced).toContain('.garden-companion-walking');
    expect(reduced).toContain('.garden-companion-lifted');
    expect(reduced).toContain('.garden-companion-pressed');
    expect(reduced).toContain('animation: none');
    expect(reduced).toContain('transition: none');
    expect(reduced).not.toMatch(/\.garden-companion-position\s*\{[^}]*transition:\s*none/s);
  });
});
