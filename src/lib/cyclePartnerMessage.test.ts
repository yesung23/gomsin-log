import { describe, expect, it } from 'vitest';
import { buildCyclePartnerMessage } from '@/lib/cyclePartnerMessage';
import type { CycleSharingPreferences } from '@/types';

function prefs(overrides: Partial<CycleSharingPreferences> = {}): CycleSharingPreferences {
  return {
    userId: 'u1',
    shareCurrentPeriod: false,
    sharePredictionWindow: false,
    shareFertilityWindow: false,
    ...overrides,
  };
}

describe('the partner preview reflects the real preferences', () => {
  it('says nothing is shared when every option is off', () => {
    /*
     * The previous preview was hard-coded and claimed a prediction was being
     * shared even with all toggles off, teaching the user the opposite of the
     * truth about their own privacy.
     */
    const message = buildCyclePartnerMessage({ preferences: prefs(), periodActive: true });
    expect(message.isEmpty).toBe(true);
    expect(message.headline).toContain('공유되는 주기 정보가 없어요');
    expect(message.lines.join(' ')).not.toContain('예상 기간');
  });

  it('shares only the current-period status when only that is on', () => {
    const message = buildCyclePartnerMessage({
      preferences: prefs({ shareCurrentPeriod: true }),
      periodActive: true,
      predictionWindowStart: '2026-08-24',
      predictionWindowEnd: '2026-08-28',
    });
    expect(message.isEmpty).toBe(false);
    const text = message.lines.join(' ');
    expect(text).toContain('생리 중이라는 상태만');
    // The window exists in the input but must not leak without its own opt-in.
    expect(text).not.toContain('8월 24일');
  });

  it('states the predicted range and that it is not an exact date', () => {
    const text = buildCyclePartnerMessage({
      preferences: prefs({ sharePredictionWindow: true }),
      periodActive: false,
      predictionWindowStart: '2026-08-24',
      predictionWindowEnd: '2026-08-28',
    }).lines.join(' ');
    expect(text).toContain('8월 24일 ~ 8월 28일');
    expect(text).toContain('정확한 날짜가 아니라');
  });

  it('never presents the fertility window as contraception', () => {
    const text = buildCyclePartnerMessage({
      preferences: prefs({ shareFertilityWindow: true }),
      periodActive: false,
      fertilityWindowStart: '2026-08-10',
      fertilityWindowEnd: '2026-08-16',
    }).lines.join(' ');
    expect(text).toContain('추정');
    expect(text).toContain('피임');
  });

  it('always states that raw health detail is never visible', () => {
    /*
     * Asserted on `neverShared`, not on `lines`, and that move is the point. The
     * guarantee used to be appended as the last of the shared lines -- same grey
     * block, same type -- so the one sentence saying "he cannot see this" was
     * formatted identically to the four saying what he could.
     *
     * Every combination including all-off: someone who shares nothing still
     * deserves to be told what sharing would never have included.
     */
    for (const preferences of [
      prefs({}),
      prefs({ shareCurrentPeriod: true }),
      prefs({ sharePredictionWindow: true }),
      prefs({ shareFertilityWindow: true }),
      prefs({ shareCurrentPeriod: true, sharePredictionWindow: true, shareFertilityWindow: true }),
    ]) {
      const message = buildCyclePartnerMessage({ preferences, periodActive: false });
      expect(message.neverShared).toContain('보이지 않아요');
      /*
       * Named one by one, so a reader need not trust a summarising word. 통증 is
       * in this list ON PURPOSE: a 2026-08-20 draft removed it to make room for
       * graded pain sharing, and the independent review refused that vocabulary.
       * The recorded pain level is unconditionally withheld; the `feeling_unwell`
       * care signal is an independent message, not an exception to this sentence.
       */
      for (const withheld of ['증상', '통증', '기분', '메모']) {
        expect(message.neverShared, withheld).toContain(withheld);
      }
      // And it stays OUT of the shared list, which is what the split is for.
      expect(message.lines.join(' ')).not.toContain('보이지 않아요');
    }
  });

  it('never describes pain as something the toggles could share', () => {
    // No share-line mentions 통증 under any preference combination: there is no
    // toggle that shares it, so no sentence may imply one.
    const message = buildCyclePartnerMessage({ preferences: prefs({}), periodActive: false });
    expect(message.lines.join(' ')).not.toContain('통증');
  });

  it('never attributes mood or behaviour to the cycle', () => {
    const text = buildCyclePartnerMessage({
      preferences: prefs({ shareCurrentPeriod: true, sharePredictionWindow: true, shareFertilityWindow: true }),
      periodActive: true,
    }).lines.join(' ');
    for (const forbidden of ['예민할', '화낼', '호르몬', '감정 변화가 심해']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('never implies urgency, since the partner may not be able to check a phone', () => {
    const text = buildCyclePartnerMessage({
      preferences: prefs({ shareCurrentPeriod: true }),
      periodActive: true,
    }).lines.join(' ');
    expect(text).not.toContain('지금 연락');
  });
});
