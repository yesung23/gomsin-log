import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  HOME_READING_MODE_STORAGE_KEY,
  readHomeReadingMode,
  useHomeReadingMode,
} from '@/features/home/useHomeReadingMode';

describe('useHomeReadingMode', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to horizontal and remembers only the allowed enum', () => {
    const { result, unmount } = renderHook(() => useHomeReadingMode());
    expect(result.current.mode).toBe('horizontal');

    act(() => result.current.setMode('vertical'));
    expect(result.current.mode).toBe('vertical');
    expect(localStorage.getItem(HOME_READING_MODE_STORAGE_KEY)).toBe('vertical');

    unmount();
    expect(renderHook(() => useHomeReadingMode()).result.current.mode).toBe('vertical');
  });

  it('ignores corrupt or non-enum storage values', () => {
    localStorage.setItem(HOME_READING_MODE_STORAGE_KEY, '{"mode":"vertical","uid":"someone"}');
    expect(readHomeReadingMode()).toBe('horizontal');
  });

  it('keeps Home usable when storage reads and writes are blocked', () => {
    const blocked = {
      getItem: () => { throw new Error('blocked read'); },
      setItem: () => { throw new Error('blocked write'); },
    };
    const { result } = renderHook(() => useHomeReadingMode(blocked));

    expect(result.current.mode).toBe('horizontal');
    act(() => result.current.setMode('vertical'));
    expect(result.current.mode).toBe('vertical');
  });
});
