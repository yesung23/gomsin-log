import { normalizeText } from '@/lib/emotionText';
import { isNativePlatform } from '@/lib/platform';

/**
 * WHEN the device is allowed to read a diary entry, and with what.
 *
 * Two questions live here because they have one answer between them: an analysis
 * that is cheap enough to run anywhere still must not run at a moment that makes
 * the app feel like it is watching someone write.
 *
 * ## The rule
 *
 * Analysis runs at a COMPOSITION BOUNDARY and nowhere else. A boundary is a point
 * where the writer has said, by an action rather than by a pause, that a thought is
 * finished: leaving the text field, or pressing save. Never on a keystroke, and
 * never on a timer.
 *
 * The composer used to run the analyser 300 ms after every pause in typing. Three
 * things were wrong with that, in increasing order of importance:
 *
 *  1. Cost scaled with LENGTH × PAUSES rather than with the number of records. A
 *     long entry re-scanned its whole body dozens of times.
 *  2. It read unfinished sentences. `무서운` is fear and `무서운 영화 봤어` is not,
 *     so a half-typed clause produces a reading that the finished one contradicts.
 *  3. It showed the result while the person was still writing. That a feeling was
 *     computed locally, deterministically and privately does not change how it
 *     feels to watch an app narrate your mood back at you mid-sentence.
 *
 * ## What is deliberately NOT here
 *
 * No prediction of when the partner will next open the app. Knowing that requires
 * modelling their access pattern, which is the behavioural surveillance
 * `PRODUCT_V3.md` §19 forbids -- and it would buy nothing, because the surface it
 * would warm up (`상대방의 오늘`) is a synchronous deterministic function that §6.2
 * forbids from using a model at all. There is no latency there to hide.
 *
 * See `docs/V1_LAUNCH_DECISIONS_2026-08-20.md` §3.
 */

/**
 * The boundaries at which an analysis may start.
 *
 * `composition-settled` — the writer left the field. `save` — the writer committed
 * the record. `record-opened` — an already-saved record was opened and carries no
 * answered feeling, so the suggestion is offered again.
 *
 * `typing` is present so that the forbidden case has a name and a test, rather than
 * being the absence of one.
 */
export type InferenceBoundary =
  | 'composition-settled'
  | 'save'
  | 'record-opened'
  | 'typing';

export function isInferenceAllowedAt(boundary: InferenceBoundary): boolean {
  return boundary !== 'typing';
}

/**
 * How much this device can afford to spend reading text.
 *
 * `full` and `compact` are declared but currently resolve to the same engine as
 * `rules`. That is not an oversight -- see `selectTextEngine` below.
 */
export type DeviceInferenceTier = 'full' | 'compact' | 'rules';

export interface DeviceCapability {
  tier: DeviceInferenceTier;
  /** Why this tier was chosen. Diagnostic only; never sent anywhere. */
  reasons: string[];
}

/**
 * Signals used for tiering.
 *
 * Only things the platform reports about ITSELF. Deliberately absent: model name,
 * user agent parsing, GPU string, screen dimensions and anything else that
 * narrows a device down to a person. A capability check that doubles as a
 * fingerprint is a worse trade than running the cheap engine everywhere.
 */
export interface DeviceSignals {
  /** `navigator.deviceMemory`, in GB. Chrome/Android only; `undefined` elsewhere. */
  memoryGb?: number;
  /** `navigator.hardwareConcurrency`. */
  cores?: number;
  native: boolean;
  /** True while the OS asked apps to do less. */
  lowPower?: boolean;
}

export function readDeviceSignals(): DeviceSignals {
  const nav = typeof navigator === 'undefined'
    ? undefined
    : (navigator as Navigator & { deviceMemory?: number });
  return {
    memoryGb: typeof nav?.deviceMemory === 'number' ? nav.deviceMemory : undefined,
    cores: typeof nav?.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : undefined,
    native: isNativePlatform(),
    lowPower: undefined,
  };
}

/**
 * Classify a device conservatively.
 *
 * Unknown is treated as small. `navigator.deviceMemory` is absent on Safari and
 * every iOS browser, which is a large share of this product's users -- so an
 * `undefined` that fell through to `full` would put the heaviest path on exactly
 * the devices the app can measure least.
 */
export function classifyDevice(signals: DeviceSignals = readDeviceSignals()): DeviceCapability {
  const reasons: string[] = [];

  if (signals.lowPower) {
    return { tier: 'rules', reasons: ['low-power-mode'] };
  }

  const memory = signals.memoryGb;
  const cores = signals.cores;

  if (memory === undefined && cores === undefined) {
    return { tier: 'rules', reasons: ['no-capability-signals'] };
  }

  if (memory !== undefined && memory < 4) reasons.push(`memory:${memory}`);
  if (cores !== undefined && cores < 6) reasons.push(`cores:${cores}`);
  if (!signals.native) reasons.push('web-runtime');

  if (reasons.length > 0) {
    return { tier: reasons.some((r) => r.startsWith('memory:')) ? 'rules' : 'compact', reasons };
  }

  return { tier: 'full', reasons: ['memory-and-cores-sufficient'] };
}

/**
 * The engine each tier gets.
 *
 * ## Why all three are the same today
 *
 * The only text task V1 has is reading six basic feelings out of one diary entry.
 * The deterministic lexicon does that in under a millisecond, with no download, no
 * resident memory and no network -- on every device, including the oldest one a
 * user might have.
 *
 * A neural model would cost hundreds of MB to download and hold, plus sustained
 * heat under repeated use, to improve one six-way classification. It would also be
 * NON-DETERMINISTIC, and two things in this product depend on determinism: §6.2
 * requires the same input to produce the same summary, and a user's correction is
 * only durable if re-opening a record cannot silently produce a different reading.
 *
 * The tiers exist so that when `BUSINESS_MEMORY_ROADMAP_V1.md` M6 validates an
 * on-device model, one branch changes instead of the call sites. Shipping the tier
 * structure is cheap; shipping the model three business stages early is not.
 */
export type TextEngine = 'deterministic-lexicon';

export function selectTextEngine(_tier: DeviceInferenceTier): TextEngine {
  return 'deterministic-lexicon';
}

/**
 * Remember what was already read, so unchanged content is never read twice.
 *
 * Keyed by the NORMALISED text, which is what the analyser actually consumes:
 * fixing a typo in a URL, or changing only whitespace, does not change the reading
 * and therefore must not cost one.
 *
 * Small and bounded. This is a memo across the boundaries of one composition, not
 * a store -- nothing here survives a reload, and nothing here is written to disk,
 * because the analysed text is diary content.
 */
export class InferenceMemo<T> {
  private readonly entries = new Map<string, T>();

  constructor(private readonly limit = 8) {}

  /** The key `text` maps to. Exported behaviour: equal keys must reuse results. */
  static keyFor(text: string): string {
    return normalizeText(text || '');
  }

  /**
   * Return the remembered reading for `text`, or compute and remember one.
   *
   * `compute` receives the NORMALISED text, so a caller cannot accidentally
   * analyse the raw body while caching against the normalised key.
   */
  read(text: string, compute: (normalized: string) => T): T {
    const key = InferenceMemo.keyFor(text);
    const hit = this.entries.get(key);
    if (hit !== undefined) {
      // Refresh recency so the entry a composition keeps returning to survives.
      this.entries.delete(key);
      this.entries.set(key, hit);
      return hit;
    }
    const value = compute(key);
    this.entries.set(key, value);
    if (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    return value;
  }

  /** True when `text` has already been read. Used by tests and by the composer. */
  has(text: string): boolean {
    return this.entries.has(InferenceMemo.keyFor(text));
  }

  clear(): void {
    this.entries.clear();
  }
}
