import { MessageCircleHeart } from 'lucide-react';
import { useStore } from '@/lib/useStore';
import { spansBeforeToday } from '@/lib/partnerDay';
import { usePartnerDay } from '@/lib/usePartnerDay';

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

  // The same surface as 상대방의 오늘 (PRODUCT_V3 §6.1–6.5). This widget sits in the
  // call-briefing "더 보기" section and claims to describe the partner's day, so it
  // has to describe the same records that surface shows.
  //
  // `persist` is off and there is no confirm button here: reading a hint is not
  // confirming the day, and this widget must not be able to retire a record.
  const { surface: shared, todayStr } = usePartnerDay();

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
  //
  // The window can reach back several days, so the copy must not name a day it
  // cannot vouch for. Calling a record from 8월 15일 "오늘" is simply false, and it
  // is the kind of false that makes the caller open with the wrong sentence. Where
  // the window is today-only the today wording is kept -- it is accurate there and
  // warmer -- and where it reaches further back the same fact is stated without a
  // day attached. Both branches still describe ONLY an author-selected tag; nothing
  // here infers a mood, scores the relationship, or reads meaning into silence
  // (PRODUCT_V3 §6.3, §13).
  const multiDay = spansBeforeToday(shared, todayStr);
  const when = multiDay ? '그동안' : '오늘';

  const moodLabel = shared.length === 0
    ? '새로 공유된 순간이 아직 없어요'
    : shared.some((r) => r.reaction === 'hard')
      ? '조금 힘든 일이 있었어요 🥹'
      : shared.some((r) => r.reaction === 'good' || r.reaction === 'thought_of_you')
        ? '기분 좋은 순간을 남겼어요 😊'
        : `${when} 순간을 나눴어요`;

  const careHint = shared.some((r) => r.reaction === 'hard')
    ? `${when} 힘든 순간이 있었으니 수고했다고 다정하게 말해주세요!`
    : shared.some((r) => r.reaction === 'thought_of_you')
      ? '네 생각이 났다고 해요! 반갑고 따뜻하게 맞아주세요.'
      : shared.length > 0
        ? `${when} 있었던 소소한 일상을 듣고 칭찬과 격려를 건네보세요.`
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
