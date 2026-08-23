import { describe, expect, it } from 'vitest';
import { renderProfileCaption } from '@/lib/profileCaption';

const base = {
  anniversaryDate: '2026-01-01',
  events: [{
    id: 'meet-1', coupleId: 'couple-1', createdBy: 'user-1', title: '만남',
    eventType: 'visit' as const, startDate: '2026-08-30', isPrivate: false, createdAt: '2026-01-01',
  }],
  military: {
    branch: 'army' as const,
    militaryStatus: 'serving' as const,
    enlistmentDate: '2025-09-01',
    expectedDischargeDate: '2026-09-09',
    dischargeDateSource: 'manual' as const,
  },
  todayStr: '2026-08-23',
};

describe('renderProfileCaption', () => {
  it('replaces every supported token with a current fact', () => {
    expect(renderProfileCaption({
      ...base,
      template: '함께 (함께한 날)일 · (만남) · 전역까지 (전역)일',
    })).toEqual({
      status: 'ready',
      text: '함께 235일 · 2026년 8월 30일 · 전역까지 17일',
      missing: [],
    });
  });

  it('does not invent a value when a referenced date is missing', () => {
    expect(renderProfileCaption({
      ...base,
      events: [],
      template: '다음 만남은 (만남)',
    })).toEqual({ status: 'needs_setup', text: null, missing: ['meeting'] });
  });

  it('does not treat an unrelated event as the next meeting', () => {
    expect(renderProfileCaption({
      ...base,
      events: [{ ...base.events[0], eventType: 'other', startDate: '2026-08-24' }],
      template: '다음 만남은 (만남)',
    })).toEqual({ status: 'needs_setup', text: null, missing: ['meeting'] });
  });

  it('returns a truthful empty state for no caption', () => {
    expect(renderProfileCaption({ ...base })).toEqual({
      status: 'ready',
      text: '235일째 같은 하늘 아래',
      missing: [],
    });
  });

  it('does not invent the default caption without an anniversary', () => {
    expect(renderProfileCaption({ ...base, anniversaryDate: undefined })).toEqual({
      status: 'needs_setup',
      text: null,
      missing: ['together'],
    });
  });
});
