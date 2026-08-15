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
} from './notifications';

afterEach(() => {
  clearNotificationDedupeForTests();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('privacy-safe notifications', () => {
  it('keeps payload copy generic and routes only by opaque record id', () => {
    expect(genericCopy('new_shared_record').body).toBe('새로운 하루가 도착했어요.');
    expect(genericCopy('new_shared_record').body).not.toContain('기록 본문');
    expect(notificationDestination({ destination: { kind: 'record', recordId: 'r/1' } }))
      .toBe('/record?record=r%2F1');
    expect(notificationDestination({ destination: { kind: 'record', recordId: '' } })).toBeNull();
    expect(notificationDestination({ destination: { kind: 'home', recordId: 'r1' } })).toBeNull();
  });

  it('scopes preference changes to the account and keeps defaults fail-safe', () => {
    expect(loadNotificationPreferences('a')).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
    saveNotificationPreferences('a', { ...DEFAULT_NOTIFICATION_PREFERENCES, systemEnabled: true });
    expect(loadNotificationPreferences('a').systemEnabled).toBe(true);
    expect(loadNotificationPreferences('b')).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it('deduplicates events and ignores disabled event types', async () => {
    const received: string[] = [];
    const unsubscribe = subscribeNotifications((event) => {
      received.push(event.id);
    });
    saveNotificationPreferences('a', { ...DEFAULT_NOTIFICATION_PREFERENCES, talkAboutEnabled: false });
    await emitNotification({ userId: 'a', eventType: 'talk_about_mark', recordId: 'r1' });
    expect(received).toEqual([]);
    saveNotificationPreferences('a', { ...DEFAULT_NOTIFICATION_PREFERENCES });
    await emitNotification({ userId: 'a', eventType: 'new_shared_record', recordId: 'r1' });
    await emitNotification({ userId: 'a', eventType: 'new_shared_record', recordId: 'r1' });
    expect(received).toHaveLength(1);
    unsubscribe();
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
      recordId: 'r2',
      isCurrent: () => false,
    });
    expect(received).toEqual([]);
    unsubscribe();
  });
});
