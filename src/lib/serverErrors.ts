/**
 * One classifier for every server failure the user can be shown.
 *
 * Before this module existed, each call site invented its own message. The two
 * recurring results were both wrong:
 *
 *  - an RLS rejection (`42501`) or an expired JWT (`PGRST301`) was reported as
 *    "check your internet connection", so the user retried forever instead of
 *    reconnecting their couple space or signing in again;
 *  - a genuinely offline device got a database-shaped message.
 *
 * Classifying once, here, is what makes "no misleading internet message" a
 * testable property rather than a per-call-site convention. The single hard rule
 * is asserted in `serverErrors.test.ts`: NO message may mention 인터넷 연결
 * unless the kind is `offline`.
 */

export type ServerErrorKind =
  /** The session is gone or expired. Recoverable by refresh, then re-login. */
  | 'auth_expired'
  /** Authenticated, but not allowed. Membership/ownership problem, not a network one. */
  | 'forbidden'
  /** The row or RPC target does not exist for this caller. */
  | 'not_found'
  /** The device has no network. The ONLY kind allowed to mention 인터넷 연결. */
  | 'offline'
  /** The server answered, but could not serve the request (incl. not-deployed RPCs). */
  | 'server'
  /** Classification failed. Never claim a cause we do not know. */
  | 'unknown';

export type ClassifiedServerError = {
  kind: ServerErrorKind;
  message: string;
};

/**
 * Korean copy, one message per kind.
 *
 * Deliberately a total function over the union: adding a kind without copy is a
 * compile error rather than an empty toast.
 */
const MESSAGES: Record<ServerErrorKind, string> = {
  auth_expired: '세션이 만료되었어요. 다시 로그인해 주세요.',
  forbidden: '권한이 없어요. 커플 공간 연결 상태를 확인해 주세요.',
  not_found: '대상을 찾을 수 없어요. 새로고침한 뒤 다시 시도해 주세요.',
  offline: '오프라인이에요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.',
  server: '서버가 요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.',
  unknown: '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.',
};

export function serverErrorMessage(kind: ServerErrorKind): string {
  return MESSAGES[kind];
}

/** Postgres/PostgREST codes that mean "the session is not usable any more". */
const AUTH_EXPIRED_CODES: ReadonlySet<string> = new Set(['PGRST301']);
/** Postgres `insufficient_privilege`, i.e. an RLS policy said no. */
const FORBIDDEN_CODES: ReadonlySet<string> = new Set(['42501']);
/** PostgREST "no rows" and "function not found in schema cache". */
const NOT_FOUND_CODES: ReadonlySet<string> = new Set(['PGRST116']);
/**
 * The RPC is not deployed on this project. Classified `server` rather than
 * `not_found`: the caller did nothing wrong and retrying the same request cannot
 * help, so the copy must not suggest a refresh.
 */
const SERVER_CODES: ReadonlySet<string> = new Set(['PGRST202']);

/** Substrings that only ever appear in a token/JWT failure. */
const AUTH_EXPIRED_MESSAGES = [
  'jwt expired',
  'jwt is expired',
  'invalid token',
  'invalid jwt',
  'token is expired',
  'refresh token not found',
  'session from session_id claim in jwt does not exist',
] as const;

/**
 * `fetch` rejects with exactly this for a dead network. It is also what a CORS
 * failure looks like, which is why it is only trusted as `offline` together with
 * the browser's own online flag (see `classifyServerError`).
 */
const NETWORK_MESSAGES = ['failed to fetch', 'network request failed', 'load failed'] as const;

function errorRecord(error: unknown): Record<string, unknown> | null {
  if (!error || typeof error !== 'object') return null;
  return error as Record<string, unknown>;
}

function errorCode(error: unknown): string {
  const record = errorRecord(error);
  const code = record?.code;
  return typeof code === 'string' ? code : '';
}

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error.toLowerCase();
  const record = errorRecord(error);
  const message = record?.message;
  return typeof message === 'string' ? message.toLowerCase() : '';
}

function errorStatus(error: unknown): number | null {
  const record = errorRecord(error);
  const status = record?.status ?? record?.statusCode;
  return typeof status === 'number' ? status : null;
}

function looksLikeNetworkFailure(error: unknown): boolean {
  const message = errorMessage(error);
  const name = errorRecord(error)?.name;
  const isTypeError = error instanceof TypeError || name === 'TypeError';
  return NETWORK_MESSAGES.some((needle) => message.includes(needle))
    && (isTypeError || message.length > 0);
}

/**
 * Is the browser reporting no network right now?
 *
 * `navigator.onLine === false` is trustworthy in the negative direction (the OS
 * says there is no link). `true` proves nothing, so it is never used to rule
 * `offline` out on its own.
 */
function browserIsOffline(online?: boolean): boolean {
  if (typeof online === 'boolean') return !online;
  if (typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean') return false;
  return !navigator.onLine;
}

/**
 * Classify a Supabase/PostgREST/fetch failure into one kind plus Korean copy.
 *
 * Order matters and is deliberate:
 *
 * 1. `offline` first when the device says it has no network, because in that
 *    state every other signal is a downstream symptom.
 * 2. Explicit codes next, because they are authoritative.
 * 3. HTTP status next.
 * 4. Message sniffing last, since it is the least reliable.
 *
 * @param error  Anything thrown or returned by a Supabase call.
 * @param options.online Override for `navigator.onLine`, so callers that
 *   already track connectivity (and tests) do not depend on the global.
 */
export function classifyServerError(
  error: unknown,
  options: { online?: boolean } = {},
): ClassifiedServerError {
  const offline = browserIsOffline(options.online);
  const code = errorCode(error);
  const status = errorStatus(error);
  const message = errorMessage(error);

  // A dead network explains everything else, so it wins outright. The one
  // exception is an authoritative auth/permission code: the server clearly did
  // answer, so the device cannot have been offline for that request.
  if (offline && !AUTH_EXPIRED_CODES.has(code) && !FORBIDDEN_CODES.has(code)) {
    return { kind: 'offline', message: MESSAGES.offline };
  }

  if (AUTH_EXPIRED_CODES.has(code)) return { kind: 'auth_expired', message: MESSAGES.auth_expired };
  if (FORBIDDEN_CODES.has(code)) return { kind: 'forbidden', message: MESSAGES.forbidden };
  if (NOT_FOUND_CODES.has(code)) return { kind: 'not_found', message: MESSAGES.not_found };
  if (SERVER_CODES.has(code)) return { kind: 'server', message: MESSAGES.server };

  if (status === 401) return { kind: 'auth_expired', message: MESSAGES.auth_expired };
  if (status === 403) return { kind: 'forbidden', message: MESSAGES.forbidden };
  if (status === 404) return { kind: 'not_found', message: MESSAGES.not_found };
  if (status !== null && status >= 500) return { kind: 'server', message: MESSAGES.server };

  if (AUTH_EXPIRED_MESSAGES.some((needle) => message.includes(needle))) {
    return { kind: 'auth_expired', message: MESSAGES.auth_expired };
  }

  // A bare `TypeError: Failed to fetch` with the browser claiming to be online
  // is still overwhelmingly a connectivity failure from the user's point of
  // view, so it is reported as such rather than as an unexplained error.
  if (looksLikeNetworkFailure(error)) return { kind: 'offline', message: MESSAGES.offline };

  return { kind: 'unknown', message: MESSAGES.unknown };
}

/** Does this kind mean the session must be refreshed or re-established? */
export function isAuthExpired(kind: ServerErrorKind): boolean {
  return kind === 'auth_expired';
}

/**
 * Should the user be invited to retry?
 *
 * `forbidden` and `not_found` are excluded on purpose: repeating the identical
 * request cannot change the answer, so offering 다시 시도 would be a lie.
 */
export function isRetryableKind(kind: ServerErrorKind): boolean {
  switch (kind) {
    case 'offline':
    case 'server':
    case 'unknown':
      return true;
    case 'auth_expired':
    case 'forbidden':
    case 'not_found':
      return false;
  }
}
