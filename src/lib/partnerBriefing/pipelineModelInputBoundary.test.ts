/**
 * P1-1 pre-dispatch boundary assertion.
 *
 * `pipeline.test.ts` proves the source-level value gate: a shared record whose body carries a
 * UUID, Storage path, signed URL or key marker never reaches the provider. That gate is
 * sufficient for the real path, because every candidate is a substring of the source it
 * cleared.
 *
 * The pipeline also asserts the assembled request immediately before the native call. That
 * second checkpoint exists for a future change to candidate building, so it cannot be reached
 * by any input -- only by breaking the substring invariant. This file breaks it deliberately
 * by mocking `buildBriefingExtractCandidates`, which is the only way to prove the check is
 * wired in rather than dead code.
 *
 * It lives in its own file because `vi.mock` is module-scoped and must not weaken the
 * unmocked coverage in `pipeline.test.ts`.
 */

import { describe, expect, it, vi } from 'vitest';
import * as fallback from './fallback';
import { runPartnerBriefingPipeline } from './pipeline';
import { FakeBriefingProvider } from './provider';
import type { BriefingModelSafeEvent } from './contract';

const RECORD_UUID = 'deadbeef-1111-2222-3333-444455556666';
const SAFE_TEXT = '오늘 훈련 힘들었어. 그래도 네 생각하니까 버텼다.';

function createEvent(ordinal: number, text: string): BriefingModelSafeEvent {
  return { ordinal, dayOrdinal: 0, period: 'morning', text, mediaKinds: [] };
}

describe('Partner Briefing pre-dispatch request assertion (P1-1)', () => {
  it('refuses to send a batch whose candidates carry a UUID the source did not contain', async () => {
    // The source text is clean, so the source gate passes it. Candidate building is then
    // forced to emit a value that is NOT a substring of it, which is exactly the regression
    // the pre-dispatch assertion is there to catch.
    const spy = vi
      .spyOn(fallback, 'buildBriefingExtractCandidates')
      .mockReturnValue([{ candidateOrdinal: 0, text: `아이디 ${RECORD_UUID}` }]);

    try {
      const provider = new FakeBriefingProvider();
      const briefing = await runPartnerBriefingPipeline({
        events: [createEvent(0, SAFE_TEXT)],
        sources: [{ ordinal: 0, recordId: 'rec-safe-1' }],
        days: [{ dayOrdinal: 0, date: '2026-08-26' }],
        provider,
        timeoutMs: 2000,
      });

      // The mocked candidate never crossed the boundary.
      const seen = JSON.stringify(provider.getCallHistory());
      expect(seen).not.toContain(RECORD_UUID);

      // The batch failed closed, so the source is rendered deterministically...
      expect(briefing.generation).toBe('deterministic');
      // ...and still keeps its exact provenance.
      expect(briefing.days[0].sections[0].items[0].parts[0].sourceRecordId).toBe(
        'rec-safe-1',
      );
      expect(briefing.overview.sourceRecordIds).toEqual(['rec-safe-1']);
      expect(briefing.sourceCount).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});
