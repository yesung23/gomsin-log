import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CyclePrediction } from '@/lib/cyclePrediction';
import { CycleSummary } from './CycleSummary';

const predictionBase: CyclePrediction = {
  status: 'insufficient_data',
  periodsUsed: 0,
  intervalsUsed: 0,
  methodVersion: 'v4.0.0-owner-only',
};

describe('CycleSummary evidence labels', () => {
  it('labels a configured fallback as a setting', () => {
    render(
      <CycleSummary
        prediction={predictionBase}
        periods={[]}
        dailyLogs={[]}
        configuredCycleLength={28}
        configuredPeriodLength={5}
      />,
    );

    expect(screen.getAllByText('(설정값)')).toHaveLength(2);
  });

  it('labels observed history as records even when the future date is withheld', () => {
    render(
      <CycleSummary
        prediction={{
          ...predictionBase,
          status: 'withheld',
          reviewReason: 'wide_variation',
          periodsUsed: 4,
          intervalsUsed: 3,
          averageCycleLength: 34,
          medianCycleLength: 33,
          shortestCycleLength: 27,
          longestCycleLength: 42,
        }}
        periods={[]}
        dailyLogs={[]}
        configuredCycleLength={28}
        configuredPeriodLength={5}
      />,
    );

    expect(screen.getByText('(최근 3번 기록)')).toBeInTheDocument();
    expect(screen.getByText('(설정값)')).toBeInTheDocument();
    expect(screen.queryByText('34일 (설정값)')).not.toBeInTheDocument();
  });
});
