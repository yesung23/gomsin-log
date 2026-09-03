import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Browser } from '@capacitor/browser';
import { authRedirectUrl, isNativePlatform } from '@/lib/platform';
import {
  classifyDeletionErrorBody,
  classifyDeletionSuccess,
  serverCallBlockedByPendingDeletion,
  type AccountDeletionOutcome,
} from '@/lib/accountDeletion';
import {
  classifyServerError,
  isSchemaCacheMiss,
  schemaCacheMissLog,
  serverErrorMessage,
  type ServerErrorKind,
} from '@/lib/serverErrors';
import { parseRemoteCoupleState, type RemoteCoupleState } from '@/lib/coupleLifecycle';
import type { AuthUser, IAuthRepository, Role } from '@/types';
import { createPkceTimeoutFetch } from '@/lib/oauthPkce';
import { appleLoginEnabled } from '@/lib/appleLoginFeature';

/**
 * Supabase environment variables configuration.
 * NEVER put service_role, DB password, or API secrets in client env!
 */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = !!(SUPABASE_URL && SUPABASE_KEY);

export type AuthProviderAvailability = {
  google: boolean;
  apple: boolean;
  email: boolean;
};

export const AUTH_PROVIDER_AVAILABILITY_TIMEOUT_MS = 8_000;

type AuthProviderAvailabilityRequest = {
  supabaseUrl: string;
  publishableKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/**
 * Parse GoTrue's public settings response without trusting its shape.
 * Missing or malformed flags stay disabled so the UI never advertises a login
 * method that is guaranteed to fail.
 */
export function parseAuthProviderAvailability(body: unknown): AuthProviderAvailability {
  const external = body && typeof body === 'object'
    ? (body as { external?: unknown }).external
    : null;
  const flags = external && typeof external === 'object'
    ? external as Record<string, unknown>
    : {};
  return {
    google: flags.google === true,
    apple: flags.apple === true,
    email: flags.email === true,
  };
}

/**
 * Ask the configured Auth server which sign-in methods are actually enabled.
 * The endpoint and publishable key are public by design; no user token or account
 * data is sent. `null` means the availability check itself could not complete.
 */
export async function fetchAuthProviderAvailabilityFrom({
  supabaseUrl,
  publishableKey,
  fetchImpl = globalThis.fetch.bind(globalThis),
  timeoutMs = AUTH_PROVIDER_AVAILABILITY_TIMEOUT_MS,
}: AuthProviderAvailabilityRequest): Promise<AuthProviderAvailability | null> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: publishableKey },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error('[gomsinlog] Auth provider settings request failed:', response.status);
      return null;
    }
    return parseAuthProviderAvailability(await response.json());
  } catch (error) {
    console.error('[gomsinlog] Auth provider settings request failed.');
    return null;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

export async function fetchAuthProviderAvailability(): Promise<AuthProviderAvailability | null> {
  if (!isSupabaseConfigured) return null;
  return fetchAuthProviderAvailabilityFrom({
    supabaseUrl: SUPABASE_URL,
    publishableKey: SUPABASE_KEY,
  });
}

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        // AuthCallbackPage owns the web code exchange. Letting the client also
        // auto-detect the same single-use PKCE code creates two consumers: the
        // automatic exchange removes the verifier while the page's fallback is
        // still waiting, which can strand a valid Google callback with
        // `AuthPKCECodeVerifierMissingError`.
        detectSessionInUrl: false,
        // Pinned explicitly so every OAuth callback carries an authorization
        // code that AuthCallbackPage can exchange exactly once.
        flowType: 'pkce',
        experimental: {
          appendPkceFlowIdToRedirects: true,
        },
      },
      global: {
        fetch: createPkceTimeoutFetch(globalThis.fetch.bind(globalThis)),
      },
    })
  : null;

/**
 * Hash invitation code using Web Crypto API SHA-256.
 * Normalizes code (trim + uppercase) before hashing.
 */
export async function hashInvitationCode(code: string): Promise<string> {
  const normalized = code.trim().toUpperCase();
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a 6-digit invitation code using a cryptographically secure RNG.
 *
 * `Math.random()` is not suitable here: its output is predictable, which would
 * let an attacker guess codes that are valid for the next 24 hours.
 * Rejection sampling keeps the distribution uniform across 100000-999999.
 */
export function generateInvitationCode(): string {
  const range = 900000; // 100000..999999
  const limit = Math.floor(0xffffffff / range) * range;
  const buf = new Uint32Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buf);
    value = buf[0];
  } while (value >= limit);
  return String(100000 + (value % range));
}

/**
 * Persist the couple anniversary on the shared `couples` row.
 */
export async function saveCoupleAnniversary(
  coupleId: string,
  anniversaryDate: string | null,
): Promise<boolean> {
  if (!supabase || !coupleId) return false;
  const { data, error } = await supabase
    .from('couples')
    .update({ anniversary_date: anniversaryDate, updated_at: new Date().toISOString() })
    .eq('id', coupleId)
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('[gomsinlog] Failed to save anniversary date.');
    return false;
  }
  if (data?.id !== coupleId) {
    console.error('[gomsinlog] Anniversary update matched no accessible couple row.');
    return false;
  }
  return true;
}

/** Draws before giving up on finding a code hash that is not already in use. */
const INVITATION_CODE_ATTEMPTS = 5;

/**
 * Did the unused-code-hash uniqueness index reject this issuance?
 *
 * Migration 015 keeps at most one unused hash so a redeemer can never be routed
 * to the wrong couple. The trade-off is that issuing a code can collide, which
 * is retryable rather than an error worth showing anyone.
 */
function isInvitationCodeCollision(error: { code?: string; message?: string }): boolean {
  return error.code === '23505'
    || (error.message || '').includes('idx_invitation_codes_one_unused_hash');
}

/**
 * Why couple creation failed, when the reason is one the caller can act on.
 *
 * `already_in_couple` is the recoverable one: the account owns a space already,
 * which happens whenever onboarding was abandoned after step 3, because
 * `create_couple_and_invitation` writes the membership before onboarding writes
 * the `profiles` row.
 */
export type CoupleCreationReason = 'already_in_couple';

/**
 * Does this RPC error mean "you already own a couple space"?
 *
 * Still a text match, because `create_couple_and_invitation` reports it with a
 * bare `RAISE` and no `error_code` -- there is nothing else to key on. What the
 * move buys is that the match now lives ONCE, next to the RPC call it describes,
 * instead of in a page that had no way to know which migration produced which
 * wording (009, 013 and 015 all differ, and all mean the same recoverable thing).
 */
function isAlreadyInCoupleMessage(message?: string): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return normalized.includes('already in an active couple')
    || normalized.includes('already in a couple')
    || normalized.includes('active couple');
}

/**
 * Create a new couple in Supabase and generate invitation code via RPC.
 */
export async function createCoupleInvitation(role: Role): Promise<{
  coupleId: string;
  code: string;
  error?: string;
  reason?: CoupleCreationReason;
}> {
  if (!supabase) {
    return {
      coupleId: '',
      code: '',
      error: '서비스 연결 설정이 완료되지 않아 커플 공간을 만들 수 없어요. 운영자에게 문의해 주세요.',
    };
  }

  try {
    // Pre-flight: placed ahead of the caller-verification read as well, so that
    // a pending deletion aborts before ANY request is issued, not merely before
    // the mutation.
    if (await serverCallBlockedByPendingDeletion()) {
      return { coupleId: '', code: '', error: '탈퇴 처리가 진행 중이어서 커플 공간을 만들 수 없어요.' };
    }
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      return { coupleId: '', code: '', error: '인증되지 않은 사용자입니다. 로그인 후 다시 시도해주세요.' };
    }

    // Only one unused code hash may exist at a time, so a six-digit code that
    // happens to match another couple's outstanding invitation is rejected.
    // The server cannot pick a different code -- it only ever sees the hash --
    // so drawing again is the client's job.
    for (let attempt = 1; attempt <= INVITATION_CODE_ATTEMPTS; attempt += 1) {
      const code = generateInvitationCode();
      const codeHash = await hashInvitationCode(code);

      // Atomic SECURITY DEFINER RPC creating couple, member and invitation.
      const { data: coupleIdData, error: rpcError } = await supabase.rpc('create_couple_and_invitation', {
        p_role: role,
        p_code_hash: codeHash,
      });

      if (!rpcError) return { coupleId: coupleIdData as string, code };
      if (isInvitationCodeCollision(rpcError) && attempt < INVITATION_CODE_ATTEMPTS) continue;
      if (isInvitationCodeCollision(rpcError)) {
        return {
          coupleId: '',
          code: '',
          error: '초대 코드를 발급하지 못했습니다. 잠시 후 다시 시도해 주세요.',
        };
      }
      // `already_in_couple` is a recoverable product state, not an error to show:
      // the caller turns it into the "recover your existing space" flow, so the
      // raw message is still carried for that branch only.
      if (isAlreadyInCoupleMessage(rpcError.message)) {
        return {
          coupleId: '',
          code: '',
          error: '이미 만들어진 커플 공간이 있어요.',
          reason: 'already_in_couple' as const,
        };
      }
      // Everything else goes through the classifier. Returning `rpcError.message`
      // verbatim put raw Postgres/PostgREST English into a Korean toast -- the one
      // invitation path that bypassed `classifyServerError`.
      return {
        coupleId: '',
        code: '',
        error: `커플 공간을 만들지 못했어요. ${classifyServerError(rpcError).message}`,
      };
    }
    return { coupleId: '', code: '', error: '커플 공간 생성에 실패했습니다.' };
  } catch (err: any) {
    if (isAlreadyInCoupleMessage(err?.message)) {
      return {
        coupleId: '',
        code: '',
        error: '이미 만들어진 커플 공간이 있어요.',
        reason: 'already_in_couple' as const,
      };
    }
    return {
      coupleId: '',
      code: '',
      error: `커플 공간을 만들지 못했어요. ${classifyServerError(err).message}`,
    };
  }
}

/**
 * Client-side brute-force damper for invitation codes.
 *
 * This is only a first line of defence for the honest UI path -- it is trivially
 * bypassed by calling an RPC directly, so migration 015's `redeem_invitation`
 * also serializes and rate-limits attempts. Keeping this local guard gives
 * immediate feedback and avoids hammering the server.
 */
const INVITE_ATTEMPT_LIMIT = 5;
const INVITE_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const inviteAttempts: number[] = [];

export function __resetInviteAttemptsForTest() {
  inviteAttempts.length = 0;
}

function registerInviteAttempt(): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  while (inviteAttempts.length > 0 && now - inviteAttempts[0] > INVITE_ATTEMPT_WINDOW_MS) {
    inviteAttempts.shift();
  }
  if (inviteAttempts.length >= INVITE_ATTEMPT_LIMIT) {
    const retryAfterSeconds = Math.ceil(
      (INVITE_ATTEMPT_WINDOW_MS - (now - inviteAttempts[0])) / 1000,
    );
    return { allowed: false, retryAfterSeconds };
  }
  inviteAttempts.push(now);
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Clear the local damper after a successful redemption. */
function clearInviteAttempts() {
  inviteAttempts.length = 0;
}

type InvitationRedemptionResult = {
  ok: boolean;
  couple_id: string | null;
  error_code: string | null;
};

function parseInvitationRedemptionResult(value: unknown): InvitationRedemptionResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (typeof result.ok !== 'boolean') return null;
  if (result.couple_id !== null && typeof result.couple_id !== 'string') return null;
  if (result.error_code !== null && typeof result.error_code !== 'string') return null;
  return {
    ok: result.ok,
    couple_id: result.couple_id as string | null,
    error_code: result.error_code as string | null,
  };
}

/**
 * One structured verdict per `error_code` migration 015 can return.
 *
 * `reason` is present only where the cause is one the rest of the app already
 * models, so the caller can route recovery (a session refresh) instead of merely
 * toasting. The two that used to be missing were the two that mattered most:
 * `not_authenticated` (`015:117-121`) and `internal_error` (`015:250,271`) both
 * fell through to the transient-retry default, so an unusable session and a
 * server-side bug were indistinguishable from "try again in a moment".
 */
function invitationErrorVerdict(
  errorCode: string | null,
): { message: string; reason?: ServerErrorKind } {
  switch (errorCode) {
    case 'rate_limited':
      return { message: '초대 코드 시도 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요.' };
    case 'invalid_or_expired':
    case 'invalid_request':
      return { message: '유효하지 않거나 만료된 초대 코드입니다. (유효기간: 24시간)' };
    // Migration 015 no longer returns this: telling the caller the space was
    // full confirmed that their guessed hash matched a live invitation. Kept so
    // a project still on 013 during a deploy window stays readable.
    case 'couple_full':
      return { message: '이미 2명이 참여한 커플 공간입니다.' };
    case 'already_connected':
      return { message: '이미 다른 커플 공간에 연결되어 있습니다. 먼저 연결을 해제해 주세요.' };
    case 'self_invitation':
      return { message: '내가 만든 초대 코드로는 연결할 수 없습니다. 상대방에게 코드를 전달해 주세요.' };
    case 'not_authenticated':
      // The session, not the code, is the problem. Retrying the same request
      // cannot help, so the copy must not invite it.
      return {
        message: `초대 코드를 확인하지 못했습니다. ${serverErrorMessage('auth_expired')}`,
        reason: 'auth_expired',
      };
    case 'internal_error':
      // The server admitted its own failure. Reusing the central `server` copy
      // keeps it distinct from an expired session and from a bad code.
      return {
        message: `초대 코드를 확인하지 못했습니다. ${serverErrorMessage('server')}`,
        reason: 'server',
      };
    default:
      return { message: '초대 코드를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
  }
}

/** Consume an invitation through migration 015's sole authenticated API. */
export async function consumeCoupleInvitation(
  code: string,
): Promise<{ coupleId?: string; error?: string; reason?: ServerErrorKind }> {
  const normalized = code.trim();
  if (!/^\d{6}$/.test(normalized)) {
    return { error: '초대 코드는 숫자 6자리입니다. 다시 확인해 주세요.' };
  }

  if (!supabase) {
    return { error: '서비스 연결 설정이 완료되지 않아 초대 코드를 확인할 수 없어요. 운영자에게 문의해 주세요.' };
  }

  const throttle = registerInviteAttempt();
  if (!throttle.allowed) {
    const minutes = Math.max(1, Math.ceil(throttle.retryAfterSeconds / 60));
    return { error: `시도 횟수가 많습니다. 약 ${minutes}분 후에 다시 시도해 주세요.` };
  }

  try {
    const codeHash = await hashInvitationCode(normalized);
    // Pre-flight: a pending deletion aborts this write before it is issued.
    if (await serverCallBlockedByPendingDeletion()) {
      return { error: '탈퇴 처리가 진행 중이어서 초대 코드를 사용할 수 없어요.' };
    }
    const { data, error } = await supabase.rpc('redeem_invitation', { p_code_hash: codeHash });

    if (error) {
      if (error.code === 'PGRST202') {
        return {
          error: '서버에 안전한 초대 코드 확인 기능이 아직 배포되지 않았습니다. 관리자에게 문의해 주세요.',
          reason: 'server',
        };
      }
      console.error('[gomsinlog] redeem_invitation failed.');
      // Classified exactly like the `catch` branch below. Left unclassified, the
      // same 401 or 42501 read as a transient hiccup or as a permission problem
      // depending only on how supabase-js chose to surface it.
      const classified = classifyServerError(error);
      return {
        error: `초대 코드를 확인하지 못했습니다. ${classified.message}`,
        reason: classified.kind,
      };
    }

    const result = parseInvitationRedemptionResult(data);
    if (!result) {
      // Migration 013 returned a bare UUID. Refuse that legacy shape instead of
      // falling back to consume_invitation and bypassing durable throttling.
      console.error('[gomsinlog] Unexpected redeem_invitation result; migration 015 is required.');
      return {
        error: '서버에 안전한 초대 코드 확인 기능이 아직 배포되지 않았습니다. 관리자에게 문의해 주세요.',
      };
    }

    if (!result.ok) {
      const verdict = invitationErrorVerdict(result.error_code);
      return { error: verdict.message, reason: verdict.reason };
    }
    if (!result.couple_id || result.error_code !== null) {
      console.error('[gomsinlog] Invalid successful redeem_invitation result.');
      return { error: '초대 코드를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
    }

    clearInviteAttempts();
    return { coupleId: result.couple_id };
  } catch (err: any) {
    console.error('[gomsinlog] redeem_invitation threw.');
    // The raw cause is in hand, so classify it. Blaming the internet
    // unconditionally told users with an expired session or an RLS rejection to
    // fix a connection that was already working.
    // Classified twice rather than hoisted into a local: `classifyServerError` is
    // pure and allocation-cheap, and `serverErrorCopy.test.ts` pins this exact
    // expression as the proof that the copy shown here comes from the classifier.
    return {
      error: `초대 코드를 확인하지 못했습니다. ${classifyServerError(err).message}`,
      reason: classifyServerError(err).kind,
    };
  }
}

/**
 * Mint a fresh invitation code for the caller's existing couple.
 *
 * Needed because the server only stores a hash of the code: if the creator
 * clears their browser storage before the partner joins, the plaintext code is
 * gone and the unique-active-couple constraint prevents creating a new space.
 */
export async function regenerateCoupleInvitation(): Promise<{ code?: string; error?: string }> {
  if (!supabase) {
    return { error: '서비스 연결 설정이 완료되지 않아 초대 코드를 발급할 수 없어요. 운영자에게 문의해 주세요.' };
  }
  // Pre-flight: a pending deletion aborts this write before it is issued.
  if (await serverCallBlockedByPendingDeletion()) {
    return { error: '탈퇴 처리가 진행 중이어서 초대 코드를 새로 만들 수 없어요.' };
  }

  try {
    for (let attempt = 1; attempt <= INVITATION_CODE_ATTEMPTS; attempt += 1) {
      const code = generateInvitationCode();
      const codeHash = await hashInvitationCode(code);
      const { error } = await supabase.rpc('regenerate_invitation', { p_code_hash: codeHash });
      if (!error) return { code };
      // PGRST202 = the function is not deployed on this project yet.
      if (error.code === 'PGRST202') {
        return {
          error:
            '서버에 초대 코드 재발급 기능이 아직 배포되지 않았습니다. 관리자에게 문의해 주세요.',
        };
      }
      if ((error.message || '').includes('No active couple')) {
        return { error: '연결할 커플 공간이 없습니다. 먼저 우리 공간을 만들어 주세요.' };
      }
      if ((error.message || '').includes('already connected')) {
        return { error: '이미 두 사람이 연결되어 있어 초대 코드가 필요하지 않습니다.' };
      }
      // A collided draw is retryable; anything else is not.
      if (isInvitationCodeCollision(error) && attempt < INVITATION_CODE_ATTEMPTS) continue;
      if (!isInvitationCodeCollision(error)) {
        console.error('[gomsinlog] regenerate_invitation failed.');
      }
      return { error: '초대 코드를 재발급하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
    }
    return { error: '초대 코드를 재발급하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
  } catch (err: any) {
    console.error('[gomsinlog] regenerate_invitation threw.');
    return { error: '초대 코드 재발급 중 오류가 발생했습니다.' };
  }
}

/**
 * Read this account's couple lifecycle from the server.
 *
 * Migration 013 revoked all client SELECT on `invitation_codes`, so there is no
 * table the client may read to tell "pending creator with a live code" from
 * "personal, no space" from "code expired". Migration 016 adds
 * `public.get_my_couple_state()` as the single SECURITY DEFINER answer to that
 * question. It returns membership, partner presence and invitation validity --
 * never a code and never a hash.
 *
 * Read-only, so it is deliberately NOT behind the deletion gate: it is also the
 * call that tells a recovering client what workspace it is looking at.
 */
export async function fetchMyCoupleState(): Promise<
  { ok: true; state: RemoteCoupleState | null }
  /**
   * `schemaGap` marks the one failure a retry can never fix: the RPC is not in
   * the PostgREST schema cache, so migration 016 is unapplied (or applied without
   * a reload). Without this flag it arrives as an ordinary `server` reason and the
   * user is told to try again shortly, which for an unapplied migration is a lie
   * about retryability -- and the record-save path resolves membership through
   * this exact RPC, so it is the difference between "the server needs a deploy"
   * and an unexplained save failure.
   */
  | { ok: false; reason: ServerErrorKind; schemaGap?: boolean }
> {
  if (!supabase) return { ok: true, state: null };
  try {
    const { data, error } = await supabase.rpc('get_my_couple_state');
    if (error) {
      // PGRST202 means migration 016 is not applied on this project yet, or it is
      // applied and the schema cache was never reloaded. That is a server-side
      // gap, not an authorization answer, so it must not be allowed to look like
      // "you have no couple space" -- and whoever reads the log needs to be told
      // which deploy step is missing instead of "failed".
      if (isSchemaCacheMiss(error)) {
        console.error(schemaCacheMissLog('get_my_couple_state', '016'));
        return { ok: false, reason: classifyServerError(error).kind, schemaGap: true };
      }
      console.error('[gomsinlog] get_my_couple_state failed.');
      return { ok: false, reason: classifyServerError(error).kind };
    }
    const parsed = parseRemoteCoupleState(data);
    if (!parsed) {
      console.error('[gomsinlog] Unexpected get_my_couple_state payload.');
      return { ok: false, reason: 'server' };
    }
    return { ok: true, state: parsed.coupleId ? parsed : null };
  } catch (err) {
    console.error('[gomsinlog] get_my_couple_state threw.');
    return { ok: false, reason: classifyServerError(err).kind };
  }
}

/**
 * Disconnect active couple using disconnect_couple RPC.
 */
export async function disconnectCoupleFromDB(): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { error } = await supabase.rpc('disconnect_couple');
    if (error) {
      // A silent `false` here was indistinguishable from a permission failure or
      // a dead network, so a missing schema reload looked like an app bug.
      if (isSchemaCacheMiss(error)) {
        console.error(schemaCacheMissLog('disconnect_couple', '015'));
        return false;
      }
      console.error('[gomsinlog] disconnect_couple RPC failed.');
      return false;
    }
    return true;
  } catch (err) {
    console.error('[gomsinlog] Failed to call disconnect_couple RPC.');
    return false;
  }
}

/**
 * Ask the server to delete this account.
 *
 * Returns a three-valued outcome rather than a boolean, because "the request
 * failed" and "your data is gone but your login is not" require completely
 * different handling. The error response BODY carries that distinction and used
 * to be discarded entirely.
 */
export async function deleteAccountFromDB(): Promise<AccountDeletionOutcome> {
  if (!supabase) return { status: 'failed', dataRemoved: false, warnings: [] };

  try {
    const { data, error } = await supabase.functions.invoke('delete-account', {
      method: 'POST',
    });
    if (error) {
      console.error('[gomsinlog] Account deletion request failed.');
      // `FunctionsHttpError.context` is a `Response`. Its body may be consumed
      // only once, so it is read exactly once here and the parsed value is
      // passed on. A relay/fetch error with no `context`, or a parse failure,
      // classifies `failed` -- never a fabricated partial deletion.
      const context = (error as { context?: unknown }).context;
      if (context && typeof (context as Response).json === 'function') {
        try {
          const body: unknown = await (context as Response).json();
          const outcome = classifyDeletionErrorBody(body);
          if (outcome.status === 'partially_deleted') {
            console.error('[gomsinlog] Account deletion ended in a partial state.');
          }
          return outcome;
        } catch {
          console.error('[gomsinlog] Account deletion error body was unreadable.');
          return { status: 'failed', dataRemoved: false, warnings: [] };
        }
      }
      return { status: 'failed', dataRemoved: false, warnings: [] };
    }
    // Require the explicit acknowledgement rather than inferring success from
    // the absence of a transport error, so a partial server-side outcome can
    // never be reported to the user as a completed deletion.
    const outcome = classifyDeletionSuccess(data);
    if (outcome.status !== 'deleted') {
      console.error('[gomsinlog] Account deletion did not confirm success.');
    }
    return outcome;
  } catch {
    console.error('[gomsinlog] Failed to invoke account deletion.');
    return { status: 'failed', dataRemoved: false, warnings: [] };
  }
}

/** Auth repository used only to fail closed when service configuration is absent. */
export class UnconfiguredAuthRepository implements IAuthRepository {
  private currentUser: AuthUser | null = null;

  isConfigured(): boolean {
    return false;
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    return this.currentUser;
  }

  async signInWithGoogle(): Promise<{ error?: string }> {
    return { error: '서비스 연결 설정이 완료되지 않았어요. 운영자에게 문의해 주세요.' };
  }

  async signInWithApple(): Promise<{ error?: string }> {
    return { error: '서비스 연결 설정이 완료되지 않았어요. 운영자에게 문의해 주세요.' };
  }

  async signInWithEmail(_email: string): Promise<{ error?: string }> {
    return { error: '서비스 연결 설정이 완료되지 않았어요. 운영자에게 문의해 주세요.' };
  }

  async signOut(): Promise<void> {
    this.currentUser = null;
  }
}

/**
 * Supabase Auth Repository for live integration.
 */
export class SupabaseAuthRepository implements IAuthRepository {
  isConfigured(): boolean {
    return isSupabaseConfigured;
  }

  async getCurrentUser(): Promise<AuthUser | null> {
    if (!supabase) return null;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return null;
      const provider = (session.user.app_metadata?.provider as 'apple' | 'google') || 'google';
      return {
        id: session.user.id,
        email: session.user.email,
        provider,
      };
    } catch (e) {
      console.error('[gomsinlog] Failed to read the current auth user.');
      return null;
    }
  }

  /**
   * Start an OAuth sign-in.
   *
   * On the web Supabase redirects the page as usual. In the Capacitor shell the
   * provider must open in the system browser -- Google blocks its sign-in page
   * inside an embedded WebView -- so we ask Supabase for the URL instead of
   * navigating, open it in a Custom Tab, and let the `appUrlOpen` deep-link
   * handler (lib/deepLinks.ts) finish the exchange.
   */
  private async startOAuth(provider: 'google' | 'apple'): Promise<{ error?: string }> {
    if (!supabase) {
      return { error: 'Supabase URL 및 Key가 설정되지 않았습니다. .env 환경변수를 확인해주세요.' };
    }

    try {
      const redirectTo = authRedirectUrl();
      const native = isNativePlatform();

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo, skipBrowserRedirect: native },
      });

      if (error) return { error: '로그인을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.' };

      if (native && data?.url) {
        // Statically imported: `src/main.tsx` already pulls in `@/lib/deepLinks`,
        // which imports `@capacitor/browser` statically, so the module is already
        // in the eager graph and there is no bundle-size cost. The
        // `isNativePlatform()` guard still keeps `Browser.open` off the web path.
        await Browser.open({ url: data.url, presentationStyle: 'popover' });
      }
      return {};
    } catch {
      // Static message only: the caught value can carry request/provider detail,
      // and the user-facing copy below already says everything they need.
      console.error('[gomsinlog] OAuth start failed.');
      return { error: '로그인을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.' };
    }
  }

  async signInWithGoogle(): Promise<{ error?: string }> {
    return this.startOAuth('google');
  }

  async signInWithApple(): Promise<{ error?: string }> {
    if (!appleLoginEnabled()) {
      return { error: '로그인을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.' };
    }
    return this.startOAuth('apple');
  }

  async signInWithEmail(email: string): Promise<{ error?: string }> {
    if (!supabase) {
      return { error: 'Supabase URL 및 Key가 설정되지 않았습니다. .env 환경변수를 확인해주세요.' };
    }
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: authRedirectUrl() },
      });
      return {
        error: error
          ? '매직링크를 보내지 못했어요. 이메일 주소를 확인하고 다시 시도해 주세요.'
          : undefined,
      };
    } catch {
      console.error('[gomsinlog] Magic-link request failed.');
      return { error: '매직링크를 보내지 못했어요. 잠시 후 다시 시도해 주세요.' };
    }
  }

  async signOut(): Promise<void> {
    if (!supabase) return;
    await supabase.auth.signOut();
  }
}

/*
 * `SupabaseLogRepository` used to sit here: an exported `ILogRepository` whose
 * `loadState()` logged "placeholder" and returned null and whose `saveState()`
 * only logged. It was never instantiated anywhere -- the store syncs real data
 * through dedicated modules -- so it was a live, importable class that silently
 * discarded state, one wiring mistake away from losing every write. Deleted
 * rather than left as a trap; real server sync goes through `sync.ts`.
 */

// Select active repositories based on configuration
export const authRepository: IAuthRepository = isSupabaseConfigured
  ? new SupabaseAuthRepository()
  : new UnconfiguredAuthRepository();
