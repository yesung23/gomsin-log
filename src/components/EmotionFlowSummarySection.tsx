import { useMemo } from 'react';
import { analyzeEmotionFlow } from '@/lib/emotionFlowAnalysis';
import type { DailyRecord, EmotionFlowItem } from '@/types';

/**
 * Aggregated emotion flow for the records currently on screen.
 *
 * Three properties are load-bearing, and they are the reason this is a component
 * over already-loaded records rather than a new data path:
 *
 * 1. **Purely derived, stored nowhere.** It reuses `analyzeEmotionFlow` over the
 *    records the page has already fetched and sanitised, so it introduces no
 *    column, no request and no cache. Editing or deleting a record therefore
 *    changes this summary on the very next render, with nothing to invalidate.
 *
 * 2. **Never sees diary text.** The input is `EmotionFlowItem[]` collected from
 *    the visible records; `log` and `matchedText` are not read. `matchedText` is
 *    stripped on the write path (`privacy.ts`) and is not consulted here either,
 *    so no diary fragment can reach the output even from a legacy row.
 *
 * 3. **Only `user_confirmed` items count.** That filter lives inside
 *    `analyzeEmotionFlow`, so rule *suggestions* -- which are composer-local and
 *    must never become narrative -- cannot influence the period summary.
 *
 * The records passed in must ALREADY be viewer-filtered (`visibleRecordsForViewer`).
 * This component does no authorization of its own; it is a presentation layer over
 * what the caller was entitled to see.
 */
interface EmotionFlowSummarySectionProps {
  /** Viewer-filtered records for the selected period. */
  records: DailyRecord[];
  /** Human-readable period label, e.g. `2026년 2월`. */
  periodLabel: string;
  /**
   * True while the period's records are not yet confirmed -- still loading, or
   * hidden because the shared workspace has not been verified.
   *
   * It OUTRANKS `records`, because an empty or partial array in that state means
   * "not known yet", and rendering it as either an empty period or a summary of
   * whatever happened to arrive would both be false statements about the user's
   * own data.
   */
  isLoading?: boolean;
  /** Non-null when the period's records could not be read. */
  error?: string | null;
  /** Retry handler, rendered only when one is supplied and an error is present. */
  onRetry?: () => void;
  className?: string;
}

export function EmotionFlowSummarySection({
  records,
  periodLabel,
  isLoading = false,
  error = null,
  onRetry,
  className,
}: EmotionFlowSummarySectionProps) {
  const { analysis, recordCount } = useMemo(() => {
    // Flatten in chronological order, then re-sequence: `analyzeEmotionFlow`
    // orders by `sequence`, which is per-record, so concatenating without
    // renumbering would interleave days.
    const ordered = [...records].sort((a, b) => {
      const byDate = a.date.localeCompare(b.date);
      if (byDate !== 0) return byDate;
      return (a.time || '').localeCompare(b.time || '');
    });

    const items: EmotionFlowItem[] = [];
    let contributing = 0;
    ordered.forEach((record) => {
      const confirmed = (record.emotionFlow || [])
        .filter((item) => item.source === 'user_confirmed')
        .sort((a, b) => a.sequence - b.sequence);
      if (confirmed.length > 0) contributing += 1;
      confirmed.forEach((item) => {
        items.push({
          // Only the fields the analysis reads are carried across. `matchedText`
          // is deliberately NOT copied, so it cannot reach the analysis or any
          // rendered string.
          group: item.group,
          displayLabel: item.displayLabel,
          source: item.source,
          sequence: items.length + 1,
        });
      });
    });

    return { analysis: analyzeEmotionFlow(items), recordCount: contributing };
  }, [records]);

  if (isLoading) {
    return (
      <section
        data-testid="emotion-flow-summary"
        data-state="loading"
        aria-busy="true"
        className={`bg-card border border-border rounded-surface p-4 ${className ?? ''}`}
      >
        <p className="text-caption font-semibold text-muted-foreground">기간 마음 흐름</p>
        {/*
          Says the period is not confirmed YET. The empty state's
          "아직 오늘의 마음이 없어요" is a verdict about the user's data, and while
          the workspace is hidden that verdict is not ours to make.
        */}
        <p className="text-caption text-muted-foreground mt-2">
          기록을 확인하는 중이에요. 확인되면 마음 흐름을 보여드려요.
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <section
        data-testid="emotion-flow-summary"
        data-state="error"
        role="alert"
        className={`bg-card border border-border rounded-surface p-4 ${className ?? ''}`}
      >
        <p className="text-caption font-semibold text-muted-foreground">기간 마음 흐름</p>
        <p className="text-caption text-muted-foreground mt-2">{error}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="press-response-row mt-3 min-h-[44px] w-full rounded-xl border border-border px-4 text-label font-bold text-foreground"
          >
            다시 시도
          </button>
        )}
      </section>
    );
  }

  if (!analysis) {
    return (
      <section
        data-testid="emotion-flow-summary"
        data-state="empty"
        className={`bg-card border border-border rounded-surface p-4 ${className ?? ''}`}
      >
        <p className="text-caption font-semibold text-muted-foreground">기간 마음 흐름</p>
        <p className="text-caption text-muted-foreground mt-2">아직 오늘의 마음이 없어요</p>
      </section>
    );
  }

  const { points, startState, endState, summary } = analysis;

  return (
    <section
      data-testid="emotion-flow-summary"
      data-state="ready"
      data-shape={analysis.shape}
      aria-label={`${periodLabel} 마음 흐름: ${summary}`}
      className={`bg-card border border-border rounded-surface p-4 ${className ?? ''}`}
    >
      <div className="flex items-baseline justify-between">
        <p className="text-caption font-semibold text-muted-foreground">기간 마음 흐름</p>
        <p className="text-caption text-muted-foreground">{periodLabel}</p>
      </div>

      <p className="text-body font-semibold text-foreground mt-2 break-keep">{summary}</p>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-caption">
        <div>
          <dt className="text-muted-foreground">처음</dt>
          <dd data-testid="summary-start" className="font-semibold text-foreground">
            {startState.label}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">마지막</dt>
          <dd data-testid="summary-end" className="font-semibold text-foreground">
            {endState.label}
          </dd>
        </div>
      </dl>

      <p data-testid="summary-counts" className="text-caption text-muted-foreground mt-3">
        기록 {recordCount}개 · 마음 {points.length}개
      </p>
    </section>
  );
}
