import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { EmotionFlowItem } from '@/types';
import { BASIC_EMOTION_ORDER } from '@/lib/basicEmotions';
import { RecordMoodSection } from '@/components/emotion/RecordMoodSection';

/**
 * 기록 속 마음.
 *
 * The rule under test that matters most is a NEGATIVE one: nothing in this surface
 * may decide a feeling on a person's behalf. Every other assertion here is about
 * making the correction cheap; that one is about it staying theirs.
 */

function item(partial: Partial<EmotionFlowItem> & { sequence: number }): EmotionFlowItem {
  return {
    group: 'joy',
    displayLabel: '행복',
    source: 'user_confirmed',
    basic: 'happiness',
    ...partial,
  };
}

function selectedOption(): string | null {
  const on = document
    .querySelector('[data-testid="record-mood-picker"] [data-selected="true"]');
  return on?.getAttribute('data-testid')?.replace('record-mood-option-', '') ?? null;
}

describe('the stored feeling arrives already chosen', () => {
  it('marks the record\'s own emotion as selected on first render', () => {
    render(
      <RecordMoodSection items={[item({ sequence: 1, basic: 'sadness', group: 'sadness' })]} onChange={() => true} />,
    );
    expect(selectedOption()).toBe('sadness');
  });

  it('offers all six, so a correction is never behind a disclosure', () => {
    render(<RecordMoodSection items={[item({ sequence: 1 })]} onChange={() => true} />);
    for (const basic of BASIC_EMOTION_ORDER) {
      expect(screen.getByTestId(`record-mood-option-${basic}`)).toBeTruthy();
    }
  });

  it('selects nothing and asks, when the record has no feeling yet', () => {
    render(<RecordMoodSection items={[]} onChange={() => true} />);
    expect(selectedOption()).toBeNull();
    expect(screen.getByText('마음 선택하기')).toBeTruthy();
  });

  it('ignores a machine suggestion that no human confirmed', () => {
    // A `rule_suggested` item is a guess. It must not render as an answer.
    render(
      <RecordMoodSection
        items={[item({ sequence: 1, basic: 'anger', group: 'anger', source: 'rule_suggested' })]}
        onChange={() => true}
      />,
    );
    expect(selectedOption()).toBeNull();
  });
});

describe('changing it costs one tap', () => {
  it('writes the picked emotion and marks it as a human edit', async () => {
    const onChange = vi.fn().mockResolvedValue(true);
    render(
      <RecordMoodSection items={[item({ sequence: 1, basic: 'happiness' })]} onChange={onChange} />,
    );

    fireEvent.click(screen.getByTestId('record-mood-option-anger'));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const next = onChange.mock.calls[0][0] as EmotionFlowItem[];
    expect(next).toHaveLength(1);
    expect(next[0].basic).toBe('anger');
    // `group` and `displayLabel` are rewritten too, so every existing reader --
    // the partner's summary, the flow analysis -- agrees with the correction.
    expect(next[0].group).toBe('anger');
    expect(next[0].displayLabel).toBe('분노');
    // Durability: this is what stops a later re-analysis quietly undoing it.
    expect(next[0].userEdited).toBe(true);
    expect(next[0].source).toBe('user_confirmed');
  });

  it('creates the first feeling when the record had none', async () => {
    const onChange = vi.fn().mockResolvedValue(true);
    render(<RecordMoodSection items={[]} onChange={onChange} />);

    fireEvent.click(screen.getByTestId('record-mood-option-fear'));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = onChange.mock.calls[0][0] as EmotionFlowItem[];
    expect(next).toHaveLength(1);
    expect(next[0].basic).toBe('fear');
    expect(next[0].source).toBe('user_confirmed');
  });

  it('a feeling picked here starts author-only, never shared', async () => {
    // PRODUCT_V3 §13. Pressing a face answers "what did I feel", not "show my
    // partner" -- publishing as a side effect of a correction would be a surprise.
    const onChange = vi.fn().mockResolvedValue(true);
    render(<RecordMoodSection items={[]} onChange={onChange} />);

    fireEvent.click(screen.getByTestId('record-mood-option-disgust'));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = onChange.mock.calls[0][0] as EmotionFlowItem[];
    expect(next[0].visibility).toBe('author_only');
  });

  it('does not write when the already-selected emotion is pressed again', () => {
    const onChange = vi.fn().mockResolvedValue(true);
    render(
      <RecordMoodSection items={[item({ sequence: 1, basic: 'happiness' })]} onChange={onChange} />,
    );
    fireEvent.click(screen.getByTestId('record-mood-option-happiness'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('falls back to what is stored when the write fails', async () => {
    const onChange = vi.fn().mockResolvedValue(false);
    render(
      <RecordMoodSection items={[item({ sequence: 1, basic: 'happiness' })]} onChange={onChange} />,
    );

    fireEvent.click(screen.getByTestId('record-mood-option-sadness'));

    // A selection that did not survive must not keep showing as chosen.
    await waitFor(() => expect(selectedOption()).toBe('happiness'));
  });

  it('writes nothing while disabled', () => {
    const onChange = vi.fn();
    render(
      <RecordMoodSection
        items={[item({ sequence: 1 })]}
        onChange={onChange}
        disabled
        disabledReason="오프라인이에요"
      />,
    );
    fireEvent.click(screen.getByTestId('record-mood-option-anger'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getAllByText('오프라인이에요').length).toBeGreaterThan(0);
  });
});

describe('a multi-feeling entry keeps all of its feelings', () => {
  const flow = [
    item({ sequence: 1, basic: 'anger', group: 'anger', displayLabel: '분노' }),
    item({ sequence: 2, basic: 'happiness' }),
  ];

  it('edits the last feeling by default, because that is where the day ended', () => {
    render(<RecordMoodSection items={flow} onChange={() => true} />);
    expect(selectedOption()).toBe('happiness');
  });

  it('changes only the chosen one and leaves the rest untouched', async () => {
    const onChange = vi.fn().mockResolvedValue(true);
    render(<RecordMoodSection items={flow} onChange={onChange} />);

    fireEvent.click(screen.getByTestId('record-mood-option-sadness'));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = onChange.mock.calls[0][0] as EmotionFlowItem[];
    expect(next).toHaveLength(2);
    expect(next[0].basic).toBe('anger'); // untouched
    expect(next[1].basic).toBe('sadness'); // corrected
  });

  it('lets an earlier feeling be picked and corrected instead', async () => {
    const onChange = vi.fn().mockResolvedValue(true);
    render(<RecordMoodSection items={flow} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText('1번째 마음 분노 고르기'));
    expect(selectedOption()).toBe('anger');

    fireEvent.click(screen.getByTestId('record-mood-option-fear'));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = onChange.mock.calls[0][0] as EmotionFlowItem[];
    expect(next[0].basic).toBe('fear');
    expect(next[1].basic).toBe('happiness'); // untouched
  });

  it('shows no sequence row for a single feeling, which would just repeat itself', () => {
    render(<RecordMoodSection items={[item({ sequence: 1 })]} onChange={() => true} />);
    expect(screen.queryByTestId('record-mood-sequence')).toBeNull();
  });
});

describe('the app never decides the feeling', () => {
  it('reads no diary text: the component is not given any', () => {
    /*
     * Structural, not behavioural. `RecordMoodSectionProps` has `items` and
     * `onChange` and nothing else that could carry an entry's words, so there is no
     * way for this surface to infer a feeling even by mistake -- the same
     * shape-is-the-enforcement argument `CyclePartnerMessageInput` makes.
     */
    const source = readSource();
    expect(source).not.toMatch(/\btext\b\s*[:?]/);
    expect(source).not.toContain('analyze');
    expect(source).not.toContain('useEmotionCandidates');
  });

  it('imports nothing that could produce a feeling on its own', () => {
    /*
     * The import list is the enforcement. Counting occurrences of
     * `user_confirmed` was the first attempt and it was worthless -- it matched
     * prose in the comments and would have passed just as happily if an analyser
     * had been wired in underneath.
     *
     * What cannot be argued with is what the module is allowed to reach. The only
     * emotion code it may import is the pure taxonomy in `basicEmotions`; the
     * candidate generator and anything that reads diary text are not on the list.
     */
    const imports = [...readSource().matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports).toContain('@/lib/basicEmotions');
    for (const specifier of imports) {
      expect(specifier, `unexpected import: ${specifier}`).not.toMatch(
        /emotionCandidates|useEmotionCandidates|emotionRule|analy[sz]/i,
      );
    }
  });
});

/**
 * The second ask.
 *
 * The composer asks about a feeling when composition settles. Someone who writes
 * and saves in one motion never answers it, and an unanswered reading is
 * correctly never stored -- so before this the fast path ended with no feeling on
 * the record and nowhere left to add one. Asking again here, where re-reading the
 * entry makes it easy to answer, closes that without ever storing a guess.
 *
 * The reading is computed by the CALLER and arrives as a prop, which is what lets
 * the import guard above stay true: this surface still cannot produce a feeling.
 */
describe('a record with no answered feeling asks once more', () => {
  const suggestion = [item({ sequence: 1, basic: 'anger', group: 'anger', source: 'rule_suggested' })];

  it('offers the reading as a question, not as an answer', () => {
    render(<RecordMoodSection items={[]} suggested={suggestion} onChange={() => true} />);
    expect(screen.getByTestId('record-mood-suggestion')).toBeTruthy();
    expect(screen.getByText('이렇게 느꼈나요?')).toBeTruthy();
    // Still nothing chosen: the picker below must not pre-select the guess.
    expect(selectedOption()).toBeNull();
  });

  it('writes it only when pressed, and as the author\'s own answer', async () => {
    const onChange = vi.fn(() => true);
    render(<RecordMoodSection items={[]} suggested={suggestion} onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('record-mood-suggestion-confirm'));

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const written = onChange.mock.calls[0][0] as unknown as EmotionFlowItem[];
    expect(written).toHaveLength(1);
    expect(written[0].source).toBe('user_confirmed');
    expect(written[0].basic).toBe('anger');
  });

  it('confirming is not sharing -- §13 keeps those two decisions apart', () => {
    const onChange = vi.fn(() => true);
    render(<RecordMoodSection items={[]} suggested={suggestion} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('record-mood-suggestion-confirm'));
    const written = onChange.mock.calls[0][0] as unknown as EmotionFlowItem[];
    expect(written[0].visibility).toBe('author_only');
  });

  it('is withheld once something is answered, because the question is settled', () => {
    render(
      <RecordMoodSection
        items={[item({ sequence: 1, basic: 'happiness' })]}
        suggested={suggestion}
        onChange={() => true}
      />,
    );
    expect(screen.queryByTestId('record-mood-suggestion')).toBeNull();
  });

  it('says the plain thing when there is no reading to offer', () => {
    render(<RecordMoodSection items={[]} onChange={() => true} />);
    expect(screen.queryByTestId('record-mood-suggestion')).toBeNull();
    expect(screen.getByText('이 기록에는 아직 마음이 없어요. 눌러서 골라 주세요.')).toBeTruthy();
  });
});

function readSource(): string {
  return readFileSync(
    resolve(process.cwd(), 'src/components/emotion/RecordMoodSection.tsx'),
    'utf8',
  );
}
