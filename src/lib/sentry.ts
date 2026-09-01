import type { ErrorEvent, StackFrame } from '@sentry/react';
import type { ErrorInfo } from 'react';

const REDACTED = '[redacted]';
const STATIC_JS_BASENAME = /^[A-Za-z0-9._-]+\.js$/;

type SentryRuntime = typeof import('@sentry/react');

interface SentryEnvironment {
  isProduction: boolean;
  enabled: string | undefined;
  dsn: string | undefined;
}

let runtimePromise: Promise<SentryRuntime | null> | null = null;

function staticJsBasename(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const clean = value.split(/[?#]/, 1)[0];
  const basename = clean.split('/').pop();
  return basename && STATIC_JS_BASENAME.test(basename) ? basename : undefined;
}

function sanitizeStackFrame(frame: StackFrame): StackFrame {
  const filename = staticJsBasename(frame.filename) ?? staticJsBasename(frame.abs_path);
  return {
    colno: Number.isFinite(frame.colno) ? frame.colno : undefined,
    filename,
    in_app: frame.in_app === true ? true : undefined,
    lineno: Number.isFinite(frame.lineno) ? frame.lineno : undefined,
  };
}

/**
 * Keep only a fixed error identity and static source locations. User content,
 * route/query data, React component names and request context never leave the
 * device through this boundary.
 */
export function sanitizeSentryEvent(event: ErrorEvent): ErrorEvent {
  const exceptionValues = event.exception?.values?.map((exception) => {
    const frames = exception.stacktrace?.frames
      ?.map(sanitizeStackFrame)
      .filter((frame) => frame.filename || frame.lineno || frame.colno);

    return {
      stacktrace: frames?.length ? { frames } : undefined,
      type: 'Error',
      value: REDACTED,
    };
  });

  return {
    dist: event.dist,
    environment: event.environment,
    event_id: event.event_id,
    exception: exceptionValues?.length ? { values: exceptionValues } : undefined,
    level: event.level,
    platform: event.platform,
    release: event.release,
    timestamp: event.timestamp,
    type: event.type,
  };
}

export function shouldInitializeSentry(
  isProduction: boolean,
  enabled: string | undefined,
  dsn: string | undefined,
  isNativeApp = false,
): boolean {
  return !isNativeApp
    && isProduction
    && enabled === 'true'
    && Boolean(dsn?.trim());
}

function defaultEnvironment(): SentryEnvironment {
  return {
    isProduction: import.meta.env.PROD,
    enabled: import.meta.env.VITE_SENTRY_ENABLED,
    dsn: import.meta.env.VITE_SENTRY_DSN,
  };
}

/**
 * Sentry is deliberately opt-in and lazy. When disabled, the SDK is not part of
 * the startup chunk and no third-party error-reporting code is requested.
 */
export async function initializeSentry(
  isNativeApp = false,
  environment: SentryEnvironment = defaultEnvironment(),
): Promise<boolean> {
  const dsn = environment.dsn?.trim();
  if (!shouldInitializeSentry(environment.isProduction, environment.enabled, dsn, isNativeApp)) {
    return false;
  }

  if (!runtimePromise) {
    runtimePromise = (async () => {
      try {
        const Sentry = await import('@sentry/react');
        Sentry.init({
          beforeSend: sanitizeSentryEvent,
          defaultIntegrations: false,
          dsn,
          environment: 'production',
          integrations: [],
          maxBreadcrumbs: 0,
          sendClientReports: false,
          sendDefaultPii: false,
        });
        return Sentry;
      } catch {
        return null;
      }
    })();
  }

  return Boolean(await runtimePromise);
}

/**
 * ErrorBoundary calls this synchronously. Reporting is fire-and-forget and can
 * never make the crash path throw again. React component stacks are intentionally
 * not forwarded because component/user route context is not needed for the
 * minimum viable production signal.
 */
export function reportBoundaryError(error: Error, _info: ErrorInfo): void {
  const pendingRuntime = runtimePromise;
  if (!pendingRuntime) return;

  void pendingRuntime.then((Sentry) => {
    if (!Sentry?.isInitialized()) return;
    try {
      Sentry.captureException(error);
    } catch {
      // Observability must never become a second application failure.
    }
  });
}
