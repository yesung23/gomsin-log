import { timingSafeEqualSecret } from '../_shared/adminSecret.ts';
import {
  CLEANUP_INVOCATION_TIMEOUT_MS,
  type RecordMediaCleanupResult,
} from '../_shared/recordMediaCleanup.ts';

export type RecordMediaCleanupHandlerDeps = {
  schedulerSecret: string | null;
  invocationTimeoutMs?: number;
  runCleanup: (signal: AbortSignal) => Promise<RecordMediaCleanupResult>;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleRecordMediaCleanupRequest(
  request: Request,
  deps: RecordMediaCleanupHandlerDeps,
): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ error: 'E_METHOD_NOT_ALLOWED' }, 405);
  }

  const providedSecret = request.headers.get(
    'x-record-media-cleanup-scheduler-secret',
  );
  if (
    !deps.schedulerSecret || !providedSecret ||
    !(await timingSafeEqualSecret(providedSecret, deps.schedulerSecret))
  ) {
    return json({ error: 'E_UNAUTHENTICATED' }, 401);
  }

  const invocationTimeoutMs = deps.invocationTimeoutMs ?? CLEANUP_INVOCATION_TIMEOUT_MS;
  if (!Number.isSafeInteger(invocationTimeoutMs) || invocationTimeoutMs < 1) {
    return json({ error: 'E_RECORD_MEDIA_CLEANUP_FAILED' }, 503);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(new Error('E_CLEANUP_INVOCATION_TIMEOUT')),
    invocationTimeoutMs,
  );
  let rejectOnAbort: (() => void) | null = null;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectOnAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
  });

  try {
    const cleanup = Promise.resolve().then(() => deps.runCleanup(controller.signal));
    return json(await Promise.race([cleanup, aborted]));
  } catch {
    return json({ error: 'E_RECORD_MEDIA_CLEANUP_FAILED' }, 503);
  } finally {
    clearTimeout(timeoutId);
    if (rejectOnAbort) {
      controller.signal.removeEventListener('abort', rejectOnAbort);
    }
  }
}
