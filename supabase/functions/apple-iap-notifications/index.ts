import { createClient } from 'npm:@supabase/supabase-js@2.111.0';
import { createAdminClientFetch, parseAdminSecretKey } from '../_shared/adminSecret.ts';
import { createAppleIapVerifier } from '../_shared/appleIapVerifier.ts';
import { handleAppleIapNotification } from './handler.ts';
import { buildVerifiedNotificationRpcArgs } from './rpc.ts';

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'E_METHOD_NOT_ALLOWED' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const url = Deno.env.get('SUPABASE_URL');
  const secret = parseAdminSecretKey(Deno.env.get('SUPABASE_SECRET_KEYS'));
  let verifier: ReturnType<typeof createAppleIapVerifier>;
  if (!url || !secret) {
    return new Response(JSON.stringify({ error: 'E_IAP_NOT_CONFIGURED' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    verifier = createAppleIapVerifier();
  } catch {
    return new Response(JSON.stringify({ error: 'E_IAP_NOT_CONFIGURED' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const admin = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: createAdminClientFetch(url, secret) },
  });

  return handleAppleIapNotification(request, {
    now: Date.now,
    verifyNotification: verifier.verifyNotification,
    verifyTransaction: verifier.verifyTransaction,
    persistVerifiedNotification: async ({
      notification,
      transaction,
      notificationJwsSha256,
      transactionJwsSha256,
      receivedAtMs,
    }) => {
      const args = await buildVerifiedNotificationRpcArgs({
        notification,
        transaction,
        notificationJwsSha256,
        transactionJwsSha256,
        receivedAtMs,
      });
      const { data, error } = await admin.rpc('iap_process_verified_notification_v2', args);
      const row = Array.isArray(data) ? data[0] : null;
      if (error || !row) throw new Error('E_IAP_PERSIST_FAILED');
      return { duplicate: row.duplicate === true, stale: row.stale === true };
    },
  });
});
