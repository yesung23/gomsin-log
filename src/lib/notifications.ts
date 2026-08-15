/**
 * Privacy-safe notification and re-entry contract.
 *
 * The app may know that a partner event happened, but notification copy must
 * stay generic. The only destination data carried here is an opaque record id;
 * the receiving screen still re-checks the current in-memory authorization and
 * shows its existing unavailable/deleted state when the source cannot be read.
 */

export type NotificationEventType = 'new_shared_record' | 'talk_about_mark';

export type NotificationDestination = {
  kind: 'record';
  recordId: string;
};

export type GenericNotificationPayload = {
  eventType: NotificationEventType;
  destination: NotificationDestination;
};

export type ReentryNotification = GenericNotificationPayload & {
  id: string;
  userId: string;
  title: string;
  body: string;
  createdAt: string;
};

export type NotificationPreferences = {
  inAppEnabled: boolean;
  systemEnabled: boolean;
  sharedRecordEnabled: boolean;
  talkAboutEnabled: boolean;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  inAppEnabled: true,
  systemEnabled: false,
  sharedRecordEnabled: true,
  talkAboutEnabled: true,
};

const PREFERENCES_PREFIX = 'gomsinlog.notifications.v1.';
const listeners = new Set<(notification: ReentryNotification) => void>();
const delivered = new Set<string>();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function preferencesKey(userId: string): string {
  return `${PREFERENCES_PREFIX}${userId}`;
}

function parsePreferences(value: unknown): NotificationPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }
  const row = value as Record<string, unknown>;
  return {
    inAppEnabled: row.inAppEnabled !== false,
    systemEnabled: row.systemEnabled === true,
    sharedRecordEnabled: row.sharedRecordEnabled !== false,
    talkAboutEnabled: row.talkAboutEnabled !== false,
  };
}

/** Preferences contain no record content; the account id only scopes the setting. */
export function loadNotificationPreferences(userId: string): NotificationPreferences {
  if (!userId || typeof localStorage === 'undefined') {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }
  try {
    return parsePreferences(JSON.parse(localStorage.getItem(preferencesKey(userId)) || 'null'));
  } catch {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES };
  }
}

export function saveNotificationPreferences(
  userId: string,
  preferences: NotificationPreferences,
): void {
  if (!userId || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(preferencesKey(userId), JSON.stringify(parsePreferences(preferences)));
  } catch {
    // A storage quota/privacy-mode failure must not block the record flow.
  }
}

export type NotificationPermission = 'granted' | 'denied' | 'default' | 'unsupported';

export function notificationPermission(): NotificationPermission {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/** Must be called from a user gesture when the browser supports notifications. */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.requestPermission();
}

export function genericCopy(eventType: NotificationEventType): { title: string; body: string } {
  return eventType === 'new_shared_record'
    ? { title: '곰신로그', body: '새로운 하루가 도착했어요.' }
    : { title: '곰신로그', body: '나중에 이야기하고 싶은 기록이 있어요.' };
}

export function notificationDestination(input: unknown): string | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const row = input as Record<string, unknown>;
  const destination = row.destination;
  if (!destination || typeof destination !== 'object' || Array.isArray(destination)) return null;
  const candidate = destination as Record<string, unknown>;
  if (candidate.kind !== 'record'
    || typeof candidate.recordId !== 'string'
    || !UUID_PATTERN.test(candidate.recordId)) {
    return null;
  }
  return `/record?record=${encodeURIComponent(candidate.recordId)}`;
}

export function subscribeNotifications(
  listener: (notification: ReentryNotification) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function systemNotification(notification: ReentryNotification): void {
  if (notificationPermission() !== 'granted') return;
  try {
    const shown = new Notification(notification.title, {
      body: notification.body,
      tag: notification.id,
      // The payload is opaque routing metadata only. It is never rendered as text.
      data: {
        eventType: notification.eventType,
        destination: notification.destination,
      } satisfies GenericNotificationPayload,
    });
    shown.onclick = () => {
      window.focus();
      window.dispatchEvent(new CustomEvent('gomsinlog:notification-open', {
        detail: {
          userId: notification.userId,
          destination: notification.destination,
        },
      }));
      shown.close();
    };
  } catch {
    // Permission can change between the check and construction (notably when a
    // browser tab is backgrounded). The in-app re-entry event remains valid.
  }
}

/** Compare immutable rows before the Store emits partner talk-about events. */
export function unseenPartnerTalkAboutMarks<T extends { id: string; actorUserId: string }>(
  previous: T[],
  current: T[],
  viewerUserId: string,
): T[] {
  const previousIds = new Set(previous.map((mark) => mark.id));
  return current.filter((mark) => mark.actorUserId !== viewerUserId && !previousIds.has(mark.id));
}

/** Emit one deduplicated generic event for the current authenticated account. */
export async function emitNotification(input: {
  userId: string;
  eventType: NotificationEventType;
  /** Immutable event row id; talk-about re-marks on one record remain distinct. */
  eventId: string;
  recordId: string;
  isCurrent?: () => boolean;
}): Promise<void> {
  if (!input.userId
    || !UUID_PATTERN.test(input.eventId)
    || !UUID_PATTERN.test(input.recordId)
    || input.isCurrent && !input.isCurrent()) return;

  const preferences = loadNotificationPreferences(input.userId);
  if (input.eventType === 'new_shared_record' && !preferences.sharedRecordEnabled) return;
  if (input.eventType === 'talk_about_mark' && !preferences.talkAboutEnabled) return;
  if (!preferences.inAppEnabled && !preferences.systemEnabled) return;
  if (input.isCurrent && !input.isCurrent()) return;

  const id = `${input.userId}:${input.eventType}:${input.eventId}`;
  if (delivered.has(id)) return;
  delivered.add(id);

  const copy = genericCopy(input.eventType);
  const notification: ReentryNotification = {
    id,
    userId: input.userId,
    title: copy.title,
    body: copy.body,
    createdAt: new Date().toISOString(),
    eventType: input.eventType,
    destination: { kind: 'record', recordId: input.recordId },
  };
  if (preferences.inAppEnabled) listeners.forEach((listener) => listener(notification));
  if (preferences.systemEnabled) systemNotification(notification);
}

/** Test seam for isolated event tests; production has no reason to call this. */
export function clearNotificationDedupeForTests(): void {
  delivered.clear();
}
