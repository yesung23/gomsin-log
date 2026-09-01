import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ErrorEvent } from '@sentry/react';

const sentry = vi.hoisted(() => ({
  captureException: vi.fn(),
  init: vi.fn(),
  isInitialized: vi.fn(),
}));

vi.mock('@sentry/react', () => sentry);

import {
  initializeSentry,
  reportBoundaryError,
  sanitizeSentryEvent,
  shouldInitializeSentry,
} from './sentry';

afterEach(() => {
  vi.clearAllMocks();
  sentry.isInitialized.mockReturnValue(false);
});

describe('Sentry privacy boundary', () => {
  it('is explicit opt-in: production, exact true, DSN, and web are all required', () => {
    const dsn = 'https://public@example.invalid/1';

    expect(shouldInitializeSentry(false, 'true', dsn)).toBe(false);
    expect(shouldInitializeSentry(true, undefined, dsn)).toBe(false);
    expect(shouldInitializeSentry(true, 'false', dsn)).toBe(false);
    expect(shouldInitializeSentry(true, 'TRUE', dsn)).toBe(false);
    expect(shouldInitializeSentry(true, 'true', '')).toBe(false);
    expect(shouldInitializeSentry(true, 'true', dsn, true)).toBe(false);
    expect(shouldInitializeSentry(true, 'true', dsn)).toBe(true);
  });

  it('removes user content, request data, breadcrumbs, and source context', () => {
    const sanitized = sanitizeSentryEvent({
      breadcrumbs: [{ category: 'console', message: 'private diary text' }],
      contexts: { app: { recordText: 'private diary text' } },
      extra: { token: 'secret-token' },
      fingerprint: ['private diary text'],
      logger: 'private logger',
      message: 'private diary text',
      request: { url: 'https://gomsinlog.app/auth/callback?code=secret-code' },
      tags: { coupleId: 'private-couple-id' },
      transaction: '/record/private-record-id',
      user: { email: 'private@example.com', id: 'private-user-id' },
      logentry: { message: 'private diary text', params: ['private diary text'] },
      spans: [{ data: { recordText: 'private diary text' } }],
      threads: { values: [{ id: 1, name: 'private diary text' }] },
      exception: {
        values: [
          {
            module: 'private diary text',
            mechanism: { data: { token: 'secret-token' }, handled: false, type: 'onerror' },
            stacktrace: {
              frames: [
                {
                  abs_path: 'https://gomsinlog.app/assets/main.js?token=secret-token',
                  context_line: 'private diary text',
                  filename: 'https://gomsinlog.app/assets/main.js#secret-token',
                  function: 'private diary text',
                  post_context: ['private diary text'],
                  pre_context: ['private diary text'],
                  vars: { recordText: 'private diary text' },
                  lineno: 123,
                  colno: 9,
                },
              ],
            },
            type: 'PrivateDiaryError',
            value: 'private diary text',
          },
        ],
      },
    } as ErrorEvent);

    expect(sanitized.breadcrumbs).toBeUndefined();
    expect(sanitized.contexts).toBeUndefined();
    expect(sanitized.extra).toBeUndefined();
    expect(sanitized.message).toBeUndefined();
    expect(sanitized.request).toBeUndefined();
    expect(sanitized.tags).toBeUndefined();
    expect(sanitized.user).toBeUndefined();
    expect(sanitized.transaction).toBeUndefined();
    expect(sanitized.logentry).toBeUndefined();
    expect(sanitized.spans).toBeUndefined();
    expect(sanitized.threads).toBeUndefined();

    const exception = sanitized.exception?.values?.[0];
    expect(exception).toMatchObject({ type: 'Error', value: '[redacted]' });
    expect(exception).not.toHaveProperty('mechanism');
    expect(exception).not.toHaveProperty('module');

    const frame = exception?.stacktrace?.frames?.[0];
    expect(frame).toEqual({
      colno: 9,
      filename: 'main.js',
      in_app: undefined,
      lineno: 123,
    });
  });

  it('drops dynamic/non-JavaScript paths instead of sending route or query data', () => {
    const sanitized = sanitizeSentryEvent({
      exception: {
        values: [{
          stacktrace: {
            frames: [
              { filename: 'https://gomsinlog.app/record/private-id?token=secret', lineno: 4 },
              { filename: 'https://gomsinlog.app/assets/app.mjs?token=secret', lineno: 5 },
            ],
          },
        }],
      },
    } as ErrorEvent);

    expect(sanitized.exception?.values?.[0]?.stacktrace?.frames).toEqual([
      { colno: undefined, filename: undefined, in_app: undefined, lineno: 4 },
      { colno: undefined, filename: undefined, in_app: undefined, lineno: 5 },
    ]);
  });

  it('does not load or initialize the SDK when reporting is disabled', async () => {
    const initialized = await initializeSentry(false, {
      isProduction: true,
      enabled: 'false',
      dsn: 'https://public@example.invalid/1',
    });

    expect(initialized).toBe(false);
    expect(sentry.init).not.toHaveBeenCalled();
  });

  it('does not report React boundary errors before an enabled initialization exists', async () => {
    reportBoundaryError(new Error('private diary text'), { componentStack: '\n    at PrivateRecord' });
    await Promise.resolve();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it('initializes a manual-error-only client with default integrations and PII disabled', async () => {
    const initialized = await initializeSentry(false, {
      isProduction: true,
      enabled: 'true',
      dsn: 'https://public@example.invalid/1',
    });

    expect(initialized).toBe(true);
    expect(sentry.init).toHaveBeenCalledWith(expect.objectContaining({
      defaultIntegrations: false,
      integrations: [],
      maxBreadcrumbs: 0,
      sendClientReports: false,
      sendDefaultPii: false,
      beforeSend: sanitizeSentryEvent,
    }));
  });

  it('reports only through the initialized manual boundary and never forwards React component info', async () => {
    sentry.isInitialized.mockReturnValue(true);
    const error = new Error('private diary text');
    const info = { componentStack: '\n    at PrivateRecord' };

    reportBoundaryError(error, info);
    await Promise.resolve();
    await Promise.resolve();

    expect(sentry.captureException).toHaveBeenCalledWith(error);
    expect(sentry.captureException).not.toHaveBeenCalledWith(error, info);
  });

  it('isolates capture failures from the application crash-recovery path', async () => {
    sentry.isInitialized.mockReturnValue(true);
    sentry.captureException.mockImplementation(() => { throw new Error('sdk failure'); });

    expect(() => reportBoundaryError(new Error('private diary text'), { componentStack: '' })).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });
});
