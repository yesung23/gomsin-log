import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearNotificationDedupeForTests,
  DEFAULT_NOTIFICATION_PREFERENCES,
  emitNotification,
  genericCopy,
  loadNotificationPreferences,
  notificationDestination,
  notificationPermission,
  requestNotificationPermission,
  saveNotificationPreferences,
  subscribeNotifications,
  unseenPartnerTalkAboutMarks,
} from './notifications';

afterEach(() => {
  clearNotificationDedupeForTests();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('privacy-safe notifications', () => {
  const RECORD = '11111111-1111-4111-8111-111111111111';
  const EVENT_1 = '22222222-2222-4222-8222-222222222222';
  const EVENT_2 = '33333333-3333-4333-8333-333333333333';

  it('keeps payload copy generic and routes only by opaque record id', () => {
    expect(genericCopy('new_shared_record').body).toBe('새로운 하루가 도착했어요.');
    expect(genericCopy('new_shared_record').body).not.toContain('기록 본문');
    expect(notificationDestination({ destination: { kind: 'record', recordId: RECORD } }))
      .toBe(`/record?record=${RECORD}`);
    expect(notificationDestination({ destination: { kind: 'record', recordId: 'r/1' } })).toBeNull();
    expect(notificationDestination({ destination: { kind: 'record', recordId: ' '.repeat(200) } })).toBeNull();
    expect(notificationDestination({ destination: { kind: 'record', recordId: '' } })).toBeNull();
    expect(notificationDestination({ destination: { kind: 'home', recordId: 'r1' } })).toBeNull();
  });

  it('scopes preference changes to the account and keeps defaults fail-safe', () => {
    expect(loadNotificationPreferences('a')).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    saveNotificationPreferences('a', { ...DEFAULT_NOTIFICATION_PREFERENCES, systemEnabled: true });
    expect(loadNotificationPreferences('a').systemEnabled).toBe(true);
    expect(loadNotificationPreferences('b')).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it('the emitter does not consume a disabled event and deduplicates it after enabling', async () => {
    const received: string[] = [];
    const unsubscribe = subscribeNotifications((event) => {
      received.push(event.id);
    });
    saveNotificationPreferences('a', { ...DEFAULT_NOTIFICATION_PREFERENCES, talkAboutEnabled: false });
    await emitNotification({ userId: 'a', eventType: 'talk_about_mark', eventId: EVENT_1, recordId: RECORD });
    expect(received).toEqual([]);
    saveNotificationPreferences('a', { ...DEFAULT_NOTIFICATION_PREFERENCES });
    await emitNotification({ userId: 'a', eventType: 'talk_about_mark', eventId: EVENT_1, recordId: RECORD });
    await emitNotification({ userId: 'a', eventType: 'talk_about_mark', eventId: EVENT_1, recordId: RECORD });
    expect(received).toHaveLength(1);
    unsubscribe();
  });

  it('delivers a new talk-about mark id for the same source record', async () => {
    const received: string[] = [];
    const unsubscribe = subscribeNotifications((event) => received.push(event.id));
    await emitNotification({ userId: 'a', eventType: 'talk_about_mark', eventId: EVENT_1, recordId: RECORD });
    await emitNotification({ userId: 'a', eventType: 'talk_about_mark', eventId: EVENT_2, recordId: RECORD });
    expect(received).toHaveLength(2);
    unsubscribe();
  });

  it('the store prefilter treats a replacement mark id on the same record as a new event', () => {
    const previous = [{ id: EVENT_1, actorUserId: 'partner', recordId: RECORD }];
    const current = [{ id: EVENT_2, actorUserId: 'partner', recordId: RECORD }];
    expect(unseenPartnerTalkAboutMarks(previous, current, 'viewer')).toEqual(current);
    expect(unseenPartnerTalkAboutMarks(current, current, 'viewer')).toEqual([]);
  });

  it('fails closed when the host has no system notification API', async () => {
    vi.stubGlobal('Notification', undefined);
    expect(notificationPermission()).toBe('unsupported');
    await expect(requestNotificationPermission()).resolves.toBe('unsupported');
  });

  it('drops an event that is stale by the time delivery begins', async () => {
    const received: string[] = [];
    const unsubscribe = subscribeNotifications((event) => received.push(event.id));
    await emitNotification({
      userId: 'a',
      eventType: 'new_shared_record',
      eventId: EVENT_1,
      recordId: RECORD,
      isCurrent: () => false,
    });
    expect(received).toEqual([]);
    unsubscribe();
  });
});
