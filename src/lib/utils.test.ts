import { describe, it, expect } from 'vitest';
import { daysBetweenLocal, toLocalDateString, formatLocalDate } from './utils';

describe('utils.ts', () => {
  it('daysBetweenLocal calculates correct difference', () => {
    expect(daysBetweenLocal('2024-01-01', '2024-01-10')).toBe(9);
    expect(daysBetweenLocal('2024-02-28', '2024-03-01')).toBe(2); // Leap year
    expect(daysBetweenLocal('2023-02-28', '2023-03-01')).toBe(1); // Non-leap year
  });

  it('toLocalDateString formats correctly', () => {
    const d = new Date(2024, 0, 15); // Jan 15 2024
    expect(toLocalDateString(d)).toBe('2024-01-15');
  });

  it('formatLocalDate formats to korean localized string', () => {
    expect(formatLocalDate('2024-05-08')).toBe('2024년 5월 8일');
  });
});
