import { timingSafeEqualSecret } from '../_shared/adminSecret.ts';
import type { RecordMediaCleanupResult } from '../_shared/recordMediaCleanup.ts';

export type RecordMediaCleanupHandlerDeps = {
  schedulerSecret: string | null;
  runCleanup: () => Promise<RecordMediaCleanupResult>;
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

  try {
    return json(await deps.runCleanup());
  } catch {
    return json({ error: 'E_RECORD_MEDIA_CLEANUP_FAILED' }, 503);
  }
}
