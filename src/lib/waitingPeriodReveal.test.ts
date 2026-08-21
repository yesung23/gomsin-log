import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DailyRecord } from '@/types';
import { REVEAL_WINDOW_DAYS, buildRevealOffer } from '@/lib/waitingPeriodReveal';

/**
 * PRODUCT_V3 §7.6 — the offer, and everything it must not do.
 *
 * The rule is that entries written before the partner joined are never shared
 * automatically. So the assertions that matter are the ones about NOT offering
 * and NOT including, and the one about there being no stored "already asked".
 */

const ME = 'user-me';
const PARTNER = 'user-partner';
const JOINED = '2026-08-20T12:00:00.000Z';

function record(over: Partial<DailyRecord> & { id: string }): DailyRecord {
  return {
    userId: ME,
    date: '2026-08-19',
    time: '10:00',
    authorRole: 'gomsin',
    log: '혼자 남긴 하루',
    isPrivate: true,
    createdAt: '2026-08-19T10:00:00.000Z',
    ...over,
  };
}

/*
  `joinedAt` is NOT defaulted.

  A default parameter is not overridden by an explicit `undefined`, so the
  "join time unknown" case below would silently run WITH a join time and assert
  nothing. This is the second time that trap caught me in this session; the first
  was `useMediaAttachment.test.tsx`, whose original suite carried a comment
  warning about exactly it.
*/
function offerAt(records: DailyRecord[], now: string, joinedAt?: string) {
  return buildRevealOffer({
    records,
    viewerUserId: ME,
    partnerJoinedAt: joinedAt,
    now: new Date(now),
  });
}

describe('what is offered', () => {
  it('offers a private entry written before the partner joined', () => {
    const offer = offerAt([record({ id: 'rec-before' })], '2026-08-20T13:00:00.000Z', JOINED);
    expect(offer.offered).toBe(true);
    expect(offer.candidates.map((c) => c.recordId)).toEqual(['rec-before']);
  });

  it('orders oldest first, which is the order they were lived in', () => {
    const offer = offerAt([
      record({ id: 'later', createdAt: '2026-08-19T18:00:00.000Z' }),
      record({ id: 'earlier', createdAt: '2026-08-17T09:00:00.000Z' }),
    ], '2026-08-20T13:00:00.000Z', JOINED);
    expect(offer.candidates.map((c) => c.recordId)).toEqual(['earlier', 'later']);
  });

  it('describes a photo-only entry without inventing text for it', () => {
    const offer = offerAt([
      record({ id: 'photo', log: '', attachments: [{ type: 'photo', name: 'a.jpg', path: 'p' }] }),
    ], '2026-08-20T13:00:00.000Z', JOINED);
    expect(offer.candidates[0].preview).toBe('사진으로 남긴 순간');
  });
});

describe('what is never offered', () => {
  it('never offers an entry written AFTER the partner joined', () => {
    // Those were written into a shared space by someone who could see the
    // sharing control. Their visibility is already a decision that was made.
    const offer = offerAt([
      record({ id: 'after', createdAt: '2026-08-21T09:00:00.000Z' }),
    ], '2026-08-21T10:00:00.000Z', JOINED);
    expect(offer.offered).toBe(false);
  });

  it('uses when it was WRITTEN, not the date it is filed under', () => {
    // A back-dated entry written after the join is not a waiting-period record.
    const offer = offerAt([
      record({ id: 'backdated', date: '2026-08-10', createdAt: '2026-08-21T09:00:00.000Z' }),
    ], '2026-08-21T10:00:00.000Z', JOINED);
    expect(offer.offered).toBe(false);
  });

  it('never offers an entry that is already shared', () => {
    const offer = offerAt([record({ id: 'shared', isPrivate: false })], '2026-08-20T13:00:00.000Z', JOINED);
    expect(offer.offered).toBe(false);
  });

  it("never offers the partner's own entries", () => {
    // Revealing someone else's private record is not a thing this can do, and
    // the filter is here so it is not a thing the UI has to remember either.
    const offer = offerAt([
      record({ id: 'theirs', userId: PARTNER }),
    ], '2026-08-20T13:00:00.000Z', JOINED);
    expect(offer.offered).toBe(false);
  });

  it('offers nothing when the join time is unknown', () => {
    /*
      A fetch still in flight, or a row old enough to lack one. Asking anyway
      would mean offering to reveal entries written after the partner arrived --
      the app inventing a waiting period that did not happen.
    */
    const offer = offerAt([record({ id: 'rec' })], '2026-08-20T13:00:00.000Z');
    expect(offer.offered).toBe(false);
  });

  it('offers nothing when the join time is unparseable', () => {
    const offer = offerAt([record({ id: 'rec' })], '2026-08-20T13:00:00.000Z', 'not-a-date');
    expect(offer.offered).toBe(false);
  });
});

describe('"once", expressed as a window rather than as stored state', () => {
  it('offers inside the window', () => {
    const almost = new Date(Date.parse(JOINED) + (REVEAL_WINDOW_DAYS - 0.5) * 86_400_000);
    expect(offerAt([record({ id: 'rec' })], almost.toISOString(), JOINED).offered).toBe(true);
  });

  it('stops offering once the window has passed', () => {
    const after = new Date(Date.parse(JOINED) + (REVEAL_WINDOW_DAYS + 1) * 86_400_000);
    const offer = offerAt([record({ id: 'rec' })], after.toISOString(), JOINED);
    expect(offer.offered).toBe(false);
    // And the record is untouched by that: still private, still there. The window
    // bounds the unprompted question, not the ability to answer it later.
    expect(offer.candidates).toEqual([]);
  });

  it('does not offer when the clock says the join is in the future', () => {
    const before = new Date(Date.parse(JOINED) - 86_400_000);
    expect(offerAt([record({ id: 'rec' })], before.toISOString(), JOINED).offered).toBe(false);
  });

  it('stores no "already asked" state anywhere', () => {
    /*
      The point of deriving the window from `joined_at`. A flag would have to live
      somewhere that survives a reload, and the only such place for a device
      preference is a whitelist pinned by a test BECAUSE its contents outlive
      account deletion.
    */
    const source = readFileSync(resolve(process.cwd(), 'src/lib/waitingPeriodReveal.ts'), 'utf8');
    expect(source).not.toContain('localStorage');
    expect(source).not.toMatch(/hasAsked|wasDismissed|promptShown|alreadyPrompted/);
    // Pure: the record type is the only import, so there is nowhere to persist to.
    expect(source.match(/^import /gm) ?? []).toHaveLength(1);
  });
});
