import { createClient } from 'npm:@supabase/supabase-js@2';

/**
 * create-media-signed-url
 *
 * couple-media 버킷은 비공개이므로 클라이언트가 직접 Signed URL을 만들지 않고
 * 이 함수가 권한을 검증한 뒤 짧은 만료시간의 URL만 발급합니다.
 *
 * 검증 순서
 *  1. Bearer 토큰으로 사용자 확인
 *  2. 경로 형식 확인: {coupleId}/{recordId}/{filename}
 *  3. 요청자가 해당 커플의 active 멤버인지 확인
 *  4. 해당 레코드가 그 커플 소속이고, 공개 기록이거나 본인 기록인지 확인
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SIGNED_URL_TTL_SECONDS = 60 * 10; // 10분

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    console.error('[create-media-signed-url] Missing server environment variables');
    return jsonResponse({ error: 'Server configuration error' }, 500);
  }

  let path: string | undefined;
  try {
    const body = await request.json();
    path = typeof body?.path === 'string' ? body.path : undefined;
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  if (!path) {
    return jsonResponse({ error: 'path is required' }, 400);
  }
  // 경로 조작(상위 디렉터리 접근) 차단
  if (path.includes('..') || path.startsWith('/')) {
    return jsonResponse({ error: 'Invalid path' }, 400);
  }

  const segments = path.split('/');
  if (segments.length !== 3) {
    return jsonResponse({ error: 'Invalid path' }, 400);
  }
  const [coupleId, recordId] = segments;
  if (!UUID_PATTERN.test(coupleId) || !UUID_PATTERN.test(recordId)) {
    return jsonResponse({ error: 'Invalid path' }, 400);
  }

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
    // 3. active 멤버십 확인
    const { data: membership, error: membershipError } = await admin
      .from('couple_members')
      .select('couple_id')
      .eq('user_id', user.id)
      .eq('couple_id', coupleId)
      .eq('status', 'active')
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership) {
      return jsonResponse({ error: 'Forbidden' }, 403);
    }

    // 4. 레코드 접근 권한 확인 (비공개 기록은 작성자만)
    const { data: record, error: recordError } = await admin
      .from('daily_records')
      .select('id, user_id, is_private')
      .eq('id', recordId)
      .eq('couple_id', coupleId)
      .maybeSingle();
    if (recordError) throw recordError;
    if (!record) {
      return jsonResponse({ error: 'Not found' }, 404);
    }
    if (record.is_private && record.user_id !== user.id) {
      return jsonResponse({ error: 'Forbidden' }, 403);
    }

    const { data, error: signError } = await admin.storage
      .from('couple-media')
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
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
