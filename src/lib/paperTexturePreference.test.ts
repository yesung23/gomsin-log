import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  PAPER_TEXTURE_DEFAULT,
  applyPaperTextureAttribute,
  loadPaperTexture,
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

  it('무지일 때만 html 속성을 붙인다', () => {
    applyPaperTextureAttribute('plain');
    expect(document.documentElement).toHaveAttribute('data-paper', 'plain');
    applyPaperTextureAttribute('ruled');
    expect(document.documentElement).not.toHaveAttribute('data-paper');
  });

  it('무지는 종이색을 유지하고 괘선 이미지만 없앤다', () => {
    const css = readFileSync('src/styles/paper.css', 'utf8');
    const plain = css.slice(css.indexOf("[data-paper='plain'] .notebook"));
    expect(plain.slice(0, plain.indexOf('}') + 1)).toContain('background-image: none');
  });
});
