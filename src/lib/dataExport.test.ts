import { describe, expect, it } from 'vitest';
import { buildPersonalExport } from '@/lib/dataExport';
import type { AppState, CoupleEvent, DailyRecord, Trip } from '@/types';

const baseState = (): AppState => ({
  setupComplete: true,
  onboardingStep: 0,
  authenticatedUser: { id: 'user-a', provider: 'google' },
  profile: {
    myName: '나', role: 'gomsin',
    couple: { partnerName: '상대', coupleCode: '', connected: true, status: 'active' },
    military: { branch: 'army', militaryStatus: 'unknown', dischargeDateSource: 'unknown', memo: '' },
    contact: { weekdayStart: '18:00', weekdayEnd: '21:00', weekendStart: '12:00', weekendEnd: '21:00', enabled: true },
  },
  records: [], events: [], trips: [], widgetLayout: [], soldierWidgetLayout: [],
  hasSeenInstallPrompt: true, theme: 'light',
});

const record = (id: string, userId: string): DailyRecord => ({
  id, userId, authorRole: 'gomsin', date: '2026-08-09', time: '12:00',
  log: id, isPrivate: false, createdAt: '2026-08-09T03:00:00Z',
});
const event = (id: string, createdBy: string): CoupleEvent => ({
  id, coupleId: 'couple-a', createdBy, title: id, eventType: 'date',
  startDate: '2026-08-10', isPrivate: false, createdAt: '2026-08-09T03:00:00Z',
});
const trip = (id: string, createdBy: string): Trip => ({
  id, coupleId: 'couple-a', createdBy, title: id, startDate: '2026-08-10',
  endDate: '2026-08-11', status: 'planned', createdAt: '2026-08-09T03:00:00Z',
});

describe('personal data export ownership', () => {
  it('never exports the partner by matching on role instead of account id', () => {
    const state: AppState = {
      ...baseState(),
      records: [record('mine', 'user-a'), record('partner-same-role', 'user-b')],
      events: [event('mine-event', 'user-a'), event('partner-event', 'user-b')],
      trips: [trip('mine-trip', 'user-a'), trip('partner-trip', 'user-b')],
    };
    const result = buildPersonalExport(state, 'user-a', '2026-08-09T00:00:00Z');
    expect(result.records.map((item) => item.log)).toEqual(['mine']);
    expect(result.events.map((item) => item.title)).toEqual(['mine-event']);
    expect(result.trips.map((item) => item.title)).toEqual(['mine-trip']);
    expect(JSON.stringify(result)).not.toContain('partner');
  });

  it('does not include expiring signed URLs in a backup', () => {
    const own = record('mine', 'user-a');
    own.attachments = [{
      id: 'a', type: 'photo', name: 'photo.jpg', path: 'couple/record/photo.jpg',
      url: 'https://signed.example/secret',
    }];
    const result = buildPersonalExport({ ...baseState(), records: [own] }, 'user-a');
    expect(result.records[0].attachments[0].path).toBe('couple/record/photo.jpg');
    expect(JSON.stringify(result)).not.toContain('signed.example');
  });

  it('does not export military fields for a general couple that uses the internal soldier slot', () => {
    const base = baseState();
    const state: AppState = {
      ...base,
      profile: {
        ...base.profile,
        role: 'soldier',
        couple: {
          ...base.profile.couple,
          relationshipContext: 'general',
        },
        military: {
          branch: 'army',
          militaryStatus: 'serving',
          enlistmentDate: '2025-01-01',
          expectedDischargeDate: '2026-06-01',
          dischargeDateSource: 'manual',
        },
      },
    };

    const result = buildPersonalExport(state, 'user-a');

    expect(result.profile.military).toBeNull();
  });
});
