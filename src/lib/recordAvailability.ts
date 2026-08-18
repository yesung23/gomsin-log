/**
 * Whether a record's content is actually readable by this client.
 *
 * P5 introduces a state that did not exist before: a row the viewer is
 * AUTHORIZED to see but cannot DECRYPT — a device missing an epoch key, or a
 * rotation that has not reached it yet. Such a record arrives with `log: ''` and
 * `contentUnavailable` set.
 *
 * That state must not reach the summary surfaces. `briefing.ts` and
 * `callBriefing.ts` both treat an empty `log` as "no text, but something is
 * here" and fall back to a sentence like `함께 확인할 순간을 남겼어요`. Applied to
 * an unreadable record that sentence is a narrative invented from content the
 * app could not read, which `PRODUCT_V3.md` §13 forbids ("앱은 서사를 만들지
 * 않는다", "침묵으로부터 추론하지 않는다") — and it would also point 정확한 원본
 * 이동 at a record that cannot be rendered.
 *
 * So an unreadable record is excluded from summarisation entirely, and the record
 * list shows it with its own explanation instead. Excluding is the conservative
 * direction: a missing summary item is recoverable once the key arrives, whereas
 * a fabricated one has already misinformed the reader.
 */

import type { DailyRecord } from '@/types';

/** True when this client holds the record's actual content. */
export function isRecordContentAvailable(record: Pick<DailyRecord, 'contentUnavailable'>): boolean {
  return !record.contentUnavailable;
}

/** Records whose content this client can actually read, in the given order. */
export function withReadableContent<T extends Pick<DailyRecord, 'contentUnavailable'>>(
  records: readonly T[],
): T[] {
  return records.filter(isRecordContentAvailable);
}
