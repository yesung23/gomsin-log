import { createClient } from 'npm:@supabase/supabase-js@2';

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

async function removeRecordMedia(
  admin: ReturnType<typeof createClient>,
  coupleId: string,
  recordIds: string[],
) {
  const bucket = admin.storage.from('couple-media');

  for (const recordId of recordIds) {
    const folder = `${coupleId}/${recordId}`;
    let offset = 0;

    while (true) {
      const { data: files, error } = await bucket.list(folder, {
        limit: 100,
        offset,
      });
      if (error) throw error;
      if (!files?.length) break;

      const paths = files
        .filter((file) => file.name && file.name !== '.emptyFolderPlaceholder')
        .map((file) => `${folder}/${file.name}`);

      if (paths.length > 0) {
        const { error: removeError } = await bucket.remove(paths);
        if (removeError) throw removeError;
      }

      if (files.length < 100) break;
      offset += files.length;
    }
  }
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
    console.error('[delete-account] Missing server environment variables');
    return jsonResponse({ error: 'Server configuration error' }, 500);
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
    const { data: memberships, error: membershipError } = await admin
      .from('couple_members')
      .select('couple_id')
      .eq('user_id', user.id);
    if (membershipError) throw membershipError;

    const coupleIds = Array.from(
      new Set((memberships || []).map((row) => row.couple_id).filter(Boolean)),
    );

    const { data: records, error: recordsError } = await admin
      .from('daily_records')
      .select('id, couple_id')
      .eq('user_id', user.id);
    if (recordsError) throw recordsError;

    for (const coupleId of coupleIds) {
      const recordIds = (records || [])
        .filter((record) => record.couple_id === coupleId)
        .map((record) => record.id);
      await removeRecordMedia(admin, coupleId, recordIds);
    }

    const { error: invitationError } = await admin
      .from('invitation_codes')
      .delete()
      .or(`created_by.eq.${user.id},used_by.eq.${user.id}`);
    if (invitationError) throw invitationError;

    const { error: recipientBriefingError } = await admin
      .from('briefings')
      .delete()
      .eq('recipient_id', user.id);
    if (recipientBriefingError) throw recipientBriefingError;

    if (coupleIds.length > 0) {
      const { error: coupleBriefingError } = await admin
        .from('briefings')
        .delete()
        .in('couple_id', coupleIds);
      if (coupleBriefingError) throw coupleBriefingError;

      const { error: disconnectError } = await admin
        .from('couple_members')
        .update({ status: 'disconnected' })
        .in('couple_id', coupleIds)
        .eq('status', 'active');
      if (disconnectError) throw disconnectError;
    }

    const { error: deleteUserError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteUserError) throw deleteUserError;

    return jsonResponse({ success: true });
  } catch (error) {
    console.error('[delete-account] Deletion failed', error);
    return jsonResponse(
      { error: 'Account deletion failed. No local success was reported.' },
      500,
    );
  }
});
