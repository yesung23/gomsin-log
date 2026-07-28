import type { DailyRecord, DailySummary, SummaryItem } from '@/types';

const REACTION_LABELS: Record<string, string> = {
  good: '좋았어',
  event: '이런 일이 있었어',
  hard: '힘들었어',
  thought_of_you: '네 생각났어',
};

export function generateDailySummary(
  records: DailyRecord[],
  partnerName: string
): DailySummary {
  // Filter out private records, sort chronologically
  const sharedRecords = records
    .filter((r) => !r.isPrivate)
    .sort((a, b) => new Date(`${a.date}T${a.time || '00:00'}`).getTime() - new Date(`${b.date}T${b.time || '00:00'}`).getTime());

  const todayStr = new Date().toISOString().split('T')[0];
  const count = sharedRecords.length;

  // Rule: 0 or 1 shared record -> skip summary card
  if (count <= 1) {
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

  // Generate call opener item
  let openerText = `오늘 제일 기억에 남는 순간이 언제였어?`;
  let openerRecordId = sharedRecords[sharedRecords.length - 1].id;

  if (hardRecord) {
    openerText = `오늘 제일 정신없었던 순간이 언제였어? 고생했어!`;
    openerRecordId = hardRecord.id;
  } else if (textRecords.length > 0 && textRecords[0].log.includes('업무')) {
    openerText = `오늘 오전 업무 때문에 지쳤었다면서, 지금은 괜찮아?`;
    openerRecordId = textRecords[0].id;
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
