/**
 * The two period states a calendar day can say, drawn rather than tinted.
 *
 * ## Why symbols and not just colour
 *
 * The calendar previously carried two states -- recorded period and predicted
 * window -- separated by a fill and a dashed border, plus a dot for "condition
 * logged". Fertility and ovulation were computed by the engine and never drawn at
 * all. V4 deliberately removes those guesses: period-start history cannot support
 * a contraceptive or ovulation claim. Colour, fill and the written label now
 * distinguish only a recorded period from an estimated period window.
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
 * No fertility state is inferred from an absence of period data.
 */

import { cycleDayMarkLabels, type CycleDayMark } from './cycleFormatting';

const ACCENT: Record<CycleDayMark, string> = {
  period: 'var(--coral-strong)',
  period_predicted: 'var(--coral-strong)',
};

/** A water drop for both actual and estimated period states. */
function Glyph({ mark, solid }: { mark: CycleDayMark; solid: boolean }) {
  const color = ACCENT[mark];
  const fill = solid ? color : 'none';
  const strokeWidth = solid ? 0 : 1.4;

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
  const rows: CycleDayMark[] = ['period', 'period_predicted'];
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
        예상 표시는 실제 시작 기록만으로 계산한 참고 범위예요. 의료 판단이나 피임 정보가 아니에요.
      </p>
    </div>
  );
}
