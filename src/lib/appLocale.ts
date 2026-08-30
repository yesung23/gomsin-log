/**
 * Application-level locale contract and pure normalization helpers.
 *
 * Keeps the supported UI locales minimal ('ko' | 'en') with Korean as default,
 * following the Ponytail principle (pure TypeScript, zero external dependencies).
 */

export type AppLocale = 'ko' | 'en';

export const DEFAULT_APP_LOCALE: AppLocale = 'ko';

/**
 * Strict runtime guard that checks if a given value is a valid AppLocale.
 */
export function isAppLocale(value: unknown): value is AppLocale {
  return value === 'ko' || value === 'en';
}

/**
 * Normalizes any unknown input into a valid AppLocale.
 * Returns DEFAULT_APP_LOCALE ('ko') if the input is not supported.
 */
export function normalizeAppLocale(value: unknown): AppLocale {
  return isAppLocale(value) ? value : DEFAULT_APP_LOCALE;
}

/**
 * Pure helper to resolve the preferred AppLocale from an ordered list of language tags (e.g. BCP-47).
 * Does not inspect browser globals or `navigator`.
 */
export function preferredAppLocale(languages?: readonly string[]): AppLocale {
  if (!languages || languages.length === 0) {
    return DEFAULT_APP_LOCALE;
  }
  for (const raw of languages) {
    const tag = raw.trim().toLowerCase();
    if (tag.startsWith('ko')) return 'ko';
    if (tag.startsWith('en')) return 'en';
  }
  return DEFAULT_APP_LOCALE;
}
