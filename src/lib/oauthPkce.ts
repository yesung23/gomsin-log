import { AUTH_CALLBACK_TIMEOUT_MS } from '@/lib/async';

const PKCE_FLOW_ID_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/;

/** Statuses the `Response` constructor refuses to pair with a body. */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

export function validatePkceFlowId(value: unknown): string | null {
  return typeof value === 'string' && PKCE_FLOW_ID_PATTERN.test(value) ? value : null;
}

function isPkceTokenRequest(input: RequestInfo | URL): boolean {
  try {
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    return url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'pkce';
  } catch {
    return false;
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}

function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(abortReason(signal)), { once: true });
  });
}

/**
 * Buffer the whole token response before handing it back, so the deadline
 * covers response-body consumption and not only the response headers.
 *
 * `@supabase/auth-js` reads the token body (`await result.json()`) *after* its
 * `fetch` call resolves, and only saves the session once that read completes.
 * Releasing the deadline at the headers would therefore leave a stalled body
 * able to hang the sign-in indefinitely, or to install a session long after the
 * user gave up and moved on.
 */
async function readWithinDeadline(response: Response, signal: AbortSignal): Promise<Response> {
  if (signal.aborted) throw abortReason(signal);
  // Nothing can stall on a status that is not allowed to carry a body.
  if (NULL_BODY_STATUSES.has(response.status)) return response;

  const body = await Promise.race([response.arrayBuffer(), rejectOnAbort(signal)]);

  // A transport that keeps streaming past its abort must still never produce a
  // usable body: once the deadline has passed there is no success left to give.
  if (signal.aborted) throw abortReason(signal);

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

export function createPkceTimeoutFetch(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    if (!isPkceTokenRequest(input)) return fetchImpl(input, init);

    const controller = new AbortController();
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const forwardAbort = () => controller.abort(callerSignal?.reason);

    if (callerSignal?.aborted) {
      forwardAbort();
    } else {
      callerSignal?.addEventListener('abort', forwardAbort, { once: true });
    }

    const timer = setTimeout(() => controller.abort(), AUTH_CALLBACK_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', forwardAbort);
    };

    try {
      const response = await fetchImpl(input, { ...init, signal: controller.signal });
      return await readWithinDeadline(response, controller.signal);
    } finally {
      cleanup();
    }
  };
}
