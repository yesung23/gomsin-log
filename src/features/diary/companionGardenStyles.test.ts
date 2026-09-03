import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('companion garden motion CSS', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/styles/index.css'), 'utf8');

  it('defines a semantic white surface token and class in light and dark themes', () => {
    expect(css).toContain('--garden-surface: #ffffff;');
    expect(css).toContain('--garden-ink:');
    expect(css).toContain('--garden-ink-soft:');
    expect(css).toContain('--garden-character-paper:');
    expect(css).toContain('.garden-surface');
    expect(css).toMatch(/\.garden-shell-surface\s*\{[^}]*background-color:\s*var\(--garden-surface\)[^}]*background-image:\s*none/s);
    expect(css).toMatch(/\.garden-header \.pen-icon\s*\{[^}]*color:\s*var\(--garden-ink\)/s);
    expect(css).toMatch(/\.garden-ink-muted\s*\{[^}]*color:\s*var\(--garden-ink-soft\)/s);
  });

  it('has independent limb keyframes and body step-bob without whole-body shaking', () => {
    expect(css).toContain('@keyframes garden-walk-bob');
    expect(css).toContain('@keyframes garden-walk-arm-left');
    expect(css).toContain('@keyframes garden-walk-arm-right');
    expect(css).toContain('@keyframes garden-walk-leg-left');
    expect(css).toContain('@keyframes garden-walk-leg-right');
    expect(css).toContain('@keyframes garden-flail-arm-left');
    expect(css).toContain('@keyframes garden-flail-arm-right');
    expect(css).toContain('@keyframes garden-flail-leg-left');
    expect(css).toContain('@keyframes garden-flail-leg-right');
    expect(css).toContain('.garden-companion-walking');
    expect(css).toContain('.garden-companion-lifted');
    expect(css).toContain('.garden-companion-pressed');
    expect(css).not.toContain('@keyframes garden-lift-wriggle');
    expect(css).not.toContain('@keyframes garden-walk-frame');
    expect(css).not.toContain('@keyframes garden-lift-frame');
    expect(css).not.toContain('.garden-character-frame--walk');
    expect(css).not.toContain('.garden-character-frame--lift');
    expect(css).not.toContain('@keyframes garden-body-shake');
    expect(css).not.toMatch(/.garden-companion-(?:control|lifted|body)[^{]*{[^}]*animation:[^}]*shake/i);
    expect(css).not.toMatch(/\.garden-companion-lifted\s*\{[^}]*animation:/i);
    expect(css).toMatch(/\.garden-limb\s*\{[^}]*background-color:\s*var\(--garden-character-paper\)[^}]*border:/s);
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
