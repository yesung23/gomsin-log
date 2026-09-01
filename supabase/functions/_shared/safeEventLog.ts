/**
 * Platform logging boundary for Edge Functions.
 *
 * Handlers keep opaque identifiers in their injected event details so their
 * unit tests can correlate an outcome. The platform logger must not forward
 * those details: only this small, non-identifying allow-list may cross into a
 * log aggregator.
 */

const SAFE_STRING_KEYS = new Set(['code', 'kind', 'reason', 'stage', 'status']);
const SAFE_NUMBER_KEYS = new Set(['devices', 'records', 'soloCouplesDeleted', 'considered', 'failed', 'tokensDropped']);
const SAFE_BOOLEAN_KEYS = new Set(['delivered']);

type SafeEventValue = string | number | boolean;

function boundedCode(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 64
    && /^[A-Za-z0-9_.:-]+$/.test(value);
}

function boundedCount(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= 1_000_000;
}

/** Return only bounded scalar fields approved for platform diagnostics. */
export function safeEventDetails(fields: Record<string, unknown>): Record<string, SafeEventValue> {
  const safe: Record<string, SafeEventValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SAFE_STRING_KEYS.has(key) && boundedCode(value)) safe[key] = value;
    else if (SAFE_NUMBER_KEYS.has(key) && boundedCount(value)) safe[key] = value;
    else if (SAFE_BOOLEAN_KEYS.has(key) && typeof value === 'boolean') safe[key] = value;
  }
  return safe;
}

/** Log an event without forwarding IDs, messages, paths, tokens, or content. */
export function logSafeEvent(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ event, ...safeEventDetails(fields) }));
}
