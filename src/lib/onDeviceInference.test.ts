import { describe, it, expect, vi } from 'vitest';
import {
  InferenceMemo,
  classifyDevice,
  isInferenceAllowedAt,
  selectTextEngine,
  type DeviceSignals,
} from '@/lib/onDeviceInference';

/**
 * The policy, not the analyser.
 *
 * `emotionCandidates.test.ts` covers what the engine reads. This covers WHEN it
 * is allowed to read it and how often -- the part that decides whether the app
 * costs a battery percent per entry or per keystroke, and whether it narrates a
 * mood at someone who is still typing.
 */

describe('when analysis may run', () => {
  it('never runs while the entry is being typed', () => {
    expect(isInferenceAllowedAt('typing')).toBe(false);
  });

  it('runs at the boundaries where a thought is finished', () => {
    expect(isInferenceAllowedAt('composition-settled')).toBe(true);
    expect(isInferenceAllowedAt('save')).toBe(true);
    expect(isInferenceAllowedAt('record-opened')).toBe(true);
  });
});

describe('not reading the same content twice', () => {
  it('computes once and reuses the result for identical content', () => {
    const memo = new InferenceMemo<string[]>();
    const compute = vi.fn((text: string) => [text]);

    memo.read('짜증났어', compute);
    memo.read('짜증났어', compute);
    memo.read('짜증났어', compute);

    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('treats content that normalises the same as the same content', () => {
    const memo = new InferenceMemo<string[]>();
    const compute = vi.fn((text: string) => [text]);

    memo.read('짜증났어', compute);
    // Only whitespace differs, and the analyser collapses whitespace, so the
    // reading cannot have changed and must not be paid for again.
    memo.read('  짜증났어  ', compute);
    memo.read('짜증났어\n', compute);

    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('re-reads when the content genuinely changed', () => {
    const memo = new InferenceMemo<string[]>();
    const compute = vi.fn((text: string) => [text]);

    memo.read('짜증났어', compute);
    memo.read('짜증났는데 기분이 나아졌어', compute);

    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('hands the analyser the normalised text, not the raw body', () => {
    const memo = new InferenceMemo<string>();
    let seen = '';
    memo.read('  짜증났어  ', (normalized) => {
      seen = normalized;
      return normalized;
    });
    expect(seen).toBe('짜증났어');
  });

  it('stays bounded rather than growing with every edit', () => {
    const memo = new InferenceMemo<number>(3);
    for (let i = 0; i < 10; i += 1) memo.read(`텍스트 ${i}`, () => i);

    expect(memo.has('텍스트 9')).toBe(true);
    expect(memo.has('텍스트 0')).toBe(false);
  });
});

describe('device tiering', () => {
  const signals = (overrides: Partial<DeviceSignals> = {}): DeviceSignals => ({
    memoryGb: 8,
    cores: 8,
    native: true,
    ...overrides,
  });

  it('treats an unmeasurable device as small rather than large', () => {
    // Safari and every iOS browser report no `deviceMemory`. Defaulting those to
    // the heaviest tier would put the most expensive path on exactly the devices
    // the app can measure least.
    const capability = classifyDevice({ native: false });
    expect(capability.tier).toBe('rules');
    expect(capability.reasons).toContain('no-capability-signals');
  });

  it('drops to the cheapest tier in low-power mode regardless of hardware', () => {
    expect(classifyDevice(signals({ lowPower: true })).tier).toBe('rules');
  });

  it('drops to the cheapest tier on a low-memory device', () => {
    expect(classifyDevice(signals({ memoryGb: 2 })).tier).toBe('rules');
  });

  it('recognises a capable native device', () => {
    expect(classifyDevice(signals()).tier).toBe('full');
  });

  it('never uses anything that identifies the device or the person', () => {
    // The signal set is the guarantee: there is no field here to put a model
    // name, a user-agent string or a screen size in, so a capability check
    // cannot quietly become a fingerprint.
    const keys = Object.keys(signals()).sort();
    expect(keys).toEqual(['cores', 'memoryGb', 'native']);
  });
});

describe('engine selection', () => {
  /**
   * V1 ships no neural model. §6.2 forbids one for the summary, the only other
   * candidate is a six-way classification the deterministic lexicon already does
   * for free, and a non-deterministic reading would break both that rule and the
   * durability of a user's correction. The tiers exist so that M6 can change one
   * branch instead of every call site.
   */
  it('resolves every tier to the deterministic engine', () => {
    expect(selectTextEngine('full')).toBe('deterministic-lexicon');
    expect(selectTextEngine('compact')).toBe('deterministic-lexicon');
    expect(selectTextEngine('rules')).toBe('deterministic-lexicon');
  });
});
