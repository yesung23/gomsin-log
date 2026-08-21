import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Contact hours, asked of BOTH roles.
 *
 * 곰신 used to skip this step along with 복무 정보, which left only 군화 supplying
 * hours. That was harmless while nothing sent notifications. It stopped being
 * harmless with migration 048: delivery happens inside each recipient's OWN
 * declared window (§14.3 -- the send time comes from hours the user typed in,
 * never from a learned access pattern), so a 곰신 who was never asked would
 * inherit the schema default, which was written for a soldier's day.
 *
 * Asserted from the source because the wizard's step routing is what actually
 * decides this, and a rendering test would have to drive four screens to reach
 * the one line that matters.
 */

const SOURCE = readFileSync(resolve(process.cwd(), 'src/pages/OnboardingPage.tsx'), 'utf8');

describe('both roles are asked when they want to hear from the app', () => {
  it('gives 곰신 five steps, not four', () => {
    expect(SOURCE).toContain("const totalSteps = role === 'gomsin' ? 5 : 6;");
  });

  it('skips 복무 정보 for 곰신 but lands them on contact hours', () => {
    // The whole change in one line: jump to 6, not past it to 7.
    expect(SOURCE).toContain("if (role === 'gomsin' && step === 4) {\n      setStep(6);");
    expect(SOURCE).not.toContain("if (role === 'gomsin' && step === 4) {\n      setStep(7);");
  });

  it('renders the step for either role', () => {
    // It was gated on `role === 'soldier'`, which is what made the skip
    // invisible: even reaching step 6 as 곰신 would have rendered nothing.
    expect(SOURCE).toContain('{step === 6 && (');
    expect(SOURCE).not.toContain("{step === 6 && role === 'soldier' && (");
  });

  it('lets 곰신 go back to the anniversary, not into 복무 정보', () => {
    expect(SOURCE).toContain("if (role === 'gomsin' && step === 6) {\n      setStep(4);");
  });
});

describe('the question differs because the question IS different', () => {
  it('asks 군화 when they can be reached', () => {
    // A constraint: there are hours when a phone is not reachable.
    expect(SOURCE).toContain('주로 언제 오늘의 로그를 확인할 수 있나요?');
  });

  it('asks 곰신 when the app may interrupt', () => {
    // A preference: they can look any time, so what this decides is different.
    expect(SOURCE).toContain('언제 알려드리면 좋을까요?');
  });

  it('promises 곰신 exactly what §14.3 guarantees, and no more', () => {
    /*
      Once a day at most, nothing outside the window, and no content in the
      payload. Each of those is enforced elsewhere -- the daily cap and the
      window in migration 048, the body as a constant in the sender -- so this
      copy is a promise the system already keeps rather than a claim about it.
    */
    const promise = SOURCE.slice(SOURCE.indexOf('이 시간 밖에서는 알리지 않아요'));
    expect(promise.slice(0, 120)).toContain('하루에 한 번');
    expect(promise.slice(0, 120)).toContain('내용은 담기지 않아요');
  });
});

describe('the wizard does not lie about where it ends', () => {
  it('never labels the anniversary step 완료 for 곰신', () => {
    /*
      It did, because the anniversary WAS their last step. Contact hours follows
      it for both roles now, so a button reading 완료 and then showing another
      screen is the app being wrong about itself.

      Caught by the browser matrix, not by anything here: a unit test that drives
      the wizard would have been written against whatever the label happened to
      be. The e2e clicks 다음 and times out when it is not there.
    */
    expect(SOURCE).not.toContain("{role === 'gomsin' ? '완료' : '다음'}");
  });
});
