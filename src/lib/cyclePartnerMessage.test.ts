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
    for (const preferences of [
      prefs({ shareCurrentPeriod: true }),
      prefs({ sharePredictionWindow: true }),
      prefs({ shareFertilityWindow: true }),
    ]) {
      const text = buildCyclePartnerMessage({ preferences, periodActive: false }).lines.join(' ');
      expect(text).toContain('보이지 않아요');
    }
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
