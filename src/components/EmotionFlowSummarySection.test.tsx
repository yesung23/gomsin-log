import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { EmotionFlowSummarySection } from '@/components/EmotionFlowSummarySection';
import { NON_DIAGNOSTIC_BANNED_TERMS } from '@/lib/emotionFlowAnalysis';
import { emotionFlowForStorage } from '@/lib/privacy';
import type { DailyRecord, EmotionFlowItem } from '@/types';

function item(
  sequence: number,
  group: EmotionFlowItem['group'],
  displayLabel: string,
  overrides: Partial<EmotionFlowItem> = {},
): EmotionFlowItem {
  return { sequence, group, displayLabel, source: 'user_confirmed', ...overrides };
}

function record(
  id: string,
  date: string,
  emotionFlow: EmotionFlowItem[],
  overrides: Partial<DailyRecord> = {},
): DailyRecord {
  return {
    id,
    userId: 'user-1',
    date,
    time: '10:00',
    authorRole: 'gomsin',
    log: 'diary body that must never be read by the summary',
    isPrivate: false,
    createdAt: `${date}T10:00:00.000Z`,
    emotionFlow,
    ...overrides,
  };
}

describe('EmotionFlowSummarySection states', () => {
  it('shows the empty state when nothing is confirmed', () => {
    render(<EmotionFlowSummarySection records={[]} periodLabel="2026년 2월" />);
    const section = screen.getByTestId('emotion-flow-summary');
    expect(section).toHaveAttribute('data-state', 'empty');
    expect(screen.getByText('아직 오늘의 마음이 없어요')).toBeInTheDocument();
  });

  it('shows the empty state when records exist but hold no confirmed items', () => {
    const records = [record('r1', '2026-02-01', [])];
    render(<EmotionFlowSummarySection records={records} periodLabel="2026년 2월" />);
    expect(screen.getByTestId('emotion-flow-summary')).toHaveAttribute('data-state', 'empty');
  });

  it('shows a loading state', () => {
    render(<EmotionFlowSummarySection records={[]} periodLabel="2026년 2월" isLoading />);
    const section = screen.getByTestId('emotion-flow-summary');
    expect(section).toHaveAttribute('data-state', 'loading');
    expect(section).toHaveAttribute('aria-busy', 'true');
  });

  /**
   * PRIORITY 2. The unconfirmed state is the one the user actually meets: on a
   * cold load the shared workspace is quarantined for ~2s and the records are
   * hidden, so `records` arrives EMPTY. Rendered as the empty state that reads
   * "아직 오늘의 마음이 없어요", the section asserted a false negative about the
   * user's own data -- and contradicted the banner directly above it, which was
   * correctly saying the shared info was hidden. Observed in a real browser as the
   * `healthy` arm of `scratch/p2-states.mjs`.
   */
  it('does not claim there are no emotions while the period is not yet confirmed', () => {
    render(<EmotionFlowSummarySection records={[]} periodLabel="2026년 2월" isLoading />);
    const section = screen.getByTestId('emotion-flow-summary');
    expect(section).toHaveAttribute('data-state', 'loading');
    expect(section.textContent).not.toContain('아직 오늘의 마음이 없어요');
    // It must say the period is still being confirmed, not that it is empty.
    expect(section.textContent).toContain('확인');
  });

  it('prefers the not-yet-confirmed state over an empty verdict, even with records', () => {
    // `isLoading` outranks a records array, because a partial array during
    // quarantine would produce a summary of the wrong period.
    const records = [record('r1', '2026-02-01', [item(1, 'joy', '기뻤어요')])];
    render(<EmotionFlowSummarySection records={records} periodLabel="2026년 2월" isLoading />);
    expect(screen.getByTestId('emotion-flow-summary')).toHaveAttribute('data-state', 'loading');
  });

  it('shows an error state with a retry when one is supplied', () => {
    let retried = 0;
    render(
      <EmotionFlowSummarySection
        records={[]}
        periodLabel="2026년 2월"
        error="기록을 불러오지 못했어요."
        onRetry={() => { retried += 1; }}
      />,
    );
    const section = screen.getByTestId('emotion-flow-summary');
    expect(section).toHaveAttribute('data-state', 'error');
    expect(screen.getByText('기록을 불러오지 못했어요.')).toBeInTheDocument();
    const retry = screen.getByText('다시 시도');
    expect(retry.className).toContain('min-h-[44px]');
    retry.click();
    expect(retried).toBe(1);
  });

  it('prefers the error state over rendering a stale summary', () => {
    const records = [record('r1', '2026-02-01', [item(1, 'joy', '기뻤어요')])];
    render(
      <EmotionFlowSummarySection
        records={records}
        periodLabel="2026년 2월"
        error="읽지 못했어요."
      />,
    );
    expect(screen.getByTestId('emotion-flow-summary')).toHaveAttribute('data-state', 'error');
  });
});

describe('EmotionFlowSummarySection aggregation', () => {
  it('aggregates across records in chronological order', () => {
    const records = [
      // Deliberately out of order in the array: the component must sort.
      record('r2', '2026-02-03', [item(1, 'joy', '기뻤어요')]),
      record('r1', '2026-02-01', [item(1, 'sadness', '슬펐어요')]),
    ];
    render(<EmotionFlowSummarySection records={records} periodLabel="2026년 2월" />);

    const section = screen.getByTestId('emotion-flow-summary');
    expect(section).toHaveAttribute('data-state', 'ready');
    expect(screen.getByTestId('summary-start')).toHaveTextContent('슬펐어요');
    expect(screen.getByTestId('summary-end')).toHaveTextContent('기뻤어요');
    // sadness -> joy is a rising period.
    expect(section).toHaveAttribute('data-shape', 'recovery');
  });

  it('orders same-day records by time', () => {
    const records = [
      record('r2', '2026-02-01', [item(1, 'joy', '기뻤어요')], { time: '20:00' }),
      record('r1', '2026-02-01', [item(1, 'sadness', '슬펐어요')], { time: '08:00' }),
    ];
    render(<EmotionFlowSummarySection records={records} periodLabel="2026년 2월" />);
    expect(screen.getByTestId('summary-start')).toHaveTextContent('슬펐어요');
    expect(screen.getByTestId('summary-end')).toHaveTextContent('기뻤어요');
  });

  it('counts contributing records and total confirmed items', () => {
    const records = [
      record('r1', '2026-02-01', [item(1, 'joy', '기뻤어요'), item(2, 'calm', '편안했어요')]),
      record('r2', '2026-02-02', [item(1, 'sadness', '슬펐어요')]),
      // Contributes nothing, so it must not be counted.
      record('r3', '2026-02-03', []),
    ];
    render(<EmotionFlowSummarySection records={records} periodLabel="2026년 2월" />);
    expect(screen.getByTestId('summary-counts')).toHaveTextContent('기록 2개 · 마음 3개');
  });

  it('reflects a record edit immediately, with nothing to invalidate', () => {
    const before = [record('r1', '2026-02-01', [item(1, 'sadness', '슬펐어요')])];
    const { rerender } = render(
      <EmotionFlowSummarySection records={before} periodLabel="2026년 2월" />,
    );
    expect(screen.getByTestId('summary-end')).toHaveTextContent('슬펐어요');

    // The same record, edited: its confirmed items were cleared and replaced.
    const after = [record('r1', '2026-02-01', [item(1, 'joy', '기뻤어요')])];
    rerender(<EmotionFlowSummarySection records={after} periodLabel="2026년 2월" />);

    expect(screen.getByTestId('summary-end')).toHaveTextContent('기뻤어요');
    expect(screen.queryByText('슬펐어요')).toBeNull();
  });

  it('reflects a record deletion immediately', () => {
    const before = [
      record('r1', '2026-02-01', [item(1, 'sadness', '슬펐어요')]),
      record('r2', '2026-02-02', [item(1, 'joy', '기뻤어요')]),
    ];
    const { rerender } = render(
      <EmotionFlowSummarySection records={before} periodLabel="2026년 2월" />,
    );
    expect(screen.getByTestId('summary-counts')).toHaveTextContent('기록 2개');

    rerender(
      <EmotionFlowSummarySection
        records={[before[0]]}
        periodLabel="2026년 2월"
      />,
    );
    expect(screen.getByTestId('summary-counts')).toHaveTextContent('기록 1개');
    expect(screen.queryByText('기뻤어요')).toBeNull();
  });

  it('returns to the empty state when the last contributing record is deleted', () => {
    const before = [record('r1', '2026-02-01', [item(1, 'joy', '기뻤어요')])];
    const { rerender } = render(
      <EmotionFlowSummarySection records={before} periodLabel="2026년 2월" />,
    );
    expect(screen.getByTestId('emotion-flow-summary')).toHaveAttribute('data-state', 'ready');

    rerender(<EmotionFlowSummarySection records={[]} periodLabel="2026년 2월" />);
    expect(screen.getByTestId('emotion-flow-summary')).toHaveAttribute('data-state', 'empty');
  });
});

describe('EmotionFlowSummarySection privacy', () => {
  it('ignores items that are not user_confirmed', () => {
    const records = [
      record('r1', '2026-02-01', [
        item(1, 'joy', '기뻤어요'),
        // A rule suggestion. Composer-local; it must never drive narrative.
        item(2, 'anger', '화났어요', { source: 'rule_suggested' }),
      ]),
    ];
    render(<EmotionFlowSummarySection records={records} periodLabel="2026년 2월" />);

    expect(screen.getByTestId('summary-counts')).toHaveTextContent('마음 1개');
    expect(screen.queryByText('화났어요')).toBeNull();
  });

  it('never renders matchedText or any diary fragment', () => {
    const records = [
      record('r1', '2026-02-01', [
        item(1, 'joy', '기뻤어요', { matchedText: '비밀 일기 조각' } as Partial<EmotionFlowItem>),
      ]),
    ];
    const { container } = render(
      <EmotionFlowSummarySection records={records} periodLabel="2026년 2월" />,
    );

    expect(container.textContent).not.toContain('비밀 일기 조각');
    // The record's `log` is not an input to the summary at all.
    expect(container.textContent).not.toContain('diary body');
  });

  it('does not let matchedText survive into a storage payload via this path', () => {
    // Defence in depth: the summary reads no `matchedText`, and the write path
    // strips it. Both are asserted so neither can regress alone.
    const withMatched = record('r1', '2026-02-01', [
      item(1, 'joy', '기뻤어요', { matchedText: '비밀 일기 조각' } as Partial<EmotionFlowItem>),
    ]);
    const stored = emotionFlowForStorage(withMatched);
    expect(JSON.stringify(stored)).not.toContain('비밀 일기 조각');
    expect(JSON.stringify(stored)).not.toContain('matchedText');
  });

  it('uses no diagnostic vocabulary in any rendered state', () => {
    const records = [
      record('r1', '2026-02-01', [item(1, 'sadness', '슬펐어요')]),
      record('r2', '2026-02-05', [item(1, 'anger', '화났어요')]),
      record('r3', '2026-02-09', [item(1, 'joy', '기뻤어요')]),
    ];
    const { container } = render(
      <EmotionFlowSummarySection records={records} periodLabel="2026년 2월" />,
    );
    for (const term of NON_DIAGNOSTIC_BANNED_TERMS) {
      expect(container.textContent, `must not contain "${term}"`).not.toContain(term);
    }
  });

  it('exposes every rendered fact as real text, not only in the aria label', () => {
    const records = [record('r1', '2026-02-01', [item(1, 'joy', '기뻤어요')])];
    render(<EmotionFlowSummarySection records={records} periodLabel="2026년 2월" />);
    expect(screen.getByTestId('summary-start')).toHaveTextContent('기뻤어요');
    expect(screen.getByTestId('summary-counts')).toBeInTheDocument();
    expect(screen.getByText('2026년 2월')).toBeInTheDocument();
  });
});
