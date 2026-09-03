/**
 * The bridge contract for `GomsinlogOnDeviceSummary`.
 *
 * One rule governs this interface, and it is why the plugin is this small:
 *
 *   NOTHING THAT CROSSES THIS BOUNDARY IDENTIFIES A RECORD, A PERSON OR A DAY.
 *
 * `refineLines` receives an ORDINAL INDEX and an already-normalised record body
 * of at most 120 UTF-16 units, and nothing else. No `recordId`, no `userId`, no
 * date, no time, no attachment URL. The TypeScript side rejoins the returned
 * index to the original record id itself (`src/lib/dailySummary/verify.ts`), so
 * the model cannot make a summary line point at a different record even if it
 * returns nonsense.
 *
 * WHAT THE MODEL MAY DO: select one exact contiguous excerpt from the same
 * record body. It may not rewrite the body or choose which records matter.
 *
 * WHAT THE MODEL MAY NOT DO, and what the TypeScript verifier rejects rather
 * than trusts: add an item, drop an item, reorder items, return an index outside
 * the request, repeat an index, rewrite text, split a word or grapheme, or exceed
 * the 40-UTF-16-unit excerpt limit. The model therefore never decides WHICH
 * moments are summarised or in WHAT ORDER — that is fixed by
 * `src/lib/dailySummary/corpus.ts` before this boundary is reached.
 *
 * PLATFORMS: iOS only, deliberately. There is no Android implementation and no
 * web implementation. `package.json` declares only `capacitor.ios`, so
 * `cap sync android` never sees this package. The TypeScript side checks
 * `getPlatform() === 'ios'` and falls back to the deterministic rules
 * everywhere else rather than silently substituting a different engine.
 *
 * NETWORK / STORAGE / LOGGING: none of the three. The native side runs Apple's
 * on-device system language model, keeps no transcript, writes no file, submits
 * no feedback, and prints neither input nor output.
 *
 * VERIFICATION: the availability gates, the guided-output decoding and the
 * cancellation path are structural. ACTUAL MODEL BEHAVIOUR ON SUPPORTED
 * HARDWARE IS UNVERIFIED — a simulator does not run Apple Intelligence, so it
 * proves compilation and bridge wiring only.
 */

/** Exactly two fields. Adding a third is a contract change, not a refactor. */
export interface OnDeviceSummaryItem {
  /** Position in the request, `0`-based. The only identifier the model sees. */
  index: number;
  /** Input: source body <=120 UTF-16 units. Output: exact excerpt core <=40. */
  text: string;
}

/**
 * Why the on-device path is not usable. A bounded code, never content.
 *
 * `os_too_old` and `framework_missing` are separate on purpose: the first is an
 * iOS 14-25 device running a build that HAS the framework, the second is a build
 * compiled against an SDK that does not, and treating them alike would hide a
 * packaging mistake behind a device-capability message.
 */
export type OnDeviceSummaryUnavailableReason =
  | 'ready'
  | 'os_too_old'
  | 'framework_missing'
  | 'model_unavailable'
  | 'locale_unsupported';

export interface OnDeviceSummaryPlugin {
  /**
   * Whether the model can run here, for this locale, right now.
   *
   * Resolves rather than rejects: "unavailable" is an ordinary answer, and the
   * caller's response to it is identical to its response to a rejection.
   */
  availability(options: { locale: string }): Promise<{
    available: boolean;
    reason: OnDeviceSummaryUnavailableReason;
  }>;

  /**
   * Extract one exact source excerpt per line, returning the same count and order.
   *
   * `requestId` is an opaque correlation id carrying no content. It is what
   * makes cancellation and single-flight possible: a second call cancels the
   * first, and a response whose `requestId` no longer matches is discarded by
   * the caller instead of being applied to a screen that has moved on.
   *
   * Rejections carry a stable code (`E_BAD_REQUEST`, `E_UNAVAILABLE`,
   * `E_CANCELLED`, `E_ON_DEVICE_SUMMARY`) and a fixed message. Neither the
   * input nor the model output ever appears in an error.
   */
  refineLines(options: {
    requestId: string;
    locale: string;
    items: OnDeviceSummaryItem[];
  }): Promise<{ requestId: string; items: OnDeviceSummaryItem[] }>;

  /** Cancel `requestId` if it is the one in flight. Never throws for a stale id. */
  cancel(options: { requestId: string }): Promise<void>;
}
