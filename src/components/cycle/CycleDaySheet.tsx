import { Pencil } from 'lucide-react';
import type { CycleDailyLog, CyclePeriod } from '@/types';
import { CycleSheet } from './CycleSheet';
import { flowLabels, formatKoreanDate, moodLabels, painLabels, symptomLabels } from './cycleFormatting';

interface CycleDaySheetProps {
  date: string;
  period: CyclePeriod | null;
  dailyLog: CycleDailyLog | null;
  isPredicted: boolean;
  onEditPeriod: (period: CyclePeriod) => void;
  onEditDailyLog: () => void;
  onClose: () => void;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-caption text-muted-foreground shrink-0">{label}</span>
      <span className="text-body text-foreground text-right break-keep">{value}</span>
    </div>
  );
}

/**
 * What happened on one date, with the two editors kept separate.
 *
 * Replaces the old pattern of expanding forms inline beneath the calendar, which
 * pushed the calendar off screen and made the page grow without bound as the
 * user tapped around.
 */
export function CycleDaySheet({
  date,
  period,
  dailyLog,
  isPredicted,
  onEditPeriod,
  onEditDailyLog,
  onClose,
}: CycleDaySheetProps) {
  const hasAnything = !!period || !!dailyLog;

  return (
    <CycleSheet title={formatKoreanDate(date)} onClose={onClose}>
      <div className="space-y-4">
        {isPredicted && !period && (
          <p className="text-caption text-muted-foreground">
            생리 예상 기간이에요. 정확한 날짜가 아니라 예상 범위예요.
          </p>
        )}

        {period && (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-caption font-bold text-foreground">생리 기록</span>
              <button
                type="button"
                onClick={() => onEditPeriod(period)}
                className="min-h-11 px-2 -mr-2 text-caption font-medium text-info flex items-center gap-1"
              >
                <Pencil className="w-3 h-3" aria-hidden="true" />
                기간 수정
              </button>
            </div>
            <p className="text-body text-foreground">
              {formatKoreanDate(period.startDate)}
              {period.endDate ? ` ~ ${formatKoreanDate(period.endDate)}` : ' 시작 (진행 중)'}
            </p>
          </div>
        )}

        {dailyLog ? (
          <div className="space-y-1 border-t border-border/60 pt-3">
            <span className="text-caption font-bold text-foreground">컨디션</span>
            <div className="divide-y divide-border/40">
              <Field
                label="증상"
                value={dailyLog.symptoms.length > 0
                  ? dailyLog.symptoms.map((symptom) => symptomLabels[symptom]).join(' · ')
                  : '기록 없음'}
              />
              <Field label="출혈량" value={dailyLog.flow ? flowLabels[dailyLog.flow] : '기록 없음'} />
              <Field label="통증" value={dailyLog.painLevel ? painLabels[dailyLog.painLevel] : '기록 없음'} />
              <Field label="기분" value={dailyLog.mood ? moodLabels[dailyLog.mood] : '기록 없음'} />
              {dailyLog.note && <Field label="메모" value={dailyLog.note} />}
            </div>
          </div>
        ) : (
          <p className="text-body text-muted-foreground">
            {hasAnything ? '이 날의 컨디션 기록이 없어요.' : '아직 기록이 없어요.'}
          </p>
        )}

        <button
          type="button"
          onClick={onEditDailyLog}
          className="w-full min-h-11 rounded-control bg-coral-strong text-coral-strong-foreground text-label font-bold"
        >
          {dailyLog ? '컨디션 수정하기' : '컨디션 기록하기'}
        </button>
      </div>
    </CycleSheet>
  );
}
