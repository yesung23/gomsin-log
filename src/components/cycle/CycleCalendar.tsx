import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  buildMonthCalendarCells,
  dailyLogHasContent,
  dailyLogOnDate,
  periodRangesOnDate,
} from '@/lib/cycle';
import {
  predictionOccursOnDate,
  type CyclePrediction,
} from '@/lib/cyclePrediction';
import { CycleDayMarker, CycleLegend } from './CycleDayMarker';
import { cycleDayMarkLabels, type CycleDayMark } from './cycleFormatting';
import { cn } from '@/lib/utils';
import type { CycleDailyLog, CyclePeriod } from '@/types';

interface CycleCalendarProps {
  year: number;
  month: number;
  periods: CyclePeriod[];
  dailyLogs: CycleDailyLog[];
  prediction: CyclePrediction;
  today: string;
  selectedDate: string;
  onMoveMonth: (amount: number) => void;
  onSelectDate: (date: string) => void;
}

/**
 * The month view, and the only place every kind of day is shown together.
 *
 * Every state carries a non-colour cue, because colour alone fails for
 * colour-blind users and in high-contrast modes:
 *   actual period    -> filled surface + a SOLID 물방울
 *   predicted window -> dashed outline + an OUTLINED 물방울
 *   condition logged -> small hollow dot, alongside any of the above
 *   today            -> thin ring
 *   selected         -> high-emphasis outline
 *
 * Solid means recorded and outlined means estimated, consistently, so the one
 * distinction with the highest cost of being misread does not depend on hue.
 * `CycleLegend` names all of it, and the full meaning is written into `aria-label`
 * too, so a screen reader hears "2026-08-25, 생리 예상 범위, 컨디션 기록 있음"
 * rather than a bare number.
 */
export function CycleCalendar({
  year,
  month,
  periods,
  dailyLogs,
  prediction,
  today,
  selectedDate,
  onMoveMonth,
  onSelectDate,
}: CycleCalendarProps) {
  const cells = buildMonthCalendarCells(year, month);

  return (
    <section className="space-y-3" aria-label="주기 달력">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => onMoveMonth(-1)}
          className="press-response min-h-11 min-w-11 flex items-center justify-center rounded-control hover:bg-muted"
          aria-label="이전 달"
        >
          <ChevronLeft className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
        </button>
        <span className="text-label font-bold text-foreground">{year}년 {month + 1}월</span>
        <button
          type="button"
          onClick={() => onMoveMonth(1)}
          className="press-response min-h-11 min-w-11 flex items-center justify-center rounded-control hover:bg-muted"
          aria-label="다음 달"
        >
          <ChevronRight className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
        </button>
      </div>

      <div className="grid grid-cols-7 text-center text-caption font-medium text-muted-foreground gap-0.5">
        <span>일</span><span>월</span><span>화</span><span>수</span><span>목</span><span>금</span><span>토</span>
      </div>

      {/*
        `gap-0.5` (2px), not `gap-1`, and the reason is arithmetic rather than
        taste: the grid is 324px wide inside this screen, so seven cells with a
        4px gap resolve to 42.9px and miss the 44px tap target by a pixel. At 2px
        they resolve to 44.6px.
      */}
      <div className="grid grid-cols-7 gap-0.5 text-center text-label">
        {cells.map((cell, index) => {
          if (!cell.date || !cell.day) {
            return <span key={`blank-${index}`} aria-hidden="true" className="min-h-11" />;
          }
          const date = cell.date;
          // `today` bounds an ongoing period: it is painted from its start through
          // today, and no further.
          const ranges = periodRangesOnDate(periods, date, today);
          const isActual = ranges.length > 0;
          const isStart = ranges.some((range) => range.isStart);
          const isPredicted = !isActual && predictionOccursOnDate(prediction, date);
          const hasLog = dailyLogHasContent(dailyLogOnDate(dailyLogs, date));
          const isToday = date === today;
          const isSelected = selectedDate === date;

          /*
            One mark per day, resolved by precedence rather than stacking.

            A recorded period outranks every estimate -- what happened beats what was
            guessed. Two glyphs in a 44px cell would collide under a two-digit date,
            so the independent condition marker is the only allowed companion.

            Days with no mark are left blank ON PURPOSE. Drawing a "low likelihood"
            symbol would turn an absence of information into a reassurance, and this
            estimate cannot support one.
          */
          const mark: CycleDayMark | null = isActual
            ? 'period'
            : isPredicted ? 'period_predicted' : null;

          const label = [
            date,
            isActual ? (isStart ? '생리 기록 시작일' : '생리 기록') : null,
            // The estimate says so in the label too, so a screen reader never hears
            // a guess in the same words as a record.
            mark && mark !== 'period' ? cycleDayMarkLabels[mark] : null,
            hasLog ? '컨디션 기록 있음' : null,
            isToday ? '오늘' : null,
          ].filter(Boolean).join(', ');

          return (
            <button
              type="button"
              key={date}
              onClick={() => onSelectDate(date)}
              aria-label={label}
              aria-current={isToday ? 'date' : undefined}
              aria-pressed={isSelected}
              className={cn(
                'min-h-11 rounded-control flex flex-col items-center justify-center gap-0.5',
                /*
                  A calendar day is pressed without looking, so it is the control
                  where feedback on RELEASE helps least. The bare `transition` here
                  answered only the selection ring, which lands after the state
                  round-trip -- on a slow one the cell sat inert under the finger.

                  There was a `@keyframes cell-press` written for this exact cell and
                  referenced by nothing. It would have been the wrong answer anyway:
                  a keyframe plays on click, not on pointer-down, and cannot be
                  interrupted by the next date. Removed with this change.
                */
                'press-response border',
                isActual && 'bg-coral/20 border-coral/40 text-coral-strong font-bold',
                isPredicted && 'border-dashed border-coral/50 text-coral-strong',
                !isActual && !isPredicted
                  && 'border-transparent text-foreground hover:bg-muted',
                isToday && !isSelected && 'ring-1 ring-coral/60',
                isSelected && 'ring-2 ring-navy ring-offset-1',
              )}
            >
              <span>{cell.day}</span>
              {/*
                The marker row. One state glyph plus, independently, the hollow dot
                for a logged condition -- a condition note can coexist with any of
                either period state, so it is the one thing allowed to sit alongside.
                Fixed height so a day with no marks keeps the same baseline as one
                with two, and the number grid stays straight.
              */}
              <span className="flex items-center justify-center gap-0.5 h-3" aria-hidden="true">
                {mark && <CycleDayMarker mark={mark} />}
                {hasLog && <span className="w-1 h-1 rounded-full border border-current" />}
              </span>
            </button>
          );
        })}
      </div>

      <CycleLegend />
    </section>
  );
}
