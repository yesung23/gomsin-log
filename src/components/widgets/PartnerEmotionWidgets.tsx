import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Sparkles } from 'lucide-react';
import { useStore } from '@/lib/useStore';
import { isOwnRecord, visibleRecordsForViewer } from '@/lib/privacy';
import { analyzeEmotionFlow } from '@/lib/emotionFlowAnalysis';
import { BASIC_EMOTION_EMOJI, basicEmotionOf } from '@/lib/basicEmotions';
import { EmotionFlowSummarySection } from '@/components/EmotionFlowSummarySection';
import { generateDailySummary } from '@/lib/briefing';
import { localToday, toLocalDateString } from '@/lib/utils';
import type { DailyRecord } from '@/types';

/**
 * The two widgets the 군화 home leads with.
 *
 * The request was specific: first the partner's emotion flow, then the summary.
 * That ordering is right for the actual situation these two people are in -- the
 * soldier gets a few minutes and wants to know how she is, not to read a feed. So
 * the flow answers "how was her day shaped" in one line, and the summary answers
 * "what actually happened" underneath it.
 *
 * Both read ONLY records the viewer is entitled to see. `visibleRecordsForViewer`
 * is applied here as well as in the store, and author-only emotion items are
 * already stripped by `sanitizeRecordForViewer`, so a private entry or an
 * author-only feeling cannot reach either widget.
 */

function usePartnerRecords(): { partnerRecords: DailyRecord[]; partnerName: string; todayStr: string } {
  const { state } = useStore();
  const { profile } = state;
  const todayStr = toLocalDateString(localToday());
  const viewer = { userId: profile.id, role: profile.role };

  const partnerRecords = useMemo(
    () => visibleRecordsForViewer(state.records, viewer)
      .filter((record) => !isOwnRecord(record, viewer) && !record.isPrivate),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.records, profile.id, profile.role],
  );

  return {
    partnerRecords,
    partnerName: profile.couple.partnerName || '상대방',
    todayStr,
  };
}

/**
 * Widget 1 — the partner's emotion flow for today.
 *
 * Renders the six-emotion chain as emoji + labels, which is the whole point of
 * collapsing the vocabulary to six: a flow reads at a glance instead of needing a
 * legend.
 */
export function PartnerEmotionFlowWidget() {
  const navigate = useNavigate();
  const { partnerRecords, partnerName, todayStr } = usePartnerRecords();

  const { analysis, items } = useMemo(() => {
    const todays = partnerRecords
      .filter((record) => record.date === todayStr)
      .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    const flat = todays.flatMap((record) =>
      (record.emotionFlow || []).filter((item) => item.source === 'user_confirmed'),
    );
    const resequenced = flat.map((item, index) => ({ ...item, sequence: index + 1 }));
    return { analysis: analyzeEmotionFlow(resequenced), items: resequenced };
  }, [partnerRecords, todayStr]);

  return (
    <button
      type="button"
      onClick={() => navigate('/record')}
      data-testid="widget-partner-emotion-flow"
      className="w-full text-left"
    >
      <h3 className="text-sm font-bold text-foreground mb-2 flex items-center gap-1.5">
        <Sparkles size={14} className="text-coral" aria-hidden="true" />
        {partnerName}의 마음 흐름
      </h3>

      {!analysis ? (
        <p className="text-xs text-muted-foreground leading-relaxed">
          아직 오늘 공유된 마음이 없어요. {partnerName}이 기록을 남기면 여기에 보여드려요.
        </p>
      ) : (
        <div className="space-y-2">
          <div
            data-testid="partner-flow-chain"
            className="flex items-center gap-1.5 flex-wrap"
          >
            {items.map((item, index) => (
              <span key={item.id || index} className="flex items-center gap-1.5">
                {index > 0 && <ArrowRight size={12} className="text-muted-foreground" aria-hidden="true" />}
                <span className="px-2 py-1 rounded-lg bg-muted text-xs font-bold text-foreground">
                  <span aria-hidden="true">{BASIC_EMOTION_EMOJI[basicEmotionOf(item)]}</span>{' '}
                  {item.displayLabel}
                </span>
              </span>
            ))}
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{analysis.summary}</p>
        </div>
      )}
    </button>
  );
}

/**
 * Widget 2 — today's summary of what the partner shared.
 *
 * Reuses `EmotionFlowSummarySection` for the period view rather than inventing a
 * second aggregation, so the two surfaces can never disagree.
 */
export function PartnerEmotionSummaryWidget() {
  const navigate = useNavigate();
  const { partnerRecords, partnerName, todayStr } = usePartnerRecords();

  const todays = useMemo(
    () => partnerRecords.filter((record) => record.date === todayStr),
    [partnerRecords, todayStr],
  );

  const summary = useMemo(
    () => generateDailySummary(todays, partnerName),
    [todays, partnerName],
  );

  const headline = summary.opener?.text
    || summary.items[0]?.text
    || (todays.length > 0 ? `${partnerName}이 오늘 ${todays.length}개의 순간을 공유했어요.` : null);

  return (
    <div data-testid="widget-partner-emotion-summary">
      <h3 className="text-sm font-bold text-foreground mb-2">오늘의 요약</h3>
      {headline ? (
        <button type="button" onClick={() => navigate('/record')} className="w-full text-left">
          <p className="text-xs text-foreground leading-relaxed">{headline}</p>
          <span className="text-[11px] text-coral font-bold mt-1 inline-block">기록으로 이동 →</span>
        </button>
      ) : (
        <p className="text-xs text-muted-foreground leading-relaxed">
          오늘 공유된 이야기가 아직 없어요.
        </p>
      )}

      {/* The period view, for when today is quiet but the week was not. */}
      <EmotionFlowSummarySection
        records={partnerRecords}
        periodLabel="최근"
        className="mt-3"
      />
    </div>
  );
}
