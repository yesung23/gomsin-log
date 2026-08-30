import { useState, useId } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';
import {
  DEFAULT_BRIEFING_LOCALE,
  type BriefingLocale,
  type BriefingPeriod,
  type PartnerBriefing,
} from '@/lib/partnerBriefing/contract';
import { formatDateForLocale } from '@/lib/partnerBriefing/fallback';

export interface PartnerBriefingCardProps {
  readonly briefing: PartnerBriefing;
  readonly locale?: BriefingLocale;
  readonly onOpenRecord: (recordId: string) => void;
  readonly className?: string;
}
const PERIOD_LABELS: Record<BriefingLocale, Record<BriefingPeriod, string>> = {
  ko: {
    morning: '아침',
    afternoon: '오후',
    evening: '저녁',
    night: '밤',
  },
  en: {
    morning: 'Morning',
    afternoon: 'Afternoon',
    evening: 'Evening',
    night: 'Night',
  },
};

const HEADING_LABELS: Record<BriefingLocale, string> = {
  ko: '지난 연락 이후',
  en: 'Since you last checked',
};

const EXPAND_LABELS: Record<BriefingLocale, { expand: string; collapse: string }> = {
  ko: {
    expand: '자세히 보기',
    collapse: '접기',
  },
  en: {
    expand: 'See details',
    collapse: 'Collapse',
  },
};

const VIEW_ORIGINAL_LABELS: Record<BriefingLocale, string> = {
  ko: '원본 보기',
  en: 'View original',
};

const GROUPS_PER_PAGE = 20;

function formatShowMoreLabel(count: number, locale: BriefingLocale): string {
  return locale === 'en' ? `Show ${count} more` : `${count}개 더 보기`;
}

function formatMomentCount(count: number, locale: BriefingLocale): string {
  if (locale === 'en') {
    return count === 1 ? '1 moment' : `${count} moments`;
  }
  return `순간 ${count}개`;
}

export function PartnerBriefingCard({
  briefing,
  locale = DEFAULT_BRIEFING_LOCALE,
  onOpenRecord,
  className,
}: PartnerBriefingCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [visibleGroupCount, setVisibleGroupCount] = useState(GROUPS_PER_PAGE);
  const baseId = useId();
  const detailsId = `${baseId}-details`;

  const hasDays = briefing.days.length > 0;
  let totalGroupCount = 0;

  for (const day of briefing.days) {
    for (const section of day.sections) {
      totalGroupCount += section.items.length;
    }
  }

  const remainingGroupCount = Math.max(0, totalGroupCount - visibleGroupCount);
  const hasHiddenGroups = remainingGroupCount > 0;
  let remainingGroupBudget = visibleGroupCount;

  const handleToggleDetails = () => {
    setVisibleGroupCount(GROUPS_PER_PAGE);
    setExpanded((prev) => !prev);
  };

  return (
    <Card
      data-testid="partner-briefing-card"
      aria-label={HEADING_LABELS[locale]}
      className={cn('space-y-3', className)}
    >
      {/* Header: Title + Range and Count Badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-heading font-semibold text-foreground">
            {HEADING_LABELS[locale]}
          </h2>
          {briefing.rangeLabel ? (
            <p className="text-caption text-muted-foreground tabular-nums mt-0.5">
              {briefing.rangeLabel}
            </p>
          ) : null}
        </div>
        <Badge tone="neutral" className="shrink-0">
          {formatMomentCount(briefing.sourceCount, locale)}
        </Badge>
      </div>

      {/* 10s Overview Text */}
      {briefing.overview.text ? (
        <p className="text-body text-foreground break-keep">
          {briefing.overview.text}
        </p>
      ) : null}

      {/* Expand / Collapse Control */}
      {hasDays ? (
        <button
          type="button"
          onClick={handleToggleDetails}
          aria-expanded={expanded}
          aria-controls={detailsId}
          data-testid="partner-briefing-expand"
          className="press-response-row w-full min-h-11 flex items-center justify-center gap-1 text-caption text-muted-foreground rounded-control"
        >
          <span>{expanded ? EXPAND_LABELS[locale].collapse : EXPAND_LABELS[locale].expand}</span>
          {expanded ? (
            <ChevronUp size={14} aria-hidden="true" />
          ) : (
            <ChevronDown size={14} aria-hidden="true" />
          )}
        </button>
      ) : null}

      {/* Expanded Details */}
      {expanded && hasDays ? (
        <div
          id={detailsId}
          data-testid="partner-briefing-details"
          className="space-y-4 border-t border-border pt-3"
        >
          {briefing.days.map((day, dayIdx) => {
            const visibleSections = day.sections.map((section, sectionIdx) => {
              if (remainingGroupBudget <= 0) {
                return null;
              }

              const visibleItems = section.items.slice(0, remainingGroupBudget);
              remainingGroupBudget -= visibleItems.length;

              if (visibleItems.length === 0) {
                return null;
              }

              /*
                Keyed by POSITION, not by period.

                A day can now legitimately carry two sections with the same period:
                `night` spans both ends of the clock, so 00:30 and 22:30 are separate
                contiguous runs with `morning` between them. `key={section.period}`
                would give React two children keyed "night" in one list. `sectionIdx` is
                already the identity used by the exact-original `textId`s below, so this
                keeps the two consistent.
              */
              return (
                <div key={`${section.period}-${sectionIdx}`} className="space-y-2 pl-1">
                  <h4 className="text-caption font-medium text-foreground">
                    {PERIOD_LABELS[locale][section.period]}
                  </h4>
                  <ul className="space-y-2">
                    {visibleItems.map((item, itemIdx) => (
                      <li
                        key={`${day.date}-${sectionIdx}-${section.period}-${itemIdx}`}
                        className="rounded-control bg-muted/30 p-2.5 space-y-2.5"
                      >
                        <p
                          data-testid="partner-briefing-summary"
                          className="text-body text-foreground break-keep"
                        >
                          {item.parts.map((part, partIdx) => {
                            const textId = `${baseId}-d${dayIdx}-s${sectionIdx}-i${itemIdx}-p${partIdx}`;
                            return (
                              <span key={`${part.sourceRecordId}-${partIdx}`}>
                                {partIdx > 0 ? ' ' : null}
                                <span id={textId}>{part.text}</span>
                              </span>
                            );
                          })}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          {item.parts.map((part, partIdx) => {
                            const textId = `${baseId}-d${dayIdx}-s${sectionIdx}-i${itemIdx}-p${partIdx}`;
                            return (
                              <button
                                key={`${part.sourceRecordId}-${partIdx}`}
                                type="button"
                                onClick={() => onOpenRecord(part.sourceRecordId)}
                                aria-label={VIEW_ORIGINAL_LABELS[locale]}
                                aria-describedby={textId}
                                className="press-response min-h-11 min-w-11 px-3 flex items-center justify-center rounded-control text-caption font-medium text-muted-foreground hover:text-foreground active:bg-muted/60"
                              >
                                {VIEW_ORIGINAL_LABELS[locale]}
                              </button>
                            );
                          })}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            });

            if (!visibleSections.some(Boolean)) {
              return null;
            }

            return (
              <section key={day.date} className="space-y-3">
                <h3 className="text-caption font-semibold text-muted-foreground tabular-nums">
                  {formatDateForLocale(day.date, locale)}
                </h3>
                {visibleSections}
              </section>
            );
          })}
          {hasHiddenGroups ? (
            <button
              type="button"
              onClick={() => setVisibleGroupCount((count) => count + GROUPS_PER_PAGE)}
              data-testid="partner-briefing-show-more"
              className="press-response-row w-full min-h-11 flex items-center justify-center rounded-control text-caption text-muted-foreground"
            >
              {formatShowMoreLabel(remainingGroupCount, locale)}
            </button>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
