import { describe, it, expect } from 'vitest';
import {
  analyzeEmotionFlow,
  EMOTION_VALENCE,
  CALM_BAND,
  DIRECTIONAL_NET_CHANGE,
  MIN_SIGN_CHANGES_FOR_ROLLERCOASTER,
  NON_DIAGNOSTIC_BANNED_TERMS,
} from '@/lib/emotionFlowAnalysis';
import type { EmotionFlowItem, EmotionGroup } from '@/types';

/**
 * Every group in the `EmotionGroup` union, written out literally. If a group is
 * added to the union without a valence entry, the coverage test below fails.
 */
const ALL_GROUPS: EmotionGroup[] = [
  'joy',
  'love',
  'anger',
  'disgust',
  'envy',
  'fear',
  'jealousy',
  'sadness',
  'shame',
  'guilt',
  'neutral',
  'uncertain',
  'frustration',
  'concern',
  'longing',
  'calm',
  'fatigue',
  'excitement',
  'surprise',
];

function item(overrides: Partial<EmotionFlowItem> = {}): EmotionFlowItem {
  return {
    id: overrides.id ?? 'flow-1',
    group: overrides.group ?? 'joy',
    displayLabel: overrides.displayLabel ?? '기쁨',
    sequence: overrides.sequence ?? 1,
    source: overrides.source ?? 'user_confirmed',
    visibility: overrides.visibility ?? 'shared',
    ...overrides,
  } as EmotionFlowItem;
}

/** Confirmed item shorthand: group + sequence, label defaults to the group. */
function confirmed(group: EmotionGroup, sequence: number, displayLabel?: string): EmotionFlowItem {
  return item({
    id: `${group}-${sequence}`,
    group,
    sequence,
    displayLabel: displayLabel ?? group,
    source: 'user_confirmed',
  });
}

describe('EMOTION_VALENCE', () => {
  it('covers every EmotionGroup in the union', () => {
    for (const group of ALL_GROUPS) {
      expect(typeof EMOTION_VALENCE[group]).toBe('number');
    }
  });

  it('has an entry for every key and no extras', () => {
    expect(Object.keys(EMOTION_VALENCE).sort()).toEqual([...ALL_GROUPS].sort());
  });

  it('keeps every valence inside [-1, 1]', () => {
    for (const group of ALL_GROUPS) {
      expect(EMOTION_VALENCE[group]).toBeGreaterThanOrEqual(-1);
      expect(EMOTION_VALENCE[group]).toBeLessThanOrEqual(1);
    }
  });

  it('orders joy above neutral above sadness', () => {
    expect(EMOTION_VALENCE.joy).toBeGreaterThan(EMOTION_VALENCE.neutral);
    expect(EMOTION_VALENCE.neutral).toBeGreaterThan(EMOTION_VALENCE.sadness);
  });
});

describe('analyzeEmotionFlow — empty inputs', () => {
  it('returns null for undefined', () => {
    expect(analyzeEmotionFlow(undefined)).toBeNull();
  });

  it('returns null for an empty array', () => {
    expect(analyzeEmotionFlow([])).toBeNull();
  });

  it('returns null when every item is only rule_suggested', () => {
    const items = [
      item({ id: 'a', group: 'joy', sequence: 1, source: 'rule_suggested' }),
      item({ id: 'b', group: 'sadness', sequence: 2, source: 'rule_suggested' }),
    ];
    expect(analyzeEmotionFlow(items)).toBeNull();
  });

  it('returns null when source is missing entirely', () => {
    const items = [item({ id: 'a', group: 'joy', sequence: 1, source: undefined })];
    expect(analyzeEmotionFlow(items)).toBeNull();
  });
});

describe('analyzeEmotionFlow — input filtering', () => {
  it('excludes rule_suggested items mixed in with confirmed ones', () => {
    const result = analyzeEmotionFlow([
      confirmed('joy', 1),
      item({ id: 'sug', group: 'anger', sequence: 2, source: 'rule_suggested' }),
      confirmed('calm', 3),
    ]);
    expect(result).not.toBeNull();
    expect(result!.points.map((p) => p.group)).toEqual(['joy', 'calm']);
  });

  it('drops items whose group has no valence entry', () => {
    const result = analyzeEmotionFlow([
      confirmed('joy', 1),
      item({ id: 'bogus', group: 'not_a_group' as EmotionGroup, sequence: 2 }),
    ]);
    expect(result!.points).toHaveLength(1);
    expect(result!.points[0].group).toBe('joy');
  });

  it('sorts out-of-order sequence values ascending', () => {
    const result = analyzeEmotionFlow([
      confirmed('calm', 3),
      confirmed('sadness', 1),
      confirmed('joy', 2),
    ]);
    expect(result!.points.map((p) => p.sequence)).toEqual([1, 2, 3]);
    expect(result!.points.map((p) => p.group)).toEqual(['sadness', 'joy', 'calm']);
  });

  it('falls back to the group key when displayLabel is blank', () => {
    const result = analyzeEmotionFlow([confirmed('joy', 1, '   ')]);
    expect(result!.points[0].label).toBe('joy');
  });

  it('trims displayLabel', () => {
    const result = analyzeEmotionFlow([confirmed('joy', 1, '  기쁨  ')]);
    expect(result!.points[0].label).toBe('기쁨');
  });
});

describe('analyzeEmotionFlow — shapes', () => {
  it('classifies a lone confirmed emotion as single', () => {
    const result = analyzeEmotionFlow([confirmed('joy', 1)]);
    expect(result!.shape).toBe('single');
    expect(result!.netChange).toBe(0);
    expect(result!.swing).toBe(0);
    expect(result!.largestTransition).toBeNull();
  });

  it('classifies a flat day inside the calm band as calm', () => {
    const result = analyzeEmotionFlow([confirmed('neutral', 1), confirmed('uncertain', 2)]);
    expect(result!.swing).toBeLessThanOrEqual(CALM_BAND);
    expect(result!.shape).toBe('calm');
  });

  it('classifies sadness → joy as recovery', () => {
    const result = analyzeEmotionFlow([confirmed('sadness', 1), confirmed('joy', 2)]);
    expect(result!.shape).toBe('recovery');
    expect(result!.netChange).toBeGreaterThanOrEqual(DIRECTIONAL_NET_CHANGE);
  });

  it('classifies joy → sadness as downward', () => {
    const result = analyzeEmotionFlow([confirmed('joy', 1), confirmed('sadness', 2)]);
    expect(result!.shape).toBe('downward');
    expect(result!.netChange).toBeLessThanOrEqual(-DIRECTIONAL_NET_CHANGE);
  });

  it('classifies joy → sadness → joy → sadness as rollercoaster', () => {
    const result = analyzeEmotionFlow([
      confirmed('joy', 1),
      confirmed('sadness', 2),
      confirmed('joy', 3),
      confirmed('sadness', 4),
    ]);
    expect(result!.shape).toBe('rollercoaster');
  });

  it('needs at least MIN_SIGN_CHANGES_FOR_ROLLERCOASTER flips', () => {
    // One flip only: joy → calm → love. Not a rollercoaster.
    const result = analyzeEmotionFlow([
      confirmed('joy', 1),
      confirmed('calm', 2),
      confirmed('love', 3),
    ]);
    expect(MIN_SIGN_CHANGES_FOR_ROLLERCOASTER).toBe(2);
    expect(result!.shape).not.toBe('rollercoaster');
  });

  it('classifies a swinging but non-directional day as mixed', () => {
    const result = analyzeEmotionFlow([
      confirmed('joy', 1),
      confirmed('calm', 2),
      confirmed('love', 3),
    ]);
    expect(result!.shape).toBe('mixed');
    expect(Math.abs(result!.netChange)).toBeLessThan(DIRECTIONAL_NET_CHANGE);
    expect(result!.swing).toBeGreaterThan(CALM_BAND);
  });
});

describe('analyzeEmotionFlow — numeric outputs', () => {
  it('reports startState, endState, netChange and swing', () => {
    const result = analyzeEmotionFlow([
      confirmed('sadness', 1, '속상했어'),
      confirmed('joy', 2, '기쁨'),
      confirmed('calm', 3, '평온'),
    ])!;
    expect(result.startState.group).toBe('sadness');
    expect(result.startState.valence).toBe(-0.75);
    expect(result.endState.group).toBe('calm');
    expect(result.endState.valence).toBe(0.5);
    expect(result.netChange).toBeCloseTo(1.25, 10);
    expect(result.swing).toBeCloseTo(1.75, 10);
  });

  it('picks the largest transition by absolute delta', () => {
    const result = analyzeEmotionFlow([
      confirmed('neutral', 1),
      confirmed('uncertain', 2),
      confirmed('joy', 3),
    ])!;
    expect(result.largestTransition).not.toBeNull();
    expect(result.largestTransition!.fromIndex).toBe(1);
    expect(result.largestTransition!.toIndex).toBe(2);
    expect(result.largestTransition!.from.group).toBe('uncertain');
    expect(result.largestTransition!.to.group).toBe('joy');
    expect(result.largestTransition!.delta).toBeCloseTo(1.1, 10);
  });

  it('breaks largest-transition ties on the earliest index', () => {
    // joy → calm → joy: deltas -0.5 then +0.5, equal magnitude.
    const result = analyzeEmotionFlow([
      confirmed('joy', 1),
      confirmed('calm', 2),
      confirmed('joy', 3),
    ])!;
    expect(result.largestTransition!.fromIndex).toBe(0);
    expect(result.largestTransition!.delta).toBeCloseTo(-0.5, 10);
  });

  it('returns a null largestTransition for a single point', () => {
    const result = analyzeEmotionFlow([confirmed('joy', 1)])!;
    expect(result.largestTransition).toBeNull();
  });
});

describe('analyzeEmotionFlow — summary', () => {
  it('joins the ordered labels with arrows', () => {
    const result = analyzeEmotionFlow([
      confirmed('sadness', 1, '속상했어'),
      confirmed('joy', 2, '기쁨'),
    ])!;
    expect(result.summary).toContain('속상했어 → 기쁨');
  });

  it('appends the fixed recovery sentence', () => {
    const result = analyzeEmotionFlow([
      confirmed('sadness', 1, '속상했어'),
      confirmed('joy', 2, '기쁨'),
    ])!;
    expect(result.summary).toContain('마음이 조금씩 편해지는 쪽으로 움직였어요.');
  });

  it('appends the fixed downward sentence', () => {
    const result = analyzeEmotionFlow([
      confirmed('joy', 1, '기쁨'),
      confirmed('sadness', 2, '속상했어'),
    ])!;
    expect(result.summary).toContain('하루가 지나면서 마음이 무거워졌어요.');
  });

  it('never uses diagnostic vocabulary', () => {
    const fixtures: EmotionFlowItem[][] = [
      [confirmed('joy', 1, '기쁨')],
      [confirmed('neutral', 1, '보통'), confirmed('uncertain', 2, '모르겠음')],
      [confirmed('sadness', 1, '속상했어'), confirmed('joy', 2, '기쁨')],
      [confirmed('joy', 1, '기쁨'), confirmed('sadness', 2, '속상했어')],
      [
        confirmed('joy', 1, '기쁨'),
        confirmed('sadness', 2, '속상했어'),
        confirmed('joy', 3, '기쁨'),
        confirmed('sadness', 4, '속상했어'),
      ],
      [confirmed('joy', 1, '기쁨'), confirmed('calm', 2, '평온'), confirmed('love', 3, '사랑')],
    ];
    for (const fixture of fixtures) {
      const summary = analyzeEmotionFlow(fixture)!.summary;
      for (const term of NON_DIAGNOSTIC_BANNED_TERMS) {
        expect(summary).not.toContain(term);
      }
    }
  });
});

describe('analyzeEmotionFlow — determinism and privacy', () => {
  it('produces a deep-equal result across repeated calls', () => {
    const items = [
      confirmed('sadness', 1, '속상했어'),
      confirmed('anger', 2, '화났어'),
      confirmed('calm', 3, '평온'),
    ];
    expect(analyzeEmotionFlow(items)).toEqual(analyzeEmotionFlow(items));
  });

  it('does not mutate its input', () => {
    const items = [confirmed('calm', 2), confirmed('joy', 1)];
    const snapshot = JSON.parse(JSON.stringify(items));
    analyzeEmotionFlow(items);
    expect(items).toEqual(snapshot);
  });

  it('never echoes matchedText or the matchedText key into its output', () => {
    const secret = '오늘 사수한테 혼났다';
    const result = analyzeEmotionFlow([
      item({
        id: 'a',
        group: 'anger',
        sequence: 1,
        displayLabel: '화났어',
        source: 'user_confirmed',
        matchedText: secret,
      }),
      item({
        id: 'b',
        group: 'calm',
        sequence: 2,
        displayLabel: '평온',
        source: 'user_confirmed',
      }),
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain('matchedText');
  });
});
