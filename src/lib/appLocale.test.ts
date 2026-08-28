import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APP_LOCALE,
  isAppLocale,
  normalizeAppLocale,
  preferredAppLocale,
  type AppLocale,
} from './appLocale';

describe('AppLocale Contract & Normalization (L4a)', () => {
  describe('AppLocale type union', () => {
    it('pins the AppLocale union exactly to ko | en', () => {
      type ExpectedLocale = 'ko' | 'en';
      type LocaleCoversExpected = [ExpectedLocale] extends [AppLocale] ? true : false;
      type LocaleHasNoExtra = [AppLocale] extends [ExpectedLocale] ? true : false;
      type LocaleExact = LocaleCoversExpected extends true
        ? LocaleHasNoExtra extends true
          ? true
          : false
        : false;

      const exactMatch: LocaleExact = true;
      expect(exactMatch).toBe(true);
    });

    it('defines DEFAULT_APP_LOCALE as ko', () => {
      expect(DEFAULT_APP_LOCALE).toBe('ko');
    });
  });

  describe('isAppLocale & normalizeAppLocale runtime guards', () => {
    it('accepts exact supported locales', () => {
      expect(isAppLocale('ko')).toBe(true);
      expect(isAppLocale('en')).toBe(true);
      expect(normalizeAppLocale('ko')).toBe('ko');
      expect(normalizeAppLocale('en')).toBe('en');
    });

    it('rejects unsupported strings, types, or casing variants', () => {
      expect(isAppLocale('KO')).toBe(false);
      expect(isAppLocale('EN')).toBe(false);
      expect(isAppLocale('ja')).toBe(false);
      expect(isAppLocale('ko-KR')).toBe(false);
      expect(isAppLocale('')).toBe(false);
      expect(isAppLocale(null)).toBe(false);
      expect(isAppLocale(undefined)).toBe(false);
      expect(isAppLocale(123)).toBe(false);
      expect(isAppLocale({})).toBe(false);

      expect(normalizeAppLocale('ja')).toBe('ko');
      expect(normalizeAppLocale(null)).toBe('ko');
      expect(normalizeAppLocale(undefined)).toBe('ko');
    });
  });

  describe('preferredAppLocale', () => {
    it('returns default ko when languages list is undefined, empty, or unparseable', () => {
      expect(preferredAppLocale(undefined)).toBe('ko');
      expect(preferredAppLocale([])).toBe('ko');
    });

    it('matches exact and BCP-47 variants in order', () => {
      expect(preferredAppLocale(['ko'])).toBe('ko');
      expect(preferredAppLocale(['en'])).toBe('en');
      expect(preferredAppLocale(['ko-KR', 'en-US'])).toBe('ko');
      expect(preferredAppLocale(['en-US', 'ko-KR'])).toBe('en');
      expect(preferredAppLocale(['EN-gb', 'ko'])).toBe('en');
      expect(preferredAppLocale(['KO-kr', 'en'])).toBe('ko');
    });

    it('skips unsupported language entries until a supported one is found', () => {
      expect(preferredAppLocale(['ja-JP', 'fr-FR', 'en-GB'])).toBe('en');
      expect(preferredAppLocale(['zh-CN', 'ko-KR', 'en-US'])).toBe('ko');
    });

    it('falls back to ko if no languages in list match supported locales', () => {
      expect(preferredAppLocale(['ja', 'fr', 'de'])).toBe('ko');
      expect(preferredAppLocale(['', '   '])).toBe('ko');
    });

    it('handles whitespace around language tags correctly', () => {
      expect(preferredAppLocale(['  en-US  '])).toBe('en');
      expect(preferredAppLocale(['  ko-KR  '])).toBe('ko');
    });
  });
});
