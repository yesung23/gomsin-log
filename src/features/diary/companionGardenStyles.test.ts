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
    expect(css).not.toContain('.garden-limb');
    expect(css).toContain('.garden-pixel-limb');
    expect(css).toContain('@keyframes garden-run');
    expect(css).toContain('@keyframes garden-shy');
    expect(css).toContain('@keyframes garden-shy-arm-left');
    expect(css).toContain('@keyframes garden-shy-arm-right');
    expect(css).toContain('.garden-motion-run');
    expect(css).toContain('.garden-motion-shy');
    expect(css).toMatch(/@keyframes garden-walk-arm-left[\s\S]*?rotate\(-22deg\)[\s\S]*?rotate\(22deg\)/);
    expect(css).toMatch(/@keyframes garden-walk-arm-right[\s\S]*?rotate\(22deg\)[\s\S]*?rotate\(-22deg\)/);
    expect(css).toMatch(/@keyframes garden-walk-leg-left[\s\S]*?rotate\(18deg\)[\s\S]*?rotate\(-18deg\)/);
    expect(css).toMatch(/@keyframes garden-walk-leg-right[\s\S]*?rotate\(-18deg\)[\s\S]*?rotate\(18deg\)/);
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
    expect(reduced).toContain('.accessory-roulette-spinning');
    expect(reduced).toContain('.garden-pixel-limb');
    expect(reduced).toMatch(/\.garden-motion-shy \.garden-companion-body\s*\{[^}]*transform:/s);
    expect(reduced).toMatch(/\.garden-motion-shy \.garden-pixel-limb-arm-left\s*\{[^}]*transform:/s);
  });

  it('defines distinct nurturing reactions without floating glyphs or a persistent score surface', () => {
    expect(css).toContain('@keyframes garden-care-pet');
    expect(css).toContain('@keyframes garden-care-wave-arm');
    expect(css).toContain('@keyframes garden-care-play');
    expect(css).toContain('.garden-care-pet');
    expect(css).toContain('.garden-care-wave');
    expect(css).toContain('.garden-care-play');
    expect(css).not.toContain('.garden-care-reaction');
    expect(css).not.toContain('@keyframes garden-care-symbol');
    expect(css).not.toContain('.garden-care-meter');
    expect(css).not.toContain('.garden-care-score');
  });

  it('defines an accessory-roulette-spin keyframe and spinning class', () => {
    expect(css).toContain('@keyframes accessory-roulette-spin');
    expect(css).toContain('.accessory-roulette-spinning');
    expect(css).toMatch(
      /\.accessory-roulette-spinning\s*\{[^}]*animation:\s*accessory-roulette-spin\s+var\(--accessory-roulette-duration,\s*1200ms\)/s,
    );
  });
});
