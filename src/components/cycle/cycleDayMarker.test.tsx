import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { predictionOccursOnDate, type CyclePrediction } from '@/lib/cyclePrediction';
import { cycleDayMarkLabels } from '@/components/cycle/cycleFormatting';
import { CycleDayMarker, CycleLegend } from '@/components/cycle/CycleDayMarker';

const prediction: CyclePrediction = {
  status: 'personalized',
  expectedStartDate: '2026-09-01',
  windowStart: '2026-08-30',
  windowEnd: '2026-09-03',
  periodsUsed: 4,
  intervalsUsed: 3,
  shortestCycleLength: 27,
  longestCycleLength: 29,
  methodVersion: 'v4.0.0-owner-only',
};

describe('owner-only period estimate markers', () => {
  it('reads the inclusive period-start range without recomputing it', () => {
    expect(predictionOccursOnDate(prediction, '2026-08-30')).toBe(true);
    expect(predictionOccursOnDate(prediction, '2026-09-01')).toBe(true);
    expect(predictionOccursOnDate(prediction, '2026-09-03')).toBe(true);
    expect(predictionOccursOnDate(prediction, '2026-08-29')).toBe(false);
  });

  it('an insufficient or withheld estimate matches no date', () => {
    for (const status of ['insufficient_data', 'withheld'] as const) {
      expect(predictionOccursOnDate({
        status,
        periodsUsed: 0,
        intervalsUsed: 0,
        methodVersion: 'v4.0.0-owner-only',
      }, '2026-08-18')).toBe(false);
    }
  });

  it('draws an actual record solid and an estimate outlined', () => {
    const actual = render(<CycleDayMarker mark="period" />).container.innerHTML;
    const estimated = render(<CycleDayMarker mark="period_predicted" />).container.innerHTML;

    expect(actual).toContain('fill="var(--coral-strong)"');
    expect(actual).toContain('stroke-width="0"');
    expect(estimated).toContain('fill="none"');
    expect(estimated).not.toContain('stroke-width="0"');
  });
});

describe('the cycle legend does not imply fertility or medical precision', () => {
  it('names only actual period, estimated period and condition-log states', () => {
    render(<CycleLegend />);
    for (const label of Object.values(cycleDayMarkLabels)) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText('컨디션 기록')).toBeTruthy();
    expect(screen.queryByText(/가임|배란/)).toBeNull();
  });

  it('keeps an explicit non-medical explanation next to the range', () => {
    render(<CycleLegend />);
    expect(screen.getByText(/실제 시작 기록만으로 계산한 참고 범위/)).toBeTruthy();
    expect(screen.getByText(/의료 판단이나 피임 정보가 아니에요/)).toBeTruthy();
  });

  it('contains no fertility or ovulation field, helper, marker or aria path', () => {
    const paths = [
      'src/lib/cyclePrediction.ts',
      'src/components/cycle/CycleDayMarker.tsx',
      'src/components/cycle/cycleFormatting.ts',
      'src/components/cycle/CycleCalendar.tsx',
    ];
    const forbidden = [
      'estimatedOvulationDate',
      'fertilityWindowStart',
      'fertilityWindowEnd',
      'fertilityOccursOnDate',
      'ovulationOccursOnDate',
      "'fertile'",
      "'ovulation'",
    ];

    for (const path of paths) {
      const source = readFileSync(resolve(process.cwd(), path), 'utf8');
      for (const token of forbidden) expect(source, `${path} :: ${token}`).not.toContain(token);
    }
  });
});
