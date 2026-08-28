import { createClient } from 'npm:@supabase/supabase-js@2.111.0';
import { handleDeleteAccountRequest } from './handler.ts';
import { createAdminClientFetch } from '../_shared/adminSecret.ts';

/**
 * Thin Deno entrypoint.
 *
 * All request handling lives in `handler.ts` so it can be exercised by the test
 * suite; this file only injects the platform-specific pieces (`Deno.env` and the
 * admin client).
 */
Deno.serve((request) => handleDeleteAccountRequest(request, {
  env: (key) => Deno.env.get(key),
  createAdmin: (url, secretKey) => createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: createAdminClientFetch(url, secretKey) },
  }),
}));
