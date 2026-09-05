/**
 * Public build-time safety switch for Sign in with Apple surfaces.
 *
 * Exact matching keeps an unreviewed provider off when the variable is missing,
 * misspelled, or supplied with a truthy-looking value. This is not a credential
 * and must never be replaced by a query, storage, cookie, or runtime toggle.
 */
export function appleLoginEnabled(): boolean {
  return import.meta.env.VITE_APPLE_LOGIN_ENABLED === 'true';
}
