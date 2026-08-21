import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The kill metric, and the thing it must not count.
 *
 * `notifications_disabled` is the one measure in §19 whose job is to say the
 * design failed. Everything else in the funnel can look healthy while people
 * quietly switch the app off, and this is the number that would show it.
 *
 * Which means a false reading here is expensive in a specific direction: an
 * inflated count argues for abandoning a design that is working. These tests
 * exist because the emit lived, for one commit, in a function with a second
 * caller that writes `systemEnabled: false` after a DENIED permission request --
 * a user pressing "allow" and being refused by the browser, recorded as a user
 * opting out.
 *
 * §19 also bounds what may be sent: the kind and the screen, never which toggle.
 * Whether someone opted out of being contacted is the question; which switch
 * they used is not, and knowing it would make this a record of what a person
 * finds intrusive.
 */

const recordProductEvent = vi.fn(async () => {});
vi.mock('@/lib/productEvents', () => ({ recordProductEvent }));

let permissionState: 'granted' | 'denied' | 'default' | 'unsupported' = 'default';
let requestResult: 'granted' | 'denied' | 'default' | 'unsupported' = 'granted';
let stored: Record<string, boolean> = {};

vi.mock('@/lib/notifications', () => ({
  DEFAULT_NOTIFICATION_PREFERENCES: {
    inAppEnabled: true,
    systemEnabled: false,
    sharedRecordEnabled: true,
    talkAboutEnabled: true,
  },
  loadNotificationPreferences: () => ({
    inAppEnabled: true,
    systemEnabled: false,
    sharedRecordEnabled: true,
    talkAboutEnabled: true,
    ...stored,
  }),
  saveNotificationPreferences: vi.fn(),
  notificationPermission: () => permissionState,
  requestNotificationPermission: async () => requestResult,
}));

const { NotificationPreferencesSection } = await import('@/components/NotificationPreferencesSection');

beforeEach(() => {
  recordProductEvent.mockClear();
  permissionState = 'default';
  requestResult = 'granted';
  stored = {};
});

describe('NotificationPreferencesSection — the kill metric', () => {
  it('records the opt-out when a user turns a notification off', async () => {
    render(<NotificationPreferencesSection userId="u1" />);
    await userEvent.click(await screen.findByRole('checkbox', { name: /앱 안에서 다시 알려주기/ }));

    await waitFor(() => expect(recordProductEvent).toHaveBeenCalledTimes(1));
    expect(recordProductEvent).toHaveBeenCalledWith({
      kind: 'notifications_disabled',
      screen: 'settings',
    });
  });

  it('sends nothing beyond the kind and the screen', async () => {
    render(<NotificationPreferencesSection userId="u1" />);
    await userEvent.click(await screen.findByRole('checkbox', { name: /이야기할 것 알림/ }));

    await waitFor(() => expect(recordProductEvent).toHaveBeenCalledTimes(1));
    const payload = recordProductEvent.mock.calls[0][0] as Record<string, unknown>;
    // Which toggle it was is absent on purpose -- see the header.
    expect(Object.keys(payload).sort()).toEqual(['kind', 'screen']);
  });

  it('does not record anything when a user turns one back ON', async () => {
    stored = { inAppEnabled: false };
    render(<NotificationPreferencesSection userId="u1" />);
    await userEvent.click(await screen.findByRole('checkbox', { name: /앱 안에서 다시 알려주기/ }));

    // A moment for an errant emit to land.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(recordProductEvent).not.toHaveBeenCalled();
  });

  it('does NOT record an opt-out when a permission request comes back denied', async () => {
    /*
      The regression this file was written for.

      A grant the user later revoked in OS settings leaves `systemEnabled: true`
      in storage while the live permission reads `default`. Pressing "allow" from
      that state returns DENIED, and the handler writes `systemEnabled: false` --
      an OFF transition produced by someone asking for MORE notification.
    */
    stored = { systemEnabled: true };
    permissionState = 'default';
    requestResult = 'denied';

    render(<NotificationPreferencesSection userId="u1" />);
    await userEvent.click(await screen.findByRole('button', { name: /알림 허용/ }));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(recordProductEvent).not.toHaveBeenCalled();
  });

  it('records nothing when a permission request succeeds either', async () => {
    permissionState = 'default';
    requestResult = 'granted';

    render(<NotificationPreferencesSection userId="u1" />);
    await userEvent.click(await screen.findByRole('button', { name: /알림 허용/ }));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(recordProductEvent).not.toHaveBeenCalled();
  });
});
