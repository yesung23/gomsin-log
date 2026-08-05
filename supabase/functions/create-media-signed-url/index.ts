import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  MEDIA_BUCKET,
  SIGNED_URL_TTL_SECONDS,
  decideMediaAccess,
  parseMediaPath,
  pathRejectionStatus,
} from './authorize.ts';

/**
 * create-media-signed-url
 *
 * couple-media 버킷은 비공개(public=false)이므로 클라이언트가 직접 Signed URL을
 * 만들지 않고, 이 함수가 권한을 검증한 뒤 짧은 만료시간의 URL만 발급합니다.
 *
 * 검증 순서
 *  1. Bearer 토큰으로 사용자 확인 (service-role 키는 절대 응답에 포함하지 않음)
 *  2. 경로 형식 확인: {coupleId}/{recordId}/{uuid}.{ext} — 임의 경로 서명 차단
 *  3. 요청자가 해당 커플의 active 멤버인지 확인
 *  4. 레코드가 그 커플 소속이고, 공개 기록이거나 본인 기록인지 확인
 *
 * 배포 (이 저장소에서는 실행하지 않음):
 *   supabase functions deploy create-media-signed-url
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Authentication required' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    // 설정 문제는 서버 로그로만 남기고 클라이언트에는 상세를 노출하지 않습니다.
    console.error('[create-media-signed-url] Missing server environment variables');
    return jsonResponse({ error: 'Server configuration error' }, 500);
  }

  let rawPath: unknown;
  try {
    const body = await request.json();
    rawPath = body?.path;
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  const parsedPath = parseMediaPath(rawPath);
  if (!parsedPath.ok) {
    return jsonResponse(
      { error: parsedPath.reason === 'missing' ? 'path is required' : 'Invalid path' },
      pathRejectionStatus(parsedPath.reason),
    );
  }
  const { coupleId, recordId } = parsedPath.value;

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const token = authorization.slice('Bearer '.length);
  const {
    data: { user },
    error: userError,
  } = await admin.auth.getUser(token);

  if (userError || !user) {
    return jsonResponse({ error: 'Invalid or expired session' }, 401);
  }

  try {
    const { data: membership, error: membershipError } = await admin
      .from('couple_members')
      .select('couple_id')
      .eq('user_id', user.id)
      .eq('couple_id', coupleId)
      .eq('status', 'active')
      .maybeSingle();
    if (membershipError) throw membershipError;

    const { data: record, error: recordError } = await admin
      .from('daily_records')
      .select('id, user_id, is_private')
      .eq('id', recordId)
      .eq('couple_id', coupleId)
      .maybeSingle();
    if (recordError) throw recordError;

    const decision = decideMediaAccess({
      userId: user.id,
      parsed: parsedPath.value,
      membership: membership ?? null,
      record: record ?? null,
    });
    if (!decision.allow) {
      return jsonResponse({ error: decision.error }, decision.status);
    }

    const { data, error: signError } = await admin.storage
      .from(MEDIA_BUCKET)
      .createSignedUrl(parsedPath.value.coupleId + '/' + parsedPath.value.recordId + '/' + parsedPath.value.fileName, SIGNED_URL_TTL_SECONDS);
    if (signError || !data?.signedUrl) throw signError || new Error('Failed to sign URL');

    return jsonResponse({
      signedUrl: data.signedUrl,
      expiresIn: SIGNED_URL_TTL_SECONDS,
    });
  } catch (error) {
    console.error('[create-media-signed-url] Failed', error);
    return jsonResponse({ error: 'Failed to create signed URL' }, 500);
  }
});
