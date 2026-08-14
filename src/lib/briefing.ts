import type { DailyRecord, DailySummary, SummaryItem } from '@/types';
import { isRecordContentAvailable } from '@/lib/recordAvailability';

export function generateDailySummary(
  records: DailyRecord[],
  partnerName: string
): DailySummary {
  // Filter out private records, sort chronologically
  const sharedRecords = records
    .filter((r) => !r.isPrivate)
    /**
     * A record this device cannot decrypt is excluded, not summarised.
     *
     * It arrives with an empty `log`, which the branches below would read as "no
     * text but something happened" and turn into a sentence about content that
     * was never available. That is a narrative invented from unreadable data, and
     * it would also make 정확한 원본 이동 point at a record that cannot render.
     * See `recordAvailability.ts`.
     */
    .filter(isRecordContentAvailable)
    .sort((a, b) => new Date(`${a.date}T${a.time || '00:00'}`).getTime() - new Date(`${b.date}T${b.time || '00:00'}`).getTime());

  const todayStr = new Date().toISOString().split('T')[0];
  const count = sharedRecords.length;

  /**
   * PRODUCT_V3 §6.2: a day with exactly one shared record is the day most
   * likely to be missed, not the day least worth summarising. The previous
   * rule skipped the summary entirely below two records, which meant the
   * common case -- someone shares one thing before going quiet -- produced
   * nothing on the surface built to catch it.
   */
  if (count === 0) {
    return {
      date: todayStr,
      items: [],
      opener: undefined,
      totalSharedCount: count,
    };
  }

  const items: SummaryItem[] = [];

  // Find records with reactions or key media
  const hardRecord = sharedRecords.find((r) => r.reaction === 'hard');
  const goodRecord = sharedRecords.find((r) => r.reaction === 'good' || r.reaction === 'thought_of_you');
  const photoRecords = sharedRecords.filter((r) => r.attachments?.some((a) => a.type === 'photo'));
  const voiceRecords = sharedRecords.filter((r) => r.attachments?.some((a) => a.type === 'voice'));
  const textRecords = sharedRecords.filter((r) => r.log && r.log.trim());

  // 1. Mood item if present
  if (hardRecord) {
    items.push({
      id: `sum-hard-${hardRecord.id}`,
      text: `${partnerName}이가 오늘 다소 힘든 순간이 있었어요.`,
      recordIds: [hardRecord.id],
      kind: 'mood',
    });
  } else if (goodRecord) {
    items.push({
      id: `sum-good-${goodRecord.id}`,
      text: `${partnerName}이가 오늘 기분 좋은 순간을 남겼어요.`,
      recordIds: [goodRecord.id],
      kind: 'mood',
    });
  }

  // 2. Key text item
  if (textRecords.length > 0) {
    const target = textRecords[0];
    items.push({
      id: `sum-text-${target.id}`,
      text: `"${target.log}"`,
      recordIds: [target.id],
      kind: 'moment',
    });
  }

  // 3. Media summary item
  if (photoRecords.length > 0 || voiceRecords.length > 0) {
    const mediaRecord = photoRecords[0] || voiceRecords[0];
    const mediaTypes: string[] = [];
    if (photoRecords.length > 0) mediaTypes.push(`사진 ${photoRecords.length}장`);
    if (voiceRecords.length > 0) mediaTypes.push(`음성 ${voiceRecords.length}개`);

    items.push({
      id: `sum-media-${mediaRecord.id}`,
      text: `오늘 타임라인에 ${mediaTypes.join(', ')} 기록이 등록되었어요.`,
      recordIds: [mediaRecord.id],
      kind: 'media',
    });
  }

  // Rule: 2-3 shared records -> max 1 item; 4+ shared records -> max 2-3 items
  const maxItems = count <= 3 ? 1 : 3;
  const finalItems = items.slice(0, maxItems);

  /**
   * Generate the call opener.
   *
   * Every branch here must be an honest reaction to something the author
   * explicitly signalled (a tag), never a guess reconstructed from free
   * text. This used to have a third branch: any record whose log contained
   * "업무" produced a fixed sentence claiming it happened "오전" and that the
   * author "지쳤었다면서" -- a time of day and an emotional state neither the
   * keyword nor the record actually established, invented from a single
   * substring match. PRODUCT_V3 §6.4 rules this out ("서사 창작" is listed
   * as a hard no). The hard/good branches below stay: they react to an
   * EXPLICIT tag the author chose, and neither one asserts a fact about the
   * content of the record beyond what the tag itself already says.
   */
  let openerText = `오늘 제일 기억에 남는 순간이 언제였어?`;
  let openerRecordId = sharedRecords[sharedRecords.length - 1].id;

  if (hardRecord) {
    openerText = `오늘 제일 정신없었던 순간이 언제였어? 고생했어!`;
    openerRecordId = hardRecord.id;
  } else if (goodRecord) {
    openerText = `오늘 기분 좋은 일 있었다면서! 무슨 일이었어?`;
    openerRecordId = goodRecord.id;
  }

  const opener: SummaryItem = {
    id: `opener-${openerRecordId}`,
    text: openerText,
    recordIds: [openerRecordId],
    kind: 'topic',
  };

  return {
    date: sharedRecords[0].date || todayStr,
    items: finalItems,
    opener,
    totalSharedCount: count,
  };
}

/**
 * The record a summary is most about, for jumping to the original.
 *
 * README section 1 promises that tapping a summary lands on the original record.
 * `opener` is the headline these widgets actually display, so it is the first
 * choice; `items[0]` is what they fall back to when there is no opener, so it is
 * the fallback here too. Returns `undefined` when the summary describes no
 * specific record, which is not a failure -- it means navigate without a target.
 */
export function summaryTargetRecordId(summary: DailySummary): string | undefined {
  return summary.opener?.recordIds[0] ?? summary.items[0]?.recordIds[0];
}

export interface EmotionFlowBriefingResult {
  recordId: string;
  flowText: string;
  labels: string[];
}

/**
 * Generate deterministic Soldier Briefing template for "오늘의 마음 흐름"
 */
export function generateEmotionFlowBriefing(records: DailyRecord[]): EmotionFlowBriefingResult | null {
  const sharedRecords = records
    .filter((r) => !r.isPrivate)
    .filter(isRecordContentAvailable)
    .sort((a, b) => new Date(`${a.date}T${a.time || '00:00'}`).getTime() - new Date(`${b.date}T${b.time || '00:00'}`).getTime());

  for (const r of sharedRecords) {
    if (!r.emotionFlow || r.emotionFlow.length === 0) continue;

    // Filter confirmed shared items
    const sharedFlow = r.emotionFlow
      .filter((f) => f.source === 'user_confirmed' && f.visibility === 'shared')
      .sort((a, b) => a.sequence - b.sequence);

    if (sharedFlow.length === 0) continue;

    const labels = sharedFlow.map((f) => f.displayLabel);
    const flowText = labels.join(' → ');

    return {
      recordId: r.id,
      flowText: `오늘의 마음: ${flowText}`,
      labels,
    };
  }

  return null;
}
