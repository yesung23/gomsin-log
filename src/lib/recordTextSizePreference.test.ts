import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyRecordTextSizeAttribute,
  loadRecordTextSize,
  saveRecordTextSize,
} from '@/lib/recordTextSizePreference';

describe('게시물·스토리 글자 크기 설정', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-record-text-size');
  });

  it('저장된 값이 없거나 손상되면 기본 크기다', () => {
    expect(loadRecordTextSize('user-1')).toBe('medium');
    localStorage.setItem('gomsin.display.recordTextSize.user-1', 'giant');
    expect(loadRecordTextSize('user-1')).toBe('medium');
  });

  it('계정별로 저장한다', () => {
    saveRecordTextSize('user-1', 'large');
    expect(loadRecordTextSize('user-1')).toBe('large');
    expect(loadRecordTextSize('user-2')).toBe('medium');
  });

  it('기본은 속성을 제거하고 작게·크게만 화면에 표시한다', () => {
    applyRecordTextSizeAttribute('large');
    expect(document.documentElement).toHaveAttribute('data-record-text-size', 'large');
    applyRecordTextSizeAttribute('small');
    expect(document.documentElement).toHaveAttribute('data-record-text-size', 'small');
    applyRecordTextSizeAttribute('medium');
    expect(document.documentElement).not.toHaveAttribute('data-record-text-size');
  });
});
