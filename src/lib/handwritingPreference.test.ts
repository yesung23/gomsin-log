import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadHandwritingEnabled,
  saveHandwritingEnabled,
  HANDWRITING_DEFAULT,
} from '@/lib/handwritingPreference';

describe('손글씨 표시 설정', () => {
  beforeEach(() => localStorage.clear());

  it('저장된 적이 없으면 켜져 있다', () => {
    expect(HANDWRITING_DEFAULT).toBe(true);
    expect(loadHandwritingEnabled('user-1')).toBe(true);
  });

  it('끄면 그 계정에서만 꺼진다', () => {
    saveHandwritingEnabled('user-1', false);
    expect(loadHandwritingEnabled('user-1')).toBe(false);
    // 같은 기기를 쓰는 다른 계정에는 적용되지 않는다.
    expect(loadHandwritingEnabled('user-2')).toBe(true);
  });

  it('다시 켤 수 있다', () => {
    saveHandwritingEnabled('user-1', false);
    saveHandwritingEnabled('user-1', true);
    expect(loadHandwritingEnabled('user-1')).toBe(true);
  });

  it('손상된 값은 끔이 아니라 기본값으로 읽는다', () => {
    // 사용자가 끈 적 없는 설정이 조용히 꺼진 채로 남으면 안 된다.
    localStorage.setItem('gomsin.display.handwriting.user-1', '{"broken":true}');
    expect(loadHandwritingEnabled('user-1')).toBe(true);
  });

  it('사용자 id가 없으면 저장하지 않고 기본값을 준다', () => {
    saveHandwritingEnabled('', false);
    expect(loadHandwritingEnabled('')).toBe(true);
  });
});
