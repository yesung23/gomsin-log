import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { runServerMutationBehindDeletionBarrier } from '@/lib/accountDeletion';
import { MAX_AVATAR_BYTES } from '@/lib/avatarImage';

export const MAX_PROFILE_AVATAR_BYTES = MAX_AVATAR_BYTES;
const JPEG_PREFIX = 'data:image/jpeg;base64,';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_TIMEOUT_MS = 15_000;
export interface ProfileAvatar { version: string | null; dataUrl: string | null }
export type AvatarReadResult = { ok: true; avatar: ProfileAvatar } | { ok: false };
export type AvatarSaveResult = { ok: true; avatar: ProfileAvatar } | { ok: false; reason: 'conflict' | 'unavailable' };

// This is the transport limit, not proof of a valid image. Migration 089 checks
// the JPEG structure/dimensions; browser decoding must still fail to a fallback.
function validJpegBase64(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_PROFILE_AVATAR_BYTES / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false;
  try {
    const bytes = atob(value);
    return bytes.length >= 4 && bytes.length <= MAX_PROFILE_AVATAR_BYTES
      && bytes.charCodeAt(0) === 255 && bytes.charCodeAt(1) === 216
      && bytes.charCodeAt(bytes.length - 2) === 255 && bytes.charCodeAt(bytes.length - 1) === 217;
  } catch { return false; }
}

function row(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

async function avatarRpc(name: string, params: Record<string, unknown>, signal?: AbortSignal) {
  if (!isSupabaseConfigured || !supabase) throw new Error('Avatar service unavailable');
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, REQUEST_TIMEOUT_MS);
  try {
    return await supabase.rpc(name, params).abortSignal(controller.signal);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export async function readProfileAvatar(ownerId: string, signal?: AbortSignal): Promise<AvatarReadResult> {
  if (!UUID.test(ownerId)) return { ok: false };
  try {
    const { data, error } = await avatarRpc('get_profile_avatar', { p_owner_user_id: ownerId }, signal);
    if (error) return { ok: false };
    if (data === null) return { ok: true, avatar: { version: null, dataUrl: null } };
    if (!row(data) || data.user_id !== ownerId || typeof data.version !== 'string' || !UUID.test(data.version)
      || (data.jpeg_base64 !== null && !validJpegBase64(data.jpeg_base64))) return { ok: false };
    return { ok: true, avatar: {
      version: data.version,
      dataUrl: data.jpeg_base64 === null ? null : `${JPEG_PREFIX}${data.jpeg_base64}`,
    } };
  } catch { return { ok: false }; }
}

export async function saveProfileAvatar(input: {
  ownerId: string; expectedVersion: string | null; operationId: string; dataUrl: string | null;
}): Promise<AvatarSaveResult> {
  const { ownerId, expectedVersion, operationId, dataUrl } = input;
  const base64 = dataUrl?.startsWith(JPEG_PREFIX) ? dataUrl.slice(JPEG_PREFIX.length) : null;
  if (!UUID.test(ownerId) || !UUID.test(operationId)
    || (expectedVersion !== null && !UUID.test(expectedVersion))
    || (dataUrl !== null && !validJpegBase64(base64))) return { ok: false, reason: 'unavailable' };
  try {
    const outcome = await runServerMutationBehindDeletionBarrier(async ({ assertCurrent }): Promise<AvatarSaveResult> => {
      assertCurrent();
      try {
        const { data, error } = await avatarRpc('set_my_profile_avatar', {
          p_expected_user_id: ownerId, p_expected_version: expectedVersion,
          p_operation_id: operationId, p_jpeg_base64: base64,
        });
        assertCurrent();
        if (error?.code === '40001') return { ok: false, reason: 'conflict' };
        if (!error && row(data) && data.user_id === ownerId && data.version === operationId) {
          return { ok: true, avatar: { version: operationId, dataUrl } };
        }
      } catch {
        // The server may have committed before its response was lost. Never
        // blindly repeat a replacement with a newly generated version.
      }
      assertCurrent();
      const check = await readProfileAvatar(ownerId);
      assertCurrent();
      return check.ok && check.avatar.version === operationId && check.avatar.dataUrl === dataUrl
        ? { ok: true, avatar: check.avatar }
        : { ok: false, reason: 'unavailable' };
    }, { expectedUserId: ownerId, policy: 'best_effort' });
    return outcome.kind === 'executed' ? outcome.value : { ok: false, reason: 'unavailable' };
  } catch { return { ok: false, reason: 'unavailable' }; }
}
