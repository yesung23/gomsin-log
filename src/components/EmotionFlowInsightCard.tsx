import { analyzeEmotionFlow } from '@/lib/emotionFlowAnalysis';
import type { EmotionFlowItem } from '@/types';

/**
 * Renders the shape of one record's confirmed emotions.
 *
 * The analysis is recomputed on every render from the items passed in and is
 * never stored, so this card can only ever show what is already in the record
 * (or, in the composer, what is about to be saved). It receives no diary text.
 *
 * The sparkline is decorative: every fact it draws is also present as real DOM
 * text, so screen readers and tests never have to parse the SVG.
 */
interface EmotionFlowInsightCardProps {
  items: EmotionFlowItem[] | undefined;
  variant?: 'composer' | 'detail';
  className?: string;
}

/** SVG geometry. The viewBox is fluid, so the card has no fixed pixel width. */
const VIEW_WIDTH = 100;
const MID_Y = 20;
const Y_SCALE = 16;

export function EmotionFlowInsightCard({
  items,
  variant = 'detail',
  className,
}: EmotionFlowInsightCardProps) {
  const analysis = analyzeEmotionFlow(items);

  // Nothing confirmed: render nothing at all rather than an empty shell.
  if (!analysis) return null;

  const { points, largestTransition, summary } = analysis;
  const count = points.length;

  const coords = points.map((point, index) => ({
    x: count === 1 ? VIEW_WIDTH / 2 : index * (VIEW_WIDTH / (count - 1)),
    y: MID_Y - point.valence * Y_SCALE,
  }));

  return (
    <div
      role="group"
      aria-label={summary}
      className={`bg-card border border-border rounded-2xl p-4 ${className ?? ''}`}
    >
      <p className="text-caption font-semibold text-muted-foreground mb-2">마음의 흐름</p>

      <p className="text-body font-medium text-foreground">
        {points.map((point) => point.label).join(' → ')}
      </p>

      <svg
        viewBox={`0 0 ${VIEW_WIDTH} 40`}
        preserveAspectRatio="none"
        role="presentation"
        aria-hidden="true"
        className="w-full h-10 text-coral my-2"
      >
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          points={coords.map(({ x, y }) => `${x},${y}`).join(' ')}
        />
        {coords.map(({ x, y }, index) => (
          <circle key={index} cx={x} cy={y} r="2.5" fill="currentColor" />
        ))}
      </svg>

      <p className="text-body text-muted-foreground">{summary}</p>

      {largestTransition && (
        <p className="text-caption text-muted-foreground mt-1">
          가장 큰 변화: {largestTransition.from.label} → {largestTransition.to.label}
        </p>
      )}

      {variant === 'composer' && (
        <p className="text-caption text-muted-foreground mt-2">
          미리보기예요. 이 정리는 저장되지 않아요.
        </p>
      )}
    </div>
  );
}
