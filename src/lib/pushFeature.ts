/**
 * Public build-time switch for OS/browser push surfaces.
 *
 * Exact string matching is fail-closed: unset, false, 1, TRUE and typos all remain off.
 * This is not a credential and must not be overridable by query/localStorage/cookies.
 */
export function pushNotificationsEnabled(): boolean {
  return import.meta.env.VITE_PUSH_NOTIFICATIONS_ENABLED === 'true';
}
