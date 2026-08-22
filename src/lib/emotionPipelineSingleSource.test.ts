import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { extractEmotionCandidates } from '@/lib/emotionCandidates';
import { normalizeText } from '@/lib/emotionText';

/**
 * Bug condition:
 *   isBugCondition(app) = more than one module turns diary text into emotions.
 *
 * Measured on the tree before this file existed, `src` contained TWO engines:
 *
 *   src/lib/emotionRuleEngine.ts   recommendEmotionFlow  -> 19 `EmotionGroup`s,
 *                                                           `source: 'rule_suggested'`,
 *                                                           max 3 items,
 *                                                           its own segmenter,
 *                                                           its own negation rule,
 *                                                           its own 오락 context rule
 *   src/lib/emotionCandidates.ts   extractEmotionCandidates -> 6 `BasicEmotion`s,
 *                                                           `source: 'user_confirmed'`,
 *                                                           max 4 items,
 *                                                           a DIFFERENT segmenter,
 *                                                           a DIFFERENT negation rule,
 *                                                           a DIFFERENT 오락 rule
 *
 * `grep -rn "recommendEmotionFlow" src` returned exactly two files: the engine and
 * its own test. No screen, hook or store action called it. So the app shipped a
 * whole second interpretation of the user's feelings that could never agree with
 * the one on screen, and the two rule sets drifted apart every time either was
 * touched -- `emotionCandidates.ts` learned that `서운` is a substring of `무서운`
 * and that `화\s*나` matches `영화 나왔어`, while `emotionRuleEngine.ts` kept both
 * bugs.
 *
 * Nothing caught it: 1,184 tests passed, and 8 of them existed specifically to
 * assert the dead engine still worked, which made the duplication look intentional.
 *
 * This file does two jobs:
 *   1. Fails if a second producer of emotions from text reappears.
 *   2. Re-asserts, against the SURVIVING pipeline, every behaviour the retired
 *      engine's tests were protecting -- so deleting them lost no coverage.
 */

const SRC = resolve(process.cwd(), 'src');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('exactly one pipeline reads emotions out of text', () => {
  it('the retired engine is gone, not merely unused', () => {
    // Left in the tree it would keep being imported by the next contributor who
    // greps for 감정 and finds two answers.
    expect(existsSync(resolve(SRC, 'lib/emotionRuleEngine.ts'))).toBe(false);
    expect(existsSync(resolve(SRC, 'lib/__tests__/emotionRuleEngine.test.ts'))).toBe(false);
  });

  it('no source file defines a second text-to-emotion extractor', () => {
    // Any function that takes prose and returns emotion items is a competing
    // reading of the same input. There must be one.
    const producers = sourceFiles(SRC).filter((file) => {
      const source = readFileSync(file, 'utf8');
      return /export function (?:recommend|analyze|extract|detect|infer)\w*Emotion\w*\s*\(/.test(source);
    });
    expect(producers.map((file) => file.slice(SRC.length + 1).replace(/\\/g, '/'))).toEqual([
      // Text in, candidates out. The only extractor.
      'lib/emotionCandidates.ts',
      // Stored items in, a shape out. Not an extractor: it never sees the body.
      'lib/emotionFlowAnalysis.ts',
    ]);
  });

  it('no source file stamps an item as a machine suggestion any more', () => {
    // `rule_suggested` is kept in the TYPE so a legacy row still parses, and both
    // the write filter and the read filter still drop it. Nothing produces it.
    const offenders = sourceFiles(SRC).filter((file) =>
      /source:\s*'rule_suggested'/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('keeps the defensive filters that legacy rows still need', () => {
    // Removing the producer must not remove the guard: rows written by the old
    // engine before it was retired can still be in someone's database.
    const privacy = readFileSync(resolve(SRC, 'lib/privacy.ts'), 'utf8');
    expect(privacy).toContain("item.source === 'user_confirmed'");
    const analysis = readFileSync(resolve(SRC, 'lib/emotionFlowAnalysis.ts'), 'utf8');
    expect(analysis).toContain('user_confirmed');
    const types = readFileSync(resolve(SRC, 'types/index.ts'), 'utf8');
    expect(types).toContain("'rule_suggested'");
  });
});

/**
 * The retired engine's eight tests, re-pointed at the surviving pipeline.
 *
 * Each one names what it was protecting, because a deleted test that is not
 * re-expressed somewhere is coverage silently lost.
 */
describe('PORTED from the retired engine: the same guarantees still hold', () => {
  it('reads an explicit happy expression as 기뻤어', () => {
    expect(extractEmotionCandidates('오늘 진짜 기뻤어했어')[0]?.basic).toBe('happiness');
  });

  it('keeps a complex flow in the order it was written', () => {
    // The retired engine's own fixture. It read 속상함 → joy → 그리움; the six-emotion
    // vocabulary says 속상했어 → 기뻤어 → 기뻤어, and 기뻤어 → 기뻤어 collapses, so the shape is
    // 속상했어 → 기뻤어. Same story, one fewer redundant beat.
    const flow = extractEmotionCandidates(
      '알바에서 진상 손님을 만나 속상했는데, 친구와 치킨 먹고 기분이 나아졌어. 우리가 함께 왔던 곳이라 네 생각이 났어',
    );
    expect(flow.map((candidate) => candidate.basic)).toEqual(['sadness', 'happiness']);
  });

  it.each([
    '오늘 하나도 안 기뻤어해',
    '오늘 기분이 별로 안 기뻤어',
  ])('does not read joy out of negated text: %s', (text) => {
    expect(extractEmotionCandidates(text).some((c) => c.basic === 'happiness')).toBe(false);
  });

  it('reads a missing-you expression as a feeling, not as nothing', () => {
    const candidates = extractEmotionCandidates('너 너무 보고 싶어');
    expect(candidates[0]?.basic).toBe('happiness');
    expect(candidates[0]?.evidence).toBe('보고 싶음');
  });

  it('never surfaces profanity or a prohibited label to the partner', () => {
    // The retired engine masked swearing with `***` inside `matchedText`. The
    // surviving pipeline is stronger: the body is never copied at all, only a
    // fixed evidence phrase from a closed list.
    const candidates = extractEmotionCandidates('오늘 알바에서 시발 개짜증났어');
    expect(candidates[0]?.basic).toBe('anger');
    for (const candidate of candidates) {
      expect(candidate.evidence).not.toMatch(/시발|씨발|개짜증|좆|ㅅㅂ/);
    }
    // And no label in the vocabulary can be one of the prohibited concepts,
    // because the vocabulary is six fixed words.
    const forbidden = ['집착', '복수심', '증오', '악의'];
    const labels = extractEmotionCandidates('오늘 집착나고 복수심이 생길 정도로 싫었어')
      .map((candidate) => candidate.evidence);
    expect(labels.some((label) => forbidden.includes(label))).toBe(false);
  });

  it('returns nothing for a meaningless fact', () => {
    expect(extractEmotionCandidates('12345 67890')).toEqual([]);
  });

  it('merges consecutive matches of the same feeling into one beat', () => {
    expect(extractEmotionCandidates('오늘 기분 좋고 기뻤어하고 신나고 즐거웠어')).toHaveLength(1);
  });
});

describe('normalizeText, now that it has its own home', () => {
  it('composes 한글 before anything tries to match it', () => {
    // macOS hands over NFD. A decomposed 짜증 matches no composed pattern, so this
    // is the difference between reading a Mac user's entry and ignoring it.
    const decomposed = '짜증'.normalize('NFD');
    expect(decomposed).not.toBe('짜증');
    expect(normalizeText(decomposed)).toBe('짜증');
  });

  it('masks a URL, an email address and a phone number', () => {
    expect(normalizeText('https://x.com 짜증')).toBe('짜증');
    expect(normalizeText('me@example.com 짜증')).toBe('짜증');
    expect(normalizeText('010-1234-5678 짜증')).toBe('짜증');
    expect(normalizeText('01012345678 짜증')).toBe('짜증');
  });

  it('masks before matching, so no PII can reach an evidence phrase', () => {
    const serialised = JSON.stringify(extractEmotionCandidates('me@example.com 010-1234-5678 짜증났어'));
    expect(serialised).not.toContain('example.com');
    expect(serialised).not.toContain('1234');
  });

  it('collapses whitespace and tolerates empty input', () => {
    expect(normalizeText('  여러   줄\n\n입력  ')).toBe('여러 줄 입력');
    expect(normalizeText('')).toBe('');
  });
});
