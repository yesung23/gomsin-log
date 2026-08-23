import type { CycleSharingPreferences } from '@/types';

/**
 * The ONLY inputs a partner-facing message may be built from.
 *
 * Note what is absent: symptoms, flow, pain, mood, note, period ids, daily-log
 * ids, exact start dates. This is a type-level boundary — a caller cannot hand
 * this builder raw health data even by mistake, because there is no field to put
 * it in.
 */
export interface CyclePartnerMessageInput {
  preferences: CycleSharingPreferences;
  /** Whether a period is currently in progress. A boolean, never a date. */
  periodActive: boolean;
  /** Predicted start window, already coarsened to a range by the engine. */
  predictionWindowStart?: string;
  predictionWindowEnd?: string;
  fertilityWindowStart?: string;
  fertilityWindowEnd?: string;
}

export interface CyclePartnerMessage {
  /** True when nothing at all is shared, so the UI can say exactly that. */
  isEmpty: boolean;
  headline: string;
  lines: string[];
  /**
   * What is withheld no matter what any toggle says.
   *
   * Separate from `lines` rather than appended to it, which is where it used to
   * sit. As the last of five sentences in one grey block it read as another thing
   * being shared -- the most reassuring sentence on the screen, formatted
   * identically to the ones listing disclosures. The UI now renders the two as two
   * blocks, so "shown" and "never shown" stop looking like one list.
   */
  neverShared: string;
}

/**
 * The withholding guarantee, in one place.
 *
 * A promise about `CyclePartnerMessageInput`, whose shape is what enforces it:
 * there is no field on that type that could carry any of these. If one is ever
 * added, this sentence has to change in the same commit, and
 * `cyclePartnerMessage.test.ts` is what makes that unavoidable.
 *
 * 통증 is in this list and stays in it. A 2026-08-20 draft removed it to make room
 * for graded pain sharing; the independent review (2026-08-21) refused that
 * vocabulary, so the recorded pain level is once again unconditionally withheld.
 * The `feeling_unwell` care signal is not an exception to this sentence: it is an
 * independent opt-in message that carries no recorded value and no grade.
 */
const NEVER_SHARED = '증상, 통증, 기분, 메모는 어떤 경우에도 보이지 않아요.';


function formatKoreanDate(date: string): string {
  const [, month, day] = date.split('-');
  if (!month || !day) return date;
  return `${Number(month)}월 ${Number(day)}일`;
}

/**
 * Build exactly what the partner would see, from the real preferences.
 *
 * Deterministic and pure so the in-app preview cannot lie: the previous version
 * showed "생리 예상 기간이 가까워졌다고 공유했어요" even when every toggle was
 * off, which taught the user the opposite of the truth about their own privacy.
 *
 * The wording never attributes mood or behaviour to the cycle, and never implies
 * urgency — the partner is often somewhere they cannot check a phone.
 */
export function buildCyclePartnerMessage(input: CyclePartnerMessageInput): CyclePartnerMessage {
  const { preferences, periodActive } = input;
  const lines: string[] = [];

  const sharesSomething = preferences.shareCurrentPeriod
    || preferences.sharePredictionWindow
    || preferences.shareFertilityWindow;

  if (!sharesSomething) {
    return {
      isEmpty: true,
      headline: '현재 파트너에게 공유되는 주기 정보가 없어요.',
      lines: ['공유하고 싶은 항목을 직접 선택할 때만 보여요.'],
      neverShared: NEVER_SHARED,
    };
  }

  if (preferences.shareCurrentPeriod) {
    lines.push(periodActive
      ? '지금 생리 중이라는 상태만 공유돼요.'
      : '지금은 생리 중이 아니라는 상태만 공유돼요.');
  }

  if (preferences.sharePredictionWindow) {
    const { predictionWindowStart, predictionWindowEnd } = input;
    lines.push(predictionWindowStart && predictionWindowEnd
      ? `다가오는 예상 기간(${formatKoreanDate(predictionWindowStart)} ~ ${formatKoreanDate(predictionWindowEnd)})만 공유돼요.`
      : '다가오는 예상 기간만 공유돼요.');
    lines.push('정확한 날짜가 아니라 예상 범위예요.');
  }

  if (preferences.shareFertilityWindow) {
    const { fertilityWindowStart, fertilityWindowEnd } = input;
    lines.push(fertilityWindowStart && fertilityWindowEnd
      ? `가임 가능성이 비교적 높다고 추정되는 기간(${formatKoreanDate(fertilityWindowStart)} ~ ${formatKoreanDate(fertilityWindowEnd)})이 공유돼요.`
      : '가임 가능성이 비교적 높다고 추정되는 기간이 공유돼요.');
    // Deliberately explicit: this estimate must never be read as contraception.
    lines.push('달력 계산에 따른 추정이며, 피임이나 임신 여부를 알려주지 않아요.');
  }

  return {
    isEmpty: false,
    headline: '군화에게 이렇게 보여요',
    lines,
    neverShared: NEVER_SHARED,
  };
}
