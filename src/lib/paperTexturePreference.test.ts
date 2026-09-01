import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PAPER_TEXTURE_DEFAULT,
  applyPaperTextureAttribute,
  loadPaperTexture,
  reconcileOwnedPaperTexture,
  savePaperTexture,
} from '@/lib/paperTexturePreference';

describe('종이 바탕 설정', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-paper');
  });

  it('처음에는 기존 줄 종이를 유지한다', () => {
    expect(PAPER_TEXTURE_DEFAULT).toBe('ruled');
    expect(loadPaperTexture('user-1')).toBe('ruled');
  });

  it('무지 종이는 계정별 기기 설정으로 저장된다', () => {
    savePaperTexture('user-1', 'plain');
    expect(loadPaperTexture('user-1')).toBe('plain');
    expect(loadPaperTexture('user-2')).toBe('ruled');
  });

  it('다섯 종이 선택을 계정별로 보존한다', () => {
    for (const texture of ['plain', 'ruled', 'grid', 'dot', 'cream'] as const) {
      savePaperTexture('user-1', texture);
      expect(loadPaperTexture('user-1')).toBe(texture);
    }
  });

  it('보유하지 않은 선택은 보유 중인 기본 종이로 되돌리고 저장한다', () => {
    savePaperTexture('user-1', 'grid');

    expect(reconcileOwnedPaperTexture('user-1', ['plain', 'ruled'])).toBe('ruled');
    expect(loadPaperTexture('user-1')).toBe('ruled');
  });

  it('모든 종이를 안정적인 html 속성으로 즉시 적용한다', () => {
    for (const texture of ['plain', 'ruled', 'grid', 'dot', 'cream'] as const) {
      applyPaperTextureAttribute(texture);
      expect(document.documentElement).toHaveAttribute('data-paper', texture);
    }
  });

  it('무지는 종이색을 유지하고 괘선 이미지만 없앤다', () => {
    const css = readFileSync('src/styles/paper.css', 'utf8');
    const plain = css.slice(css.indexOf("[data-paper='plain'] .notebook"));
    expect(plain.slice(0, plain.indexOf('}') + 1)).toContain('background-image: none');
  });

  it('모눈·도트·크림 종이는 앱 공책 바탕에 서로 다른 표면을 쓴다', () => {
    const css = readFileSync('src/styles/paper.css', 'utf8');
    expect(css).toContain("[data-paper='grid'] .notebook");
    expect(css).toContain("[data-paper='dot'] .notebook");
    expect(css).toContain("[data-paper='cream'] .notebook");
    expect(css).toContain('background-size: 20px 20px');
    expect(css).toContain('background-size: 18px 18px');
  });
});
