/**
 * The four things a calendar day can say, drawn rather than tinted.
 *
 * ## Why symbols and not just colour
 *
 * The calendar previously carried two states -- recorded period and predicted
 * window -- separated by a fill and a dashed border, plus a dot for "condition
 * logged". Fertility and ovulation were computed by the engine and never drawn at
 * all, so the two states people most often open a cycle app to see were the two it
 * did not show.
 *
 * Adding them as two more colours would have made a five-colour grid where colour
 * carried everything. Roughly one in twelve people cannot separate some of those
 * hues, and a high-contrast or reduced-transparency mode flattens the rest. So each
 * state gets a SHAPE, and the shape is what identifies it; colour agrees with the
 * shape, and the legend and `aria-label` say it in words. Three signals, none of
 * them load-bearing alone.
 *
 * ## Actual vs predicted
 *
 * A recorded day and a guess about a day must never look the same. Recorded is
 * SOLID; every estimate is OUTLINED and lighter. That difference is deliberately
 * carried by fill rather than by hue, because it survives every accessibility mode
 * and it is the distinction with the highest cost of being wrong.
 *
 * ## Wording
 *
 * Nothing here says 안전한 날 or 임신이 안 되는 날, and nothing may. This is a
 * statistical estimate from past start dates -- it is not contraception, it does
 * not know about this cycle, and language that implies otherwise would be a
 * medical claim the arithmetic cannot support. The low-likelihood state is
 * therefore drawn as an absence rather than as a reassurance.
 */

import { cycleDayMarkLabels, type CycleDayMark } from './cycleFormatting';

const ACCENT: Record<CycleDayMark, string> = {
  period: 'var(--coral-strong)',
  period_predicted: 'var(--coral-strong)',
  fertile: 'var(--emotion-disgust)', // the sage green already in the token set
  ovulation: 'var(--info)',
};

/**
 * 물방울 for a period, 씨앗 for the fertile window, a small heart for ovulation.
 *
 * The seed is drawn rather than borrowed: a leaf or a sprout would read as a plant
 * app, and the shape here has to be small enough to sit under a two-digit date on a
 * 320px screen and still not be a blob.
 */
function Glyph({ mark, solid }: { mark: CycleDayMark; solid: boolean }) {
  const color = ACCENT[mark];
  const fill = solid ? color : 'none';
  const strokeWidth = solid ? 0 : 1.4;

  if (mark === 'ovulation') {
    return (
      <path
        d="M6 10.2 2.6 6.9a2.2 2.2 0 0 1 3.4-2.8 2.2 2.2 0 0 1 3.4 2.8L6 10.2Z"
        fill={fill}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
    );
  }

  if (mark === 'fertile') {
    // A seed: one round lobe with a short stem notch. Not a leaf, not a droplet.
    return (
      <>
        <ellipse cx="6" cy="7.4" rx="3.4" ry="3.9" fill={fill} stroke={color} strokeWidth={strokeWidth} />
        <path d="M6 3.5c0-1.3.8-2.2 2-2.5-.1 1.4-.8 2.2-2 2.5Z" fill={color} opacity={solid ? 0.75 : 0.5} />
      </>
    );
  }

  // 물방울, for both the recorded and the predicted period.
  return (
    <path
      d="M6 1.4c2.2 2.6 3.7 4.6 3.7 6.4A3.7 3.7 0 0 1 6 11.5 3.7 3.7 0 0 1 2.3 7.8c0-1.8 1.5-3.8 3.7-6.4Z"
      fill={fill}
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinejoin="round"
    />
  );
}

export function CycleDayMarker({ mark, size = 12 }: { mark: CycleDayMark; size?: number }) {
  // Only a recorded period is solid. Everything else is an estimate, and says so.
  const solid = mark === 'period';
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <Glyph mark={mark} solid={solid} />
    </svg>
  );
}

/**
 * The legend. Not optional.
 *
 * A symbol set nobody explained is a worse calendar than a plain one, and the two
 * new marks are exactly the ones a user has no prior expectation for. It also
 * carries the sentence that keeps the estimate honest, where the estimate is.
 */
export function CycleLegend() {
  const rows: CycleDayMark[] = ['period', 'period_predicted', 'fertile', 'ovulation'];
  return (
    <div className="space-y-1.5">
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
        {rows.map((mark) => (
          <li key={mark} className="flex items-center gap-1.5">
            <CycleDayMarker mark={mark} />
            {cycleDayMarkLabels[mark]}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="w-1 h-1 rounded-full border border-current inline-block"
          />
          컨디션 기록
        </li>
      </ul>
      <p className="text-caption text-muted-foreground leading-tight">
        예상 표시는 지난 기록으로 계산한 추정이에요. 피임 여부를 알려주지는 않아요.
      </p>
    </div>
  );
}
