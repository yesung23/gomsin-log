import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

/**
 * §4.2: an empty state must mean EMPTY, not UNREACHABLE.
 *
 * Quarantine (`store.tsx`, the `nextState` that assigns `records: []`) clears the
 * shared workspace on a realtime failure -- and it clears one's OWN records with
 * it, deliberately, because stale couple-scoped data must not outlive the
 * authorization that produced it.
 *
 * Three fixed-core surfaces read only the length of what survived and said
 * "아직 ... 없어요". At the exact moment the app cannot confirm anything, the
 * 군화 with a fifteen-minute window is told there is nothing there. That is not
 * a cosmetic wording problem: it is the loop's first arrow reporting a state
 * that never happened.
 *
 * `PartnerDayTimelineWidget` already drew this distinction with a skeleton.
 * These tests exist so the three that did not cannot quietly go back.
 *
 * Rendered, not grepped. A source-substring gate would pass on a commented-out
 * branch -- the defect class this repository has now been bitten by three times.
 */

/*
 * COVERAGE GAP, stated rather than left to be discovered.
 *
 * `TodayLogWidget` carries the same one-line fix and the same failure mode, and
 * it is NOT rendered here. It pulls the composer, the emotion-candidate hook and
 * the suggestion review with it, and mocking that surface well enough to render
 * is a larger job than the fix it would cover. Its branch is verified by
 * `tsc` and by reading, which is weaker than the two below, and saying so is the
 * point -- an untested branch that nobody names is how this file's subject
 * survived in the first place.
 */

let sharedSyncStatus = 'live';

const baseProfile = {
  id: 'u1',
  role: 'soldier',
  couple: { connected: true, status: 'active', partnerName: '상대' },
};

vi.mock('@/lib/useStore', () => ({
  useStore: () => ({
    state: {
      profile: baseProfile,
      records: [],
      talkAboutMarks: [],
      events: [],
      trips: [],
    },
    sharedSyncStatus,
    setHighlightedRecordId: vi.fn(),
    resolveTalkAbout: vi.fn(),
    addRecordWithMedia: vi.fn(),
    queueRecordForLater: vi.fn(),
  }),
}));

vi.mock('@/lib/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
  OFFLINE_READONLY_MESSAGE: 'offline',
}));

vi.mock('@/lib/productEvents', () => ({ recordProductEvent: vi.fn() }));

const { TodayBriefingWidget } = await import('@/lib/widgetComponents');
const { TalkAboutListWidget } = await import('@/components/widgets/TalkAboutListWidget');

const draw = (node: React.ReactElement) => {
  const text = render(<MemoryRouter>{node}</MemoryRouter>).container.textContent ?? '';
  /*
    Every render goes through this, and that is the point.
    The first version of this fix put its explanation inside the JSX, where a
    bare block comment is not a comment at all -- React renders it as text. The
    branch assertions below all passed while the surface printed its own block
    comment to the user, backticks and all, because they only asked which
    SENTENCE appeared. CI caught it on the literal-backtick test that exists
    because this happened once before.
    So: no source markup ever reaches the screen, checked on every case.
  */
  expect(text).not.toContain('/*');
  expect(text).not.toContain('*' + '/');
  expect(text).not.toContain('`');
  return text;
};

describe('§4.2: quarantine must not be rendered as emptiness', () => {
  beforeEach(() => { sharedSyncStatus = 'live'; });

  describe('오늘의 브리핑', () => {
    it('says nothing is here only when the app can actually see', () => {
      expect(draw(<TodayBriefingWidget />)).toContain('아직 오늘의 기록이 없어요');
    });

    it('says it is still checking when the shared workspace is unconfirmed', () => {
      sharedSyncStatus = 'unavailable';
      const text = draw(<TodayBriefingWidget />);
      expect(text).toContain('확인하는 중');
      /*
        The negative half is the load-bearing one. Without it this test passes on
        a surface that renders BOTH sentences, which is the failure mode a purely
        positive assertion invites.
      */
      expect(text).not.toContain('아직 오늘의 기록이 없어요');
    });
  });

  describe('오늘 이야기할 것', () => {
    it('says nothing is marked only when the app can actually see', () => {
      expect(draw(<TalkAboutListWidget />)).toContain('아직 표시한 기록이 없어요');
    });

    it('says it is still checking when the shared workspace is unconfirmed', () => {
      sharedSyncStatus = 'unavailable';
      const text = draw(<TalkAboutListWidget />);
      expect(text).toContain('확인하는 중');
      expect(text).not.toContain('아직 표시한 기록이 없어요');
    });
  });
});
