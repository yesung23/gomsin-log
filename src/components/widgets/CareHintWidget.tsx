import { useMemo } from 'react';
import { MessageCircleHeart } from 'lucide-react';
import { useStore } from '@/lib/useStore';
import { isOwnRecord, visibleRecordsForViewer } from '@/lib/privacy';
import { localToday, toLocalDateString, getPartnerDaySince } from '@/lib/utils';

/**
 * "다정한 한마디" — what to actually say when the call comes.
 *
 * Ported out of the old hardcoded 군화 home rather than dropped, because it was
 * the one thing on that screen that turned information into an action. The
 * soldier's problem is not a shortage of data, it is a two-minute window and no
 * idea how to open. This reads the mood she shared and suggests the opening line.
 *
 * Derived only, from records this viewer is entitled to see, and it never claims a
 * feeling that was not shared.
 */
export function CareHintWidget() {
  const { state } = useStore();
  const { profile } = state;
  const partnerName = profile.couple.partnerName || '상대방';
  // Align with the same "마지막 확인 이후 놓친 구간" contract (PRODUCT_V3 §6.1–6.5)
  // used by PartnerDayTimelineWidget, TodayBriefingWidget, and the other
  // PartnerEmotion* widgets inside CallBriefing. This surface appears in the
  // call-briefing "더 보기" section which claims context for the partner's day.
  const since = getPartnerDaySince(state.partnerDayLastCheckedAt);
  const todayStr = toLocalDateString(localToday());

  const shared = useMemo(() => {
    const viewer = { userId: profile.id, role: profile.role };
    return visibleRecordsForViewer(state.records, viewer).filter(
      (record) => (since ? record.date >= since : record.date === todayStr)
        && !isOwnRecord(record, viewer)
        && !record.isPrivate,
    );
  }, [state.records, profile.id, profile.role, since, todayStr]);

  // Describes what was actually shared. Deliberately not a score or a bar: an
  // earlier version rendered `sharedRecords.length * 25` as an "energy level",
  // which looked measured but was a record count in disguise.
  //
  // The fallback line used to be a mood claim ('평온하게 하루를 보내고
  // 있어요') inferred from the ABSENCE of a hard/good/thought_of_you tag.
  // PRODUCT_V3 §6.4 rules this out explicitly: silence is not evidence of
  // calm, it just means nothing was tagged -- author tags are optional
  // (see TodayLogWidget), so no tag at all is the common case, not a signal.
  // The fallback now states only what is actually known: records exist.
  const moodLabel = shared.length === 0
    ? '오늘 공유된 순간이 아직 없어요'
    : shared.some((r) => r.reaction === 'hard')
      ? '조금 힘든 일이 있었어요 🥹'
      : shared.some((r) => r.reaction === 'good' || r.reaction === 'thought_of_you')
        ? '기분 좋은 순간을 남겼어요 😊'
        : '오늘 순간을 나눴어요';

  const careHint = shared.some((r) => r.reaction === 'hard')
    ? '오늘 힘든 순간이 있었으니 수고했다고 다정하게 말해주세요!'
    : shared.some((r) => r.reaction === 'thought_of_you')
      ? '네 생각이 났다고 해요! 반갑고 따뜻하게 맞아주세요.'
      : shared.length > 0
        ? '오늘의 소소한 일상을 듣고 칭찬과 격려를 건네보세요.'
        : '전화할 때 따뜻한 목소리로 첫 인사를 건네주세요!';

  return (
    <div data-testid="widget-care-hint">
      <h3 className="text-heading text-foreground mb-2 flex items-center gap-1.5">
        <MessageCircleHeart size={14} className="text-coral" aria-hidden="true" />
        다정한 한마디
      </h3>
      <p className="text-caption text-muted-foreground mb-1.5">
        {partnerName}의 하루 · {moodLabel}
      </p>
      <p className="text-body text-foreground break-keep">{careHint}</p>
    </div>
  );
}
