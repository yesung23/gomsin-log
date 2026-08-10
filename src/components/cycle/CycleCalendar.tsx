import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  buildMonthCalendarCells,
  dailyLogHasContent,
  dailyLogOnDate,
  periodRangesOnDate,
} from '@/lib/cycle';
import { predictionOccursOnDate, type CyclePrediction } from '@/lib/cyclePrediction';
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
 * The month view, and the only place the three kinds of day are shown together.
 *
 * Every state carries a non-colour cue, because colour alone fails for
 * colour-blind users and in high-contrast modes:
 *   actual period    -> filled surface + a solid dot
 *   predicted window -> dashed outline
 *   condition logged -> small marker under the number
 *   today            -> thin ring
 *   selected         -> high-emphasis outline
 * The full meaning is also written into `aria-label`, so a screen reader hears
 * "8월 25일, 생리 예상 기간, 컨디션 기록 있음" rather than a bare number.
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
          className="min-h-11 min-w-11 flex items-center justify-center rounded-control hover:bg-muted"
          aria-label="이전 달"
        >
          <ChevronLeft className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
        </button>
        <span className="text-label font-bold text-foreground">{year}년 {month + 1}월</span>
        <button
          type="button"
          onClick={() => onMoveMonth(1)}
          className="min-h-11 min-w-11 flex items-center justify-center rounded-control hover:bg-muted"
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
          const ranges = periodRangesOnDate(periods, date);
          const isActual = ranges.length > 0;
          const isStart = ranges.some((range) => range.isStart);
          const isPredicted = !isActual && predictionOccursOnDate(prediction, date);
          const hasLog = dailyLogHasContent(dailyLogOnDate(dailyLogs, date));
          const isToday = date === today;
          const isSelected = selectedDate === date;

          const label = [
            date,
            isActual ? (isStart ? '생리 기록 시작일' : '생리 기록') : null,
            isPredicted ? '생리 예상 기간' : null,
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
                'border transition',
                isActual && 'bg-coral/20 border-coral/40 text-coral-strong font-bold',
                isPredicted && 'border-dashed border-coral/50 text-coral-strong',
                !isActual && !isPredicted && 'border-transparent text-foreground hover:bg-muted',
                isToday && !isSelected && 'ring-1 ring-coral/60',
                isSelected && 'ring-2 ring-navy ring-offset-1',
              )}
            >
              <span>{cell.day}</span>
              {/* Non-colour markers: a filled dot for a recorded period day, a
                  hollow one for a logged condition. */}
              <span className="flex items-center gap-0.5 h-1.5" aria-hidden="true">
                {isActual && <span className="w-1 h-1 rounded-full bg-coral-strong" />}
                {hasLog && <span className="w-1 h-1 rounded-full border border-current" />}
              </span>
            </button>
          );
        })}
      </div>

      <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-coral/40 border border-coral/50" aria-hidden="true" />
          기록
        </li>
        <li className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full border border-dashed border-coral/60" aria-hidden="true" />
          예상
        </li>
        <li className="flex items-center gap-1.5">
          <span className="w-1 h-1 rounded-full border border-current" aria-hidden="true" />
          컨디션
        </li>
      </ul>
    </section>
  );
}
